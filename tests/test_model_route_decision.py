from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]
WEB = ROOT / "web"
DATA = WEB / "data" / "model-route-decision-v1.js"
RECORD = ROOT / "examples" / "decision-records" / "openai-model-route-002.json"


def _decision() -> dict:
    script = DATA.read_text()
    prefix = "window.AI_COST_LENS_MODEL_ROUTE_DECISION = "
    assert script.startswith(prefix)
    return json.loads(script.removeprefix(prefix).removesuffix(";\n"))


def test_decision_assets_and_brand_contract_are_present():
    html = (WEB / "model-route-decision.html").read_text()
    css = (WEB / "model-route-decision.css").read_text()
    assert (WEB / "model-route-decision.js").is_file()
    assert DATA.is_file()
    assert "--paper: #f5eee9" in css
    assert "CLOUD &amp; CAPITAL" in html
    assert "MODEL ROUTE DECISION" in html
    assert "What did this test actually prove?" in html
    assert "Open decision JSON" in html
    assert "Next test" in html
    script = (WEB / "model-route-decision.js").read_text()
    assert "recordedDate(state.data)" in script
    assert "state.data.as_of}`" not in script


def test_bundled_decision_matches_reconciled_pilot_002():
    decision = _decision()
    assert decision["schema_version"] == "ai-cost-lens-decision-record/0.1"
    assert decision["decision_id"] == "openai-model-route-002-decision-v1"
    assert decision["mode"] == "controlled_synthetic_pilot"
    baseline = decision["routes"]["baseline"]
    proposed = decision["routes"]["proposed"]
    assert baseline["provider_cost_usd"] == 0.065008
    assert proposed["provider_cost_usd"] == 0.0037392
    assert baseline["exact_responses"] == 9
    assert proposed["exact_responses"] == 5
    assert decision["comparison"]["provider_cost_difference_usd"] == 0.0612688
    assert round(decision["comparison"]["provider_cost_reduction_pct"], 2) == 94.25
    assert decision["comparison"]["human_review_cost_usd"] is None
    states = {item["claim_id"]: item["state"] for item in decision["claims"]}
    assert states["all_in_savings"] == "UNKNOWN"
    assert decision["comparison"]["gates"]["valid_human_review_cost"] is False


def test_browser_fixture_is_generated_from_portable_record():
    assert _decision() == json.loads(RECORD.read_text())


def test_decision_keeps_evidence_states_separate():
    decision = _decision()
    states = {item["topic"]: item["state"] for item in decision["evidence"]}
    assert states == {
        "Provider bill": "VERIFIED_FACT",
        "Objective correctness": "VERIFIED_FACT",
        "Reviewer trust": "LIMITED_EVIDENCE",
        "All-in economics": "UNKNOWN",
    }


def test_javascript_element_references_exist_in_html():
    html = (WEB / "model-route-decision.html").read_text()
    script = (WEB / "model-route-decision.js").read_text()
    ids = set(re.findall(r'id="([^"]+)"', html))
    references = set(re.findall(r'byId\("([^"]+)"\)', script))
    assert references <= ids


def test_single_file_decision_preview_embeds_everything():
    preview = (WEB / "model-route-decision-preview.html").read_text()
    assert '<link rel="stylesheet" href="model-route-decision.css"' not in preview
    assert '<script src="model-route-decision.js"' not in preview
    assert '<script src="data/model-route-decision-v1.js"' not in preview
    assert '"schema_version": "ai-cost-lens-decision-record/0.1"' in preview
    assert "gpt-5.6-sol" in preview
    assert "gpt-5.6-luna" in preview


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_decision_javascript_has_valid_syntax():
    for path in [
        WEB / "model-route-decision.js",
        DATA,
        ROOT / "scripts" / "build-model-route-decision-preview.mjs",
    ]:
        result = subprocess.run(
            ["node", "--check", str(path)],
            check=False,
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stderr
