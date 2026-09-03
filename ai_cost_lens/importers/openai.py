"""Import official OpenAI organization usage and cost response files.

The two Admin API endpoints expose different financial grains. Usage can be
grouped by model, project, API key, batch status, and service tier. Cost can be
grouped by project, API key, and line item, but not directly by model. This
importer preserves that boundary instead of allocating observed cost to models.
"""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterable, Mapping

IMPORT_VERSION = "ai-cost-lens-provider-evidence/1.0"


class OpenAIImportError(ValueError):
    """Raised when provider evidence cannot be imported safely."""


def _load_pages(path: Path, label: str) -> tuple[list[dict[str, Any]], str]:
    try:
        raw = path.read_bytes()
        value = json.loads(raw)
    except FileNotFoundError as exc:
        raise OpenAIImportError(f"{label} file not found: {path}") from exc
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise OpenAIImportError(f"unable to read {label} file: {exc}") from exc

    pages = value if isinstance(value, list) else [value]
    if not pages or not all(isinstance(page, dict) for page in pages):
        raise OpenAIImportError(
            f"{label} file must contain an API page object or an array of page objects"
        )
    for index, page in enumerate(pages, start=1):
        if page.get("object") != "page" or not isinstance(page.get("data"), list):
            raise OpenAIImportError(
                f"{label} page {index} must be an OpenAI page with a data array"
            )
        has_more = page.get("has_more")
        if not isinstance(has_more, bool):
            raise OpenAIImportError(f"{label} page {index} has_more must be boolean")
        if index < len(pages):
            if not has_more or not str(page.get("next_page") or "").strip():
                raise OpenAIImportError(
                    f"{label} page {index} does not declare the next supplied page"
                )
        elif has_more:
            raise OpenAIImportError(
                f"{label} evidence is incomplete; fetch the next page before importing"
            )
    return pages, hashlib.sha256(raw).hexdigest()


def _number(value: Any, field: str, *, integer: bool = False) -> Decimal:
    if value is None or isinstance(value, bool):
        raise OpenAIImportError(f"{field} must be numeric")
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise OpenAIImportError(f"{field} must be numeric") from exc
    if not parsed.is_finite() or parsed < 0:
        raise OpenAIImportError(f"{field} must be finite and non-negative")
    if integer and parsed != parsed.to_integral_value():
        raise OpenAIImportError(f"{field} must be an integer")
    return parsed


def _optional_integer(value: Any, field: str) -> int:
    if value is None:
        return 0
    return int(_number(value, field, integer=True))


def _integer(value: Any, field: str) -> int:
    return int(_number(value, field, integer=True))


def _bucket(bucket: Mapping[str, Any], field: str) -> tuple[int, int, str]:
    if bucket.get("object") != "bucket" or not isinstance(bucket.get("results"), list):
        raise OpenAIImportError(f"{field} must be a bucket with a results array")
    start = int(_number(bucket.get("start_time"), f"{field}.start_time", integer=True))
    end = int(_number(bucket.get("end_time"), f"{field}.end_time", integer=True))
    if end <= start:
        raise OpenAIImportError(f"{field}.end_time must be after start_time")
    day = datetime.fromtimestamp(start, tz=timezone.utc).date().isoformat()
    return start, end, day


def _all_buckets(pages: Iterable[Mapping[str, Any]]) -> Iterable[Mapping[str, Any]]:
    for page in pages:
        yield from page["data"]


def _bucket_dates(pages: list[dict[str, Any]], label: str) -> list[str]:
    dates = []
    for index, bucket in enumerate(_all_buckets(pages), start=1):
        _, _, day = _bucket(bucket, f"{label} bucket {index}")
        dates.append(day)
    return sorted(set(dates))


def _usage_rows(pages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for bucket_index, bucket in enumerate(_all_buckets(pages), start=1):
        _, _, day = _bucket(bucket, f"usage bucket {bucket_index}")
        for result_index, result in enumerate(bucket["results"], start=1):
            field = f"usage bucket {bucket_index} result {result_index}"
            if not isinstance(result, Mapping) or result.get("object") != (
                "organization.usage.completions.result"
            ):
                raise OpenAIImportError(
                    f"{field} must be an organization completions usage result"
                )
            total_input = _integer(result.get("input_tokens"), f"{field}.input_tokens")
            cached = _optional_integer(
                result.get("input_cached_tokens"), f"{field}.input_cached_tokens"
            )
            cache_write = _optional_integer(
                result.get("input_cache_write_tokens"),
                f"{field}.input_cache_write_tokens",
            )
            uncached_value = result.get("input_uncached_tokens")
            if uncached_value is None:
                remainder = total_input - cached - cache_write
                if remainder < 0:
                    raise OpenAIImportError(
                        f"{field} cached and cache-write tokens exceed total input tokens"
                    )
                uncached = remainder
                breakdown_basis = "derived_from_total"
            else:
                uncached = _optional_integer(
                    uncached_value, f"{field}.input_uncached_tokens"
                )
                if uncached + cached + cache_write != total_input:
                    raise OpenAIImportError(
                        f"{field} input token categories do not reconcile to input_tokens"
                    )
                breakdown_basis = "provider_reported"

            rows.append(
                {
                    "date": day,
                    "model": str(result.get("model") or "unattributed"),
                    "project": str(result.get("project_id") or "unattributed"),
                    "api_key": str(result.get("api_key_id") or "unattributed"),
                    "service_tier": str(result.get("service_tier") or "unattributed"),
                    "batch": result.get("batch"),
                    "requests": _integer(
                        result.get("num_model_requests"),
                        f"{field}.num_model_requests",
                    ),
                    "input_tokens": total_input,
                    "uncached_input_tokens": uncached,
                    "cached_input_tokens": cached,
                    "cache_write_input_tokens": cache_write,
                    "output_tokens": _integer(
                        result.get("output_tokens"), f"{field}.output_tokens"
                    ),
                    "input_breakdown_basis": breakdown_basis,
                }
            )
    if not rows:
        raise OpenAIImportError("usage evidence contains no completion usage results")
    return rows


def _cost_rows(pages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for bucket_index, bucket in enumerate(_all_buckets(pages), start=1):
        _, _, day = _bucket(bucket, f"cost bucket {bucket_index}")
        for result_index, result in enumerate(bucket["results"], start=1):
            field = f"cost bucket {bucket_index} result {result_index}"
            if not isinstance(result, Mapping) or result.get("object") != (
                "organization.costs.result"
            ):
                raise OpenAIImportError(f"{field} must be an organization cost result")
            amount = result.get("amount")
            if not isinstance(amount, Mapping):
                raise OpenAIImportError(f"{field}.amount must be an object")
            currency = str(amount.get("currency") or "").upper()
            if len(currency) != 3 or not currency.isalpha():
                raise OpenAIImportError(f"{field}.amount.currency must be ISO-4217")
            rows.append(
                {
                    "date": day,
                    "amount": str(
                        _number(amount.get("value"), f"{field}.amount.value")
                    ),
                    "currency": currency,
                    "line_item": str(result.get("line_item") or "unattributed"),
                    "project": str(result.get("project_id") or "unattributed"),
                    "api_key": str(result.get("api_key_id") or "unattributed"),
                    "quantity": (
                        str(_number(result.get("quantity"), f"{field}.quantity"))
                        if result.get("quantity") is not None
                        else None
                    ),
                    "quantity_unit": result.get("quantity_unit"),
                }
            )
    if not rows:
        raise OpenAIImportError("cost evidence contains no cost results")
    currencies = {row["currency"] for row in rows}
    if len(currencies) != 1:
        raise OpenAIImportError("one OpenAI evidence bundle cannot mix currencies")
    return rows


def _usage_totals(rows: list[dict[str, Any]]) -> dict[str, int]:
    fields = (
        "requests",
        "input_tokens",
        "uncached_input_tokens",
        "cached_input_tokens",
        "cache_write_input_tokens",
        "output_tokens",
    )
    return {field: sum(int(row[field]) for row in rows) for field in fields}


def _cost_total(rows: list[dict[str, Any]]) -> str:
    total = sum((Decimal(row["amount"]) for row in rows), Decimal("0"))
    return str(total.quantize(Decimal("0.000001")))


def _coverage(rows: list[dict[str, Any]], field: str) -> dict[str, Any]:
    attributed = sum(1 for row in rows if row[field] != "unattributed")
    return {
        "attributed_rows": attributed,
        "total_rows": len(rows),
        "row_coverage_pct": round(attributed / len(rows) * 100, 1),
    }


def _group_usage(rows: list[dict[str, Any]], field: str) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[str(row[field])].append(row)
    return [
        {field: key, **_usage_totals(values)} for key, values in sorted(grouped.items())
    ]


def build_openai_evidence(
    usage_path: Path, cost_path: Path, *, mode: str
) -> dict[str, Any]:
    """Build a strict evidence inventory from saved OpenAI Admin API responses."""
    if mode not in {"illustrative", "real"}:
        raise OpenAIImportError("evidence mode must be illustrative or real")
    usage_pages, usage_hash = _load_pages(usage_path, "usage")
    cost_pages, cost_hash = _load_pages(cost_path, "cost")
    usage = _usage_rows(usage_pages)
    costs = _cost_rows(cost_pages)

    usage_dates = _bucket_dates(usage_pages, "usage")
    cost_dates = _bucket_dates(cost_pages, "cost")
    aligned = usage_dates == cost_dates
    usage_projects = {
        row["project"] for row in usage if row["project"] != "unattributed"
    }
    cost_projects = {
        row["project"] for row in costs if row["project"] != "unattributed"
    }
    shared_projects = sorted(usage_projects & cost_projects)
    project_join_possible = bool(shared_projects)

    return {
        "schema_version": IMPORT_VERSION,
        "mode": mode,
        "provider": "openai",
        "source": {
            "usage_endpoint": "GET /v1/organization/usage/completions",
            "cost_endpoint": "GET /v1/organization/costs",
            "usage_sha256": usage_hash,
            "cost_sha256": cost_hash,
            "usage_pages": len(usage_pages),
            "cost_pages": len(cost_pages),
        },
        "period": {
            "timezone": "UTC",
            "usage_dates": usage_dates,
            "cost_dates": cost_dates,
            "aligned": aligned,
        },
        "usage": {
            "basis": "provider_reported",
            "totals": _usage_totals(usage),
            "coverage": {
                "model": _coverage(usage, "model"),
                "project": _coverage(usage, "project"),
                "api_key": _coverage(usage, "api_key"),
                "service_tier": _coverage(usage, "service_tier"),
            },
            "by_model": _group_usage(usage, "model"),
            "by_project": _group_usage(usage, "project"),
            "rows": usage,
        },
        "cost": {
            "basis": "provider_reported",
            "currency": costs[0]["currency"],
            "total": _cost_total(costs),
            "coverage": {
                "project": _coverage(costs, "project"),
                "api_key": _coverage(costs, "api_key"),
                "line_item": _coverage(costs, "line_item"),
            },
            "rows": costs,
        },
        "reconciliation": {
            "status": "ready_for_total_review" if aligned else "period_mismatch",
            "periods_aligned": aligned,
            "project_join_possible": project_join_possible,
            "shared_projects": shared_projects,
            "model_cost_allocation_supported": False,
            "savings_claim_allowed": False,
        },
        "limitations": [
            "The cost endpoint does not group observed cost directly by model, so this import does not allocate billed dollars to models.",
            "Organization reports are aggregated evidence, not request-level traces.",
            "Provider reports do not establish whether a result was usable, how much human correction it required, or what business outcome it produced.",
            "This import preserves evidence only; it does not certify an invoice or create a savings claim.",
        ],
    }
