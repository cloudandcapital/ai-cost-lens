"""Tests for provider detection and normalization."""

from __future__ import annotations

import textwrap
from pathlib import Path

import pytest


def _write_csv(tmp_path: Path, filename: str, content: str) -> Path:
    p = tmp_path / filename
    p.write_text(textwrap.dedent(content).lstrip(), encoding="utf-8")
    return p


# ---------------------------------------------------------------------------
# detect_provider
# ---------------------------------------------------------------------------

from ai_cost_lens.providers.detector import detect_provider


def test_detect_bedrock_via_model_id_column():
    assert detect_provider({"model_id", "date", "cost_usd"}) == "bedrock"


def test_detect_openai_via_model_value():
    assert detect_provider({"model", "date", "cost_usd"}, "gpt-4o") == "openai"


def test_detect_openai_o1():
    assert detect_provider({"model", "date", "cost_usd"}, "o1-mini") == "openai"


def test_detect_anthropic_via_model_value():
    assert (
        detect_provider({"model", "date", "cost_usd"}, "claude-sonnet-4-6")
        == "anthropic"
    )


def test_detect_unknown_raises():
    with pytest.raises(ValueError, match="Cannot detect"):
        detect_provider({"irrelevant_column"})


def test_detect_ambiguous_model_raises():
    with pytest.raises(ValueError, match="ambiguous"):
        detect_provider({"model", "date", "cost_usd"}, "unknown-model-xyz")


# ---------------------------------------------------------------------------
# load_and_normalize
# ---------------------------------------------------------------------------

from ai_cost_lens.providers.detector import load_and_normalize


def test_normalize_openai(tmp_path):
    p = _write_csv(
        tmp_path,
        "openai.csv",
        """\
        date,model,input_tokens,output_tokens,requests,cost_usd
        2026-03-01,gpt-4o,1000,500,5,0.0750
        2026-03-02,gpt-4o-mini,5000,2000,20,0.0120
    """,
    )
    records = load_and_normalize(p)
    assert len(records) == 2
    assert records[0].provider == "openai"
    assert records[0].ServiceName == "gpt-4o"
    assert records[0].BilledCost == "0.0750"
    assert records[0].ChargePeriodStart == "2026-03-01"
    assert records[0].ChargePeriodEnd == "2026-03-02"
    assert records[0].ChargeType == "Usage"


def test_normalize_anthropic(tmp_path):
    p = _write_csv(
        tmp_path,
        "anthropic.csv",
        """\
        date,model,input_tokens,output_tokens,requests,cost_usd
        2026-03-01,claude-sonnet-4-6,2000,800,10,0.1200
    """,
    )
    records = load_and_normalize(p)
    assert len(records) == 1
    assert records[0].provider == "anthropic"
    assert records[0].ServiceName == "claude-sonnet-4-6"


def test_normalize_bedrock(tmp_path):
    p = _write_csv(
        tmp_path,
        "bedrock.csv",
        """\
        date,model_id,input_tokens,output_tokens,requests,cost_usd
        2026-03-01,amazon.nova-pro-v1:0,3000,1000,15,0.0480
    """,
    )
    records = load_and_normalize(p)
    assert len(records) == 1
    assert records[0].provider == "bedrock"
    assert records[0].ServiceName == "amazon.nova-pro-v1:0"


def test_missing_header_raises(tmp_path):
    p = tmp_path / "empty.csv"
    p.write_text("", encoding="utf-8")
    with pytest.raises(ValueError, match="empty or missing"):
        load_and_normalize(p)
