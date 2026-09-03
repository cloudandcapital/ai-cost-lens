from __future__ import annotations

import json
from pathlib import Path

import pytest
from click.testing import CliRunner

from ai_cost_lens.cli import cli
from ai_cost_lens.importers.openai import build_openai_evidence
from ai_cost_lens.sanitize import OpenAISanitizeError, sanitize_openai_bundle


def _usage() -> dict:
    return {
        "object": "page",
        "data": [
            {
                "object": "bucket",
                "start_time": 1785542400,
                "end_time": 1785628800,
                "results": [
                    {
                        "object": "organization.usage.completions.result",
                        "input_tokens": 1000,
                        "input_cached_tokens": 400,
                        "input_cache_write_tokens": 100,
                        "input_uncached_tokens": 500,
                        "output_tokens": 200,
                        "num_model_requests": 3,
                        "project_id": "proj_private",
                        "api_key_id": "key_private",
                        "user_id": "user_private",
                        "model": "gpt-example",
                    }
                ],
            }
        ],
        "has_more": False,
        "next_page": None,
    }


def _costs() -> dict:
    return {
        "object": "page",
        "data": [
            {
                "object": "bucket",
                "start_time": 1785542400,
                "end_time": 1785628800,
                "results": [
                    {
                        "object": "organization.costs.result",
                        "amount": {"value": 1.25, "currency": "usd"},
                        "line_item": "gpt-example, input_tokens",
                        "project_id": "proj_private",
                        "api_key_id": "key_private",
                    }
                ],
            }
        ],
        "has_more": False,
        "next_page": None,
    }


def _write(path: Path, value: object) -> Path:
    path.write_text(json.dumps(value), encoding="utf-8")
    return path


def test_sanitizer_preserves_financial_evidence_and_shared_join(tmp_path: Path):
    usage_path = _write(tmp_path / "usage.json", _usage())
    cost_path = _write(tmp_path / "costs.json", _costs())
    original_usage = usage_path.read_bytes()
    output_dir = tmp_path / "safe"

    report = sanitize_openai_bundle(usage_path, cost_path, output_dir)
    safe_usage = json.loads((output_dir / "openai-usage.sanitized.json").read_text())
    safe_costs = json.loads((output_dir / "openai-costs.sanitized.json").read_text())
    usage_row = safe_usage["data"][0]["results"][0]
    cost_row = safe_costs["data"][0]["results"][0]

    assert usage_path.read_bytes() == original_usage
    assert usage_row["project_id"] == cost_row["project_id"] == "project-001"
    assert usage_row["api_key_id"] == cost_row["api_key_id"] == "api-key-001"
    assert usage_row["user_id"] == "user-001"
    assert usage_row["input_tokens"] == 1000
    assert cost_row["amount"] == {"value": 1.25, "currency": "usd"}
    assert "proj_private" not in json.dumps(safe_usage)
    assert "key_private" not in json.dumps(safe_costs)
    assert report["replacement_count"] == 5

    evidence = build_openai_evidence(
        output_dir / "openai-usage.sanitized.json",
        output_dir / "openai-costs.sanitized.json",
        mode="real",
    )
    assert evidence["reconciliation"]["project_join_possible"] is True
    assert evidence["usage"]["totals"]["requests"] == 3
    assert evidence["cost"]["total"] == "1.250000"


def test_sanitizer_refuses_to_overwrite_output_directory(tmp_path: Path):
    usage_path = _write(tmp_path / "usage.json", _usage())
    cost_path = _write(tmp_path / "costs.json", _costs())
    output_dir = tmp_path / "safe"
    output_dir.mkdir()
    with pytest.raises(OpenAISanitizeError, match="already exists"):
        sanitize_openai_bundle(usage_path, cost_path, output_dir)


def test_sanitize_openai_cli(tmp_path: Path):
    usage_path = _write(tmp_path / "usage.json", _usage())
    cost_path = _write(tmp_path / "costs.json", _costs())
    output_dir = tmp_path / "safe"
    result = CliRunner().invoke(
        cli,
        [
            "sanitize-openai",
            "--usage",
            str(usage_path),
            "--costs",
            str(cost_path),
            "--output-dir",
            str(output_dir),
        ],
    )
    assert result.exit_code == 0, result.output
    assert (output_dir / "sanitization-report.json").is_file()
