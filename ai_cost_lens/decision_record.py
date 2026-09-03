"""Validate portable AI Cost Lens finance decision records."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Mapping

DECISION_RECORD_VERSION = "ai-cost-lens-decision-record/0.1"
SUPPORTED_PROFILES = {"model_route/0.1"}
EVIDENCE_STATES = {
    "VERIFIED_FACT",
    "LIMITED_EVIDENCE",
    "COMPANY_CLAIM",
    "ESTIMATE",
    "UNKNOWN",
    "CONTRADICTED",
}
DECISION_CODES = {
    "KEEP_BASELINE",
    "CHANGE_ROUTE",
    "TEST",
    "INVESTIGATE",
    "REJECT",
}
MODES = {"real", "controlled_synthetic_pilot", "illustrative"}
CONSISTENCY_STATUSES = {"PASS", "FAIL", "NOT_TESTED"}


class DecisionRecordError(ValueError):
    """Raised when a decision record is incomplete or internally inconsistent."""


def _mapping(value: Any, field: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise DecisionRecordError(f"{field} must be an object")
    return value


def _list(value: Any, field: str) -> list[Any]:
    if not isinstance(value, list):
        raise DecisionRecordError(f"{field} must be an array")
    return value


def _text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise DecisionRecordError(f"{field} must be non-empty text")
    return value.strip()


def _number(value: Any, field: str, *, nullable: bool = False) -> float | None:
    if value is None and nullable:
        return None
    if isinstance(value, bool):
        raise DecisionRecordError(f"{field} must be numeric")
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise DecisionRecordError(f"{field} must be numeric") from exc
    if not math.isfinite(parsed):
        raise DecisionRecordError(f"{field} must be finite")
    return parsed


def _nonnegative(value: Any, field: str, *, nullable: bool = False) -> float | None:
    parsed = _number(value, field, nullable=nullable)
    if parsed is not None and parsed < 0:
        raise DecisionRecordError(f"{field} cannot be negative")
    return parsed


def _close(actual: float, expected: float) -> bool:
    return math.isclose(actual, expected, rel_tol=1e-9, abs_tol=1e-9)


def load_decision_record(path: Path) -> dict[str, Any]:
    """Load and validate a decision record from disk."""

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise DecisionRecordError(f"decision record not found: {path}") from exc
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise DecisionRecordError(f"unable to read decision record: {exc}") from exc
    if not isinstance(payload, dict):
        raise DecisionRecordError("decision record must contain a JSON object")
    validate_decision_record(payload)
    return payload


def validate_decision_record(payload: Mapping[str, Any]) -> None:
    """Fail closed when a decision record cannot support its stated conclusion."""

    if payload.get("schema_version") != DECISION_RECORD_VERSION:
        raise DecisionRecordError(f"schema_version must be {DECISION_RECORD_VERSION}")
    if payload.get("record_profile") not in SUPPORTED_PROFILES:
        raise DecisionRecordError(
            f"record_profile must be one of: {', '.join(sorted(SUPPORTED_PROFILES))}"
        )
    _text(payload.get("decision_id"), "decision_id")
    _text(payload.get("recorded_at"), "recorded_at")
    _text(payload.get("question"), "question")
    _text(payload.get("title"), "title")
    if payload.get("mode") not in MODES:
        raise DecisionRecordError(f"mode must be one of: {', '.join(sorted(MODES))}")

    decision = _mapping(payload.get("decision"), "decision")
    if decision.get("code") not in DECISION_CODES:
        raise DecisionRecordError(
            f"decision.code must be one of: {', '.join(sorted(DECISION_CODES))}"
        )
    for field in ("label", "recommendation", "reason"):
        _text(decision.get(field), f"decision.{field}")

    workload = _mapping(payload.get("workload"), "workload")
    for field in ("name", "description", "evidence_label"):
        _text(workload.get(field), f"workload.{field}")
    case_count = _number(workload.get("case_count"), "workload.case_count")
    if case_count is None or case_count <= 0 or not case_count.is_integer():
        raise DecisionRecordError("workload.case_count must be a positive integer")
    conditions = _list(workload.get("conditions"), "workload.conditions")
    if not conditions:
        raise DecisionRecordError("workload.conditions cannot be empty")
    for index, condition in enumerate(conditions):
        _text(condition, f"workload.conditions[{index}]")

    routes = _mapping(payload.get("routes"), "routes")
    route_values: dict[str, dict[str, float]] = {}
    for route_name in ("baseline", "proposed"):
        route = _mapping(routes.get(route_name), f"routes.{route_name}")
        for field in ("role", "label", "model"):
            _text(route.get(field), f"routes.{route_name}.{field}")
        requests = _nonnegative(route.get("requests"), f"routes.{route_name}.requests")
        exact = _nonnegative(
            route.get("exact_responses"),
            f"routes.{route_name}.exact_responses",
        )
        cost = _nonnegative(
            route.get("provider_cost_usd"),
            f"routes.{route_name}.provider_cost_usd",
        )
        cost_per_exact = _nonnegative(
            route.get("cost_per_exact_response_usd"),
            f"routes.{route_name}.cost_per_exact_response_usd",
        )
        assert requests is not None and exact is not None and cost is not None
        assert cost_per_exact is not None
        if not requests.is_integer() or requests <= 0:
            raise DecisionRecordError(
                f"routes.{route_name}.requests must be a positive integer"
            )
        if not exact.is_integer() or exact > case_count:
            raise DecisionRecordError(
                f"routes.{route_name}.exact_responses must be an integer no greater than case_count"
            )
        if exact == 0:
            raise DecisionRecordError(
                f"routes.{route_name}.cost_per_exact_response_usd is undefined when exact_responses is zero"
            )
        expected_unit_cost = cost / exact
        if not _close(cost_per_exact, expected_unit_cost):
            raise DecisionRecordError(
                f"routes.{route_name}.cost_per_exact_response_usd does not reconcile"
            )
        route_values[route_name] = {
            "cost": cost,
            "exact": exact,
        }

    comparison = _mapping(payload.get("comparison"), "comparison")
    baseline = route_values["baseline"]
    proposed = route_values["proposed"]
    expected_difference = baseline["cost"] - proposed["cost"]
    expected_reduction = expected_difference / baseline["cost"] * 100
    expected_quality_change = (
        proposed["exact"] / case_count - baseline["exact"] / case_count
    ) * 100
    comparisons = {
        "provider_cost_difference_usd": expected_difference,
        "provider_cost_reduction_pct": expected_reduction,
        "exact_response_change_points": expected_quality_change,
    }
    for field, expected in comparisons.items():
        actual = _number(comparison.get(field), f"comparison.{field}")
        assert actual is not None
        if not _close(actual, expected):
            raise DecisionRecordError(f"comparison.{field} does not reconcile")
    human_cost = _nonnegative(
        comparison.get("human_review_cost_usd"),
        "comparison.human_review_cost_usd",
        nullable=True,
    )
    _nonnegative(
        comparison.get("all_in_cost_difference_usd"),
        "comparison.all_in_cost_difference_usd",
        nullable=True,
    )
    for field in ("headline_metric", "quality_metric", "limitation"):
        _text(comparison.get(field), f"comparison.{field}")
    gates = _mapping(comparison.get("gates"), "comparison.gates")
    required_gates = {
        "equivalent_work",
        "compatible_cost_basis",
        "accepted_outcome_definition",
        "valid_human_review_cost",
    }
    if set(gates) != required_gates or not all(
        isinstance(value, bool) for value in gates.values()
    ):
        raise DecisionRecordError(
            "comparison.gates must contain the four required boolean gates"
        )
    if gates["valid_human_review_cost"] != (human_cost is not None):
        raise DecisionRecordError(
            "comparison.gates.valid_human_review_cost conflicts with human_review_cost_usd"
        )

    evidence = _list(payload.get("evidence"), "evidence")
    if not evidence:
        raise DecisionRecordError("evidence cannot be empty")
    evidence_ids: set[str] = set()
    for index, raw_item in enumerate(evidence):
        item = _mapping(raw_item, f"evidence[{index}]")
        evidence_id = _text(item.get("evidence_id"), f"evidence[{index}].evidence_id")
        if evidence_id in evidence_ids:
            raise DecisionRecordError(f"duplicate evidence_id: {evidence_id}")
        evidence_ids.add(evidence_id)
        for field in ("topic", "value", "detail", "source"):
            _text(item.get(field), f"evidence[{index}].{field}")
        if item.get("state") not in EVIDENCE_STATES:
            raise DecisionRecordError(
                f"evidence[{index}].state is not a supported evidence state"
            )

    claims = _list(payload.get("claims"), "claims")
    if not claims:
        raise DecisionRecordError("claims cannot be empty")
    claim_ids: set[str] = set()
    claim_by_id: dict[str, Mapping[str, Any]] = {}
    for index, raw_claim in enumerate(claims):
        claim = _mapping(raw_claim, f"claims[{index}]")
        claim_id = _text(claim.get("claim_id"), f"claims[{index}].claim_id")
        if claim_id in claim_ids:
            raise DecisionRecordError(f"duplicate claim_id: {claim_id}")
        claim_ids.add(claim_id)
        claim_by_id[claim_id] = claim
        _text(claim.get("statement"), f"claims[{index}].statement")
        state = claim.get("state")
        if state not in EVIDENCE_STATES:
            raise DecisionRecordError(
                f"claims[{index}].state is not a supported evidence state"
            )
        source_ids = _list(claim.get("source_ids"), f"claims[{index}].source_ids")
        if not source_ids or not all(
            isinstance(source_id, str) and source_id in evidence_ids
            for source_id in source_ids
        ):
            raise DecisionRecordError(
                f"claims[{index}].source_ids must reference known evidence"
            )
        blocked_by = _list(claim.get("blocked_by", []), f"claims[{index}].blocked_by")
        if state in {"UNKNOWN", "LIMITED_EVIDENCE"} and not blocked_by:
            raise DecisionRecordError(
                f"claims[{index}] needs a blocked_by reason for {state}"
            )
        if state == "VERIFIED_FACT" and blocked_by:
            raise DecisionRecordError(f"claims[{index}] cannot be verified and blocked")

    all_in_claim = claim_by_id.get("all_in_savings")
    if all_in_claim is None:
        raise DecisionRecordError("claims must include all_in_savings")
    if all_in_claim.get("state") == "VERIFIED_FACT" and not all(gates.values()):
        raise DecisionRecordError(
            "all_in_savings cannot be verified until every comparison gate passes"
        )
    if decision.get("code") == "CHANGE_ROUTE" and all_in_claim.get("state") != (
        "VERIFIED_FACT"
    ):
        raise DecisionRecordError(
            "CHANGE_ROUTE requires a verified all_in_savings claim"
        )

    limitations = _list(payload.get("limitations"), "limitations")
    limitation_ids: set[str] = set()
    for index, raw_limitation in enumerate(limitations):
        limitation = _mapping(raw_limitation, f"limitations[{index}]")
        limitation_id = _text(
            limitation.get("limitation_id"),
            f"limitations[{index}].limitation_id",
        )
        if limitation_id in limitation_ids:
            raise DecisionRecordError(f"duplicate limitation_id: {limitation_id}")
        limitation_ids.add(limitation_id)
        _text(limitation.get("effect"), f"limitations[{index}].effect")
        blocks = _list(limitation.get("blocks"), f"limitations[{index}].blocks")
        if not blocks or not all(block in claim_ids for block in blocks):
            raise DecisionRecordError(
                f"limitations[{index}].blocks must reference known claims"
            )
    for claim_id, claim in claim_by_id.items():
        blocked_by = claim.get("blocked_by", [])
        if not all(block in limitation_ids for block in blocked_by):
            raise DecisionRecordError(
                f"claim {claim_id} references an unknown limitation"
            )

    consistency_checks = _list(payload.get("consistency_checks"), "consistency_checks")
    if not consistency_checks:
        raise DecisionRecordError("consistency_checks cannot be empty")
    check_ids: set[str] = set()
    material_failures = 0
    for index, raw_check in enumerate(consistency_checks):
        check = _mapping(raw_check, f"consistency_checks[{index}]")
        check_id = _text(check.get("check_id"), f"consistency_checks[{index}].check_id")
        if check_id in check_ids:
            raise DecisionRecordError(f"duplicate consistency check: {check_id}")
        check_ids.add(check_id)
        status = check.get("status")
        if status not in CONSISTENCY_STATUSES:
            raise DecisionRecordError(
                f"consistency_checks[{index}].status is not supported"
            )
        material = check.get("material")
        if not isinstance(material, bool):
            raise DecisionRecordError(
                f"consistency_checks[{index}].material must be boolean"
            )
        source_ids = _list(
            check.get("source_ids"), f"consistency_checks[{index}].source_ids"
        )
        if not source_ids or not all(
            isinstance(source_id, str) and source_id in evidence_ids
            for source_id in source_ids
        ):
            raise DecisionRecordError(
                f"consistency_checks[{index}].source_ids must reference known evidence"
            )
        values = []
        units = []
        for side in ("left", "right"):
            metric = _mapping(check.get(side), f"consistency_checks[{index}].{side}")
            _text(
                metric.get("label"),
                f"consistency_checks[{index}].{side}.label",
            )
            value = _number(
                metric.get("value"),
                f"consistency_checks[{index}].{side}.value",
            )
            unit = _text(
                metric.get("unit"),
                f"consistency_checks[{index}].{side}.unit",
            )
            assert value is not None
            values.append(value)
            units.append(unit)
        if units[0] == units[1]:
            values_match = _close(values[0], values[1])
            if status == "PASS" and not values_match:
                raise DecisionRecordError(
                    f"consistency_checks[{index}] is marked PASS but values conflict"
                )
            if status == "FAIL" and values_match:
                raise DecisionRecordError(
                    f"consistency_checks[{index}] is marked FAIL but values match"
                )
        if status == "FAIL" and material:
            material_failures += 1
    if decision.get("code") == "CHANGE_ROUTE" and material_failures:
        raise DecisionRecordError(
            "CHANGE_ROUTE is blocked by a material consistency failure"
        )

    next_test = _mapping(payload.get("next_test"), "next_test")
    for field in ("question", "smallest_test"):
        _text(next_test.get(field), f"next_test.{field}")
    inputs = _list(next_test.get("inputs"), "next_test.inputs")
    metrics = _list(next_test.get("metrics"), "next_test.metrics")
    if not inputs or not metrics:
        raise DecisionRecordError("next_test inputs and metrics cannot be empty")
    _nonnegative(
        next_test.get("cash_cost_ceiling_usd"), "next_test.cash_cost_ceiling_usd"
    )
