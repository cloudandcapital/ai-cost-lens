from __future__ import annotations

import json
from pathlib import Path

import pytest
from click.testing import CliRunner

from ai_cost_lens.canonical import CanonicalError, load_usage
from ai_cost_lens.cli import cli

DATA_DIR = Path(__file__).parents[1] / "ai_cost_lens" / "data"


def test_demo_is_deterministic_reconciled_and_explicitly_illustrative():
    runner = CliRunner()
    first = runner.invoke(cli, ["ccac", "--demo"])
    second = runner.invoke(cli, ["ccac", "--demo"])
    assert first.exit_code == 0, first.output
    assert first.output == second.output
    payload = json.loads(first.output)
    assert payload["contract"] == "ccac/1.0.0"
    assert payload["producer"] == {"name": "ai-cost-lens", "version": "0.2.0"}
    assert payload["mode"] == "illustrative"
    assert payload["extensions"]["ai_cost_lens"]["reconciliation"]["status"] == "passed"
    assert payload["opportunities"] == []
    assert all("--" not in metric["id"] for metric in payload["metrics"])


def test_bedrock_overlap_and_unattributed_cost_are_explicit():
    payload = json.loads(CliRunner().invoke(cli, ["ccac", "--demo"]).output)
    bedrock = next(
        metric
        for metric in payload["metrics"]
        if metric["dimensions"].get("provider") == "bedrock"
        and metric["unit"] == "currency"
    )
    assert bedrock["dimensions"]["cloud_spend_overlap"] == "potential"
    assert (
        next(
            metric
            for metric in payload["metrics"]
            if metric["id"] == "metric.ai.total-cost"
        )["additivity"]
        == "non_additive"
    )
    assert any(
        "not a savings estimate" in finding["description"]
        for finding in payload["findings"]
    )


def test_token_categories_and_cost_bases_remain_distinct():
    payload = json.loads(CliRunner().invoke(cli, ["ccac", "--demo"]).output)
    names = {metric["name"] for metric in payload["metrics"]}
    assert {
        "Uncached input tokens",
        "Cached input tokens",
        "Output tokens",
        "Reasoning tokens",
    }.issubset(names)
    bases = {
        metric["basis"] for metric in payload["metrics"] if metric["unit"] == "currency"
    }
    assert "observed" in bases
    assert "calculated" in bases
    assert any(
        metric["id"].endswith(".cost-per-million-tokens")
        for metric in payload["metrics"]
    )
    assert any(
        metric["id"].endswith(".cost-per-request") for metric in payload["metrics"]
    )


def test_demo_output_file_contains_json_only(tmp_path):
    target = tmp_path / "result.json"
    result = CliRunner().invoke(cli, ["ccac", "--demo", "--output", str(target)])
    assert result.exit_code == 0
    assert result.output == ""
    assert json.loads(target.read_text())["mode"] == "illustrative"


@pytest.mark.parametrize(
    "field,value",
    [
        ("uncached_input_tokens", "NaN"),
        ("output_tokens", ""),
        ("requests", "1.5"),
        ("billed_cost", "Infinity"),
    ],
)
def test_invalid_required_values_fail_closed(tmp_path: Path, field: str, value: str):
    header = list(
        __import__(
            "ai_cost_lens.canonical", fromlist=["REQUIRED_COLUMNS"]
        ).REQUIRED_COLUMNS
    )
    row = [
        "u1",
        "2026-07-01",
        "openai",
        "m",
        "USD",
        "1",
        "0",
        "1",
        "0",
        "1",
        "1",
        "1",
        "provider_reported",
        "p",
        "t",
        "dev",
        "task",
    ]
    row[header.index(field)] = value
    path = tmp_path / "bad.csv"
    path.write_text(",".join(header) + "\n" + ",".join(row) + "\n")
    with pytest.raises(CanonicalError):
        load_usage(path)


def test_calculated_unknown_model_fails_instead_of_zero(tmp_path: Path):
    source = (DATA_DIR / "canonical-usage-v2.csv").read_text()
    source = source.replace("illustrative-model-a", "unsupported-model")
    usage = tmp_path / "usage.csv"
    usage.write_text(source)
    result = CliRunner().invoke(
        cli,
        [
            "ccac",
            "--input",
            str(usage),
            "--price-book",
            str(DATA_DIR / "illustrative-price-book.json"),
        ],
    )
    assert result.exit_code == 1
    assert "no zero-cost fallback" in result.output


def test_usage_before_price_book_effective_date_is_rejected(tmp_path: Path):
    source = (
        (DATA_DIR / "canonical-usage-v2.csv")
        .read_text()
        .replace("2026-07-01", "2026-06-30")
    )
    usage = tmp_path / "usage.csv"
    usage.write_text(source)
    result = CliRunner().invoke(
        cli,
        [
            "ccac",
            "--input",
            str(usage),
            "--price-book",
            str(DATA_DIR / "illustrative-price-book.json"),
        ],
    )
    assert result.exit_code == 1
    assert "historical rates are required" in result.output
