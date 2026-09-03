from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

import pytest
from click.testing import CliRunner

from ai_cost_lens.cli import cli
from ai_cost_lens.importers.openai import OpenAIImportError, build_openai_evidence

USAGE = {
    "object": "page",
    "data": [
        {
            "object": "bucket",
            "start_time": 1788220800,
            "end_time": 1788307200,
            "results": [
                {
                    "object": "organization.usage.completions.result",
                    "input_tokens": 1500,
                    "input_uncached_tokens": 1000,
                    "input_cached_tokens": 400,
                    "input_cache_write_tokens": 100,
                    "output_tokens": 300,
                    "num_model_requests": 12,
                    "model": "gpt-example",
                    "project_id": "proj_example",
                    "api_key_id": "key_example",
                    "service_tier": "standard",
                    "batch": False,
                }
            ],
        }
    ],
    "has_more": False,
    "next_page": None,
}

COSTS = {
    "object": "page",
    "data": [
        {
            "object": "bucket",
            "start_time": 1788220800,
            "end_time": 1788307200,
            "results": [
                {
                    "object": "organization.costs.result",
                    "amount": {"value": 1.25, "currency": "usd"},
                    "line_item": "example input tokens",
                    "project_id": "proj_example",
                    "api_key_id": "key_example",
                    "quantity": 1500,
                    "quantity_unit": "tokens",
                },
                {
                    "object": "organization.costs.result",
                    "amount": {"value": 0.75, "currency": "usd"},
                    "line_item": "example output tokens",
                    "project_id": "proj_example",
                    "api_key_id": "key_example",
                    "quantity": 300,
                    "quantity_unit": "tokens",
                },
            ],
        }
    ],
    "has_more": False,
    "next_page": None,
}


def _write(path: Path, value: object) -> Path:
    path.write_text(json.dumps(value), encoding="utf-8")
    return path


def test_build_openai_evidence_preserves_financial_grains(tmp_path: Path):
    result = build_openai_evidence(
        _write(tmp_path / "usage.json", USAGE),
        _write(tmp_path / "costs.json", COSTS),
        mode="illustrative",
    )
    assert result["schema_version"] == "ai-cost-lens-provider-evidence/1.0"
    assert result["usage"]["totals"] == {
        "requests": 12,
        "input_tokens": 1500,
        "uncached_input_tokens": 1000,
        "cached_input_tokens": 400,
        "cache_write_input_tokens": 100,
        "output_tokens": 300,
    }
    assert result["cost"]["total"] == "2.000000"
    assert result["period"]["aligned"] is True
    assert result["reconciliation"]["project_join_possible"] is True
    assert result["reconciliation"]["model_cost_allocation_supported"] is False
    assert result["reconciliation"]["savings_claim_allowed"] is False


def test_missing_uncached_breakdown_is_derived_without_losing_cache_write(
    tmp_path: Path,
):
    usage = deepcopy(USAGE)
    del usage["data"][0]["results"][0]["input_uncached_tokens"]
    result = build_openai_evidence(
        _write(tmp_path / "usage.json", usage),
        _write(tmp_path / "costs.json", COSTS),
        mode="illustrative",
    )
    row = result["usage"]["rows"][0]
    assert row["uncached_input_tokens"] == 1000
    assert row["input_breakdown_basis"] == "derived_from_total"


def test_nonreconciling_input_categories_fail(tmp_path: Path):
    usage = deepcopy(USAGE)
    usage["data"][0]["results"][0]["input_uncached_tokens"] = 999
    with pytest.raises(OpenAIImportError, match="do not reconcile"):
        build_openai_evidence(
            _write(tmp_path / "usage.json", usage),
            _write(tmp_path / "costs.json", COSTS),
            mode="illustrative",
        )


@pytest.mark.parametrize(
    "field", ["input_tokens", "output_tokens", "num_model_requests"]
)
def test_required_usage_measure_fails_when_missing(tmp_path: Path, field: str):
    usage = deepcopy(USAGE)
    del usage["data"][0]["results"][0][field]
    with pytest.raises(OpenAIImportError, match=field):
        build_openai_evidence(
            _write(tmp_path / "usage.json", usage),
            _write(tmp_path / "costs.json", COSTS),
            mode="illustrative",
        )


def test_incomplete_pagination_fails_closed(tmp_path: Path):
    usage = deepcopy(USAGE)
    usage["has_more"] = True
    usage["next_page"] = "next"
    with pytest.raises(OpenAIImportError, match="incomplete"):
        build_openai_evidence(
            _write(tmp_path / "usage.json", usage),
            _write(tmp_path / "costs.json", COSTS),
            mode="illustrative",
        )


def test_period_mismatch_is_visible(tmp_path: Path):
    costs = deepcopy(COSTS)
    costs["data"][0]["start_time"] += 86400
    costs["data"][0]["end_time"] += 86400
    result = build_openai_evidence(
        _write(tmp_path / "usage.json", USAGE),
        _write(tmp_path / "costs.json", costs),
        mode="illustrative",
    )
    assert result["reconciliation"]["status"] == "period_mismatch"
    assert result["reconciliation"]["periods_aligned"] is False


def test_different_projects_do_not_create_a_false_join(tmp_path: Path):
    costs = deepcopy(COSTS)
    for row in costs["data"][0]["results"]:
        row["project_id"] = "proj_other"
    result = build_openai_evidence(
        _write(tmp_path / "usage.json", USAGE),
        _write(tmp_path / "costs.json", costs),
        mode="illustrative",
    )
    assert result["reconciliation"]["project_join_possible"] is False
    assert result["reconciliation"]["shared_projects"] == []


def test_import_openai_cli(tmp_path: Path):
    usage = _write(tmp_path / "usage.json", USAGE)
    costs = _write(tmp_path / "costs.json", COSTS)
    output = tmp_path / "evidence.json"
    result = CliRunner().invoke(
        cli,
        [
            "import-openai",
            "--usage",
            str(usage),
            "--costs",
            str(costs),
            "--output",
            str(output),
            "--mode",
            "illustrative",
        ],
    )
    assert result.exit_code == 0
    payload = json.loads(output.read_text())
    assert payload["provider"] == "openai"
    assert payload["mode"] == "illustrative"
    assert payload["cost"]["basis"] == "provider_reported"
