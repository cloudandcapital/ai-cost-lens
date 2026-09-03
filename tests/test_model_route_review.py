from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]
WEB = ROOT / "web"
DATA = WEB / "data" / "model-route-review-packet.js"


def _packet() -> dict:
    script = DATA.read_text()
    prefix = "window.AI_COST_LENS_REVIEW_PACKET = "
    assert script.startswith(prefix)
    return json.loads(script.removeprefix(prefix).removesuffix(";\n"))


def test_review_assets_and_brand_contract_are_present():
    html = (WEB / "model-route-review.html").read_text()
    css = (WEB / "model-route-review.css").read_text()
    assert (WEB / "model-route-review.js").is_file()
    assert DATA.is_file()
    assert (WEB / "model-route-review-preview.html").is_file()
    assert "--paper: #f5eee9" in css
    assert "CLOUD &amp; CAPITAL" in html
    assert "Begin the blinded review" in html
    assert "Needs expert review" in html
    assert "I know the correction" in html
    assert "Show JSON to copy" in html
    assert "local only" in html
    assert 'id="response-count"' in html
    assert 'id="decision-count"' in html


def test_review_packet_is_complete_and_counterbalanced():
    packet = _packet()
    assert packet["schema_version"] == "ai-cost-lens-human-review-packet/1.0"
    assert packet["experiment_id"] == "openai-model-route-002"
    assert packet["packet_id"] == "openai-model-route-002-human-review-v2"
    assert len(packet["items"]) == 20
    assert len({item["item_id"] for item in packet["items"]}) == 20
    assert len({item["case_id"] for item in packet["items"]}) == 10
    for case_id in {item["case_id"] for item in packet["items"]}:
        routes = {
            item["route_key"] for item in packet["items"] if item["case_id"] == case_id
        }
        assert routes == {"baseline", "proposed"}
    assert sum(item["route_key"] == "baseline" for item in packet["items"]) == 10
    assert sum(item["route_key"] == "proposed" for item in packet["items"]) == 10


def test_review_packet_matches_locked_source_hashes():
    packet = _packet()
    assert packet["source_hashes"] == {
        "answer_key_sha256": "4db2cb65b2aa64932d5960174e8ef297915875db68d256e2d3197bba18cf59fe",
        "cases_sha256": "a246a1dedd201b57a911bf4468224c9daf469a8670491c49375869fc866accc5",
        "system_prompt_sha256": "e50f11103f0f90ba4b3e6ca9e361ac59ad9022c1b927781900631e3f68ded0f3",
    }
    assert packet["routes"]["baseline"]["input_tokens"] == 6852
    assert packet["routes"]["baseline"]["output_tokens"] == 1880
    assert packet["routes"]["proposed"]["input_tokens"] == 6852
    assert packet["routes"]["proposed"]["output_tokens"] == 1974


def test_single_file_reviewer_embeds_everything():
    preview = (WEB / "model-route-review-preview.html").read_text()
    assert '<link rel="stylesheet" href="model-route-review.css"' not in preview
    assert '<script src="model-route-review.js"' not in preview
    assert '<script src="data/model-route-review-packet.js"' not in preview
    assert '"schema_version": "ai-cost-lens-human-review-packet/1.0"' in preview
    assert "gpt-5.6-sol" in preview
    assert "gpt-5.6-luna" in preview


def test_javascript_element_references_exist_in_html():
    html = (WEB / "model-route-review.html").read_text()
    script = (WEB / "model-route-review.js").read_text()
    ids = set(re.findall(r'id="([^"]+)"', html))
    references = set(re.findall(r'byId\("([^"]+)"\)', script))
    assert references <= ids


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_review_javascript_has_valid_syntax():
    for path in [
        WEB / "model-route-review.js",
        ROOT / "scripts" / "build-model-route-review.mjs",
    ]:
        result = subprocess.run(
            ["node", "--check", str(path)],
            check=False,
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stderr


def test_review_builder_supports_the_smaller_follow_up_pilot():
    script = (ROOT / "scripts" / "build-model-route-review.mjs").read_text()
    app = (WEB / "model-route-review.js").read_text()
    assert 'result = { experiment: "openai-model-route-002" }' in script
    assert "const expectedResponses = casesDocument.cases.length" in script
    assert "case_count: expectedResponses" in script
    assert "response_count: expectedResponses * 2" in script
    assert "const responseCount = packet.response_count || packet.items.length" in app
    assert "${route.accepted}/${reviewed}" in app
