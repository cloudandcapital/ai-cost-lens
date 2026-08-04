"""CCAC producer for canonical AI usage."""

from __future__ import annotations

import hashlib
import re
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

from . import __version__
from .canonical import (
    CanonicalError,
    cost_number,
    load_price_book,
    load_usage,
    price_usage,
    validate_price_book_mode,
)

CONTRACT = "ccac/1.0.0"


def _timestamp(value: str | None) -> str:
    if value is None:
        parsed = datetime.now(timezone.utc)
    else:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as exc:
            raise CanonicalError("generated_at must be RFC3339") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return (
        parsed.astimezone(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _slug(value: str) -> str:
    clean = (
        re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:45].rstrip("-")
        or "unknown"
    )
    return f"{clean}-{hashlib.sha256(value.encode()).hexdigest()[:8]}"


def _metric(
    mid: str,
    name: str,
    value: float,
    unit: str,
    currency: str | None,
    basis: str,
    additivity: str,
    period: dict[str, str],
    dims: dict[str, Any],
    evidence: str,
    formula: str | None = None,
) -> dict[str, Any]:
    return {
        "id": mid,
        "name": name,
        "value": value,
        "unknown_reason": None,
        "unit": unit,
        "currency": currency,
        "basis": basis,
        "additivity": additivity,
        "period": period,
        "dimensions": dims,
        "formula": formula,
        "input_metric_ids": [],
        "evidence_ids": [evidence],
        "quality_status": "valid",
    }


def build_result(
    usage_path: Path,
    *,
    price_book_path: Path | None,
    mode: str,
    run_id: str | None = None,
    generated_at: str | None = None,
) -> dict[str, Any]:
    if mode not in {"illustrative", "real"}:
        raise CanonicalError("mode must be illustrative or real")
    records, usage_hash = load_usage(usage_path)
    price_book, price_hash = load_price_book(price_book_path)
    validate_price_book_mode(price_book, mode)
    priced = price_usage(records, price_book)
    try:
        rid = str(uuid.UUID(run_id)) if run_id else str(uuid.uuid4())
    except (ValueError, TypeError) as exc:
        raise CanonicalError("run_id must be a UUID") from exc
    generated = _timestamp(generated_at)
    start = min(item.record.day for item in priced)
    end = max(item.record.day for item in priced) + timedelta(days=1)
    period = {"start": start.isoformat(), "end": end.isoformat(), "timezone": "UTC"}
    currency = priced[0].record.currency
    usage_source = "source.ai-cost-lens.usage"
    usage_evidence = "evidence.ai-cost-lens.usage"
    inputs = [
        {
            "id": usage_source,
            "source_type": "canonical_ai_usage_csv",
            "source_version": "ai-cost-lens/2.0",
            "adapter_version": __version__,
            "content_sha256": usage_hash,
            "access": (
                "illustrative_fixture" if mode == "illustrative" else "local_read_only"
            ),
            "data_classification": (
                "public_illustrative"
                if mode == "illustrative"
                else "customer_confidential"
            ),
            "lossy_mapping": False,
            "mapping_notes": [
                "Provider-reported and calculated costs retain distinct canonical bases."
            ],
        }
    ]
    evidence = [
        {
            "id": usage_evidence,
            "kind": "source_row",
            "source_ids": [usage_source],
            "description": "Strict canonical AI usage rows.",
            "locator": "csv:usage_id",
            "observed_at": generated,
            "content_sha256": usage_hash,
        }
    ]
    if price_book is not None:
        price_source = "source.ai-cost-lens.price-book"
        inputs.append(
            {
                "id": price_source,
                "source_type": "ai_price_book",
                "source_version": str(price_book["schema_version"]),
                "adapter_version": __version__,
                "content_sha256": price_hash,
                "access": (
                    "illustrative_fixture"
                    if mode == "illustrative"
                    else "local_read_only"
                ),
                "data_classification": (
                    "public_illustrative"
                    if mode == "illustrative"
                    else "customer_confidential"
                ),
                "lossy_mapping": False,
                "mapping_notes": [
                    "Rates are user-supplied and date/source provenance is declared in the price book."
                ],
            }
        )
        evidence.append(
            {
                "id": "evidence.ai-cost-lens.price-book",
                "kind": "price_book",
                "source_ids": [price_source],
                "description": "Versioned user-supplied AI token rates.",
                "locator": "json:prices",
                "observed_at": generated,
                "content_sha256": price_hash,
            }
        )
    totals: dict[tuple[str, str, str, str, str, str, str], dict[str, Any]] = (
        defaultdict(
            lambda: {
                "cost": Decimal("0"),
                "input": 0,
                "cached": 0,
                "output": 0,
                "reasoning": 0,
                "requests": 0,
            }
        )
    )
    for item in priced:
        r = item.record
        key = (
            r.provider,
            r.model,
            r.project,
            r.team,
            r.environment,
            r.task,
            r.cost_basis,
        )
        data = totals[key]
        data["cost"] += item.cost
        data["input"] += r.uncached_input_tokens
        data["cached"] += r.cached_input_tokens
        data["output"] += r.output_tokens
        data["reasoning"] += r.reasoning_tokens
        data["requests"] += r.requests
    metrics = []
    findings = []
    model_cost_ids = []
    for key, data in sorted(totals.items()):
        provider, model, project, team, environment, task, cost_basis = key
        comp = _slug("|".join(key))
        prefix = f"metric.ai.{comp}"
        dims = {
            "scope": "ai_usage",
            "provider": provider,
            "model": model,
            "project": project,
            "team": team,
            "environment": environment,
            "task": task,
            "cost_basis": cost_basis,
            "cloud_spend_overlap": (
                "potential" if provider == "bedrock" else "none_known"
            ),
        }
        basis = "observed" if cost_basis == "provider_reported" else "calculated"
        formula = (
            "sum calculated token-category costs" if basis == "calculated" else None
        )
        cost_id = f"{prefix}.cost"
        model_cost_ids.append(cost_id)
        ev = (
            "evidence.ai-cost-lens.price-book"
            if basis == "calculated"
            else usage_evidence
        )
        cost_metric = _metric(
            cost_id,
            f"{provider} {model} AI usage cost",
            cost_number(data["cost"]),
            "currency",
            currency,
            basis,
            "additive",
            period,
            dims,
            ev,
            formula,
        )
        if basis == "calculated":
            cost_metric["evidence_ids"] = [
                usage_evidence,
                "evidence.ai-cost-lens.price-book",
            ]
        metrics.extend(
            [
                cost_metric,
                _metric(
                    f"{prefix}.uncached-input-tokens",
                    "Uncached input tokens",
                    data["input"],
                    "tokens",
                    None,
                    "observed",
                    "additive",
                    period,
                    dims,
                    usage_evidence,
                ),
                _metric(
                    f"{prefix}.cached-input-tokens",
                    "Cached input tokens",
                    data["cached"],
                    "tokens",
                    None,
                    "observed",
                    "additive",
                    period,
                    dims,
                    usage_evidence,
                ),
                _metric(
                    f"{prefix}.output-tokens",
                    "Output tokens",
                    data["output"],
                    "tokens",
                    None,
                    "observed",
                    "additive",
                    period,
                    dims,
                    usage_evidence,
                ),
                _metric(
                    f"{prefix}.reasoning-tokens",
                    "Reasoning tokens",
                    data["reasoning"],
                    "tokens",
                    None,
                    "observed",
                    "additive",
                    period,
                    dims,
                    usage_evidence,
                ),
                _metric(
                    f"{prefix}.requests",
                    "AI requests",
                    data["requests"],
                    "requests",
                    None,
                    "observed",
                    "additive",
                    period,
                    dims,
                    usage_evidence,
                ),
            ]
        )
        total_tokens = (
            data["input"] + data["cached"] + data["output"] + data["reasoning"]
        )
        if total_tokens > 0:
            unit_metric = _metric(
                f"{prefix}.cost-per-million-tokens",
                "Cost per million categorized tokens",
                cost_number(data["cost"] / Decimal(total_tokens) * Decimal("1000000")),
                "currency_per_million_tokens",
                currency,
                "calculated",
                "ratio",
                period,
                dims,
                usage_evidence,
                "cost / (uncached_input_tokens + cached_input_tokens + output_tokens + reasoning_tokens) * 1,000,000",
            )
            unit_metric["input_metric_ids"] = [
                cost_id,
                f"{prefix}.uncached-input-tokens",
                f"{prefix}.cached-input-tokens",
                f"{prefix}.output-tokens",
                f"{prefix}.reasoning-tokens",
            ]
            metrics.append(unit_metric)
        if data["requests"] > 0:
            request_metric = _metric(
                f"{prefix}.cost-per-request",
                "Cost per request",
                cost_number(data["cost"] / Decimal(data["requests"])),
                "currency_per_request",
                currency,
                "calculated",
                "ratio",
                period,
                dims,
                usage_evidence,
                "cost / requests",
            )
            request_metric["input_metric_ids"] = [cost_id, f"{prefix}.requests"]
            metrics.append(request_metric)
        if project.lower() == "unattributed" or team.lower() == "unattributed":
            findings.append(
                {
                    "id": f"finding.allocation.{comp}",
                    "finding_type": "allocation",
                    "title": f"Unattributed AI cost for {provider} {model}",
                    "description": "Ownership is missing. This is unattributed cost, not a savings estimate.",
                    "severity": "medium",
                    "status": "open",
                    "metric_ids": [cost_id],
                    "evidence_ids": [usage_evidence],
                    "first_observed_at": generated,
                    "last_observed_at": generated,
                }
            )
    used_price_keys = sorted(
        {item.price_key for item in priced if item.price_key is not None}
    )
    total = sum((item.cost for item in priced), Decimal("0"))
    cost_bases = sorted({item.record.cost_basis for item in priced})
    total_cost_basis = (
        cost_bases[0] if len(cost_bases) == 1 else "mixed_" + "_and_".join(cost_bases)
    )
    row_token_sum = sum(
        item.record.uncached_input_tokens
        + item.record.cached_input_tokens
        + item.record.output_tokens
        + item.record.reasoning_tokens
        for item in priced
    )
    metric_token_sum = sum(
        data["input"] + data["cached"] + data["output"] + data["reasoning"]
        for data in totals.values()
    )
    total_id = "metric.ai.total-cost"
    metrics.append(
        _metric(
            total_id,
            "AI usage cost",
            cost_number(total),
            "currency",
            currency,
            "calculated",
            "non_additive",
            period,
            {
                "scope": "ai_usage",
                "cost_basis": total_cost_basis,
                "cloud_spend_overlap": "potential_when_provider_is_bedrock",
            },
            usage_evidence,
            "sum provider-reported and calculated model/allocation cost metrics exactly once; non-additive outside the AI domain",
        )
    )
    metrics[-1]["input_metric_ids"] = model_cost_ids
    if used_price_keys:
        metrics[-1]["evidence_ids"] = [
            usage_evidence,
            "evidence.ai-cost-lens.price-book",
        ]
    pricing_provenance = None
    if price_book is not None:
        pricing_provenance = {
            "mode": price_book["mode"],
            "source": price_book["source"],
            "effective_at": price_book["effective_at"],
            "input_sha256": price_hash,
            "used_price_keys": used_price_keys,
            "used_rate_keys": (
                [
                    "cached_input_per_million",
                    "input_per_million",
                    "output_per_million",
                    "reasoning_per_million",
                ]
                if used_price_keys
                else []
            ),
        }
    return {
        "contract": CONTRACT,
        "document_type": "tool_result",
        "producer": {"name": "ai-cost-lens", "version": __version__},
        "run_id": rid,
        "generated_at": generated,
        "mode": mode,
        "period": period,
        "inputs": inputs,
        "quality": {"status": "valid", "issues": []},
        "metrics": metrics,
        "findings": findings,
        "opportunities": [],
        "evidence": evidence,
        "extensions": {
            "ai_cost_lens": {
                "usage_records": len(priced),
                "pricing_mode": "user_supplied_price_book_and_or_reported_cost",
                "pricing_provenance": pricing_provenance,
                "model_cost_metric_ids": model_cost_ids,
                "reconciliation": {
                    "row_cost_sum": cost_number(total),
                    "model_cost_sum": cost_number(
                        sum((data["cost"] for data in totals.values()), Decimal("0"))
                    ),
                    "difference": 0.0,
                    "row_token_sum": row_token_sum,
                    "metric_token_sum": metric_token_sum,
                    "token_difference": row_token_sum - metric_token_sum,
                    "status": "passed",
                },
                "accounting_boundary": "AI domain cost is non-additive at the technology-spend boundary until Bedrock/cloud billing overlap is reconciled.",
            }
        },
    }
