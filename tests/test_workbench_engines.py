from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]
WEB = ROOT / "web"


def run_node(source: str, *paths: Path) -> dict:
    result = subprocess.run(
        ["node", "-e", source, *(str(path) for path in paths)],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_opportunity_engine_is_conservative_and_does_not_sum_overlapping_findings():
    result = run_node(
        r"""
const fs = require("fs");
const engine = require(process.argv[1]);
const review = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
console.log(JSON.stringify(engine.analyzeReview(review)));
""",
        WEB / "opportunity-engine.js",
        WEB / "data" / "illustrative-review-result.json",
    )
    assert result["schema_version"] == "ai-cost-lens-opportunity-set/1.0"
    assert result["supported"] is True
    by_id = {item["id"]: item for item in result["findings"]}
    assert set(by_id) == {
        "quality-floor-erosion",
        "human-rework-increase",
        "unit-cost-deterioration",
        "retry-cost-candidate",
        "unverified-financial-difference",
    }
    assert by_id["quality-floor-erosion"]["action"] == "keep_current_route"
    assert by_id["quality-floor-erosion"]["metrics"] == {
        "quality_floor": 0.9,
        "observed_usable_rate": 0.75,
    }
    assert result["currency"] == "USD"
    assert by_id["human-rework-increase"]["estimated_avoidable_cost"] == 42860
    assert by_id["unit-cost-deterioration"]["estimated_avoidable_cost"] == 6436
    assert by_id["retry-cost-candidate"]["estimated_avoidable_cost"] is None
    assert (
        by_id["retry-cost-candidate"]["confidence_in_dollar_estimate"]
        == "not_quantified"
    )
    assert "request-level" in by_id["retry-cost-candidate"]["limitations"]
    headline = result["headline"]
    assert headline["conservative_non_additive_opportunity"] == 42860
    assert headline["savings_claim_allowed"] is False
    assert "never summed" in headline["method"]


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_scenario_engine_reprices_observed_shape_without_calling_it_savings():
    result = run_node(
        r"""
const fs = require("fs");
const engine = require(process.argv[1]);
const catalog = require(process.argv[2]);
const review = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
console.log(JSON.stringify(engine.simulateRoute(review, catalog, {
  route: "baseline",
  model_id: "openai/gpt-5.6-luna",
  cached_input_share: 0.25,
  output_reduction: 0.20,
  retry_reduction: 0.50,
  batch: false,
})));
""",
        WEB / "scenario-engine.js",
        WEB / "data" / "pricing-catalog-v0.5.js",
        WEB / "data" / "illustrative-review-result.json",
    )
    assert result["schema_version"] == "ai-cost-lens-scenario/1.0"
    assert result["modeled_usage"]["requests"] == 970
    assert result["modeled_usage"]["input_tokens"] == 116_400_000
    assert result["modeled_usage"]["cached_input_tokens"] == 29_100_000
    assert result["modeled_usage"]["output_tokens"] == 6_208_000
    # 87.3M uncached * .20 + 29.1M cached * .02 + 6.208M output * 1.20.
    assert result["economics"]["estimated_provider_cost_usd"] == 25.4916
    assert result["economics"]["non_provider_cost_held_constant_usd"] == 34940
    assert result["economics"]["estimated_recurring_operating_cost_usd"] == 34965.4916
    assert result["evidence_gate"]["decision"] == "TEST_FIRST"
    assert result["evidence_gate"]["savings_claim_allowed"] is False
    assert result["assumptions"]["model_behavior_and_quality_held_constant"] is True
    assert result["assumptions"]["removed_retries_use_average_token_shape"] is True


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_workbench_engines_do_not_turn_missing_values_into_zero():
    result = run_node(
        r"""
const opportunities = require(process.argv[1]);
const scenarios = require(process.argv[2]);
const actuals = require(process.argv[3]);
const catalog = require(process.argv[4]);
const sparseReview = {
  schema_version: "ai-cost-lens-review-result/1.0",
  currency: "USD",
  workload: {accepted_quality_threshold: 0.9},
  baseline: {label: "Current", usage: {requests: 10, processed_input_tokens: null, output_tokens: 10, retries: 0}, costs: {model_cost: 1}, measures: {}, outcomes: {}},
  proposed: {label: "Proposed", usage: {requests: 10, processed_input_tokens: null, output_tokens: 10, retries: 0}, costs: {model_cost: null, human_review_cost: null}, measures: {retry_rate: null, cache_reuse_rate: null}, outcomes: {}, evidence: {}},
  comparison: {savings_claim_allowed: false},
};
const findings = opportunities.analyzeReview(sparseReview).findings;
let scenarioRejected = false;
let actualsRejected = false;
try {
  scenarios.simulateRoute(sparseReview, catalog, {route: "baseline", model_id: "openai/gpt-5.6-luna", cached_input_share: 0, output_reduction: 0, retry_reduction: 0, batch: false});
} catch (_error) { scenarioRejected = true; }
try {
  actuals.buildLedger({source_mode: "real", currency: "USD", baseline_period: "July", actual_period: "August", baseline_cost: null, actual_cost: 1, baseline_volume: 1, actual_volume: 1, baseline_usable_rate: 1, actual_usable_rate: 1, quality_floor: 1});
} catch (_error) { actualsRejected = true; }
console.log(JSON.stringify({findings, scenarioRejected, actualsRejected}));
""",
        WEB / "opportunity-engine.js",
        WEB / "scenario-engine.js",
        WEB / "actuals-engine.js",
        WEB / "data" / "pricing-catalog-v0.5.js",
    )
    assert result["scenarioRejected"] is True
    assert result["actualsRejected"] is True
    assert not any(item["id"] == "human-rework-increase" for item in result["findings"])
    assert not any(item["id"] == "retry-cost-candidate" for item in result["findings"])


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_scenario_engine_rejects_retry_counts_above_total_requests():
    result = run_node(
        r"""
const scenarios = require(process.argv[1]);
const catalog = require(process.argv[2]);
const review = {
  schema_version: "ai-cost-lens-review-result/1.0",
  currency: "USD",
  baseline: {id: "baseline", label: "Current", usage: {requests: 10, retries: 11, processed_input_tokens: 1000, output_tokens: 100}, costs: {model_cost: 1}},
  proposed: {id: "proposed", label: "Proposed", usage: {requests: 10, retries: 0, processed_input_tokens: 1000, output_tokens: 100}, costs: {model_cost: 1}},
};
let rejected = false;
let missingRejected = false;
let currencyRejected = false;
try {
  scenarios.simulateRoute(review, catalog, {route: "baseline", model_id: "openai/gpt-5.6-luna", cached_input_share: 0, output_reduction: 0, retry_reduction: 1, batch: false});
} catch (_error) { rejected = true; }
try {
  scenarios.simulateRoute({...review, baseline: {...review.baseline, usage: {...review.baseline.usage, retries: null}}}, catalog, {route: "baseline", model_id: "openai/gpt-5.6-luna", cached_input_share: 0, output_reduction: 0, retry_reduction: 0.5, batch: false});
} catch (_error) { missingRejected = true; }
try {
  scenarios.simulateRoute({...review, currency: "EUR", baseline: {...review.baseline, usage: {...review.baseline.usage, retries: 1}}}, catalog, {route: "baseline", model_id: "openai/gpt-5.6-luna", cached_input_share: 0, output_reduction: 0, retry_reduction: 0, batch: false});
} catch (_error) { currencyRejected = true; }
console.log(JSON.stringify({rejected, missingRejected, currencyRejected}));
""",
        WEB / "scenario-engine.js",
        WEB / "data" / "pricing-catalog-v0.5.js",
    )
    assert result["rejected"] is True
    assert result["missingRejected"] is True
    assert result["currencyRejected"] is True


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_actuals_engine_requires_every_gate_before_realized_savings():
    result = run_node(
        r"""
const engine = require(process.argv[1]);
const complete = {
  source_mode: "real",
  currency: "USD",
  baseline_period: "2026-07", actual_period: "2026-09",
  baseline_cost: 100000, actual_cost: 70000,
  baseline_volume: 1000, actual_volume: 900,
  baseline_usable_rate: 0.90, actual_usable_rate: 0.92,
  implementation_cost: 5000, quality_floor: 0.90,
  quality_verified: true, policy_approved: true,
  implemented_at: "2026-09-01", provider_reported: true,
  periods_comparable: true, outcomes_complete: true,
};
const realized = engine.buildLedger(complete, "2026-09-21T00:00:00.000Z");
const blocked = engine.buildLedger({...complete, quality_verified: false}, "2026-09-21T00:00:00.000Z");
const illustrative = engine.buildLedger({...complete, source_mode: "illustrative"}, "2026-09-21T00:00:00.000Z");
const eur = engine.buildLedger({...complete, currency: "EUR"}, "2026-09-21T00:00:00.000Z");
const missingImplementation = engine.buildLedger({...complete, implemented_at: ""}, "2026-09-21T00:00:00.000Z");
let invalidDateRejected = false;
let fractionalVolumeRejected = false;
try { engine.buildLedger({...complete, implemented_at: "2026-02-31"}); } catch (_error) { invalidDateRejected = true; }
try { engine.buildLedger({...complete, actual_volume: 900.5}); } catch (_error) { fractionalVolumeRejected = true; }
console.log(JSON.stringify({realized, blocked, illustrative, eur, missingImplementation, invalidDateRejected, fractionalVolumeRejected}));
""",
        WEB / "actuals-engine.js",
    )
    realized = result["realized"]
    assert realized["schema_version"] == "ai-cost-lens-realized-savings/1.0"
    assert realized["currency"] == "USD"
    assert realized["normalization"]["normalized_baseline_cost"] == 92000
    assert realized["waterfall"]["billed_difference"] == 22000
    assert realized["waterfall"]["realized_net_difference"] == 17000
    assert realized["gates"]["realized_savings_claim_allowed"] is True
    assert realized["status"] == "REALIZED"
    assert [stage["stage"] for stage in realized["stages"]] == [
        "identified",
        "proposed",
        "verified",
        "approved",
        "implemented",
        "observed",
        "realized",
    ]
    assert all(stage["complete"] for stage in realized["stages"])

    blocked = result["blocked"]
    assert blocked["waterfall"]["realized_net_difference"] == 17000
    assert blocked["gates"]["realized_savings_claim_allowed"] is False
    assert blocked["status"] == "OBSERVED_NOT_REALIZED"
    assert blocked["stages"][-1] == {"stage": "realized", "complete": False}

    illustrative = result["illustrative"]
    assert illustrative["waterfall"]["realized_net_difference"] == 17000
    assert illustrative["gates"]["source_record_is_real"] is False
    assert illustrative["gates"]["realized_savings_claim_allowed"] is False
    assert result["eur"]["currency"] == "EUR"

    assert result["missingImplementation"]["gates"]["implementation_recorded"] is False
    assert result["missingImplementation"]["stages"][5] == {
        "stage": "observed",
        "complete": False,
    }
    assert result["invalidDateRejected"] is True
    assert result["fractionalVolumeRejected"] is True


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
@pytest.mark.parametrize(
    "asset",
    [
        WEB / "opportunity-engine.js",
        WEB / "scenario-engine.js",
        WEB / "actuals-engine.js",
    ],
)
def test_workbench_engine_javascript_has_valid_syntax(asset: Path):
    result = subprocess.run(
        ["node", "--check", str(asset)],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
