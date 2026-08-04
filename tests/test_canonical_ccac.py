from __future__ import annotations

import csv
import json
from pathlib import Path

import pytest
from click.testing import CliRunner

from ai_cost_lens.canonical import (
    REQUIRED_COLUMNS,
    CanonicalError,
    load_price_book,
    load_usage,
)
from ai_cost_lens.ccac import build_result
from ai_cost_lens.cli import cli

DATA_DIR = Path(__file__).parents[1] / "ai_cost_lens" / "data"


def _write_price_book(tmp_path: Path, mode: str | None, *, model: str = "m") -> Path:
    payload = {
        "schema_version": "ai-cost-lens-price-book/1.0",
        "effective_at": "2026-07-01",
        "source": "Test rates",
        "prices": {
            f"openai/{model}": {
                "currency": "USD",
                "input_per_million": 2,
                "cached_input_per_million": 1,
                "output_per_million": 4,
                "reasoning_per_million": 4,
            }
        },
    }
    if mode is not None:
        payload["mode"] = mode
    path = tmp_path / f"prices-{mode or 'missing'}.json"
    path.write_text(json.dumps(payload))
    return path


def _write_usage(
    tmp_path: Path, rows: list[list[str]], name: str = "usage.csv"
) -> Path:
    path = tmp_path / name
    with path.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(REQUIRED_COLUMNS)
        writer.writerows(rows)
    return path


def _usage_row(
    usage_id: str, cost_basis: str, billed_cost: str, *, tokens: str = "1000000"
) -> list[str]:
    return [
        usage_id,
        "2026-07-01",
        "openai",
        "m",
        "USD",
        tokens,
        "0",
        "0",
        "0",
        "1",
        "1",
        billed_cost,
        cost_basis,
        "same-project",
        "same-team",
        "production",
        "same-task",
    ]


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


def test_identical_dimensions_keep_cost_bases_separate_and_reconcile(tmp_path: Path):
    usage = _write_usage(
        tmp_path,
        [
            _usage_row("reported", "provider_reported", "3"),
            _usage_row("priced", "calculated", ""),
        ],
    )
    payload = build_result(
        usage, price_book_path=_write_price_book(tmp_path, "real"), mode="real"
    )
    cost_metrics = [
        metric
        for metric in payload["metrics"]
        if metric["unit"] == "currency" and metric["id"] != "metric.ai.total-cost"
    ]
    assert len(cost_metrics) == 2
    assert len({metric["id"] for metric in cost_metrics}) == 2
    by_cost_basis = {
        metric["dimensions"]["cost_basis"]: metric for metric in cost_metrics
    }
    reported = by_cost_basis["provider_reported"]
    calculated = by_cost_basis["calculated"]
    assert (reported["value"], reported["basis"], reported["evidence_ids"]) == (
        3.0,
        "observed",
        ["evidence.ai-cost-lens.usage"],
    )
    assert (calculated["value"], calculated["basis"]) == (2.0, "calculated")
    assert calculated["evidence_ids"] == [
        "evidence.ai-cost-lens.usage",
        "evidence.ai-cost-lens.price-book",
    ]
    total = next(
        metric
        for metric in payload["metrics"]
        if metric["id"] == "metric.ai.total-cost"
    )
    assert total["value"] == 5.0
    assert set(total["input_metric_ids"]) == {metric["id"] for metric in cost_metrics}
    assert total["dimensions"]["cost_basis"] == "mixed_calculated_and_provider_reported"
    assert total["evidence_ids"] == [
        "evidence.ai-cost-lens.usage",
        "evidence.ai-cost-lens.price-book",
    ]
    reconciliation = payload["extensions"]["ai_cost_lens"]["reconciliation"]
    assert reconciliation["row_cost_sum"] == 5.0
    assert reconciliation["model_cost_sum"] == 5.0
    assert reconciliation["difference"] == 0.0
    assert reconciliation["row_token_sum"] == 2_000_000
    assert reconciliation["metric_token_sum"] == 2_000_000
    assert reconciliation["token_difference"] == 0
    assert reconciliation["status"] == "passed"
    token_metrics = [
        metric
        for metric in payload["metrics"]
        if metric["name"] == "Uncached input tokens"
    ]
    assert sum(metric["value"] for metric in token_metrics) == 2_000_000


def test_demo_emits_illustrative_pricing_provenance():
    payload = json.loads(CliRunner().invoke(cli, ["ccac", "--demo"]).output)
    provenance = payload["extensions"]["ai_cost_lens"]["pricing_provenance"]
    assert provenance["mode"] == "illustrative"
    assert provenance["effective_at"] == "2026-07-01"
    assert "Synthetic rates" in provenance["source"]
    assert len(provenance["input_sha256"]) == 64
    assert provenance["used_price_keys"] == [
        "anthropic/illustrative-model-b",
        "openai/illustrative-model-a",
    ]
    assert provenance["used_rate_keys"] == [
        "cached_input_per_million",
        "input_per_million",
        "output_per_million",
        "reasoning_per_million",
    ]


@pytest.mark.parametrize("mode", [None, "invalid"])
def test_missing_or_invalid_price_book_mode_is_rejected(
    tmp_path: Path, mode: str | None
):
    with pytest.raises(CanonicalError, match="price book mode"):
        load_price_book(_write_price_book(tmp_path, mode))


@pytest.mark.parametrize(
    "analysis_mode,price_book_mode",
    [("real", "illustrative"), ("illustrative", "real")],
)
def test_price_book_mode_mismatch_is_rejected(
    tmp_path: Path, analysis_mode: str, price_book_mode: str
):
    usage = _write_usage(tmp_path, [_usage_row("priced", "calculated", "")])
    with pytest.raises(CanonicalError, match="cannot be used"):
        build_result(
            usage,
            price_book_path=_write_price_book(tmp_path, price_book_mode),
            mode=analysis_mode,
        )


@pytest.mark.parametrize("mode", ["real", "illustrative"])
def test_matching_price_book_modes_are_accepted(tmp_path: Path, mode: str):
    usage = _write_usage(tmp_path, [_usage_row("priced", "calculated", "")])
    payload = build_result(
        usage, price_book_path=_write_price_book(tmp_path, mode), mode=mode
    )
    assert payload["extensions"]["ai_cost_lens"]["pricing_provenance"]["mode"] == mode


def test_provider_reported_only_needs_no_price_book(tmp_path: Path):
    usage = _write_usage(tmp_path, [_usage_row("reported", "provider_reported", "3")])
    payload = build_result(usage, price_book_path=None, mode="real")
    assert payload["extensions"]["ai_cost_lens"]["pricing_provenance"] is None
    metric = next(
        metric
        for metric in payload["metrics"]
        if metric["unit"] == "currency" and metric["id"] != "metric.ai.total-cost"
    )
    assert metric["basis"] == "observed"
    assert metric["dimensions"]["cost_basis"] == "provider_reported"


def test_calculated_usage_without_price_book_fails_closed(tmp_path: Path):
    usage = _write_usage(tmp_path, [_usage_row("priced", "calculated", "")])
    with pytest.raises(CanonicalError, match="requires a price book"):
        build_result(usage, price_book_path=None, mode="real")


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
    price_book = json.loads((DATA_DIR / "illustrative-price-book.json").read_text())
    price_book["mode"] = "real"
    real_price_book = tmp_path / "real-price-book.json"
    real_price_book.write_text(json.dumps(price_book))
    result = CliRunner().invoke(
        cli,
        [
            "ccac",
            "--input",
            str(usage),
            "--price-book",
            str(real_price_book),
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
    price_book = json.loads((DATA_DIR / "illustrative-price-book.json").read_text())
    price_book["mode"] = "real"
    real_price_book = tmp_path / "real-price-book.json"
    real_price_book.write_text(json.dumps(price_book))
    result = CliRunner().invoke(
        cli,
        [
            "ccac",
            "--input",
            str(usage),
            "--price-book",
            str(real_price_book),
        ],
    )
    assert result.exit_code == 1
    assert "historical rates are required" in result.output
