from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from click.testing import CliRunner

from ai_cost_lens.cli import cli
from ai_cost_lens.review import ReviewError, build_review

DATA = json.loads(
    (
        Path(__file__).parents[1]
        / "ai_cost_lens"
        / "data"
        / "illustrative-review-v1.json"
    ).read_text()
)


def test_demo_review_is_decision_ready_and_honest():
    result = CliRunner().invoke(cli, ["review", "--demo"])
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["schema_version"] == "ai-cost-lens-review-result/1.0"
    assert payload["mode"] == "illustrative"
    assert payload["comparison"]["status"] == "no_modeled_improvement"
    assert payload["comparison"]["savings_claim_allowed"] is False
    assert payload["comparison"]["same_cost_basis"] is True
    assert payload["comparison"]["provider_cost_reported"] is True
    assert payload["baseline"]["outcomes"]["basis"] == "illustrative"
    assert payload["baseline"]["evidence"]["outcome_basis"] == "illustrative"
    assert "synthetic stress test" in payload["comparison"]["limitation"]
    assert "does not lower" in payload["comparison"]["finding"]


def test_demo_review_calculations_reconcile():
    payload = build_review(DATA)
    baseline = payload["baseline"]
    proposed = payload["proposed"]
    assert baseline["costs"]["recurring_operating_cost"] == 134940
    assert proposed["costs"]["recurring_operating_cost"] == 112800
    assert proposed["costs"]["all_in_pilot_cost"] == 112800
    assert baseline["measures"]["cost_per_usable_result"] == 143.553191
    assert proposed["measures"]["cost_per_usable_result"] == 150.4
    assert payload["comparison"]["cost_per_usable_result_change_pct"] == 4.8
    assert payload["comparison"]["usable_result_rate_change_points"] == -19.0
    assert payload["comparison"]["payback_usable_results"] is None


def test_demo_plan_variance_and_time_payback_reconcile():
    planning = build_review(DATA)["planning"]
    assert planning["plan"]["recurring_operating_cost"] == 129000
    assert planning["plan"]["ready_results"] == 920
    assert planning["plan"]["cost_per_ready_result"] == 140.217391
    assert planning["actual"]["recurring_operating_cost"] == 134940
    assert planning["variance"]["recurring_operating_cost"] == 5940
    assert planning["variance"]["ready_results"] == 20
    assert planning["variance"]["ready_result_rate_points"] == 2
    assert planning["variance"]["cost_per_ready_result"] == 3.3358
    assert planning["variance"]["primary_cost_drivers"] == [
        {
            "label": "Provider cost",
            "amount": 5000,
            "direction": "unfavorable",
        },
        {
            "label": "Human review and correction",
            "amount": 940,
            "direction": "unfavorable",
        },
    ]
    assert planning["payback"]["monthly_operating_savings"] == -6436.00046
    assert planning["payback"]["payback_months"] is None
    assert planning["payback"]["within_decision_horizon"] is False
    assert planning["payback"]["horizon_net_savings"] == -77232.00552
    assert planning["payback"]["status"] == "no_operating_payback"


def test_committed_web_demo_matches_engine():
    expected = build_review(DATA)
    actual = json.loads(
        (
            Path(__file__).parents[1]
            / "web"
            / "data"
            / "illustrative-review-result.json"
        ).read_text()
    )
    assert actual == expected


def test_lower_cost_without_quality_is_not_an_improvement():
    value = copy.deepcopy(DATA)
    value["proposed"]["costs"]["human_review_cost"] = 10000
    value["proposed"]["outcomes"]["usable_results"] = 700
    value["proposed"]["outcomes"]["status_counts"] = {
        "ready_to_use": 700,
        "needs_correction": 230,
        "needs_escalation": 70,
    }
    payload = build_review(value)
    assert payload["comparison"]["status"] == "cost_lower_quality_unconfirmed"
    assert payload["comparison"]["quality_holds"] is False


def test_real_same_basis_can_support_savings_claim():
    value = copy.deepcopy(DATA)
    value["mode"] = "real"
    value["proposed"]["costs"]["model_cost"] = 55000
    value["proposed"]["costs"]["shared_infrastructure_cost"] = 22000
    value["proposed"]["costs"]["human_review_cost"] = 3300
    value["proposed"]["outcomes"]["usable_results"] = 950
    value["proposed"]["outcomes"]["status_counts"] = {
        "ready_to_use": 950,
        "needs_correction": 40,
        "needs_escalation": 10,
    }
    for scenario in ("baseline", "proposed"):
        value[scenario]["evidence"]["coverage_status"] = "complete"
        value[scenario]["evidence"]["reconciliation_issues"] = []
    payload = build_review(value)
    assert payload["comparison"]["savings_claim_allowed"] is True
    assert payload["planning"]["payback"]["status"] == "within_horizon"
    assert payload["planning"]["payback"]["payback_months"] == 0
    assert payload["planning"]["payback"]["horizon_net_savings"] > 0


def test_calculated_cost_basis_cannot_be_called_savings_even_when_matched():
    value = copy.deepcopy(DATA)
    value["mode"] = "real"
    value["proposed"]["costs"]["model_cost"] = 55000
    value["proposed"]["costs"]["human_review_cost"] = 3300
    value["proposed"]["outcomes"]["usable_results"] = 950
    value["proposed"]["outcomes"]["status_counts"] = {
        "ready_to_use": 950,
        "needs_correction": 40,
        "needs_escalation": 10,
    }
    for scenario in ("baseline", "proposed"):
        value[scenario]["evidence"]["cost_basis"] = "calculated"
        value[scenario]["evidence"]["coverage_status"] = "complete"
        value[scenario]["evidence"]["reconciliation_issues"] = []
    payload = build_review(value)
    assert payload["comparison"]["same_cost_basis"] is True
    assert payload["comparison"]["provider_cost_reported"] is False
    assert payload["comparison"]["savings_claim_allowed"] is False
    assert "reported provider cost is required" in payload["comparison"]["limitation"]


def test_real_review_with_partial_coverage_cannot_support_savings():
    value = copy.deepcopy(DATA)
    value["mode"] = "real"
    for scenario in ("baseline", "proposed"):
        value[scenario]["evidence"]["cost_basis"] = "observed"
        value[scenario]["evidence"]["coverage_status"] = "complete"
        value[scenario]["evidence"]["reconciliation_issues"] = []
    value["proposed"]["evidence"]["coverage_status"] = "partial"
    value["proposed"]["evidence"]["reconciliation_issues"] = [
        "Outcome log does not reconcile to provider requests."
    ]
    payload = build_review(value)
    assert payload["comparison"]["evidence_complete"] is False
    assert payload["comparison"]["savings_claim_allowed"] is False


def test_unknown_unique_input_does_not_create_a_fake_reprocessing_measure():
    value = copy.deepcopy(DATA)
    value["baseline"]["usage"]["unique_input_tokens"] = None
    payload = build_review(value)
    assert payload["baseline"]["measures"]["context_reprocessing_ratio"] is None


@pytest.mark.parametrize(
    ("path", "value", "message"),
    [
        (("baseline", "usage", "requests"), 0, "requests must be greater than zero"),
        (
            ("baseline", "usage", "cached_input_tokens"),
            121000000,
            "cached_input_tokens cannot exceed processed_input_tokens",
        ),
        (
            ("baseline", "outcomes", "usable_results"),
            1001,
            "usable_results cannot exceed completed_results",
        ),
        (
            ("baseline", "outcomes", "correction_minutes"),
            1,
            "must reconcile to human_review_minutes",
        ),
        (("baseline", "costs", "model_cost"), -1, "finite and non-negative"),
        (("baseline", "policy", "approved"), "false", "must be true or false"),
    ],
)
def test_review_fails_closed(path, value, message):
    payload = copy.deepcopy(DATA)
    current = payload
    for key in path[:-1]:
        current = current[key]
    current[path[-1]] = value
    with pytest.raises(ReviewError, match=message):
        build_review(payload)


def test_review_rejects_reversed_period():
    payload = copy.deepcopy(DATA)
    payload["period"]["end"] = "2026-07-30"
    with pytest.raises(ReviewError, match="cannot be before"):
        build_review(payload)


@pytest.mark.parametrize(
    ("path", "value", "message"),
    [
        (
            ("planning", "plan", "completed_results"),
            0,
            "completed_results must be greater than zero",
        ),
        (
            ("planning", "plan", "ready_result_rate"),
            0,
            "ready_result_rate must be greater than 0",
        ),
        (
            ("planning", "expected_ready_results_per_month"),
            0,
            "expected_ready_results_per_month must be greater than zero",
        ),
        (
            ("planning", "decision_horizon_months"),
            0,
            "decision_horizon_months must be greater than zero",
        ),
    ],
)
def test_planning_fails_closed(path, value, message):
    payload = copy.deepcopy(DATA)
    current = payload
    for key in path[:-1]:
        current = current[key]
    current[path[-1]] = value
    with pytest.raises(ReviewError, match=message):
        build_review(payload)
