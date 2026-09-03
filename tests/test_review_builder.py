from __future__ import annotations

import csv
import json
from copy import deepcopy
from pathlib import Path

import pytest
from click.testing import CliRunner

from ai_cost_lens.cli import cli
from ai_cost_lens.review_builder import (
    ReviewBuildError,
    _outcomes,
    build_review_from_manifest,
)


def _evidence(day: str, cost: str, requests: int, cached: int = 100) -> dict:
    project = "proj_support"
    return {
        "schema_version": "ai-cost-lens-provider-evidence/1.0",
        "mode": "real",
        "provider": "openai",
        "source": {
            "usage_sha256": f"usage-{day}",
            "cost_sha256": f"cost-{day}",
        },
        "period": {
            "usage_dates": [day],
            "cost_dates": [day],
            "aligned": True,
        },
        "usage": {
            "rows": [
                {
                    "date": day,
                    "model": "gpt-example",
                    "project": project,
                    "requests": requests,
                    "input_tokens": 1000,
                    "cached_input_tokens": cached,
                    "cache_write_input_tokens": 50,
                    "output_tokens": 200,
                }
            ]
        },
        "cost": {
            "currency": "USD",
            "rows": [
                {
                    "date": day,
                    "project": project,
                    "amount": cost,
                    "line_item": "gpt-example, input_tokens",
                }
            ],
        },
    }


def _write_json(path: Path, value: object) -> Path:
    path.write_text(json.dumps(value), encoding="utf-8")
    return path


def _write_outcomes(path: Path, day: str, *, requests: tuple[int, int]) -> Path:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "result_id",
                "date",
                "accepted",
                "model_requests",
                "retry_requests",
                "human_review_minutes",
                "correction_minutes",
            ],
        )
        writer.writeheader()
        writer.writerow(
            {
                "result_id": "result-1",
                "date": day,
                "accepted": "true",
                "model_requests": requests[0],
                "retry_requests": 1 if requests[0] > 1 else 0,
                "human_review_minutes": 10,
                "correction_minutes": 5,
            }
        )
        writer.writerow(
            {
                "result_id": "result-2",
                "date": day,
                "accepted": "true",
                "model_requests": requests[1],
                "retry_requests": 0,
                "human_review_minutes": 5,
                "correction_minutes": 0,
            }
        )
    return path


def _manifest(tmp_path: Path) -> Path:
    _write_json(tmp_path / "baseline-evidence.json", _evidence("2026-08-01", "4", 3))
    _write_json(
        tmp_path / "proposed-evidence.json", _evidence("2026-08-02", "2", 3, 300)
    )
    _write_outcomes(tmp_path / "baseline-outcomes.csv", "2026-08-01", requests=(2, 1))
    _write_outcomes(tmp_path / "proposed-outcomes.csv", "2026-08-02", requests=(2, 1))
    scenario = {
        "id": "baseline",
        "label": "Baseline",
        "provider_evidence": "baseline-evidence.json",
        "outcome_log": "baseline-outcomes.csv",
        "scope": {
            "project": "proj_support",
            "cost_boundary": "all_project_provider_cost",
        },
        "model": {"route": "One project route"},
        "costs": {
            "shared_infrastructure_cost": 0,
            "human_hourly_rate": 0,
            "one_time_change_cost": 0,
        },
        "verifier": "Human reviewer",
        "acceptance_rule": "Correct result accepted without material rewrite",
        "policy": {"approved": True, "retention_mode": "Approved test data"},
    }
    proposed = deepcopy(scenario)
    proposed.update(
        {
            "id": "proposed",
            "label": "Proposed",
            "provider_evidence": "proposed-evidence.json",
            "outcome_log": "proposed-outcomes.csv",
        }
    )
    manifest = {
        "schema_version": "ai-cost-lens-review-build/1.0",
        "mode": "real",
        "currency": "USD",
        "workload": {
            "name": "Support drafting",
            "description": "Draft a response for human acceptance.",
            "outcome_unit": "usable result",
            "accepted_quality_threshold": 0.8,
        },
        "baseline": scenario,
        "proposed": proposed,
    }
    return _write_json(tmp_path / "manifest.json", manifest)


def test_builder_joins_provider_cost_and_human_outcomes(tmp_path: Path):
    result = build_review_from_manifest(_manifest(tmp_path))
    assert result["baseline"]["costs"]["model_cost"] == 4
    assert result["proposed"]["costs"]["model_cost"] == 2
    assert result["baseline"]["outcomes"]["usable_results"] == 2
    assert result["baseline"]["usage"]["retries"] == 1
    assert result["baseline"]["usage"]["cache_write_input_tokens"] == 50
    assert result["baseline"]["usage"]["unique_input_tokens"] is None
    assert result["baseline"]["measures"]["context_reprocessing_ratio"] is None
    assert result["baseline"]["outcomes"]["review_minutes"] == 15
    assert result["baseline"]["outcomes"]["correction_minutes"] == 5
    assert result["baseline"]["evidence"]["outcome_log_sha256"]
    assert result["comparison"]["evidence_complete"] is True
    assert result["comparison"]["savings_claim_allowed"] is True


def test_builder_carries_optional_plan_and_decision_horizon(tmp_path: Path):
    manifest_path = _manifest(tmp_path)
    manifest = json.loads(manifest_path.read_text())
    manifest["planning"] = {
        "label": "Approved operating plan",
        "plan": {
            "provider_cost": 5,
            "shared_infrastructure_cost": 0,
            "human_review_cost": 0,
            "completed_results": 2,
            "ready_result_rate": 1,
        },
        "expected_ready_results_per_month": 2,
        "decision_horizon_months": 6,
    }
    _write_json(manifest_path, manifest)
    result = build_review_from_manifest(manifest_path)
    assert result["planning"]["label"] == "Approved operating plan"
    assert result["planning"]["actual"]["provider_cost"] == 4
    assert result["planning"]["variance"]["provider_cost"] == -1
    assert result["planning"]["payback"]["decision_horizon_months"] == 6


def test_request_mismatch_remains_visible_and_blocks_savings(tmp_path: Path):
    manifest = _manifest(tmp_path)
    _write_outcomes(tmp_path / "proposed-outcomes.csv", "2026-08-02", requests=(1, 1))
    result = build_review_from_manifest(manifest)
    assert result["proposed"]["evidence"]["coverage_status"] == "partial"
    assert "3 requests" in result["proposed"]["evidence"]["reconciliation_issues"][0]
    assert result["comparison"]["savings_claim_allowed"] is False


def test_retry_requests_exclude_the_first_model_request(tmp_path: Path):
    outcome_path = tmp_path / "outcomes.csv"
    outcome_path.write_text(
        "result_id,date,accepted,model_requests,retry_requests,human_review_minutes,correction_minutes\n"
        "result-1,2026-08-01,true,1,1,2,0\n",
        encoding="utf-8",
    )
    with pytest.raises(
        ReviewBuildError,
        match="cannot exceed the additional model requests after the first request",
    ):
        _outcomes(outcome_path)


def test_evidence_mode_must_match_review_mode(tmp_path: Path):
    manifest = _manifest(tmp_path)
    evidence_path = tmp_path / "proposed-evidence.json"
    evidence = json.loads(evidence_path.read_text())
    evidence["mode"] = "illustrative"
    _write_json(evidence_path, evidence)
    with pytest.raises(ReviewBuildError, match="must match review mode"):
        build_review_from_manifest(manifest)


def test_malformed_provider_row_fails_with_field_context(tmp_path: Path):
    manifest = _manifest(tmp_path)
    evidence_path = tmp_path / "proposed-evidence.json"
    evidence = json.loads(evidence_path.read_text())
    evidence["usage"]["rows"][0]["requests"] = "not-a-number"
    _write_json(evidence_path, evidence)
    with pytest.raises(
        ReviewBuildError, match="proposed usage row 1 requests must be numeric"
    ):
        build_review_from_manifest(manifest)


def test_builder_requires_one_attributed_project(tmp_path: Path):
    manifest_path = _manifest(tmp_path)
    manifest = json.loads(manifest_path.read_text())
    manifest["baseline"]["scope"]["project"] = "*"
    _write_json(manifest_path, manifest)
    with pytest.raises(ReviewBuildError, match="must name one attributed"):
        build_review_from_manifest(manifest_path)


def test_build_review_cli(tmp_path: Path):
    manifest = _manifest(tmp_path)
    output = tmp_path / "review.json"
    result = CliRunner().invoke(
        cli,
        ["build-review", "--manifest", str(manifest), "--output", str(output)],
    )
    assert result.exit_code == 0, result.output
    payload = json.loads(output.read_text())
    assert payload["schema_version"] == "ai-cost-lens-review-result/1.0"
    assert payload["workload"]["name"] == "Support drafting"
