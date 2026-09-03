from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from click.testing import CliRunner

from ai_cost_lens.cli import cli
from ai_cost_lens.decision_record import (
    DecisionRecordError,
    load_decision_record,
    validate_decision_record,
)

ROOT = Path(__file__).parents[1]
RECORD = ROOT / "examples" / "decision-records" / "openai-model-route-002.json"


def _record() -> dict:
    return json.loads(RECORD.read_text())


def test_bundled_decision_record_is_valid_and_loadable():
    payload = load_decision_record(RECORD)
    assert payload["decision"]["code"] == "KEEP_BASELINE"
    assert payload["claims"][1]["state"] == "UNKNOWN"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("provider_cost_difference_usd", 0.05),
        ("provider_cost_reduction_pct", 90),
        ("exact_response_change_points", -30),
    ],
)
def test_comparison_math_cannot_drift(field: str, value: float):
    payload = _record()
    payload["comparison"][field] = value
    with pytest.raises(DecisionRecordError, match=field):
        validate_decision_record(payload)


def test_cost_per_exact_response_is_recomputed():
    payload = _record()
    payload["routes"]["proposed"]["cost_per_exact_response_usd"] = 0.01
    with pytest.raises(DecisionRecordError, match="does not reconcile"):
        validate_decision_record(payload)


def test_unknown_claim_must_name_the_missing_proof():
    payload = _record()
    payload["claims"][1]["blocked_by"] = []
    with pytest.raises(DecisionRecordError, match="blocked_by"):
        validate_decision_record(payload)


def test_claims_must_reference_known_evidence():
    payload = _record()
    payload["claims"][0]["source_ids"] = ["invented-source"]
    with pytest.raises(DecisionRecordError, match="known evidence"):
        validate_decision_record(payload)


def test_verified_all_in_savings_requires_every_gate():
    payload = _record()
    payload["claims"][1]["state"] = "VERIFIED_FACT"
    payload["claims"][1]["blocked_by"] = []
    with pytest.raises(DecisionRecordError, match="every comparison gate"):
        validate_decision_record(payload)


def test_change_route_is_blocked_without_verified_all_in_savings():
    payload = _record()
    payload["decision"]["code"] = "CHANGE_ROUTE"
    with pytest.raises(DecisionRecordError, match="CHANGE_ROUTE"):
        validate_decision_record(payload)


def test_consistency_check_cannot_pass_when_values_conflict():
    payload = _record()
    payload["consistency_checks"][0]["status"] = "PASS"
    with pytest.raises(DecisionRecordError, match="marked PASS"):
        validate_decision_record(payload)


def test_change_route_is_blocked_by_material_consistency_failure():
    payload = _record()
    payload["decision"]["code"] = "CHANGE_ROUTE"
    payload["comparison"]["human_review_cost_usd"] = 10
    payload["comparison"]["gates"]["valid_human_review_cost"] = True
    payload["claims"][1]["state"] = "VERIFIED_FACT"
    payload["claims"][1]["blocked_by"] = []
    with pytest.raises(DecisionRecordError, match="material consistency failure"):
        validate_decision_record(payload)


def test_cli_validates_the_public_record():
    result = CliRunner().invoke(cli, ["validate-decision", "--input", str(RECORD)])
    assert result.exit_code == 0
    output = json.loads(result.output)
    assert output == {
        "decision": "KEEP_BASELINE",
        "decision_id": "openai-model-route-002-decision-v1",
        "record_profile": "model_route/0.1",
        "schema_version": "ai-cost-lens-decision-record/0.1",
        "status": "valid",
    }


def test_cli_reports_tampered_decision(tmp_path: Path):
    payload = copy.deepcopy(_record())
    payload["comparison"]["provider_cost_reduction_pct"] = 99
    path = tmp_path / "tampered.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    result = CliRunner().invoke(cli, ["validate-decision", "--input", str(path)])
    assert result.exit_code != 0
    assert "does not reconcile" in result.output
