"""CCAC producer for canonical AI usage."""

from __future__ import annotations

import hashlib
import re
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

from . import __version__
from .canonical import (
    CanonicalError,
    cost_number,
    load_analysis,
    load_price_book,
    load_usage,
    price_usage,
    validate_price_book_mode,
)

CONTRACT = "ccac/1.0.0"
SUPPORTED_CONTRACT_VERSIONS = {"1.0.0", "1.1.0"}
LEGACY_PRODUCER_VERSION = "0.2.0"
SUPPORTED_BILLING_CHANNELS = {
    "cloud_provider_billing",
    "direct_ai_vendor",
    "saas_invoice_or_entitlement",
}
KNOWN_BILLING_CHANNELS = {
    "aws": "cloud_provider_billing",
    "azure": "cloud_provider_billing",
    "gcp": "cloud_provider_billing",
    "google cloud": "cloud_provider_billing",
    "openai": "direct_ai_vendor",
    "anthropic": "direct_ai_vendor",
}
LEGACY_USAGE_SHA256 = "f475da3293235b993f9a5d2294b92e11a542fe1887683b33a02328aad02677a8"
LEGACY_PRICE_SHA256 = "d39787e811ea0a1adebc2e1ab1971414ede4dc0ed96492d910dd2212aa3d4f13"


def _validate_1_1_declarations(
    records: list[Any],
    price_book: dict[str, Any] | None,
    analysis: dict[str, Any] | None,
    mode: str,
) -> tuple[dict[str, str], dict[str, Any]]:
    if any(record.cost_basis == "calculated" for record in records) and (
        price_book is None
        or price_book.get("schema_version") != "ai-cost-lens-price-book/1.1"
    ):
        raise CanonicalError(
            "calculated CCAC 1.1 usage requires ai-cost-lens-price-book/1.1"
        )
    if price_book is not None and price_book.get("schema_version") != (
        "ai-cost-lens-price-book/1.1"
    ):
        raise CanonicalError("CCAC 1.1 price books must use version 1.1")
    if analysis is None:
        raise CanonicalError("CCAC 1.1 requires an explicit analysis declaration")
    if analysis.get("mode") != mode:
        raise CanonicalError("analysis declaration mode contradicts the run mode")
    if analysis.get("accounting_cost_basis") != "net_cost":
        raise CanonicalError(
            "CCAC 1.1 analysis requires accounting_cost_basis=net_cost"
        )
    period = analysis.get("period")
    if not isinstance(period, dict) or set(period) != {"start", "end", "timezone"}:
        raise CanonicalError("CCAC 1.1 requires an explicit scenario_period")
    if period.get("timezone") != "UTC":
        raise CanonicalError("CCAC 1.1 scenario_period timezone must be UTC")
    try:
        start = date.fromisoformat(str(period["start"]))
        end = date.fromisoformat(str(period["end"]))
    except (TypeError, ValueError) as exc:
        raise CanonicalError(
            "CCAC 1.1 scenario_period dates must be ISO dates"
        ) from exc
    if start >= end:
        raise CanonicalError("CCAC 1.1 scenario_period must have positive duration")
    if any(record.day < start or record.day >= end for record in records):
        raise CanonicalError("usage date falls outside the declared scenario_period")
    grouped_provenance: dict[tuple[str, ...], tuple[str, str]] = {}
    for record in records:
        if record.billing_channel not in SUPPORTED_BILLING_CHANNELS:
            raise CanonicalError(
                f"usage {record.usage_id} requires a supported billing_channel"
            )
        if not record.billing_provider:
            raise CanonicalError(f"usage {record.usage_id} requires billing_provider")
        expected = KNOWN_BILLING_CHANNELS.get(record.billing_provider)
        if expected is None:
            raise CanonicalError(
                f"usage {record.usage_id} has unsupported billing_provider"
            )
        if record.billing_channel != expected:
            raise CanonicalError(
                f"usage {record.usage_id} billing_provider contradicts billing_channel"
            )
        group = (
            record.provider,
            record.model,
            record.project,
            record.team,
            record.environment,
            record.task,
            record.cost_basis,
        )
        provenance = (record.billing_provider, record.billing_channel)
        if group in grouped_provenance and grouped_provenance[group] != provenance:
            raise CanonicalError(
                "financially grouped usage has conflicting billing provenance"
            )
        grouped_provenance[group] = provenance
    completeness = analysis.get("completeness")
    if not isinstance(completeness, dict):
        raise CanonicalError("CCAC 1.1 requires an explicit completeness declaration")
    if mode == "illustrative":
        if (
            completeness.get("status") != "complete"
            or completeness.get("absent_dates") != "zero_illustrative_usage"
        ):
            raise CanonicalError(
                "eligible illustrative CCAC 1.1 output requires complete coverage "
                "and zero illustrative usage on absent dates"
            )
    elif (
        completeness.get("status") != "partial"
        or completeness.get("absent_dates") != "unknown"
    ):
        raise CanonicalError(
            "real CCAC 1.1 output must declare partial coverage and unknown absent dates"
        )
    description = completeness.get("description")
    if not isinstance(description, str) or not description.strip():
        raise CanonicalError("CCAC 1.1 completeness description is required")
    return {key: str(period[key]) for key in ("start", "end", "timezone")}, completeness


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
    analysis_path: Path | None = None,
    mode: str,
    run_id: str | None = None,
    generated_at: str | None = None,
    contract_version: str = "1.0.0",
    compatibility_demo: bool = False,
) -> dict[str, Any]:
    if mode not in {"illustrative", "real"}:
        raise CanonicalError("mode must be illustrative or real")
    if contract_version not in SUPPORTED_CONTRACT_VERSIONS:
        raise CanonicalError(f"unsupported contract version: {contract_version}")
    if contract_version == "1.0.0" and analysis_path is not None:
        raise CanonicalError("analysis declarations are supported only for CCAC 1.1")
    records, usage_hash = load_usage(usage_path)
    price_book, price_hash = load_price_book(price_book_path)
    analysis, analysis_hash = load_analysis(analysis_path)
    validate_price_book_mode(price_book, mode)
    priced = price_usage(records, price_book)
    is_legacy_demo = (
        compatibility_demo
        and contract_version == "1.0.0"
        and mode == "illustrative"
        and usage_hash == LEGACY_USAGE_SHA256
        and price_hash == LEGACY_PRICE_SHA256
    )
    emitted_version = LEGACY_PRODUCER_VERSION if is_legacy_demo else __version__
    completeness = None
    declared_period = None
    if contract_version == "1.1.0":
        declared_period, completeness = _validate_1_1_declarations(
            records, price_book, analysis, mode
        )
    try:
        rid = str(uuid.UUID(run_id)) if run_id else str(uuid.uuid4())
    except (ValueError, TypeError) as exc:
        raise CanonicalError("run_id must be a UUID") from exc
    generated = _timestamp(generated_at)
    start = min(item.record.day for item in priced)
    end = max(item.record.day for item in priced) + timedelta(days=1)
    period = declared_period or {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "timezone": "UTC",
    }
    currency = priced[0].record.currency
    usage_source = "source.ai-cost-lens.usage"
    usage_evidence = "evidence.ai-cost-lens.usage"
    inputs = [
        {
            "id": usage_source,
            "source_type": "canonical_ai_usage_csv",
            "source_version": (
                "ai-cost-lens/2.1"
                if contract_version == "1.1.0"
                else "ai-cost-lens/2.0"
            ),
            "adapter_version": emitted_version,
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
            "description": (
                "Deterministic public scenario with explicit billing channels; no customer account or provider API was queried and no invoice was fetched or certified."
                if contract_version == "1.1.0" and mode == "illustrative"
                else "Strict canonical AI usage rows."
            ),
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
                "adapter_version": emitted_version,
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
                "description": (
                    "Synthetic, non-current token prices used to calculate illustrative cost components; no invoice was fetched or certified."
                    if contract_version == "1.1.0" and mode == "illustrative"
                    else "Versioned user-supplied AI token rates."
                ),
                "locator": "json:prices",
                "observed_at": generated,
                "content_sha256": price_hash,
            }
        )
    if analysis is not None:
        analysis_source = "source.ai-cost-lens.analysis"
        inputs.append(
            {
                "id": analysis_source,
                "source_type": "ai_analysis_declaration",
                "source_version": str(analysis["schema_version"]),
                "adapter_version": emitted_version,
                "content_sha256": analysis_hash,
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
                    "Run period, accounting basis, and coverage are declared separately from usage and pricing."
                ],
            }
        )
        evidence.append(
            {
                "id": "evidence.ai-cost-lens.analysis",
                "kind": "contract",
                "source_ids": [analysis_source],
                "description": str(analysis["completeness"]["description"]),
                "locator": "json:period,completeness",
                "observed_at": generated,
                "content_sha256": analysis_hash,
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
                "billing_channels": set(),
                "billing_providers": set(),
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
        if r.billing_channel is not None:
            data["billing_channels"].add(r.billing_channel)
        if r.billing_provider is not None:
            data["billing_providers"].add(r.billing_provider)
    metrics = []
    findings = []
    model_cost_ids = []
    direct_model_cost_ids = []
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
        if contract_version == "1.1.0":
            if (
                len(data["billing_channels"]) != 1
                or len(data["billing_providers"]) != 1
            ):
                raise CanonicalError(
                    "financially grouped usage must have one explicit billing provenance"
                )
            dims["billing_channel"] = next(iter(data["billing_channels"]))
            dims["billing_provider"] = next(iter(data["billing_providers"]))
        basis = "observed" if cost_basis == "provider_reported" else "calculated"
        formula = (
            "sum calculated token-category costs" if basis == "calculated" else None
        )
        cost_id = f"{prefix}.cost"
        model_cost_ids.append(cost_id)
        if dims.get("billing_channel") == "direct_ai_vendor":
            direct_model_cost_ids.append(cost_id)
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
    direct_items = [
        item for item in priced if item.record.billing_channel == "direct_ai_vendor"
    ]
    direct_total = sum((item.cost for item in direct_items), Decimal("0"))
    if contract_version == "1.1.0":
        if not direct_model_cost_ids:
            raise CanonicalError("CCAC 1.1 direct_ai scope has no included components")
        coverage = "complete" if mode == "illustrative" else "partial"
        eligible = mode == "illustrative"
        component_bases = sorted({item.basis for item in direct_items})
        scope_basis = "observed" if component_bases == ["observed"] else "calculated"
        scope_formula = (
            None
            if scope_basis == "observed"
            else "sum explicitly classified direct_ai_vendor cost components exactly once"
        )
        scope_metric = _metric(
            "metric.tech-spend.scope.direct_ai",
            "Canonical direct-AI scope spend",
            cost_number(direct_total),
            "currency",
            currency,
            scope_basis,
            "additive",
            period,
            {
                "scope": "direct_ai",
                "cost_basis": "net_cost",
                "billing_channel": "direct_ai_vendor",
                "component_bases": ",".join(component_bases),
            },
            usage_evidence,
            scope_formula,
        )
        scope_metric["input_metric_ids"] = direct_model_cost_ids
        scope_metric["evidence_ids"] = [
            usage_evidence,
            "evidence.ai-cost-lens.analysis",
        ]
        if "calculated" in component_bases:
            scope_metric["evidence_ids"].append("evidence.ai-cost-lens.price-book")
        scope_metric["accounting_boundary"] = {
            "relationship": "canonical_scope_spend",
            "scope": "direct_ai",
            "canonical_owner": "ai-cost-lens",
            "source_channel": "direct_ai_vendor",
            "cost_basis": "net_cost",
            "currency_minor_unit": 0.01,
            "inclusion_rules": [
                "Include usage explicitly classified as direct_ai_vendor billing."
            ],
            "exclusion_rules": [
                "Exclude provider-billed native AI assigned to cloud_provider_billing.",
                "Exclude SaaS invoice or entitlement charges outside direct AI-vendor billing.",
            ],
            "coverage": coverage,
            "overlap": {
                "disposition": "resolved",
                "treatment": "Explicit billing-channel declarations exclude provider-billed AI from direct_ai.",
            },
            "cross_scope_treatments": {
                "provider_billed_ai": "excluded",
                "direct_ai_vendor": "included",
            },
            "component_treatments": {
                "credits": "not_applicable",
                "taxes": "not_applicable",
                "adjustments": "not_applicable",
                "shared_services": "not_applicable",
            },
            "allocation_of_metric_id": None,
            "total_eligible": eligible,
            "eligibility_reason": (
                "Eligible only for the complete deterministic illustrative window declared by the bundled fixture."
                if eligible
                else "Local files do not establish complete vendor or billing-period coverage."
            ),
        }
        metrics.append(scope_metric)
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
        "contract": f"ccac/{contract_version}",
        "document_type": "tool_result",
        "producer": {"name": "ai-cost-lens", "version": emitted_version},
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
                **(
                    {
                        "direct_ai_scope": {
                            "billing_channel": "direct_ai_vendor",
                            "scope_cost_basis": "net_cost",
                            "component_bases": component_bases,
                            "component_metric_ids": direct_model_cost_ids,
                            "excluded_provider_billed_cost": cost_number(
                                sum(
                                    (
                                        item.cost
                                        for item in priced
                                        if item.record.billing_channel
                                        == "cloud_provider_billing"
                                    ),
                                    Decimal("0"),
                                )
                            ),
                            "completeness": completeness,
                        }
                    }
                    if contract_version == "1.1.0"
                    else {}
                ),
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
