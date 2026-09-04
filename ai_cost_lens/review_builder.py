"""Build a Workload Review from provider evidence and a human outcome log."""

from __future__ import annotations

import csv
import hashlib
import json
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Mapping

from .review import ReviewError, build_review

BUILD_VERSION = "ai-cost-lens-review-build/1.0"
PROVIDER_EVIDENCE_VERSION = "ai-cost-lens-provider-evidence/1.0"
OUTCOME_COLUMNS = (
    "result_id",
    "date",
    "model_requests",
    "retry_requests",
    "human_review_minutes",
    "correction_minutes",
)


class ReviewBuildError(ValueError):
    """Raised when provider and outcome evidence cannot be joined safely."""


def _text(value: Any, field: str) -> str:
    result = str(value or "").strip()
    if not result:
        raise ReviewBuildError(f"{field} is required")
    return result


def _number(value: Any, field: str) -> Decimal:
    if value is None or isinstance(value, bool):
        raise ReviewBuildError(f"{field} must be numeric")
    try:
        parsed = Decimal(str(value).strip())
    except (InvalidOperation, ValueError) as exc:
        raise ReviewBuildError(f"{field} must be numeric") from exc
    if not parsed.is_finite() or parsed < 0:
        raise ReviewBuildError(f"{field} must be finite and non-negative")
    return parsed


def _integer(value: Any, field: str) -> int:
    parsed = _number(value, field)
    if parsed != parsed.to_integral_value():
        raise ReviewBuildError(f"{field} must be an integer")
    return int(parsed)


def _boolean(value: Any, field: str) -> bool:
    if not isinstance(value, bool):
        raise ReviewBuildError(f"{field} must be true or false")
    return value


def _load_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ReviewBuildError(f"{label} file not found: {path}") from exc
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ReviewBuildError(f"unable to read {label} file: {exc}") from exc
    if not isinstance(value, dict):
        raise ReviewBuildError(f"{label} file must contain a JSON object")
    return value


def _resolve(parent: Path, value: Any, field: str) -> Path:
    path = Path(_text(value, field))
    return path if path.is_absolute() else parent / path


def _outcomes(path: Path) -> dict[str, Any]:
    try:
        raw = path.read_bytes()
        text = raw.decode("utf-8-sig")
    except FileNotFoundError as exc:
        raise ReviewBuildError(f"outcome log not found: {path}") from exc
    except (OSError, UnicodeError) as exc:
        raise ReviewBuildError(f"unable to read outcome log: {exc}") from exc
    reader = csv.DictReader(text.splitlines())
    if reader.fieldnames is None:
        raise ReviewBuildError("outcome log is empty or missing a header")
    missing = [name for name in OUTCOME_COLUMNS if name not in reader.fieldnames]
    if missing:
        raise ReviewBuildError(
            f"outcome log is missing required columns: {', '.join(missing)}"
        )
    if (
        "outcome_status" not in reader.fieldnames
        and "accepted" not in reader.fieldnames
    ):
        raise ReviewBuildError(
            "outcome log is missing outcome_status; older logs may use accepted"
        )

    rows = []
    seen = set()
    for row_number, row in enumerate(reader, start=2):
        result_id = _text(row.get("result_id"), f"outcome row {row_number} result_id")
        if result_id in seen:
            raise ReviewBuildError(f"duplicate outcome result_id: {result_id}")
        seen.add(result_id)
        day = _text(row.get("date"), f"outcome row {row_number} date")
        try:
            date.fromisoformat(day)
        except ValueError as exc:
            raise ReviewBuildError(
                f"outcome row {row_number} date must use ISO YYYY-MM-DD"
            ) from exc
        status_text = str(row.get("outcome_status") or "").strip().lower()
        if status_text:
            if status_text not in {
                "ready_to_use",
                "needs_correction",
                "needs_escalation",
            }:
                raise ReviewBuildError(
                    f"outcome row {row_number} outcome_status must be ready_to_use, needs_correction, or needs_escalation"
                )
        else:
            accepted_text = _text(
                row.get("accepted"), f"outcome row {row_number} accepted"
            ).lower()
            if accepted_text not in {"true", "false"}:
                raise ReviewBuildError(
                    f"outcome row {row_number} accepted must be true or false"
                )
            status_text = (
                "ready_to_use" if accepted_text == "true" else "needs_escalation"
            )
        model_requests = _integer(
            row.get("model_requests"), f"outcome row {row_number} model_requests"
        )
        retry_requests = _integer(
            row.get("retry_requests"), f"outcome row {row_number} retry_requests"
        )
        if retry_requests > max(model_requests - 1, 0):
            raise ReviewBuildError(
                f"outcome row {row_number} retry_requests cannot exceed the additional model requests after the first request"
            )
        rows.append(
            {
                "result_id": result_id,
                "date": day,
                "accepted": status_text == "ready_to_use",
                "outcome_status": status_text,
                "model_requests": model_requests,
                "retry_requests": retry_requests,
                "human_review_minutes": _number(
                    row.get("human_review_minutes"),
                    f"outcome row {row_number} human_review_minutes",
                ),
                "correction_minutes": _number(
                    row.get("correction_minutes"),
                    f"outcome row {row_number} correction_minutes",
                ),
            }
        )
    if not rows:
        raise ReviewBuildError("outcome log contains no results")
    if not any(row["accepted"] for row in rows):
        raise ReviewBuildError("outcome log contains no accepted results")
    return {
        "rows": rows,
        "completed_results": len(rows),
        "usable_results": sum(1 for row in rows if row["accepted"]),
        "status_counts": {
            status: sum(1 for row in rows if row["outcome_status"] == status)
            for status in (
                "ready_to_use",
                "needs_correction",
                "needs_escalation",
            )
        },
        "model_requests": sum(row["model_requests"] for row in rows),
        "retry_requests": sum(row["retry_requests"] for row in rows),
        "review_minutes": sum(
            (row["human_review_minutes"] for row in rows), Decimal("0")
        ),
        "correction_minutes": sum(
            (row["correction_minutes"] for row in rows), Decimal("0")
        ),
        "dates": sorted({row["date"] for row in rows}),
        "sha256": hashlib.sha256(raw).hexdigest(),
    }


def _select(rows: list[dict[str, Any]], project: str) -> list[dict[str, Any]]:
    return (
        rows if project == "*" else [row for row in rows if row["project"] == project]
    )


def _evidence_usage_rows(rows: list[Any], field: str) -> list[dict[str, Any]]:
    normalized = []
    for index, row in enumerate(rows, start=1):
        if not isinstance(row, Mapping):
            raise ReviewBuildError(f"{field} usage row {index} must be an object")
        day = _text(row.get("date"), f"{field} usage row {index} date")
        try:
            date.fromisoformat(day)
        except ValueError as exc:
            raise ReviewBuildError(
                f"{field} usage row {index} date must use ISO YYYY-MM-DD"
            ) from exc
        total_input = _integer(
            row.get("input_tokens"), f"{field} usage row {index} input_tokens"
        )
        cached = _integer(
            row.get("cached_input_tokens"),
            f"{field} usage row {index} cached_input_tokens",
        )
        cache_write = _integer(
            row.get("cache_write_input_tokens"),
            f"{field} usage row {index} cache_write_input_tokens",
        )
        if cached + cache_write > total_input:
            raise ReviewBuildError(
                f"{field} usage row {index} cached and cache-write tokens exceed total input"
            )
        normalized.append(
            {
                "date": day,
                "project": _text(
                    row.get("project"), f"{field} usage row {index} project"
                ),
                "model": _text(row.get("model"), f"{field} usage row {index} model"),
                "requests": _integer(
                    row.get("requests"), f"{field} usage row {index} requests"
                ),
                "input_tokens": total_input,
                "cached_input_tokens": cached,
                "cache_write_input_tokens": cache_write,
                "output_tokens": _integer(
                    row.get("output_tokens"),
                    f"{field} usage row {index} output_tokens",
                ),
            }
        )
    return normalized


def _evidence_cost_rows(rows: list[Any], field: str) -> list[dict[str, Any]]:
    normalized = []
    for index, row in enumerate(rows, start=1):
        if not isinstance(row, Mapping):
            raise ReviewBuildError(f"{field} cost row {index} must be an object")
        day = _text(row.get("date"), f"{field} cost row {index} date")
        try:
            date.fromisoformat(day)
        except ValueError as exc:
            raise ReviewBuildError(
                f"{field} cost row {index} date must use ISO YYYY-MM-DD"
            ) from exc
        normalized.append(
            {
                "date": day,
                "project": _text(
                    row.get("project"), f"{field} cost row {index} project"
                ),
                "amount": _number(
                    row.get("amount"), f"{field} cost row {index} amount"
                ),
            }
        )
    return normalized


def _scenario(
    raw: Mapping[str, Any], field: str, parent: Path, currency: str, mode: str
) -> tuple[dict[str, Any], list[str]]:
    evidence_path = _resolve(
        parent, raw.get("provider_evidence"), f"{field}.provider_evidence"
    )
    outcome_path = _resolve(parent, raw.get("outcome_log"), f"{field}.outcome_log")
    evidence = _load_json(evidence_path, f"{field} provider evidence")
    if evidence.get("schema_version") != PROVIDER_EVIDENCE_VERSION:
        raise ReviewBuildError(
            f"{field} provider evidence must use {PROVIDER_EVIDENCE_VERSION}"
        )
    if evidence.get("provider") != "openai":
        raise ReviewBuildError(f"{field} currently supports OpenAI evidence only")
    if evidence.get("mode") != mode:
        raise ReviewBuildError(
            f"{field} provider evidence mode must match review mode {mode!r}"
        )
    try:
        all_usage_rows = evidence["usage"]["rows"]
        all_cost_rows = evidence["cost"]["rows"]
        evidence_currency = evidence["cost"]["currency"]
        source = evidence["source"]
    except (KeyError, TypeError) as exc:
        raise ReviewBuildError(
            f"{field} provider evidence is missing required sections"
        ) from exc
    if not isinstance(all_usage_rows, list) or not isinstance(all_cost_rows, list):
        raise ReviewBuildError(f"{field} provider evidence rows must be arrays")
    if not isinstance(source, Mapping):
        raise ReviewBuildError(f"{field} provider evidence source must be an object")
    all_usage_rows = _evidence_usage_rows(all_usage_rows, field)
    all_cost_rows = _evidence_cost_rows(all_cost_rows, field)
    usage_hash = _text(source.get("usage_sha256"), f"{field} usage source hash")
    cost_hash = _text(source.get("cost_sha256"), f"{field} cost source hash")

    scope = raw.get("scope")
    costs = raw.get("costs")
    model = raw.get("model")
    policy = raw.get("policy")
    for name, value in (
        ("scope", scope),
        ("costs", costs),
        ("model", model),
        ("policy", policy),
    ):
        if not isinstance(value, Mapping):
            raise ReviewBuildError(f"{field}.{name} must be an object")
    assert isinstance(scope, Mapping)
    assert isinstance(costs, Mapping)
    assert isinstance(model, Mapping)
    assert isinstance(policy, Mapping)

    project = _text(scope.get("project"), f"{field}.scope.project")
    if project in {"*", "unattributed"}:
        raise ReviewBuildError(
            f"{field}.scope.project must name one attributed provider project"
        )
    cost_boundary = _text(scope.get("cost_boundary"), f"{field}.scope.cost_boundary")
    if cost_boundary != "all_project_provider_cost":
        raise ReviewBuildError(
            f"{field}.scope.cost_boundary must explicitly be all_project_provider_cost"
        )

    usage_rows = _select(all_usage_rows, project)
    cost_rows = _select(all_cost_rows, project)
    if not usage_rows:
        raise ReviewBuildError(f"{field} has no provider usage for project {project!r}")
    if not cost_rows:
        raise ReviewBuildError(f"{field} has no provider cost for project {project!r}")
    if evidence_currency != currency:
        raise ReviewBuildError(
            f"{field} provider currency does not match review currency {currency}"
        )

    outcomes = _outcomes(outcome_path)
    provider_dates = {str(row["date"]) for row in usage_rows}
    cost_dates = {str(row["date"]) for row in cost_rows}
    outcome_dates = set(outcomes["dates"])
    provider_requests = sum(int(row["requests"]) for row in usage_rows)
    outcome_requests = int(outcomes["model_requests"])
    issues = []
    if provider_dates != cost_dates:
        issues.append("Selected provider usage and cost periods do not align.")
    if not outcome_dates <= provider_dates:
        issues.append(
            "The outcome log contains dates outside the provider usage period."
        )
    if provider_requests != outcome_requests:
        issues.append(
            f"Provider usage reports {provider_requests:,} requests while the outcome log accounts for {outcome_requests:,}."
        )
    if any(row["model"] == "unattributed" for row in usage_rows):
        issues.append("Some provider usage is not attributed to a model.")

    models = sorted({row["model"] for row in usage_rows})
    total_input = sum(int(row["input_tokens"]) for row in usage_rows)
    cached_input = sum(int(row["cached_input_tokens"]) for row in usage_rows)
    cache_write = sum(int(row["cache_write_input_tokens"]) for row in usage_rows)
    output_tokens = sum(int(row["output_tokens"]) for row in usage_rows)
    provider_cost = sum((row["amount"] for row in cost_rows), Decimal("0"))
    total_human_minutes = outcomes["review_minutes"] + outcomes["correction_minutes"]
    hourly_rate = _number(
        costs.get("human_hourly_rate"), f"{field}.costs.human_hourly_rate"
    )
    human_cost = total_human_minutes / Decimal("60") * hourly_rate
    coverage_status = "complete" if not issues else "partial"
    coverage = (
        f"Complete project evidence for {project}"
        if not issues
        else f"Partial project evidence for {project}: {len(issues)} reconciliation issue(s)"
    )
    scenario = {
        "id": _text(raw.get("id"), f"{field}.id"),
        "label": _text(raw.get("label"), f"{field}.label"),
        "model": {
            "provider": "OpenAI",
            "name": ", ".join(models),
            "route": _text(model.get("route"), f"{field}.model.route"),
        },
        "costs": {
            "model_cost": float(provider_cost),
            "shared_infrastructure_cost": float(
                _number(
                    costs.get("shared_infrastructure_cost"),
                    f"{field}.costs.shared_infrastructure_cost",
                )
            ),
            "human_review_cost": float(
                human_cost.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
            ),
            "one_time_change_cost": float(
                _number(
                    costs.get("one_time_change_cost"),
                    f"{field}.costs.one_time_change_cost",
                )
            ),
        },
        "usage": {
            "requests": provider_requests,
            "retries": int(outcomes["retry_requests"]),
            "unique_input_tokens": None,
            "processed_input_tokens": total_input,
            "cached_input_tokens": cached_input,
            "cache_write_input_tokens": cache_write,
            "output_tokens": output_tokens,
        },
        "outcomes": {
            "completed_results": int(outcomes["completed_results"]),
            "usable_results": int(outcomes["usable_results"]),
            "status_counts": outcomes["status_counts"],
            "human_review_minutes": float(total_human_minutes),
            "review_minutes": float(outcomes["review_minutes"]),
            "correction_minutes": float(outcomes["correction_minutes"]),
            "verifier": _text(raw.get("verifier"), f"{field}.verifier"),
            "acceptance_rule": _text(
                raw.get("acceptance_rule"), f"{field}.acceptance_rule"
            ),
        },
        "policy": {
            "approved": _boolean(policy.get("approved"), f"{field}.policy.approved"),
            "retention_mode": _text(
                policy.get("retention_mode"), f"{field}.policy.retention_mode"
            ),
        },
        "evidence": {
            "cost_basis": "observed",
            "source": (
                f"OpenAI organization usage and cost response files; outcome log {outcome_path.name}"
            ),
            "observed_at": max(cost_dates),
            "coverage": coverage,
            "coverage_status": coverage_status,
            "reconciliation_issues": issues,
            "cost_boundary": cost_boundary,
            "provider_usage_sha256": usage_hash,
            "provider_cost_sha256": cost_hash,
            "outcome_log_sha256": outcomes["sha256"],
        },
    }
    return scenario, sorted(provider_dates | cost_dates | outcome_dates)


def build_review_from_manifest(path: Path) -> dict[str, Any]:
    """Build a decision-ready review from provider evidence and outcome logs."""
    manifest = _load_json(path, "review build manifest")
    if manifest.get("schema_version") != BUILD_VERSION:
        raise ReviewBuildError(f"review build manifest must use {BUILD_VERSION}")
    mode = _text(manifest.get("mode"), "mode").lower()
    if mode not in {"illustrative", "real"}:
        raise ReviewBuildError("mode must be illustrative or real")
    currency = _text(manifest.get("currency"), "currency").upper()
    if len(currency) != 3 or not currency.isalpha():
        raise ReviewBuildError("currency must be a three-letter ISO code")
    workload = manifest.get("workload")
    baseline_raw = manifest.get("baseline")
    proposed_raw = manifest.get("proposed")
    if not isinstance(workload, Mapping):
        raise ReviewBuildError("workload must be an object")
    if not isinstance(baseline_raw, Mapping) or not isinstance(proposed_raw, Mapping):
        raise ReviewBuildError("baseline and proposed must be objects")

    baseline, baseline_dates = _scenario(
        baseline_raw, "baseline", path.parent, currency, mode
    )
    proposed, proposed_dates = _scenario(
        proposed_raw, "proposed", path.parent, currency, mode
    )
    baseline_span = date.fromisoformat(max(baseline_dates)) - date.fromisoformat(
        min(baseline_dates)
    )
    proposed_span = date.fromisoformat(max(proposed_dates)) - date.fromisoformat(
        min(proposed_dates)
    )
    if baseline_span != proposed_span:
        raise ReviewBuildError(
            "baseline and proposed date spans have different durations; "
            "use equally long, complete periods before comparing totals"
        )
    dates = sorted(set(baseline_dates + proposed_dates))
    declaration = {
        "schema_version": "ai-cost-lens-review/1.0",
        "mode": mode,
        "currency": currency,
        "period": {"start": dates[0], "end": dates[-1], "timezone": "UTC"},
        "workload": dict(workload),
        "baseline": baseline,
        "proposed": proposed,
    }
    if manifest.get("planning") is not None:
        declaration["planning"] = manifest["planning"]
    try:
        result = build_review(declaration)
        for key, days in (("baseline", baseline_dates), ("proposed", proposed_dates)):
            result[key]["period"] = {"start": min(days), "end": max(days)}
        return result
    except ReviewError as exc:
        raise ReviewBuildError(str(exc)) from exc
