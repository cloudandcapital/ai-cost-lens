from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]
WEB = ROOT / "web"


def test_web_assets_and_brand_contract_are_present():
    html = (WEB / "index.html").read_text()
    css = (WEB / "styles.css").read_text()
    assert (WEB / "app.js").is_file()
    assert (WEB / "data" / "illustrative-review-result.json").is_file()
    assert (WEB / "preview.html").is_file()
    assert (WEB / "templates" / "ai-cost-lens-spend-template.csv").is_file()
    assert (WEB / "templates" / "ai-cost-lens-work-log-template.csv").is_file()
    assert "--paper: #f5eee9" in css
    assert "--surface: #ffffff" in css
    assert "CLOUD &amp; CAPITAL" in html
    assert "EVIDENCE CHECK" in html
    assert 'id="boundary-title"' in html
    assert "ILLUSTRATIVE DATA" not in html  # The current file supplies the label.
    assert "Illustrative data is never presented as customer evidence" in html
    assert "What would you like to check?" in html
    assert "See the worked example" in html
    assert "Upload what you have" in html
    assert "CSV, JSON, or a text-based invoice PDF" in html
    assert "Compare cost per ready result" in html
    assert "BEST PLACE TO START" in html
    assert "OPENAI OR CLAUDE" in html
    assert "ANY PROVIDER OR AI TOOL" in html
    assert (
        "universal spend and work templates for any provider, including OpenAI" in html
    )
    assert "Start with the records you already have" in html
    assert "Start with the reports you already have" in html
    assert "Put both routes in one spend file" in html
    assert "Add what happened to the work" in html
    assert (
        "A result produced with three calls has three model requests and two retries"
        in html
    )
    assert "Set the decision rules" in html
    assert html.count("data-builder-mode=") == 5
    assert 'data-builder-mode="single"' in html
    assert "CRAWL" in html
    assert "WALK" in html
    assert "RUN" in html
    assert "Understand the bill" in html
    assert "Explain the usage" in html
    assert "Connect cost to outcomes" in html
    assert "Understand one bill" in html
    assert "Human effort is optional" in html
    assert "No human review record? Leave it blank" in (WEB / "app.js").read_text()
    assert "Blended cost per request" in (WEB / "app.js").read_text()
    assert 'id="workload-builder-fields" hidden' in html
    assert 'id="openai-builder-fields" hidden' in html
    assert 'data-import-provider="openai"' in html
    assert 'data-import-provider="claude"' in html
    assert 'id="invoice-provider"' in html
    assert 'id="invoice-amount"' in html
    assert 'id="claude-spend-file"' in html
    assert 'id="claude-usage-file"' in html
    assert 'id="claude-cost-file"' in html
    assert "Claude Console Usage and Cost CSV headers are not published" in html
    assert "never asks for an API key" in html
    assert "Personal identifiers were discarded" in (WEB / "app.js").read_text()
    assert 'id="builder-actions" hidden' in html
    assert ".builder-actions[hidden]" in css
    assert 'aria-pressed="false"' in html
    assert "SAVE NOW" in (WEB / "app.js").read_text()
    assert "Quick sample" in html
    assert "How this number is built" in html
    assert "BREAK EVEN EXPLORER" in html
    assert "PLAN CHECK" in html
    assert 'id="planning-section"' in html
    assert 'id="payback-verdict"' in html
    assert "LUMEN'S READ" in html
    assert 'id="decision-code"' in html
    assert 'id="lumen-dialog"' in html
    assert 'id="lumen-form"' not in html
    assert "deterministic record explainer, not a general AI chat" in html
    assert "Share view" in html
    assert "body.story-mode .masthead," not in css
    assert "body.story-mode .header-actions > :not(#story-toggle)" in css
    assert "Download decision record (JSON)" in html
    assert 'id="print-memo"' in html
    assert 'id="finance-memo"' in html
    assert "Print finance memo" in html
    assert "What would help you today?" in html
    assert 'id="baseline-policy-approved"' in html
    assert 'id="proposed-policy-approved"' in html
    assert 'id="policy-approved"' not in html
    app = (WEB / "app.js").read_text()
    assert "builderMode: null" in app
    assert "retryRequests > Math.max(modelRequests - 1, 0)" in app
    assert "state.demoData = cloneData(state.data)" in app
    assert 'mode === "example"' in app
    assert "activateBuilderMode" in app
    assert "renderFinanceMemo" in app
    assert 'document.body.classList.add("printing-memo")' in app
    assert 'window.addEventListener("afterprint"' in app
    assert 'window.matchMedia?.("print")' in app
    assert 'document.body.classList.remove("printing-memo"), 1500' not in app
    assert "The provider bill fell" in app
    assert "The cost of a ready result rose" in app
    assert "buildPlanningRecord" in app
    assert "NO OPERATING PAYBACK" in app
    assert "What happened versus plan?" in html
    assert "Does the change pay back?" in html
    assert "Cost per ready result" in app
    assert "KEEP CURRENT ROUTE" in app
    assert "At these costs, the proposed route needs" in app
    assert 'id="yield-slider" type="range" min="0"' in html
    assert "NO READY RESULTS" in app
    assert 'input.step = "any"' in app
    assert "safeMax / 200" not in app
    assert "The example's numbers match. But this is not real-world proof." in app
    assert "if (proposed.costs.one_time_change_cost > 0)" in app
    assert ".status-illustrative" in css
    assert (
        'evidence-pill ${state.data.mode === "illustrative" ? "is-illustrative"' in app
    )
    assert "modeled cost" in app
    assert "Latest evidence date" in app
    assert "Statistical range" in app
    assert "the sample was not declared random or systematic" in app
    assert "wholeNumber(baseline.outcomes.human_review_minutes)" in app
    assert ".question-nav[hidden]" in css
    assert "body.story-mode .cockpit-grid" in css
    assert "content: attr(data-label)" in css
    assert "None included" in app
    assert ".evidence-pill.is-illustrative" in css
    assert ".review-map" not in css
    assert ".finance-memo" in css
    assert "body.printing-memo .finance-memo" in css
    memo_next = re.findall(r"\.memo-next\s*\{([^}]*)\}", css, re.DOTALL)[-1]
    assert "background: #fff" in memo_next
    assert "color: #171816" in memo_next


def test_single_file_preview_embeds_assets_and_data():
    preview = (WEB / "preview.html").read_text()
    assert '<link rel="stylesheet" href="styles.css"' not in preview
    assert '<script src="app.js"' not in preview
    assert '"schema_version": "ai-cost-lens-review-result/1.0"' in preview
    assert 'fetch("data/illustrative-review-result.json")' not in preview
    assert 'href="templates/ai-cost-lens-spend-template.csv"' not in preview
    assert 'href="templates/ai-cost-lens-work-log-template.csv"' not in preview
    assert "data:text/csv;base64," in preview


def test_static_site_build_uses_the_self_contained_review_as_index():
    script = (ROOT / "scripts" / "build-static-site.mjs").read_text()
    assert 'import("./build-model-route-decision-preview.mjs")' in script
    assert (
        'copyFile(resolve(web, "preview.html"), resolve(build, "index.html"))' in script
    )


def test_universal_templates_preserve_finance_join_fields():
    spend = (WEB / "templates" / "ai-cost-lens-spend-template.csv").read_text()
    work = (WEB / "templates" / "ai-cost-lens-work-log-template.csv").read_text()
    assert "period,date,workload,provider,model,route,requests" in spend
    assert "provider_cost,cost_basis,currency" in spend
    assert "provider_reported" in spend
    assert "calculated" in spend
    assert (
        "period,result_id,outcome_status,model_requests,retry_requests,human_minutes"
        in work
    )
    assert "baseline,base-002,needs_correction,2,1,3.0" in work
    assert "ready_to_use" in work
    assert "needs_correction" in work


def test_universal_path_explains_provider_transfer_and_source_boundaries():
    html = (WEB / "index.html").read_text()
    for label in (
        "OpenAI API",
        "Claude API",
        "Amazon Bedrock",
        "Gemini or Vertex AI",
        "Gateway or another tool",
    ):
        assert label in html
    assert "Show me exactly what to put in each column" in html
    assert "Upload the completed template, not the original provider report." in html
    assert "text-based OpenAI or Anthropic invoice PDF" in html
    assert "Scans and screenshots are not read" in html
    assert "Invoice or subscription only?" in html
    assert (
        "Choose Understand one bill to record a subscription amount without usage or outcomes"
        in html
    )
    assert "including after any correction you completed" in html
    assert "If correction made the result ready, use ready_to_use" in html
    assert "One result is one unit of finished work" in html
    assert "Show me exactly what to put in the work log" in html
    assert "Three model calls means two retries" in html


def test_universal_path_distinguishes_missing_token_data_from_zero():
    html = (WEB / "index.html").read_text()
    app = (WEB / "app.js").read_text()
    assert "Leave blank if the source does not report them." in html
    assert "Zero means the source reported zero" in html
    assert 'value === null || value === undefined ? "Not available"' in app


def test_javascript_element_references_exist_in_html():
    html = (WEB / "index.html").read_text()
    script = (WEB / "app.js").read_text()
    ids = set(re.findall(r'id="([^"]+)"', html))
    references = set(re.findall(r'getElementById\("([^"]+)"\)', script))
    assert references <= ids


def test_html_ids_are_unique():
    html = (WEB / "index.html").read_text()
    ids = re.findall(r'id="([^"]+)"', html)
    assert len(ids) == len(set(ids))


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_finance_memo_uses_the_active_decision_record_values():
    script = r"""
const fs = require("fs");
const elements = new Map();
global.document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, { textContent: "", innerHTML: "", hidden: false });
    return elements.get(id);
  },
};
let source = fs.readFileSync(process.argv[1], "utf8");
source = source.replace(
  "  function renderAll() {",
  "  globalThis.__setMemoData = (value) => { state.data = value; }; globalThis.__renderFinanceMemo = renderFinanceMemo; return;\n  function renderAll() {",
);
eval(source);
globalThis.__setMemoData(JSON.parse(fs.readFileSync(process.argv[2], "utf8")));
globalThis.__renderFinanceMemo();
console.log(JSON.stringify(Object.fromEntries([...elements.entries()].map(([id, value]) => [id, value]))));
"""
    result = subprocess.run(
        [
            "node",
            "-e",
            script,
            str(WEB / "app.js"),
            str(WEB / "data" / "illustrative-review-result.json"),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    memo = __import__("json").loads(result.stdout)
    assert memo["memo-title"]["textContent"] == "AI spend decision memo"
    assert "Customer due diligence case summaries" in memo["memo-meta"]["textContent"]
    assert memo["memo-decision-code"]["textContent"] == "KEEP CURRENT ROUTE"
    assert "$143.55" in memo["memo-table-body"]["innerHTML"]
    assert "$150.40" in memo["memo-table-body"]["innerHTML"]
    assert "+4.8%" in memo["memo-table-body"]["innerHTML"]
    assert "−$6,436.00" in memo["memo-plan-grid"]["innerHTML"]
    assert memo["memo-planning"]["hidden"] is False
    assert "Illustrative data" in memo["memo-footer-status"]["textContent"]


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_openai_bill_memo_preserves_the_provider_evidence_boundary():
    script = r"""
const fs = require("fs");
const elements = new Map();
global.document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, { textContent: "", innerHTML: "", hidden: false });
    return elements.get(id);
  },
};
let source = fs.readFileSync(process.argv[1], "utf8");
source = source.replace(
  "  function renderAll() {",
  "  globalThis.__buildBill = buildOpenAIBillReview; globalThis.__setMemoData = (value) => { state.data = value; }; globalThis.__renderFinanceMemo = renderFinanceMemo; return;\n  function renderAll() {",
);
eval(source);
(async () => {
  const review = await globalThis.__buildBill(
    fs.readFileSync(process.argv[2], "utf8"),
    fs.readFileSync(process.argv[3], "utf8"),
  );
  globalThis.__setMemoData(review);
  globalThis.__renderFinanceMemo();
  console.log(JSON.stringify(Object.fromEntries([...elements.entries()].map(([id, value]) => [id, value]))));
})();
"""
    result = subprocess.run(
        [
            "node",
            "-e",
            script,
            str(WEB / "app.js"),
            str(ROOT / "tests" / "fixtures" / "openai-dashboard-usage.csv"),
            str(ROOT / "tests" / "fixtures" / "openai-dashboard-cost.csv"),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    memo = __import__("json").loads(result.stdout)
    assert memo["memo-decision-code"]["textContent"] == "COST AND USAGE"
    assert "$12.75" in memo["memo-table-body"]["innerHTML"]
    assert "Blended cost per request" in memo["memo-table-body"]["innerHTML"]
    assert "Start with gpt-economy" in memo["memo-next-step"]["textContent"]
    assert "Unavailable from these exports" in memo["memo-evidence"]["innerHTML"]
    assert "Not supported" in memo["memo-evidence"]["innerHTML"]
    assert memo["memo-planning"]["hidden"] is True


def test_question_navigation_matches_views():
    html = (WEB / "index.html").read_text()
    nav_views = set(re.findall(r'data-view="([^"]+)"', html))
    section_views = set(re.findall(r'id="view-([^"]+)"', html))
    assert nav_views == section_views == {"review", "anatomy", "evidence"}


def test_release_review_regressions_have_plain_language_and_precise_formatting():
    app = (WEB / "app.js").read_text()
    model_review = (WEB / "model-route-review.js").read_text()
    model_review_preview = (WEB / "model-route-review-preview.html").read_text()
    assert "button.disabled = isBill" in app
    assert "button.tabIndex = isBill ? -1 : 0" in app
    assert "That file isn't valid JSON. Choose a saved AI Cost Lens review." in app
    assert 'project record${usage.by_project.length === 1 ? "" : "s"}' in app
    assert 'model route${usage.by_model.length === 1 ? "" : "s"}' in app
    assert "unitMoney(perAccepted)" in model_review
    assert "value < 1 ? `${(value * 100).toFixed(1)}¢`" in model_review
    assert "unitMoney(perAccepted)" in model_review_preview


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_browser_javascript_has_valid_syntax():
    result = subprocess.run(
        ["node", "--check", str(WEB / "app.js")],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_browser_openai_csv_review_matches_strict_fixture_totals():
    script = r"""
const fs = require("fs");
let source = fs.readFileSync(process.argv[1], "utf8");
source = source.replace(
  "  function validateResult(data) {",
  "  globalThis.__buildOpenAIBillReview = buildOpenAIBillReview; return;\n  function validateResult(data) {",
);
eval(source);
(async () => {
  const result = await globalThis.__buildOpenAIBillReview(
    fs.readFileSync(process.argv[2], "utf8"),
    fs.readFileSync(process.argv[3], "utf8"),
  );
  console.log(JSON.stringify(result));
})();
"""
    result = subprocess.run(
        [
            "node",
            "-e",
            script,
            str(WEB / "app.js"),
            str(ROOT / "tests" / "fixtures" / "openai-dashboard-usage.csv"),
            str(ROOT / "tests" / "fixtures" / "openai-dashboard-cost.csv"),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    payload = __import__("json").loads(result.stdout)
    assert payload["bill"]["total"] == 12.75
    assert payload["usage"]["totals"]["requests"] == 30
    assert payload["period"]["aligned"] is True
    assert payload["reconciliation"]["model_cost_allocation_supported"] is False
    assert payload["reconciliation"]["savings_claim_allowed"] is False


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_browser_workload_builder_accepts_three_state_outcome_template():
    script = r"""
const fs = require("fs");
let source = fs.readFileSync(process.argv[1], "utf8");
source = source.replace(
  "  function validateResult(data) {",
  "  globalThis.__buildLocalReview = buildLocalReview; return;\n  function validateResult(data) {",
);
eval(source);
(async () => {
  const result = await globalThis.__buildLocalReview(
    fs.readFileSync(process.argv[2], "utf8"),
    fs.readFileSync(process.argv[3], "utf8"),
    {
      acceptanceRule: "Correct without a material rewrite",
      verifier: "Human review",
      qualityFloor: 0.5,
      hourlyRate: 60,
      policyApproved: true,
      baselineShared: 0,
      proposedShared: 0,
      changeCost: 0,
      planning: {
        label: "Approved plan for the current route",
        plan: {
          providerCost: 5,
          sharedCost: 0,
          humanCost: 0,
          completedResults: 2,
          readyRate: 0.5,
        },
        expectedReadyPerMonth: 2,
        horizonMonths: 6,
      },
    },
  );
  console.log(JSON.stringify(result));
})();
"""
    result = subprocess.run(
        [
            "node",
            "-e",
            script,
            str(WEB / "app.js"),
            str(WEB / "templates" / "ai-cost-lens-spend-template.csv"),
            str(WEB / "templates" / "ai-cost-lens-work-log-template.csv"),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    payload = __import__("json").loads(result.stdout)
    assert payload["baseline"]["outcomes"]["status_counts"] == {
        "ready_to_use": 1,
        "needs_correction": 1,
        "needs_escalation": 0,
    }
    assert payload["proposed"]["outcomes"]["status_counts"]["ready_to_use"] == 2
    assert payload["baseline"]["evidence"]["cost_basis"] == "observed"
    assert payload["proposed"]["evidence"]["cost_basis"] == "calculated"
    assert payload["baseline"]["usage"]["requests"] == 3
    assert payload["baseline"]["usage"]["retries"] == 1
    assert payload["baseline"]["measures"]["retry_rate"] == pytest.approx(1 / 3)
    assert payload["proposed"]["usage"]["retries"] == 0
    assert payload["baseline"]["evidence"]["reconciliation_issues"] == []
    assert payload["comparison"]["same_cost_basis"] is False
    assert payload["comparison"]["provider_cost_reported"] is False
    assert payload["comparison"]["savings_claim_allowed"] is False
    assert payload["planning"]["plan"]["recurring_operating_cost"] == 5
    assert payload["planning"]["actual"]["provider_cost"] == 18.4
    assert payload["planning"]["variance"]["provider_cost"] == 13.4
    assert payload["planning"]["payback"]["decision_horizon_months"] == 6


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_browser_customer_can_build_anthropic_universal_review():
    script = r"""
const fs = require("fs");
let source = fs.readFileSync(process.argv[1], "utf8");
source = source.replace(
  "  function validateResult(data) {",
  "  globalThis.__buildLocalReview = buildLocalReview; return;\n  function validateResult(data) {",
);
eval(source);
(async () => {
  const result = await globalThis.__buildLocalReview(
    fs.readFileSync(process.argv[2], "utf8"),
    fs.readFileSync(process.argv[3], "utf8"),
    {
      acceptanceRule: "Accurate against the source record",
      verifier: "Finance reviewer",
      qualityFloor: 0.5,
      hourlyRate: 60,
      baselinePolicyApproved: true,
      proposedPolicyApproved: true,
      baselineShared: 0,
      proposedShared: 0,
      changeCost: 0,
      outcomeLogComplete: true,
    },
  );
  console.log(JSON.stringify(result));
})();
"""
    result = subprocess.run(
        [
            "node",
            "-e",
            script,
            str(WEB / "app.js"),
            str(WEB.parent / "tests" / "fixtures" / "anthropic-universal-spend.csv"),
            str(WEB.parent / "tests" / "fixtures" / "anthropic-universal-work-log.csv"),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    payload = __import__("json").loads(result.stdout)
    assert payload["baseline"]["model"]["provider"] == "Anthropic"
    assert payload["baseline"]["usage"]["requests"] == 7
    assert payload["proposed"]["usage"]["requests"] == 9
    assert payload["baseline"]["usage"]["retries"] == 2
    assert payload["proposed"]["usage"]["retries"] == 4
    assert payload["baseline"]["measures"]["cost_per_usable_result"] == 7.5
    assert payload["proposed"]["measures"]["cost_per_usable_result"] == pytest.approx(
        12.333333
    )
    assert payload["comparison"]["provider_cost_reported"] is True
    assert payload["comparison"]["evidence_complete"] is True
    assert payload["comparison"]["savings_claim_allowed"] is False
    assert payload["baseline"]["measures"]["cache_write_rate"] is None


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_browser_sampled_review_labels_estimates_and_blocks_savings_claim():
    script = r"""
const fs = require("fs");
let source = fs.readFileSync(process.argv[1], "utf8");
source = source.replace(
  "  function validateResult(data) {",
  "  globalThis.__buildSampledReview = buildSampledReview; return;\n  function validateResult(data) {",
);
eval(source);
(async () => {
  const result = await globalThis.__buildSampledReview(
    fs.readFileSync(process.argv[2], "utf8"),
    {
      baseline: { population: 1000, ready: 20, correction: 8, escalation: 2, humanMinutes: 120 },
      proposed: { population: 1000, ready: 24, correction: 5, escalation: 1, humanMinutes: 90 },
    },
    {
      acceptanceRule: "Correct without a material rewrite",
      verifier: "Human review",
      qualityFloor: 0.5,
      hourlyRate: 60,
      policyApproved: true,
      baselineShared: 0,
      proposedShared: 0,
      changeCost: 0,
      sampleRandom: true,
    },
  );
  console.log(JSON.stringify(result));
})();
"""
    result = subprocess.run(
        [
            "node",
            "-e",
            script,
            str(WEB / "app.js"),
            str(WEB / "templates" / "ai-cost-lens-spend-template.csv"),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    payload = __import__("json").loads(result.stdout)
    assert payload["mode"] == "sampled"
    assert payload["comparison"]["savings_claim_allowed"] is False
    assert payload["comparison"]["outcome_evidence_basis"] == "sampled"
    assert payload["baseline"]["outcomes"]["sample_size"] == 30
    assert payload["baseline"]["outcomes"]["completed_results"] == 1000
    assert payload["baseline"]["outcomes"]["usable_results"] == pytest.approx(
        666.666667
    )
    assert payload["baseline"]["evidence"]["coverage_status"] == "sampled"
    assert payload["baseline"]["evidence"]["cost_basis"] == "observed"
    assert payload["proposed"]["evidence"]["cost_basis"] == "calculated"
    assert payload["comparison"]["same_cost_basis"] is False
    assert payload["baseline"]["outcomes"]["ready_rate_interval_95"][0] < 20 / 30
    assert payload["baseline"]["outcomes"]["ready_rate_interval_95"][1] > 20 / 30


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_browser_universal_builder_allows_unreported_token_fields():
    script = r"""
const fs = require("fs");
let source = fs.readFileSync(process.argv[1], "utf8");
source = source.replace(
  "  function validateResult(data) {",
  "  globalThis.__buildSampledReview = buildSampledReview; return;\n  function validateResult(data) {",
);
eval(source);
const spend = `period,date,workload,provider,model,route,requests,input_tokens,cached_input_tokens,cache_write_input_tokens,output_tokens,provider_cost,cost_basis,currency
baseline,2026-08-01,Support summaries,Anthropic,Claude Sonnet,Current route,,,,,,12.50,provider_reported,USD
proposed,2026-08-15,Support summaries,Anthropic,Claude Haiku,Pilot route,,,,,,8.25,provider_reported,USD`;
(async () => {
  const result = await globalThis.__buildSampledReview(
    spend,
    {
      baseline: { population: 2, ready: 1, correction: 1, escalation: 0, humanMinutes: 2 },
      proposed: { population: 2, ready: 2, correction: 0, escalation: 0, humanMinutes: 1 },
    },
    {
      acceptanceRule: "Accurate without a material rewrite",
      verifier: "Human review",
      qualityFloor: 0.5,
      hourlyRate: 60,
      baselinePolicyApproved: true,
      proposedPolicyApproved: true,
      baselineShared: 0,
      proposedShared: 0,
      changeCost: 0,
      sampleRandom: true,
    },
  );
  console.log(JSON.stringify(result));
})();
"""
    result = subprocess.run(
        ["node", "-e", script, str(WEB / "app.js")],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    payload = __import__("json").loads(result.stdout)
    assert payload["baseline"]["usage"]["requests"] is None
    assert payload["baseline"]["usage"]["processed_input_tokens"] is None
    assert payload["baseline"]["usage"]["cached_input_tokens"] is None
    assert payload["baseline"]["usage"]["output_tokens"] is None
    assert payload["baseline"]["measures"]["cache_reuse_rate"] is None
    assert payload["baseline"]["costs"]["model_cost"] == 12.5
