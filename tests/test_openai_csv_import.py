from pathlib import Path

import pytest

from ai_cost_lens.importers.openai_csv import (
    OpenAICsvImportError,
    build_openai_csv_bill_review,
)

FIXTURES = Path(__file__).parent / "fixtures"


def test_builds_strict_bill_review_without_model_cost_allocation():
    result = build_openai_csv_bill_review(
        FIXTURES / "openai-dashboard-usage.csv",
        FIXTURES / "openai-dashboard-cost.csv",
        mode="illustrative",
    )

    assert result["schema_version"] == "ai-cost-lens-openai-bill-review/0.1"
    assert result["bill"]["total"] == "12.750000"
    assert result["usage"]["totals"]["requests"] == 30
    assert result["usage"]["totals"]["input_tokens"] == 16000
    assert result["usage"]["by_model"][0]["model"] == "gpt-economy"
    assert result["period"]["aligned"] is True
    assert result["coverage"]["usage_model"]["row_coverage_pct"] == 100.0
    assert result["coverage"]["cost_project"]["row_coverage_pct"] == 0.0
    assert result["reconciliation"]["model_cost_allocation_supported"] is False
    assert result["reconciliation"]["outcome_cost_supported"] is False
    assert result["reconciliation"]["savings_claim_allowed"] is False


def test_rejects_nonreconciling_input_token_categories(tmp_path: Path):
    source = (FIXTURES / "openai-dashboard-usage.csv").read_text()
    bad = tmp_path / "bad.csv"
    bad.write_text(
        source.replace(
            "7000.0,2000.0,1000.0,0.0,6000.0", "7000.0,2000.0,1000.0,0.0,5000.0"
        )
    )

    with pytest.raises(OpenAICsvImportError, match="do not reconcile"):
        build_openai_csv_bill_review(bad, FIXTURES / "openai-dashboard-cost.csv")
