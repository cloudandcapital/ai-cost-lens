"""Evidence-aware workload review calculations for AI Cost Lens."""

from __future__ import annotations

import json
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Mapping

REVIEW_VERSION = "ai-cost-lens-review/1.0"
MONEY = Decimal("0.000001")
RATIO = Decimal("0.000001")


class ReviewError(ValueError):
    """Raised when a workload review cannot be calculated safely."""


def _text(value: Any, field: str) -> str:
    result = str(value or "").strip()
    if not result:
        raise ReviewError(f"{field} is required")
    return result


def _number(value: Any, field: str) -> Decimal:
    if isinstance(value, bool):
        raise ReviewError(f"{field} must be numeric")
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise ReviewError(f"{field} must be numeric") from exc
    if not parsed.is_finite() or parsed < 0:
        raise ReviewError(f"{field} must be finite and non-negative")
    return parsed


def _integer(value: Any, field: str) -> int:
    parsed = _number(value, field)
    if parsed != parsed.to_integral_value():
        raise ReviewError(f"{field} must be an integer")
    return int(parsed)


def _optional_integer(value: Any, field: str) -> int | None:
    if value is None:
        return None
    return _integer(value, field)


def _boolean(value: Any, field: str) -> bool:
    if not isinstance(value, bool):
        raise ReviewError(f"{field} must be true or false")
    return value


def _money(value: Decimal) -> float:
    return float(value.quantize(MONEY, rounding=ROUND_HALF_UP))


def _ratio(value: Decimal) -> float:
    return float(value.quantize(RATIO, rounding=ROUND_HALF_UP))


def _percent(value: Decimal) -> float:
    return float((value * Decimal("100")).quantize(Decimal("0.1")))


def load_review(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ReviewError(f"review file not found: {path}") from exc
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ReviewError(f"unable to read review file: {exc}") from exc
    if not isinstance(payload, dict):
        raise ReviewError("review file must contain a JSON object")
    return payload


def _calculate_scenario(raw: Mapping[str, Any], field: str) -> dict[str, Any]:
    label = _text(raw.get("label"), f"{field}.label")
    model = raw.get("model")
    costs = raw.get("costs")
    usage = raw.get("usage")
    outcomes = raw.get("outcomes")
    policy = raw.get("policy")
    evidence = raw.get("evidence")
    for name, value in (
        ("model", model),
        ("costs", costs),
        ("usage", usage),
        ("outcomes", outcomes),
        ("policy", policy),
        ("evidence", evidence),
    ):
        if not isinstance(value, Mapping):
            raise ReviewError(f"{field}.{name} must be an object")

    assert isinstance(model, Mapping)
    assert isinstance(costs, Mapping)
    assert isinstance(usage, Mapping)
    assert isinstance(outcomes, Mapping)
    assert isinstance(policy, Mapping)
    assert isinstance(evidence, Mapping)

    model_cost = _number(costs.get("model_cost"), f"{field}.costs.model_cost")
    shared_cost = _number(
        costs.get("shared_infrastructure_cost"),
        f"{field}.costs.shared_infrastructure_cost",
    )
    human_cost = _number(
        costs.get("human_review_cost"), f"{field}.costs.human_review_cost"
    )
    change_cost = _number(
        costs.get("one_time_change_cost"), f"{field}.costs.one_time_change_cost"
    )

    requests = _integer(usage.get("requests"), f"{field}.usage.requests")
    retries = _integer(usage.get("retries"), f"{field}.usage.retries")
    unique_input = _optional_integer(
        usage.get("unique_input_tokens"), f"{field}.usage.unique_input_tokens"
    )
    processed_input = _integer(
        usage.get("processed_input_tokens"),
        f"{field}.usage.processed_input_tokens",
    )
    cached_input = _integer(
        usage.get("cached_input_tokens"), f"{field}.usage.cached_input_tokens"
    )
    cache_write_input = _integer(
        usage.get("cache_write_input_tokens", 0),
        f"{field}.usage.cache_write_input_tokens",
    )
    output_tokens = _integer(usage.get("output_tokens"), f"{field}.usage.output_tokens")
    if requests == 0:
        raise ReviewError(f"{field}.usage.requests must be greater than zero")
    if retries > requests:
        raise ReviewError(f"{field}.usage.retries cannot exceed requests")
    if unique_input is not None and unique_input > processed_input:
        raise ReviewError(
            f"{field}.usage.unique_input_tokens cannot exceed processed_input_tokens"
        )
    if cached_input > processed_input:
        raise ReviewError(
            f"{field}.usage.cached_input_tokens cannot exceed processed_input_tokens"
        )
    if cached_input + cache_write_input > processed_input:
        raise ReviewError(
            f"{field}.usage cached and cache-write tokens cannot exceed processed_input_tokens"
        )

    completed = _integer(
        outcomes.get("completed_results"), f"{field}.outcomes.completed_results"
    )
    usable = _integer(
        outcomes.get("usable_results"), f"{field}.outcomes.usable_results"
    )
    review_minutes = _number(
        outcomes.get("human_review_minutes"),
        f"{field}.outcomes.human_review_minutes",
    )
    review_only_minutes = _number(
        outcomes.get("review_minutes", review_minutes),
        f"{field}.outcomes.review_minutes",
    )
    correction_minutes = _number(
        outcomes.get("correction_minutes", 0),
        f"{field}.outcomes.correction_minutes",
    )
    if review_only_minutes + correction_minutes != review_minutes:
        raise ReviewError(
            f"{field}.outcomes review and correction minutes must reconcile to human_review_minutes"
        )
    if completed == 0:
        raise ReviewError(
            f"{field}.outcomes.completed_results must be greater than zero"
        )
    if usable == 0:
        raise ReviewError(f"{field}.outcomes.usable_results must be greater than zero")
    if usable > completed:
        raise ReviewError(
            f"{field}.outcomes.usable_results cannot exceed completed_results"
        )
    supplied_status_counts = outcomes.get("status_counts")
    if supplied_status_counts is None:
        status_counts = {
            "ready_to_use": usable,
            "needs_correction": 0,
            "needs_escalation": completed - usable,
        }
    else:
        if not isinstance(supplied_status_counts, Mapping):
            raise ReviewError(f"{field}.outcomes.status_counts must be an object")
        status_counts = {
            name: _integer(
                supplied_status_counts.get(name, 0),
                f"{field}.outcomes.status_counts.{name}",
            )
            for name in ("ready_to_use", "needs_correction", "needs_escalation")
        }
        if status_counts["ready_to_use"] != usable:
            raise ReviewError(
                f"{field}.outcomes.status_counts.ready_to_use must equal usable_results"
            )
        if sum(status_counts.values()) != completed:
            raise ReviewError(
                f"{field}.outcomes.status_counts must reconcile to completed_results"
            )

    outcome_basis = str(outcomes.get("basis") or "observed_log").strip().lower()
    if outcome_basis not in {
        "observed_log",
        "sampled",
        "user_estimate",
        "illustrative",
    }:
        raise ReviewError(
            f"{field}.outcomes.basis must be observed_log, sampled, user_estimate, or illustrative"
        )

    cost_basis = _text(evidence.get("cost_basis"), f"{field}.evidence.cost_basis")
    if cost_basis not in {"observed", "calculated", "allocated"}:
        raise ReviewError(
            f"{field}.evidence.cost_basis must be observed, calculated, or allocated"
        )
    coverage_status = str(evidence.get("coverage_status") or "unspecified").lower()
    if coverage_status not in {"complete", "partial", "illustrative", "unspecified"}:
        raise ReviewError(
            f"{field}.evidence.coverage_status must be complete, partial, illustrative, or unspecified"
        )
    reconciliation_issues = evidence.get("reconciliation_issues", [])
    if not isinstance(reconciliation_issues, list) or not all(
        isinstance(issue, str) and issue.strip() for issue in reconciliation_issues
    ):
        raise ReviewError(
            f"{field}.evidence.reconciliation_issues must be a text array"
        )
    recurring = model_cost + shared_cost + human_cost
    all_in = recurring + change_cost
    usable_decimal = Decimal(usable)
    completed_decimal = Decimal(completed)
    requests_decimal = Decimal(requests)
    processed_decimal = Decimal(processed_input)

    return {
        "id": _text(raw.get("id"), f"{field}.id"),
        "label": label,
        "model": {
            "provider": _text(model.get("provider"), f"{field}.model.provider"),
            "name": _text(model.get("name"), f"{field}.model.name"),
            "route": _text(model.get("route"), f"{field}.model.route"),
        },
        "costs": {
            "model_cost": _money(model_cost),
            "shared_infrastructure_cost": _money(shared_cost),
            "human_review_cost": _money(human_cost),
            "one_time_change_cost": _money(change_cost),
            "recurring_operating_cost": _money(recurring),
            "all_in_pilot_cost": _money(all_in),
        },
        "usage": {
            "requests": requests,
            "retries": retries,
            "unique_input_tokens": unique_input,
            "processed_input_tokens": processed_input,
            "cached_input_tokens": cached_input,
            "cache_write_input_tokens": cache_write_input,
            "output_tokens": output_tokens,
        },
        "outcomes": {
            "basis": outcome_basis,
            "completed_results": completed,
            "usable_results": usable,
            "status_counts": status_counts,
            "human_review_minutes": _ratio(review_minutes),
            "review_minutes": _ratio(review_only_minutes),
            "correction_minutes": _ratio(correction_minutes),
            "verifier": _text(outcomes.get("verifier"), f"{field}.outcomes.verifier"),
            "acceptance_rule": _text(
                outcomes.get("acceptance_rule"),
                f"{field}.outcomes.acceptance_rule",
            ),
        },
        "policy": {
            "approved": _boolean(policy.get("approved"), f"{field}.policy.approved"),
            "retention_mode": _text(
                policy.get("retention_mode"), f"{field}.policy.retention_mode"
            ),
        },
        "evidence": {
            "cost_basis": cost_basis,
            "outcome_basis": str(evidence.get("outcome_basis") or outcome_basis),
            "source": _text(evidence.get("source"), f"{field}.evidence.source"),
            "observed_at": _text(
                evidence.get("observed_at"), f"{field}.evidence.observed_at"
            ),
            "coverage": _text(evidence.get("coverage"), f"{field}.evidence.coverage"),
            "coverage_status": coverage_status,
            "reconciliation_issues": reconciliation_issues,
            "cost_boundary": str(evidence.get("cost_boundary") or "unspecified"),
            "provider_usage_sha256": (
                str(evidence.get("provider_usage_sha256"))
                if evidence.get("provider_usage_sha256")
                else None
            ),
            "provider_cost_sha256": (
                str(evidence.get("provider_cost_sha256"))
                if evidence.get("provider_cost_sha256")
                else None
            ),
            "outcome_log_sha256": (
                str(evidence.get("outcome_log_sha256"))
                if evidence.get("outcome_log_sha256")
                else None
            ),
        },
        "measures": {
            "cost_per_usable_result": _money(recurring / usable_decimal),
            "all_in_cost_per_usable_result": _money(all_in / usable_decimal),
            "usable_result_rate": _ratio(usable_decimal / completed_decimal),
            "retry_rate": _ratio(Decimal(retries) / requests_decimal),
            "cache_reuse_rate": _ratio(
                Decimal(cached_input) / processed_decimal
                if processed_input
                else Decimal("0")
            ),
            "cache_write_rate": _ratio(
                Decimal(cache_write_input) / processed_decimal
                if processed_input
                else Decimal("0")
            ),
            "context_reprocessing_ratio": (
                _ratio(
                    (processed_decimal - Decimal(unique_input)) / processed_decimal
                    if processed_input
                    else Decimal("0")
                )
                if unique_input is not None
                else None
            ),
            "human_review_minutes_per_usable_result": _ratio(
                review_minutes / usable_decimal
            ),
        },
    }


def _calculate_planning(
    raw: Any,
    baseline: Mapping[str, Any],
    proposed: Mapping[str, Any],
) -> dict[str, Any] | None:
    if raw is None:
        return None
    if not isinstance(raw, Mapping):
        raise ReviewError("planning must be an object")
    plan = raw.get("plan")
    if not isinstance(plan, Mapping):
        raise ReviewError("planning.plan must be an object")

    plan_provider = _number(plan.get("provider_cost"), "planning.plan.provider_cost")
    plan_shared = _number(
        plan.get("shared_infrastructure_cost"),
        "planning.plan.shared_infrastructure_cost",
    )
    plan_human = _number(
        plan.get("human_review_cost"), "planning.plan.human_review_cost"
    )
    plan_completed = _integer(
        plan.get("completed_results"), "planning.plan.completed_results"
    )
    plan_ready_rate = _number(
        plan.get("ready_result_rate"), "planning.plan.ready_result_rate"
    )
    if not plan_completed:
        raise ReviewError("planning.plan.completed_results must be greater than zero")
    if plan_ready_rate <= 0 or plan_ready_rate > 1:
        raise ReviewError(
            "planning.plan.ready_result_rate must be greater than 0 and at most 1"
        )

    expected_monthly_ready = _integer(
        raw.get("expected_ready_results_per_month"),
        "planning.expected_ready_results_per_month",
    )
    horizon_months = _integer(
        raw.get("decision_horizon_months"), "planning.decision_horizon_months"
    )
    if not expected_monthly_ready:
        raise ReviewError(
            "planning.expected_ready_results_per_month must be greater than zero"
        )
    if not horizon_months:
        raise ReviewError("planning.decision_horizon_months must be greater than zero")

    plan_recurring = plan_provider + plan_shared + plan_human
    plan_ready_results = Decimal(plan_completed) * plan_ready_rate
    plan_unit = plan_recurring / plan_ready_results

    actual_provider = Decimal(str(baseline["costs"]["model_cost"]))
    actual_shared = Decimal(str(baseline["costs"]["shared_infrastructure_cost"]))
    actual_human = Decimal(str(baseline["costs"]["human_review_cost"]))
    actual_recurring = Decimal(str(baseline["costs"]["recurring_operating_cost"]))
    actual_ready = Decimal(str(baseline["outcomes"]["usable_results"]))
    actual_completed = int(baseline["outcomes"]["completed_results"])
    actual_ready_rate = Decimal(str(baseline["measures"]["usable_result_rate"]))
    actual_unit = Decimal(str(baseline["measures"]["cost_per_usable_result"]))

    cost_drivers = [
        ("Provider cost", actual_provider - plan_provider),
        ("Shared infrastructure", actual_shared - plan_shared),
        ("Human review and correction", actual_human - plan_human),
    ]
    cost_drivers.sort(key=lambda item: abs(item[1]), reverse=True)

    proposed_unit = Decimal(str(proposed["measures"]["cost_per_usable_result"]))
    change_cost = Decimal(str(proposed["costs"]["one_time_change_cost"]))
    savings_per_ready = actual_unit - proposed_unit
    monthly_operating_savings = savings_per_ready * Decimal(expected_monthly_ready)
    horizon_net = monthly_operating_savings * Decimal(horizon_months) - change_cost
    if monthly_operating_savings > 0:
        payback_months = (
            change_cost / monthly_operating_savings if change_cost else Decimal("0")
        )
        within_horizon = payback_months <= Decimal(horizon_months)
        payback_status = "within_horizon" if within_horizon else "outside_horizon"
    else:
        payback_months = None
        within_horizon = False
        payback_status = "no_operating_payback"

    return {
        "label": _text(raw.get("label"), "planning.label"),
        "plan": {
            "provider_cost": _money(plan_provider),
            "shared_infrastructure_cost": _money(plan_shared),
            "human_review_cost": _money(plan_human),
            "recurring_operating_cost": _money(plan_recurring),
            "completed_results": plan_completed,
            "ready_result_rate": _ratio(plan_ready_rate),
            "ready_results": _ratio(plan_ready_results),
            "cost_per_ready_result": _money(plan_unit),
        },
        "actual": {
            "provider_cost": _money(actual_provider),
            "shared_infrastructure_cost": _money(actual_shared),
            "human_review_cost": _money(actual_human),
            "recurring_operating_cost": _money(actual_recurring),
            "completed_results": actual_completed,
            "ready_result_rate": _ratio(actual_ready_rate),
            "ready_results": _ratio(actual_ready),
            "cost_per_ready_result": _money(actual_unit),
        },
        "variance": {
            "provider_cost": _money(actual_provider - plan_provider),
            "shared_infrastructure_cost": _money(actual_shared - plan_shared),
            "human_review_cost": _money(actual_human - plan_human),
            "recurring_operating_cost": _money(actual_recurring - plan_recurring),
            "ready_results": _ratio(actual_ready - plan_ready_results),
            "ready_result_rate_points": float(
                ((actual_ready_rate - plan_ready_rate) * Decimal("100")).quantize(
                    Decimal("0.1")
                )
            ),
            "cost_per_ready_result": _money(actual_unit - plan_unit),
            "primary_cost_drivers": [
                {
                    "label": label,
                    "amount": _money(amount),
                    "direction": (
                        "unfavorable"
                        if amount > 0
                        else "favorable" if amount < 0 else "on_plan"
                    ),
                }
                for label, amount in cost_drivers[:2]
            ],
        },
        "payback": {
            "expected_ready_results_per_month": expected_monthly_ready,
            "decision_horizon_months": horizon_months,
            "monthly_operating_savings": _money(monthly_operating_savings),
            "one_time_change_cost": _money(change_cost),
            "payback_months": (
                _ratio(payback_months) if payback_months is not None else None
            ),
            "within_decision_horizon": within_horizon,
            "horizon_net_savings": _money(horizon_net),
            "status": payback_status,
        },
    }


def build_review(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Validate a review declaration and return a decision-ready result."""
    if payload.get("schema_version") != REVIEW_VERSION:
        raise ReviewError(f"review must use {REVIEW_VERSION}")
    mode = _text(payload.get("mode"), "mode").lower()
    if mode not in {"illustrative", "real"}:
        raise ReviewError("mode must be illustrative or real")
    currency = _text(payload.get("currency"), "currency").upper()
    if len(currency) != 3 or not currency.isalpha():
        raise ReviewError("currency must be a three-letter ISO code")
    period = payload.get("period")
    if not isinstance(period, Mapping):
        raise ReviewError("period must be an object")
    period_start = _text(period.get("start"), "period.start")
    period_end = _text(period.get("end"), "period.end")
    timezone = _text(period.get("timezone"), "period.timezone")
    try:
        start_day = date.fromisoformat(period_start)
        end_day = date.fromisoformat(period_end)
    except ValueError as exc:
        raise ReviewError("period dates must use ISO YYYY-MM-DD") from exc
    if end_day < start_day:
        raise ReviewError("period.end cannot be before period.start")
    workload = payload.get("workload")
    if not isinstance(workload, Mapping):
        raise ReviewError("workload must be an object")
    outcome_unit = _text(workload.get("outcome_unit"), "workload.outcome_unit")
    threshold = _number(
        workload.get("accepted_quality_threshold"),
        "workload.accepted_quality_threshold",
    )
    if threshold > 1:
        raise ReviewError("workload.accepted_quality_threshold cannot exceed 1")

    baseline_raw = payload.get("baseline")
    proposed_raw = payload.get("proposed")
    if not isinstance(baseline_raw, Mapping) or not isinstance(proposed_raw, Mapping):
        raise ReviewError("baseline and proposed must be objects")
    baseline = _calculate_scenario(baseline_raw, "baseline")
    proposed = _calculate_scenario(proposed_raw, "proposed")

    base_cpu = Decimal(str(baseline["measures"]["cost_per_usable_result"]))
    proposed_cpu = Decimal(str(proposed["measures"]["cost_per_usable_result"]))
    base_rate = Decimal(str(baseline["measures"]["usable_result_rate"]))
    proposed_rate = Decimal(str(proposed["measures"]["usable_result_rate"]))
    base_recurring = Decimal(str(baseline["costs"]["recurring_operating_cost"]))
    proposed_recurring = Decimal(str(proposed["costs"]["recurring_operating_cost"]))
    change_cost = Decimal(str(proposed["costs"]["one_time_change_cost"]))
    baseline_usable = Decimal(str(baseline["outcomes"]["usable_results"]))

    cpu_delta = proposed_cpu - base_cpu
    cpu_change_pct = cpu_delta / base_cpu if base_cpu else Decimal("0")
    normalized_proposed = proposed_cpu * baseline_usable
    normalized_difference = normalized_proposed - base_recurring
    operating_gain_per_result = base_cpu - proposed_cpu
    payback_results = (
        (change_cost / operating_gain_per_result).quantize(
            Decimal("1"), rounding=ROUND_HALF_UP
        )
        if change_cost and operating_gain_per_result > 0
        else None
    )
    planning = _calculate_planning(payload.get("planning"), baseline, proposed)

    baseline_basis = baseline["evidence"]["cost_basis"]
    proposed_basis = proposed["evidence"]["cost_basis"]
    same_cost_basis = baseline_basis == proposed_basis
    provider_cost_reported = (
        baseline_basis == "observed" and proposed_basis == "observed"
    )
    both_policy_approved = bool(
        baseline["policy"]["approved"] and proposed["policy"]["approved"]
    )
    quality_holds = proposed_rate >= threshold and proposed_rate >= base_rate
    evidence_complete = bool(
        baseline["evidence"]["coverage_status"] == "complete"
        and proposed["evidence"]["coverage_status"] == "complete"
        and not baseline["evidence"]["reconciliation_issues"]
        and not proposed["evidence"]["reconciliation_issues"]
    )
    modeled_improvement = cpu_delta < 0 and quality_holds and both_policy_approved
    savings_claim_allowed = bool(
        modeled_improvement
        and same_cost_basis
        and provider_cost_reported
        and evidence_complete
        and mode == "real"
    )

    if modeled_improvement:
        status = "modeled_improvement"
        finding = (
            f"On recurring cost, the proposed route comes out "
            f"{abs(_percent(cpu_change_pct)):.1f}% lower for each {outcome_unit}. "
            f"The usable result rate moves from {_percent(base_rate):.1f}% to "
            f"{_percent(proposed_rate):.1f}%."
        )
    elif cpu_delta < 0:
        status = "cost_lower_quality_unconfirmed"
        finding = (
            f"The proposed route costs less per {outcome_unit}, but the available "
            "quality or policy evidence is not strong enough to call it an improvement."
        )
    else:
        status = "no_modeled_improvement"
        finding = (
            f"The proposed route does not lower recurring cost per {outcome_unit} "
            "under the declared assumptions."
        )

    if mode == "illustrative":
        limitation = (
            "This is a synthetic stress test, not bank or customer data. It "
            "demonstrates the decision logic; no savings or performance claim "
            "extends beyond these inputs."
        )
    elif not evidence_complete:
        limitation = (
            "The cost and outcome evidence does not fully reconcile. Resolve the "
            "listed coverage issues before calling the difference savings."
        )
    elif not same_cost_basis:
        limitation = (
            f"The baseline model cost is {baseline_basis}, while the proposed model "
            f"cost is {proposed_basis}. Confirm the proposed result against a provider "
            "bill before calling the difference savings."
        )
    elif not provider_cost_reported:
        limitation = (
            f"Both provider costs use a {baseline_basis} basis. The comparison can "
            "support a test decision, but reported provider cost is required before "
            "calling the difference savings."
        )
    else:
        limitation = (
            "The conclusion only applies to the declared workload, period, outcome "
            "definition, and cost boundary."
        )

    if cpu_delta >= 0:
        recommendation = (
            "Leave the current route in place. The cheaper model bill does not offset "
            "the lower ready result yield and additional human work."
        )
    elif payback_results is not None:
        recommendation = (
            f"Run one bounded pilot and verify the proposed bill. The ${_money(change_cost):,.0f} "
            f"change cost would be earned back after about {int(payback_results):,} usable "
            "results if the modeled operating difference holds."
        )
    else:
        recommendation = "Keep the comparison open until cost, quality, and policy evidence support the same decision."

    result = {
        "schema_version": "ai-cost-lens-review-result/1.0",
        "mode": mode,
        "currency": currency,
        "period": {
            "start": period_start,
            "end": period_end,
            "timezone": timezone,
        },
        "workload": {
            "name": _text(workload.get("name"), "workload.name"),
            "description": _text(workload.get("description"), "workload.description"),
            "outcome_unit": outcome_unit,
            "accepted_quality_threshold": _ratio(threshold),
        },
        "baseline": baseline,
        "proposed": proposed,
        "comparison": {
            "status": status,
            "finding": finding,
            "limitation": limitation,
            "recommendation": recommendation,
            "savings_claim_allowed": savings_claim_allowed,
            "same_cost_basis": same_cost_basis,
            "provider_cost_reported": provider_cost_reported,
            "quality_holds": quality_holds,
            "both_policy_approved": both_policy_approved,
            "evidence_complete": evidence_complete,
            "recurring_cost_difference": _money(proposed_recurring - base_recurring),
            "cost_per_usable_result_difference": _money(cpu_delta),
            "cost_per_usable_result_change_pct": _percent(cpu_change_pct),
            "usable_result_rate_change_points": float(
                ((proposed_rate - base_rate) * Decimal("100")).quantize(Decimal("0.1"))
            ),
            "normalized_proposed_cost_at_baseline_volume": _money(normalized_proposed),
            "normalized_cost_difference": _money(normalized_difference),
            "payback_usable_results": (
                int(payback_results) if payback_results is not None else None
            ),
        },
    }
    if planning is not None:
        result["planning"] = planning
    return result
