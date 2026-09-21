from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).parents[1]
WEB = ROOT / "web"


def test_request_analysis_has_no_network_or_credential_path():
    engine = (WEB / "usage-event-engine.js").read_text()
    app = (WEB / "app.js").read_text()
    request_section = app[
        app.index("function parseRequestLog") : app.index(
            "function scenarioModelOptions"
        )
    ]

    for forbidden in (
        "fetch(",
        "XMLHttpRequest",
        "sendBeacon",
        "WebSocket",
        "EventSource",
        "localStorage",
        "sessionStorage",
        "api_key",
        "Authorization",
    ):
        assert forbidden not in engine
        assert forbidden not in request_section

    assert "prompt_text_required: false" in engine
    assert "prompt_text_stored: false" in engine
    assert "source_file_uploaded: false" in engine
    assert "unknown source fields were not copied" in app


def test_browser_app_only_fetches_its_checked_in_example():
    app = (WEB / "app.js").read_text()
    calls = re.findall(r"fetch\(([^\n]+)", app)
    assert calls == ['"data/illustrative-review-result.json");']


def test_static_preview_inlines_request_engine_and_template():
    preview = (WEB / "preview.html").read_text()
    assert 'src="usage-event-engine.js"' not in preview
    assert "ai-cost-lens-usage-review/1.1" in preview
    assert 'href="templates/ai-cost-lens-request-log-template.csv"' not in preview
    assert "data:text/csv;base64," in preview


def test_competitor_challenge_language_stays_evidence_bounded():
    html = (WEB / "index.html").read_text()
    app = (WEB / "app.js").read_text()
    engine = (WEB / "usage-event-engine.js").read_text()
    assert "OVERLAP REMOVED FROM THE HEADLINE" in html
    assert "Price is not a capability or quality score" in html
    assert "This is not savings" in app
    assert "savings_claim_allowed: false" in engine
    assert "does not prove" in engine
    assert "not automatically recoverable" in engine
