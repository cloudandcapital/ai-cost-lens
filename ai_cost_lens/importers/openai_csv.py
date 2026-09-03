"""Import saved OpenAI dashboard CSV exports as a finance-first bill review.

The dashboard exports preserve useful provider evidence, but their grains do not
always join. In particular, a cost export may contain an organization total
without project, model, or line-item attribution. This module reports that gap
instead of allocating dollars using token share or another unsupported proxy.
"""

from __future__ import annotations

import csv
import hashlib
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterable

SCHEMA_VERSION = "ai-cost-lens-openai-bill-review/0.1"


class OpenAICsvImportError(ValueError):
    """Raised when saved dashboard exports cannot be reviewed safely."""


USAGE_COLUMNS = {
    "start_time",
    "end_time",
    "project_id",
    "num_model_requests",
    "model",
    "service_tier",
    "input_tokens",
    "output_tokens",
    "input_cached_tokens",
    "input_cache_write_tokens",
    "input_uncached_tokens",
}

COST_COLUMNS = {
    "start_time",
    "end_time",
    "amount_value",
    "amount_currency",
    "line_item",
    "project_id",
}


def _read_csv(
    path: Path, label: str, required: set[str]
) -> tuple[list[dict[str, str]], str]:
    try:
        raw = path.read_bytes()
        text = raw.decode("utf-8-sig")
        reader = csv.DictReader(text.splitlines())
        if not reader.fieldnames:
            raise OpenAICsvImportError(f"{label} export has no header")
        missing = sorted(required - set(reader.fieldnames))
        if missing:
            raise OpenAICsvImportError(
                f"{label} export is missing required columns: {', '.join(missing)}"
            )
        rows = [dict(row) for row in reader]
    except FileNotFoundError as exc:
        raise OpenAICsvImportError(f"{label} export not found: {path}") from exc
    except (OSError, UnicodeError, csv.Error) as exc:
        raise OpenAICsvImportError(f"unable to read {label} export: {exc}") from exc
    if not rows:
        raise OpenAICsvImportError(f"{label} export has no rows")
    return rows, hashlib.sha256(raw).hexdigest()


def _decimal(value: Any, field: str, *, integer: bool = False) -> Decimal:
    if value is None or str(value).strip() == "":
        raise OpenAICsvImportError(f"{field} is required")
    try:
        parsed = Decimal(str(value).strip())
    except (InvalidOperation, ValueError) as exc:
        raise OpenAICsvImportError(f"{field} must be numeric") from exc
    if not parsed.is_finite() or parsed < 0:
        raise OpenAICsvImportError(f"{field} must be finite and non-negative")
    if integer and parsed != parsed.to_integral_value():
        raise OpenAICsvImportError(f"{field} must be a whole number")
    return parsed


def _optional_integer(value: Any, field: str) -> int:
    if value is None or str(value).strip() == "":
        return 0
    return int(_decimal(value, field, integer=True))


def _day(row: dict[str, str], field: str) -> str:
    iso = str(row.get("start_time_iso") or "").strip()
    if iso:
        try:
            return datetime.fromisoformat(iso.replace("Z", "+00:00")).date().isoformat()
        except ValueError as exc:
            raise OpenAICsvImportError(
                f"{field}.start_time_iso is not a valid date"
            ) from exc
    timestamp = int(
        _decimal(row.get("start_time"), f"{field}.start_time", integer=True)
    )
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).date().isoformat()


def _bucket_dates(rows: Iterable[dict[str, str]], label: str) -> list[str]:
    return sorted(
        {_day(row, f"{label} row {index}") for index, row in enumerate(rows, 2)}
    )


def _usage_rows(rows: list[dict[str, str]]) -> list[dict[str, Any]]:
    parsed: list[dict[str, Any]] = []
    for index, row in enumerate(rows, 2):
        signals = (
            row.get("num_model_requests"),
            row.get("model"),
            row.get("input_tokens"),
            row.get("output_tokens"),
        )
        if not any(str(value or "").strip() for value in signals):
            continue
        field = f"usage row {index}"
        total_input = _optional_integer(
            row.get("input_tokens"), f"{field}.input_tokens"
        )
        cached = _optional_integer(
            row.get("input_cached_tokens"), f"{field}.input_cached_tokens"
        )
        cache_write = _optional_integer(
            row.get("input_cache_write_tokens"), f"{field}.input_cache_write_tokens"
        )
        uncached_raw = row.get("input_uncached_tokens")
        if uncached_raw is None or str(uncached_raw).strip() == "":
            uncached = total_input - cached - cache_write
            if uncached < 0:
                raise OpenAICsvImportError(
                    f"{field} cache tokens exceed total input tokens"
                )
            breakdown_basis = "derived_from_total"
        else:
            uncached = _optional_integer(uncached_raw, f"{field}.input_uncached_tokens")
            if uncached + cached + cache_write != total_input:
                raise OpenAICsvImportError(
                    f"{field} input token categories do not reconcile to input_tokens"
                )
            breakdown_basis = "provider_reported"
        parsed.append(
            {
                "date": _day(row, field),
                "model": str(row.get("model") or "").strip() or "unattributed",
                "project": str(row.get("project_id") or "").strip() or "unattributed",
                "api_key": str(row.get("api_key_id") or "").strip() or "unattributed",
                "service_tier": str(row.get("service_tier") or "").strip()
                or "unattributed",
                "requests": _optional_integer(
                    row.get("num_model_requests"), f"{field}.num_model_requests"
                ),
                "input_tokens": total_input,
                "uncached_input_tokens": uncached,
                "cached_input_tokens": cached,
                "cache_write_input_tokens": cache_write,
                "output_tokens": _optional_integer(
                    row.get("output_tokens"), f"{field}.output_tokens"
                ),
                "input_breakdown_basis": breakdown_basis,
            }
        )
    if not parsed:
        raise OpenAICsvImportError("usage export contains no populated usage rows")
    return parsed


def _cost_rows(rows: list[dict[str, str]]) -> list[dict[str, Any]]:
    parsed: list[dict[str, Any]] = []
    for index, row in enumerate(rows, 2):
        amount_raw = str(row.get("amount_value") or "").strip()
        if not amount_raw:
            continue
        field = f"cost row {index}"
        currency = str(row.get("amount_currency") or "").strip().upper()
        if len(currency) != 3 or not currency.isalpha():
            raise OpenAICsvImportError(
                f"{field}.amount_currency must be a three-letter code"
            )
        parsed.append(
            {
                "date": _day(row, field),
                "amount": str(_decimal(amount_raw, f"{field}.amount_value")),
                "currency": currency,
                "project": str(row.get("project_id") or "").strip() or "unattributed",
                "api_key": str(row.get("api_key_id") or "").strip() or "unattributed",
                "line_item": str(row.get("line_item") or "").strip() or "unattributed",
            }
        )
    if not parsed:
        raise OpenAICsvImportError("cost export contains no populated cost rows")
    if len({row["currency"] for row in parsed}) != 1:
        raise OpenAICsvImportError("one bill review cannot mix currencies")
    return parsed


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


def _group_usage(rows: list[dict[str, Any]], field: str) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        groups[str(row[field])].append(row)
    grouped = [
        {field: name, **_usage_totals(values)} for name, values in groups.items()
    ]
    return sorted(grouped, key=lambda item: (-item["requests"], str(item[field])))


def _coverage(rows: list[dict[str, Any]], field: str) -> dict[str, Any]:
    attributed = sum(1 for row in rows if row[field] != "unattributed")
    return {
        "attributed_rows": attributed,
        "total_rows": len(rows),
        "row_coverage_pct": round(attributed / len(rows) * 100, 1),
    }


def build_openai_csv_bill_review(
    usage_path: Path, cost_path: Path, *, mode: str = "real"
) -> dict[str, Any]:
    """Build a strict bill review from saved OpenAI dashboard CSV exports."""
    if mode not in {"illustrative", "real"}:
        raise OpenAICsvImportError("mode must be illustrative or real")
    raw_usage, usage_hash = _read_csv(usage_path, "usage", USAGE_COLUMNS)
    raw_costs, cost_hash = _read_csv(cost_path, "cost", COST_COLUMNS)
    usage = _usage_rows(raw_usage)
    costs = _cost_rows(raw_costs)
    usage_dates = _bucket_dates(raw_usage, "usage")
    cost_dates = _bucket_dates(raw_costs, "cost")
    aligned = usage_dates == cost_dates
    total = sum((Decimal(row["amount"]) for row in costs), Decimal("0"))
    cost_project = _coverage(costs, "project")
    cost_line_item = _coverage(costs, "line_item")
    project_join_supported = cost_project["row_coverage_pct"] == 100.0
    limitations = [
        "The saved cost export does not attribute billed dollars to models, so AI Cost Lens does not allocate cost using token share.",
        "The provider exports do not establish whether a result was usable, how much human correction it required, or what business outcome it produced.",
    ]
    if not project_join_supported:
        limitations.insert(
            1,
            "The saved cost export does not fully attribute cost to projects, so project-level billed cost is unavailable.",
        )
    if not aligned:
        limitations.insert(
            0, "The usage and cost exports do not cover the same daily buckets."
        )
    return {
        "schema_version": SCHEMA_VERSION,
        "provider": "openai",
        "mode": mode,
        "period": {
            "timezone": "UTC",
            "start": min(usage_dates + cost_dates),
            "end": max(usage_dates + cost_dates),
            "usage_dates": usage_dates,
            "cost_dates": cost_dates,
            "aligned": aligned,
        },
        "bill": {
            "basis": "provider_reported",
            "currency": costs[0]["currency"],
            "total": str(total.quantize(Decimal("0.000001"))),
            "populated_rows": len(costs),
            "days_with_cost": len({row["date"] for row in costs}),
        },
        "usage": {
            "basis": "provider_reported",
            "totals": _usage_totals(usage),
            "populated_rows": len(usage),
            "days_with_usage": len({row["date"] for row in usage}),
            "by_model": _group_usage(usage, "model"),
            "by_project": _group_usage(usage, "project"),
        },
        "coverage": {
            "usage_model": _coverage(usage, "model"),
            "usage_project": _coverage(usage, "project"),
            "usage_api_key": _coverage(usage, "api_key"),
            "usage_service_tier": _coverage(usage, "service_tier"),
            "cost_project": cost_project,
            "cost_api_key": _coverage(costs, "api_key"),
            "cost_line_item": cost_line_item,
        },
        "reconciliation": {
            "status": "ready_for_bill_review" if aligned else "period_mismatch",
            "periods_aligned": aligned,
            "project_cost_join_supported": project_join_supported,
            "model_cost_allocation_supported": False,
            "outcome_cost_supported": False,
            "savings_claim_allowed": False,
        },
        "finding": (
            "This export supports a total bill review and a usage-mix review. "
            "It does not support billed cost by model or cost per usable result."
        ),
        "limitations": limitations,
        "next_step": "Add a workload outcome log before comparing cost per usable result or claiming savings.",
        "source": {
            "usage_export": "OpenAI Usage dashboard completions CSV",
            "cost_export": "OpenAI Usage dashboard cost CSV",
            "usage_sha256": usage_hash,
            "cost_sha256": cost_hash,
        },
    }
