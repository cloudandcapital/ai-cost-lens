"""Tests for the AI Cost Lens CLI."""

from __future__ import annotations

import json
import textwrap
from pathlib import Path

import pytest
from click.testing import CliRunner

from ai_cost_lens.cli import cli


def _write_csv(tmp_path: Path, filename: str, content: str) -> Path:
    p = tmp_path / filename
    p.write_text(textwrap.dedent(content).lstrip(), encoding="utf-8")
    return p


OPENAI_CSV = """\
    date,model,input_tokens,output_tokens,requests,cost_usd
    2026-03-01,gpt-4o,1000,500,5,0.0750
    2026-03-02,gpt-4o,800,400,4,0.0600
    2026-03-01,gpt-4o-mini,5000,2000,20,0.0120
"""

ANTHROPIC_CSV = """\
    date,model,input_tokens,output_tokens,requests,cost_usd
    2026-03-01,claude-sonnet-4-6,2000,800,10,0.1200
    2026-03-02,claude-sonnet-4-6,1800,700,9,0.1080
"""


@pytest.fixture()
def runner():
    return CliRunner()


def test_version_option(runner):
    result = runner.invoke(cli, ["--version"])
    assert result.exit_code == 0
    assert result.output.strip() == "ai-cost-lens, version 0.3.3"


def test_help_describes_the_provider_neutral_product(runner):
    result = runner.invoke(cli, ["--help"])
    assert result.exit_code == 0
    assert "provider-neutral AI cost and decision analysis" in result.output
    assert "OpenAI, Anthropic, and AWS Bedrock" not in result.output


def test_analyze_table(runner, tmp_path):
    p = _write_csv(tmp_path, "openai.csv", OPENAI_CSV)
    result = runner.invoke(
        cli, ["analyze", "--input", str(p), "--group-by", "model", "--format", "table"]
    )
    assert result.exit_code == 0
    assert "gpt-4o" in result.output
    assert "gpt-4o-mini" in result.output
    assert "TOTAL" in result.output


def test_analyze_json(runner, tmp_path):
    p = _write_csv(tmp_path, "openai.csv", OPENAI_CSV)
    result = runner.invoke(
        cli, ["analyze", "--input", str(p), "--group-by", "model", "--format", "json"]
    )
    assert result.exit_code == 0
    data = json.loads(result.output)
    assert data["schema_version"] == "1.0"
    assert data["group_by"] == "model"
    assert data["total_cost"] > 0
    assert any(r["key"] == "gpt-4o" for r in data["rows"])


def test_analyze_csv_format(runner, tmp_path):
    p = _write_csv(tmp_path, "openai.csv", OPENAI_CSV)
    result = runner.invoke(cli, ["analyze", "--input", str(p), "--format", "csv"])
    assert result.exit_code == 0
    assert "key,cost" in result.output
    assert "gpt-4o" in result.output


def test_analyze_group_by_day(runner, tmp_path):
    p = _write_csv(tmp_path, "openai.csv", OPENAI_CSV)
    result = runner.invoke(
        cli, ["analyze", "--input", str(p), "--group-by", "day", "--format", "table"]
    )
    assert result.exit_code == 0
    assert "2026-03-01" in result.output
    assert "2026-03-02" in result.output


def test_compare(runner, tmp_path):
    b = _write_csv(tmp_path, "baseline.csv", OPENAI_CSV)
    p = _write_csv(tmp_path, "proposed.csv", ANTHROPIC_CSV)
    result = runner.invoke(cli, ["compare", "--baseline", str(b), "--proposed", str(p)])
    assert result.exit_code == 0
    assert "Comparison:" in result.output
    assert "TOTAL" in result.output


def test_missing_file_exits_3(runner, tmp_path):
    result = runner.invoke(cli, ["analyze", "--input", str(tmp_path / "nope.csv")])
    assert result.exit_code != 0


def test_analyze_anthropic(runner, tmp_path):
    p = _write_csv(tmp_path, "anthropic.csv", ANTHROPIC_CSV)
    result = runner.invoke(cli, ["analyze", "--input", str(p), "--format", "json"])
    assert result.exit_code == 0
    data = json.loads(result.output)
    assert any(r["key"] == "claude-sonnet-4-6" for r in data["rows"])
    assert all(r["provider"] == "anthropic" for r in data["rows"])


def test_legacy_malformed_cost_fails_instead_of_zero(runner, tmp_path):
    p = _write_csv(tmp_path, "bad.csv", OPENAI_CSV.replace("0.0750", "NaN"))
    result = runner.invoke(cli, ["analyze", "--input", str(p), "--format", "json"])
    assert result.exit_code == 4


def test_legacy_mixed_provider_rows_are_rejected(runner, tmp_path):
    mixed = OPENAI_CSV + "2026-03-03,claude-sonnet-4-6,100,50,1,0.1\n"
    p = _write_csv(tmp_path, "mixed.csv", mixed)
    result = runner.invoke(cli, ["analyze", "--input", str(p), "--format", "json"])
    assert result.exit_code == 4
