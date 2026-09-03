from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

import pytest

from ai_cost_lens.model_route_pilot import (
    ModelRoutePilotError,
    run_route,
    score_output,
)

ROOT = Path(__file__).parents[1]
EXPERIMENT_ID = "openai-model-route-002"
ANSWER_KEY = json.loads(
    (ROOT / "experiments" / EXPERIMENT_ID / "answer-key.json").read_text()
)["answers"]


def _expected_output(case_id: str) -> dict:
    answer = ANSWER_KEY[case_id]
    return {
        "case_id": case_id,
        "decision": answer["decision"],
        "primary_metric": {
            "label": answer["metric_label"],
            "value": answer["metric_value"],
            "unit": answer["metric_unit"],
        },
        "claim_assessments": [
            {"claim_id": claim_id, "state": state}
            for claim_id, state in answer["claim_states"].items()
        ],
        "memo": "The evidence supports a bounded decision and keeps the missing proof visible.",
        "next_question": "What evidence would change the decision?",
    }


def _transport(payload, key):
    assert key == "private-test-key"
    case = json.loads(payload["input"][1]["content"])
    output = _expected_output(case["case_id"])
    return {
        "id": f"resp-{case['case_id']}",
        "status": "completed",
        "output": [
            {
                "type": "message",
                "content": [{"type": "output_text", "text": json.dumps(output)}],
            }
        ],
        "usage": {
            "input_tokens": 100,
            "input_tokens_details": {"cached_tokens": 0},
            "output_tokens": 50,
            "total_tokens": 150,
        },
    }


def test_locked_route_runs_once_per_case_without_exposing_key(
    tmp_path: Path, monkeypatch
):
    monkeypatch.setenv("AI_COST_LENS_BASELINE_KEY", "private-test-key")
    output_dir = tmp_path / "baseline"
    result = run_route(ROOT, "baseline", output_dir, transport=_transport)
    assert result["model"] == "gpt-5.6-sol"
    assert result["experiment_id"] == EXPERIMENT_ID
    assert result["request_count"] == 10
    assert result["automatic_pass_count"] == 10
    assert result["automatic_retries"] == 0
    assert result["automatic_scoring_is_not_human_acceptance"] is True
    assert len(list((output_dir / "requests").glob("*.json"))) == 10
    assert len(list((output_dir / "responses").glob("*.json"))) == 10
    first_request = json.loads(
        (output_dir / "requests" / "rate-vs-tokenizer.json").read_text()
    )
    assert first_request["model"] == "gpt-5.6-sol"
    assert first_request["reasoning"] == {"effort": "none"}
    assert first_request["max_output_tokens"] == 500
    assert first_request["store"] is False
    assert first_request["text"]["format"]["strict"] is True
    assert first_request["text"]["format"]["schema"]["properties"]["primary_metric"][
        "properties"
    ]["unit"]["enum"] == ["USD_PER_WORKLOAD"]
    manifest = json.loads((output_dir / "run-manifest.json").read_text())
    assert manifest["status"] == "completed"
    assert manifest["planned_request_count"] == 10
    assert manifest["completed_request_count"] == 10
    review_rows = (output_dir / "human-review-template.csv").read_text()
    assert "accepted,model_requests,retry_requests" in review_rows
    assert "rate-vs-tokenizer" in review_rows
    assert "private-test-key" not in "".join(
        path.read_text() for path in output_dir.rglob("*") if path.is_file()
    )


def test_pilot_003_is_locked_to_five_finance_decisions(tmp_path: Path, monkeypatch):
    experiment_id = "openai-model-route-003"
    answer_key = json.loads(
        (ROOT / "experiments" / experiment_id / "answer-key.json").read_text()
    )["answers"]

    def transport(payload, key):
        assert key == "private-test-key"
        case = json.loads(payload["input"][1]["content"])
        answer = answer_key[case["case_id"]]
        output = {
            "case_id": case["case_id"],
            "decision": answer["decision"],
            "primary_metric": {
                "label": answer["metric_label"],
                "value": answer["metric_value"],
                "unit": answer["metric_unit"],
            },
            "claim_assessments": [
                {"claim_id": claim_id, "state": state}
                for claim_id, state in answer["claim_states"].items()
            ],
            "memo": "The finance decision follows from the supplied evidence.",
            "next_question": "NONE - evidence sufficient",
        }
        return {
            "id": f"resp-{case['case_id']}",
            "status": "completed",
            "output": [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": json.dumps(output)}],
                }
            ],
            "usage": {
                "input_tokens": 100,
                "input_tokens_details": {"cached_tokens": 0},
                "output_tokens": 50,
                "total_tokens": 150,
            },
        }

    monkeypatch.setenv("AI_COST_LENS_BASELINE_KEY", "private-test-key")
    result = run_route(
        ROOT,
        "baseline",
        tmp_path / "pilot-003-baseline",
        experiment_id=experiment_id,
        transport=transport,
    )
    assert result["experiment_id"] == experiment_id
    assert result["request_count"] == 5
    assert result["automatic_pass_count"] == 5
    assert result["automatic_retries"] == 0


def test_route_requires_its_own_project_key(tmp_path: Path, monkeypatch):
    monkeypatch.delenv("AI_COST_LENS_PROPOSED_KEY", raising=False)
    with pytest.raises(ModelRoutePilotError, match="AI_COST_LENS_PROPOSED_KEY"):
        run_route(ROOT, "proposed", tmp_path / "proposed", transport=_transport)


def test_route_refuses_to_overwrite_evidence(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("AI_COST_LENS_BASELINE_KEY", "private-test-key")
    output_dir = tmp_path / "baseline"
    output_dir.mkdir()
    with pytest.raises(ModelRoutePilotError, match="already exists"):
        run_route(ROOT, "baseline", output_dir, transport=_transport)


def test_automatic_score_does_not_hide_wrong_finance_answer():
    output = _expected_output("human-cost-reversal")
    output["decision"] = "APPROVE"
    result = score_output(
        output, "human-cost-reversal", ANSWER_KEY["human-cost-reversal"]
    )
    assert result["auto_pass"] is False
    assert result["checks"]["decision"] is False
    assert result["human_review_required"] is True


def test_request_failure_is_recorded_and_never_retried(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("AI_COST_LENS_BASELINE_KEY", "private-test-key")
    calls = []

    def failing_transport(payload, key):
        calls.append(payload)
        if len(calls) == 2:
            raise ModelRoutePilotError("planned failure containing private-test-key")
        return _transport(payload, key)

    output_dir = tmp_path / "failed-baseline"
    with pytest.raises(ModelRoutePilotError, match="planned failure"):
        run_route(ROOT, "baseline", output_dir, transport=failing_transport)

    assert len(calls) == 2
    assert not (output_dir / "summary.json").exists()
    assert not (output_dir / "human-review-template.csv").exists()
    failure = json.loads((output_dir / "failure.json").read_text())
    manifest = json.loads((output_dir / "run-manifest.json").read_text())
    assert failure["failed_case_id"] == "cache-reuse"
    assert failure["completed_request_count"] == 1
    assert failure["automatic_retries"] == 0
    assert "private-test-key" not in json.dumps(failure)
    assert "[REDACTED]" in failure["error"]
    assert manifest["status"] == "failed"


def test_locked_finance_answers_reconcile_independently():
    expected = {
        "rate-vs-tokenizer": Decimal("1.3") * Decimal("2"),
        "cache-reuse": (Decimal("0.40") - Decimal("0.27"))
        / Decimal("0.40")
        * Decimal("100"),
        "action-vs-outcome": (Decimal("500") / Decimal("100000"))
        * Decimal("20")
        * Decimal("3"),
        "commitment-exposure": Decimal("8000") - Decimal("6000"),
        "cap-vs-value": (Decimal("800") + Decimal("10") * Decimal("60"))
        / Decimal("30"),
        "retention-gate": Decimal("30"),
        "benchmark-scope": Decimal("120000") / Decimal("8000"),
        "human-cost-reversal": (Decimal("100") + Decimal("30") * Decimal("60"))
        - (Decimal("400") + Decimal("5") * Decimal("60")),
        "retry-economics": (Decimal("130") * Decimal("0.02")) / Decimal("90"),
        "currency-boundary": None,
    }
    for case_id, calculated in expected.items():
        recorded_value = ANSWER_KEY[case_id]["metric_value"]
        if calculated is None:
            assert recorded_value is None, case_id
            continue
        recorded = Decimal(str(recorded_value))
        tolerance = max(abs(calculated) * Decimal("0.001"), Decimal("0.0001"))
        assert abs(recorded - calculated) <= tolerance, case_id


def test_currency_case_allows_an_unavailable_metric(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("AI_COST_LENS_PROPOSED_KEY", "private-test-key")
    output_dir = tmp_path / "proposed"
    run_route(ROOT, "proposed", output_dir, transport=_transport)
    request = json.loads(
        (output_dir / "requests" / "currency-boundary.json").read_text()
    )
    metric_schema = request["text"]["format"]["schema"]["properties"]["primary_metric"][
        "properties"
    ]
    assert metric_schema["value"]["type"] == ["number", "null"]
    assert metric_schema["unit"]["enum"] == ["UNAVAILABLE"]


def test_pilot_001_remains_explicitly_reproducible(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("AI_COST_LENS_BASELINE_KEY", "private-test-key")
    result = run_route(
        ROOT,
        "baseline",
        tmp_path / "pilot-001",
        experiment_id="openai-model-route-001",
        transport=_transport,
    )
    assert result["experiment_id"] == "openai-model-route-001"
    assert result["request_count"] == 10
