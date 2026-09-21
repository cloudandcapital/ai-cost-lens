from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]
WEB = ROOT / "web"
ENGINE = WEB / "usage-event-engine.js"
CATALOG = WEB / "data" / "pricing-catalog-v0.4.js"
FIXTURE = ROOT / "tests" / "fixtures" / "request-events-multi-provider.csv"


def run_node(script: str, *args: Path) -> dict:
    result = subprocess.run(
        ["node", "-e", script, *map(str, args)],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_request_events_normalize_and_provider_cost_wins():
    result = run_node(
        r"""
const engine = require(process.argv[1]);
const catalog = require(process.argv[2]);
const rows = [{
  request_id: "r-1", created_at: "2026-09-01T00:00:00Z", model: "gpt-5.6-sol",
  prompt_tokens: "1000", completion_tokens: "500", cached_tokens: "250",
  cost_usd: "9.99", calculated_cost_usd: "1.25", status: "ok", currency: "usd",
  prompt: "this must not be copied", user_email: "private@example.com",
}];
const review = engine.buildReview(rows, {
  catalog, source_name: "request.csv", source_file_hash: "abc123", generated_at: "2026-09-21T00:00:00Z",
});
console.log(JSON.stringify(review));
""",
        ENGINE,
        CATALOG,
    )
    event = result["events"][0]
    assert event["schema_version"] == "ai-cost-lens-usage-event/1.0"
    assert event["provider"] == "OpenAI"
    assert event["provider_reported_cost"] == 9.99
    assert event["calculated_cost"] == 1.25
    assert event["selected_cost"] == 9.99
    assert event["cost_basis"] == "provider_reported"
    assert event["source_file_hash"] == "abc123"
    assert "prompt" not in event
    assert "user_email" not in event
    assert result["privacy"] == {
        "parsed_locally": True,
        "prompt_text_required": False,
        "prompt_text_stored": False,
        "source_file_uploaded": False,
    }


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_catalog_cost_requires_explicit_pricing_inputs_and_matching_currency_date():
    result = run_node(
        r"""
const engine = require(process.argv[1]);
const catalog = require(process.argv[2]);
const complete = {
  event_id: "priced", timestamp: "2026-09-21T12:00:00Z", model: "gpt-5.6-sol",
  input_tokens: 1000, output_tokens: 500, cached_input_tokens: 250,
  batch: false, tool_charges: 0, currency: "USD",
};
const variants = [
  complete,
  {...complete, event_id: "cache-missing", cached_input_tokens: ""},
  {...complete, event_id: "batch-missing", batch: ""},
  {...complete, event_id: "tool-cost-missing", tool_charges: ""},
  {...complete, event_id: "wrong-currency", currency: "EUR"},
  {...complete, event_id: "before-catalog", timestamp: "2026-09-20T12:00:00Z"},
];
console.log(JSON.stringify(engine.buildReview(variants, {catalog, generated_at: "2026-09-21T00:00:00Z"})));
""",
        ENGINE,
        CATALOG,
    )
    events = {event["event_id"]: event for event in result["events"]}
    assert events["priced"]["calculated_cost"] == 0.0131
    assert events["priced"]["cost_basis"] == "calculated"
    for event_id in (
        "cache-missing",
        "batch-missing",
        "tool-cost-missing",
        "wrong-currency",
        "before-catalog",
    ):
        assert events[event_id]["calculated_cost"] is None
        assert events[event_id]["cost_basis"] == "unpriced"


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_request_level_rules_flag_specific_rows_and_remove_overlap():
    result = run_node(
        r"""
const fs = require("fs");
const engine = require(process.argv[1]);
const catalog = require(process.argv[2]);
const text = fs.readFileSync(process.argv[3], "utf8").trim();
const lines = text.split(/\r?\n/);
const headers = lines[0].split(",");
const rows = lines.slice(1).map((line) => Object.fromEntries(line.split(",").map((value, index) => [headers[index], value])));
console.log(JSON.stringify(engine.buildReview(rows, {catalog, source_file_hash: "fixture", generated_at: "2026-09-21T00:00:00Z"})));
""",
        ENGINE,
        CATALOG,
        FIXTURE,
    )
    assert result["event_count"] == 7
    assert result["reconciliation"]["priced_rows"] == 7
    assert result["reconciliation"]["duplicate_rows_flagged"] == 2
    by_id = {finding["id"]: finding for finding in result["findings"]}
    assert {
        "duplicate-billed-event",
        "failed-or-retried-request-cost",
        "repeated-error-loop",
        "low-cache-use-with-repeated-prefix",
        "oversized-input-candidate",
        "excessive-output-candidate",
        "reasoning-intensity-candidate",
        "repeated-tool-call-candidate",
    }.issubset(by_id)
    assert by_id["duplicate-billed-event"]["affected_event_ids"] == ["row-000005"]
    assert len(by_id["failed-or-retried-request-cost"]["affected_event_ids"]) == 4
    # Failed/retry rows cost 4 × .0064. One duplicate and the retry loop overlap;
    # the headline uses the union, not the sum of all three findings.
    assert result["headline"]["conservative_non_additive_opportunity"] == 0.0256
    assert result["headline"]["priced_affected_event_count"] == 4
    assert result["headline"]["savings_claim_allowed"] is False
    assert "counted once" in result["headline"]["method"]


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_unpriced_rows_survive_and_missing_values_do_not_become_zero():
    result = run_node(
        r"""
const engine = require(process.argv[1]);
const catalog = require(process.argv[2]);
const review = engine.buildReview([{event_id: "x", model: "unknown", workload: "A", status: "success"}], {catalog});
let invalidCache = false;
let nested = false;
let ambiguous = false;
let normalizedDuplicate = false;
try { engine.buildReview([{model: "gpt-5.6-sol", input_tokens: 10, cached_input_tokens: 11, output_tokens: 1}], {catalog}); } catch (_error) { invalidCache = true; }
try { engine.buildReview([{event_id: "x", metadata: {secret: true}}], {catalog}); } catch (_error) { nested = true; }
try { engine.buildReview([{event_id: "x", request_id: "y"}], {catalog}); } catch (_error) { ambiguous = true; }
try { engine.buildReview([{"Event ID": "x", event_id: "x"}], {catalog}); } catch (_error) { normalizedDuplicate = true; }
console.log(JSON.stringify({review, invalidCache, nested, ambiguous, normalizedDuplicate}));
""",
        ENGINE,
        CATALOG,
    )
    event = result["review"]["events"][0]
    assert event["input_tokens"] is None
    assert event["provider_reported_cost"] is None
    assert event["calculated_cost"] is None
    assert event["selected_cost"] is None
    assert event["cost_basis"] == "unpriced"
    assert result["review"]["reconciliation"]["unpriced_rows"] == 1
    assert result["invalidCache"] is True
    assert result["nested"] is True
    assert result["ambiguous"] is True
    assert result["normalizedDuplicate"] is True


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_mixed_currency_never_produces_a_cross_currency_total():
    result = run_node(
        r"""
const engine = require(process.argv[1]);
const rows = [
  {event_id: "a", workload: "Route A", provider_reported_cost: 10, currency: "USD", status: "failed"},
  {event_id: "b", workload: "Route B", provider_reported_cost: 8, currency: "EUR", status: "failed"},
];
console.log(JSON.stringify(engine.buildReview(rows, {generated_at: "2026-09-21T00:00:00Z"})));
""",
        ENGINE,
    )
    assert result["currency"] == "MIXED"
    assert result["reconciliation"]["selected_observed_cost"] is None
    assert result["spend"]["selected_cost"] is None
    assert result["spend"]["cost_per_priced_request"] is None
    assert result["spend"]["projected_30_day_cost"] is None
    assert all(
        item["selected_cost"] is None
        for rows in result["spend"]["breakdowns"].values()
        for item in rows
    )
    assert result["headline"]["conservative_non_additive_opportunity"] is None
    assert "No cross-currency amount" in result["headline"]["method"]
    assert all(
        finding["estimated_avoidable_cost"] is None for finding in result["findings"]
    )
    assert all(not finding["event_avoidable_costs"] for finding in result["findings"])
    assert all(
        finding["confidence_in_dollar_estimate"] == "not_quantified"
        for finding in result["findings"]
    )
    by_id = {finding["id"]: finding for finding in result["findings"]}
    assert (
        "2 of 2 priced requests"
        in by_id["spend-without-outcome-evidence"]["explanation"]
    )
    assert (
        "% of selected request cost"
        not in by_id["spend-without-outcome-evidence"]["explanation"]
    )
    assert "spend-concentration" not in by_id


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_model_mismatch_is_only_a_candidate_and_never_headline_savings():
    result = run_node(
        r"""
const engine = require(process.argv[1]);
const catalog = require(process.argv[2]);
const rows = [
  {event_id: "a", workload: "Classification", provider: "OpenAI", model: "gpt-6-astra", input_tokens: 1000, output_tokens: 50, cost_usd: 0.0125, currency: "USD", outcome_status: "ready_to_use"},
  {event_id: "b", workload: "Classification", provider: "OpenAI", model: "gpt-5.6-luna", input_tokens: 1000, output_tokens: 50, cost_usd: 0.00026, currency: "USD", outcome_status: "ready_to_use"},
];
console.log(JSON.stringify(engine.buildReview(rows, {catalog, generated_at: "2026-09-21T00:00:00Z"})));
""",
        ENGINE,
        CATALOG,
    )
    by_id = {finding["id"]: finding for finding in result["findings"]}
    candidate = by_id["model-mismatch-candidate"]
    assert candidate["action"] == "verify"
    assert candidate["headline_eligible"] is False
    assert candidate["confidence_in_dollar_estimate"] == "estimated"
    assert "does not prove" in candidate["explanation"]
    assert result["headline"]["conservative_non_additive_opportunity"] is None
    assert result["evidence_gate"]["savings_claim_allowed"] is False


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_cost_spike_requires_unit_cost_change_and_never_becomes_savings():
    result = run_node(
        r"""
const engine = require(process.argv[1]);
const rows = Array.from({length: 8}, (_, index) => ({
  event_id: `day-${index + 1}`,
  timestamp: `2026-09-${String(index + 1).padStart(2, "0")}T12:00:00Z`,
  workload: "Summaries",
  provider_reported_cost: index === 7 ? 3 : 1,
  currency: "USD",
  status: "success",
  outcome_status: "ready_to_use",
}));
console.log(JSON.stringify(engine.buildReview(rows, {generated_at: "2026-09-21T00:00:00Z"})));
""",
        ENGINE,
    )
    by_id = {finding["id"]: finding for finding in result["findings"]}
    spike = by_id["cost-spike-unexplained-by-volume"]
    assert spike["affected_event_ids"] == ["row-000008"]
    assert spike["current_cost"] == 3
    assert spike["estimated_avoidable_cost"] is None
    assert spike["headline_eligible"] is False
    assert spike["confidence_in_dollar_estimate"] == "not_quantified"
    assert result["headline"]["conservative_non_additive_opportunity"] is None
    assert result["evidence_gate"]["savings_claim_allowed"] is False


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_spend_overview_requires_complete_comparable_coverage_for_run_rate():
    result = run_node(
        r"""
const engine = require(process.argv[1]);
const rows = Array.from({length: 7}, (_, index) => ({
  event_id: `day-${index + 1}`,
  timestamp: `2026-09-${String(index + 1).padStart(2, "0")}T12:00:00Z`,
  provider: index < 4 ? "OpenAI" : "Anthropic",
  model: index < 4 ? "gpt-5.6-sol" : "claude-sonnet-5",
  project: index < 5 ? "Product" : "Research",
  workload: "Summaries",
  provider_reported_cost: 10,
  currency: "USD",
  status: "success",
  outcome_status: "ready_to_use",
}));
const confirmed = engine.buildReview(rows, {period_complete_confirmed: true});
const undeclared = engine.buildReview(rows, {period_complete_confirmed: false});
const partial = engine.buildReview([...rows, {...rows[0], event_id: "unpriced", provider_reported_cost: ""}], {period_complete_confirmed: true});
console.log(JSON.stringify({confirmed, undeclared, partial}));
""",
        ENGINE,
    )
    spend = result["confirmed"]["spend"]
    assert spend["period"] == {
        "start": "2026-09-01",
        "end": "2026-09-07",
        "calendar_days": 7,
        "active_days": 7,
        "timestamped_rows": 7,
        "complete_period_confirmed": True,
    }
    assert spend["selected_cost"] == 70
    assert spend["cost_per_priced_request"] == 10
    assert spend["average_cost_per_calendar_day"] == 10
    assert spend["projected_30_day_cost"] == 300
    assert spend["run_rate_status"] == "AVAILABLE"
    assert spend["run_rate_limitations"] == []
    assert spend["breakdowns"]["provider"] == [
        {
            "label": "OpenAI",
            "event_count": 4,
            "priced_rows": 4,
            "selected_cost": 40,
            "average_selected_cost_per_priced_row": 10,
            "share_of_selected_cost": 0.571429,
        },
        {
            "label": "Anthropic",
            "event_count": 3,
            "priced_rows": 3,
            "selected_cost": 30,
            "average_selected_cost_per_priced_row": 10,
            "share_of_selected_cost": 0.428571,
        },
    ]
    undeclared = result["undeclared"]["spend"]
    assert undeclared["run_rate_status"] == "NOT_SUPPORTED"
    assert undeclared["projected_30_day_cost"] is None
    assert (
        "Complete continuous period not confirmed" in undeclared["run_rate_limitations"]
    )
    partial = result["partial"]["spend"]
    assert partial["run_rate_status"] == "NOT_SUPPORTED"
    assert partial["projected_30_day_cost"] is None
    assert "Some rows are unpriced" in partial["run_rate_limitations"]


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_budget_variance_and_operating_signals_reconcile_without_claiming_savings():
    result = run_node(
        r"""
const engine = require(process.argv[1]);
const rows = Array.from({length: 14}, (_, index) => ({
  event_id: `day-${index + 1}`,
  timestamp: `2026-09-${String(index + 1).padStart(2, "0")}T12:00:00Z`,
  provider: index < 7 ? "OpenAI" : "Anthropic",
  model: index < 7 ? "gpt-5.6-sol" : "claude-sonnet-5",
  project: "Product",
  team: index < 7 ? "Platform" : "Growth",
  customer: "Internal",
  workload: "Summaries",
  input_tokens: 100,
  cached_input_tokens: 20,
  provider_reported_cost: index < 7 ? 10 : 20,
  currency: "USD",
  status: index === 12 ? "failed" : index === 13 ? "retried" : "success",
  retry_parent_event_id: index === 13 ? "day-13" : "",
  latency_ms: 100 + index * 10,
  outcome_status: "ready_to_use",
}));
const watch = engine.buildReview(rows, {
  period_complete_confirmed: true,
  monthly_budget: 500,
  budget_warning_threshold: .8,
  generated_at: "2026-09-21T00:00:00Z",
});
const over = engine.buildReview(rows, {
  period_complete_confirmed: true,
  monthly_budget: 400,
  budget_warning_threshold: .8,
});
const incomplete = engine.buildReview(rows, {
  period_complete_confirmed: false,
  monthly_budget: 500,
});
const missingSignals = engine.buildReview(rows.map((row) => {
  const {status, retry_parent_event_id, cached_input_tokens, latency_ms, outcome_status, ...rest} = row;
  return rest;
}), {period_complete_confirmed: true});
const volumeRows = rows.flatMap((row, index) => {
  const first = {...row, provider_reported_cost: 10};
  return index < 7 ? [first] : [first, {...first, event_id: `${row.event_id}-second`}];
});
const volumeOnly = engine.buildReview(volumeRows, {period_complete_confirmed: true});
const zeroPrior = engine.buildReview(rows.map((row, index) => ({...row, provider_reported_cost: index < 7 ? 0 : 10})), {period_complete_confirmed: true});
const oddPeriod = engine.buildReview([...rows, {...rows.at(-1), event_id: "day-15", timestamp: "2026-09-15T12:00:00Z"}], {period_complete_confirmed: true});
let zeroBudgetRejected = false;
let thresholdRejected = false;
try { engine.buildReview(rows, {period_complete_confirmed: true, monthly_budget: 0}); } catch (_error) { zeroBudgetRejected = true; }
try { engine.buildReview(rows, {period_complete_confirmed: true, monthly_budget: 500, budget_warning_threshold: 1.01}); } catch (_error) { thresholdRejected = true; }
console.log(JSON.stringify({watch, over, incomplete, missingSignals, volumeOnly, zeroPrior, oddPeriod, zeroBudgetRejected, thresholdRejected}));
""",
        ENGINE,
    )
    review = result["watch"]
    assert review["schema_version"] == "ai-cost-lens-usage-review/1.1"
    assert review["application_version"] == "0.5.0"
    budget = review["spend"]["budget"]
    assert budget == {
        "status": "WATCH",
        "monthly_budget": 500,
        "warning_threshold": 0.8,
        "projected_30_day_cost": 450,
        "projected_utilization": 0.9,
        "projected_variance_to_budget": -50,
        "projected_budget_remaining": 50,
        "currency": "USD",
        "method": budget["method"],
        "savings_claim_allowed": False,
    }
    assert "not a live alert or forecast" in budget["method"]
    assert result["over"]["spend"]["budget"]["status"] == "OVER"
    assert result["incomplete"]["spend"]["budget"]["status"] == "RUN_RATE_UNAVAILABLE"
    assert result["zeroBudgetRejected"] is True
    assert result["thresholdRejected"] is True

    variance = review["spend"]["period_variance"]
    assert variance["status"] == "AVAILABLE"
    assert variance["window_days"] == 7
    assert variance["prior_period"]["selected_cost"] == 70
    assert variance["current_period"]["selected_cost"] == 140
    assert variance["total_cost_change"] == 70
    assert variance["total_cost_change_rate"] == 1
    assert variance["request_volume_effect"] == 0
    assert variance["average_cost_per_request_effect"] == 70
    assert variance["savings_claim_allowed"] is False
    assert (
        variance["request_volume_effect"] + variance["average_cost_per_request_effect"]
        == variance["total_cost_change"]
    )
    assert variance["top_model_cost_changes"][0] == {
        "label": "Anthropic · claude-sonnet-5",
        "prior_cost": 0,
        "current_cost": 140,
        "change": 140,
    }
    assert variance["top_provider_cost_changes"][0] == {
        "label": "Anthropic",
        "prior_cost": 0,
        "current_cost": 140,
        "change": 140,
    }
    assert result["incomplete"]["spend"]["period_variance"]["status"] == "NOT_SUPPORTED"

    volume = result["volumeOnly"]["spend"]["period_variance"]
    assert volume["total_cost_change"] == 70
    assert volume["request_volume_effect"] == 70
    assert volume["average_cost_per_request_effect"] == 0
    zero_prior = result["zeroPrior"]["spend"]["period_variance"]
    assert zero_prior["total_cost_change"] == 70
    assert zero_prior["total_cost_change_rate"] is None
    odd = result["oddPeriod"]["spend"]["period_variance"]
    assert odd["window_days"] == 7
    assert odd["excluded_leading_days"] == 1
    assert odd["prior_period"]["start"] == "2026-09-02"
    assert odd["current_period"]["end"] == "2026-09-15"

    operating = review["spend"]["operational_metrics"]
    assert operating["status_coverage_rows"] == 14
    assert operating["failed_or_cancelled_rows"] == 1
    assert operating["failed_or_cancelled_rate"] == 0.071429
    assert operating["retry_coverage_rows"] == 14
    assert operating["retry_linked_rows"] == 1
    assert operating["retry_linked_rate"] == 0.071429
    assert operating["cache_share"] == 0.2
    assert operating["median_latency_ms"] == 165
    assert operating["p95_latency_ms"] == 223.5
    assert operating["outcome_coverage_rows"] == 14

    missing = result["missingSignals"]["spend"]["operational_metrics"]
    assert missing["status_coverage_rows"] == 0
    assert missing["failed_or_cancelled_rate"] is None
    assert missing["retry_coverage_rows"] == 0
    assert missing["retry_linked_rate"] is None
    assert missing["cache_coverage_rows"] == 0
    assert missing["cache_share"] is None
    assert missing["latency_coverage_rows"] == 0
    assert missing["median_latency_ms"] is None
    assert missing["outcome_coverage_rows"] == 0
    assert review["evidence_gate"]["savings_claim_allowed"] is False


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_bill_reconciliation_preserves_rows_and_labels_duplicate_reference():
    result = run_node(
        r"""
const engine = require(process.argv[1]);
const rows = [
  {event_id: "same", provider: "OpenAI", workload: "Route", provider_reported_cost: 10, currency: "USD", status: "success"},
  {event_id: "same", provider: "OpenAI", workload: "Route", provider_reported_cost: 10, currency: "USD", status: "success"},
  {event_id: "other", provider: "OpenAI", workload: "Route", provider_reported_cost: 5, currency: "USD", status: "success"},
];
const comparable = engine.buildReview(rows, {billed_total: 15, billed_currency: "usd", bill_scope_confirmed: true});
const unconfirmed = engine.buildReview(rows, {billed_total: 15, billed_currency: "USD", bill_scope_confirmed: false});
const billCurrencyMissing = engine.buildReview(rows, {billed_total: 15, bill_scope_confirmed: true});
const requestCostMissing = engine.buildReview([{event_id: "unpriced", status: "success"}], {billed_total: 15, billed_currency: "USD", bill_scope_confirmed: true});
console.log(JSON.stringify({comparable, unconfirmed, billCurrencyMissing, requestCostMissing}));
""",
        ENGINE,
    )
    comparable = result["comparable"]
    assert comparable["event_count"] == 3
    assert len(comparable["events"]) == 3
    assert comparable["reconciliation"]["selected_observed_cost"] == 25
    assert (
        comparable["reconciliation"]["selected_cost_excluding_later_duplicate_rows"]
        == 15
    )
    assert comparable["reconciliation"]["bill"] == {
        "status": "COMPARABLE",
        "supplied_total": 15,
        "supplied_currency": "USD",
        "same_scope_confirmed": True,
        "raw_selected_cost_difference": -10,
        "duplicate_excluded_reference_difference": 0,
        "method": "Billed total minus selected request cost. The duplicate-excluded difference retains the first source row in each repeated-ID group as a review reference only; no row is deleted or presumed invalid.",
    }
    unconfirmed = result["unconfirmed"]["reconciliation"]["bill"]
    assert unconfirmed["status"] == "SCOPE_NOT_CONFIRMED"
    assert unconfirmed["raw_selected_cost_difference"] is None
    assert unconfirmed["duplicate_excluded_reference_difference"] is None
    assert (
        result["billCurrencyMissing"]["reconciliation"]["bill"]["status"]
        == "BILL_CURRENCY_MISSING"
    )
    request_cost_missing = result["requestCostMissing"]["reconciliation"]
    assert request_cost_missing["provider_reported_cost"] is None
    assert request_cost_missing["calculated_cost_used_when_reported_missing"] is None
    assert request_cost_missing["selected_observed_cost"] is None
    assert request_cost_missing["selected_cost_excluding_later_duplicate_rows"] is None
    assert request_cost_missing["bill"]["status"] == "REQUEST_COST_MISSING"


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_missing_request_currency_stays_unknown_until_explicitly_declared():
    result = run_node(
        r"""
const engine = require(process.argv[1]);
const rows = [{event_id: "a", provider: "OpenAI", provider_reported_cost: 4, status: "failed"}];
const unknown = engine.buildReview(rows, {billed_total: 4, billed_currency: "USD", bill_scope_confirmed: true});
const declared = engine.buildReview(rows, {default_currency: "USD", billed_total: 4, billed_currency: "USD", bill_scope_confirmed: true});
console.log(JSON.stringify({unknown, declared}));
""",
        ENGINE,
    )
    unknown = result["unknown"]
    assert unknown["events"][0]["currency"] is None
    assert unknown["currency"] is None
    assert unknown["reconciliation"]["selected_observed_cost"] is None
    assert unknown["headline"]["conservative_non_additive_opportunity"] is None
    assert unknown["reconciliation"]["bill"]["status"] == "REQUEST_CURRENCY_MISSING"
    assert all(not finding["event_avoidable_costs"] for finding in unknown["findings"])
    assert all(
        finding["confidence_in_dollar_estimate"] == "not_quantified"
        for finding in unknown["findings"]
    )
    declared = result["declared"]
    assert declared["events"][0]["currency"] == "USD"
    assert declared["currency"] == "USD"
    assert declared["reconciliation"]["selected_observed_cost"] == 4
    assert declared["reconciliation"]["bill"]["status"] == "COMPARABLE"


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_normalized_csv_protects_against_formula_injection():
    result = run_node(
        r"""
const engine = require(process.argv[1]);
const review = engine.buildReview([{event_id: "=HYPERLINK(x)", model: "gpt-5.6-sol", input_tokens: 1, output_tokens: 1}], {});
console.log(JSON.stringify({csv: engine.normalizedCsv(review)}));
""",
        ENGINE,
    )
    assert "'=HYPERLINK(x)" in result["csv"]
    assert result["csv"].startswith("record_id,event_id,timestamp")


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_usage_event_engine_has_valid_syntax():
    result = subprocess.run(
        ["node", "--check", str(ENGINE)],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr


def test_request_log_template_and_browser_asset_are_present():
    html = (WEB / "index.html").read_text()
    assert (WEB / "templates" / "ai-cost-lens-request-log-template.csv").is_file()
    # The browser integration is added with the request-level engine, not left as a hidden library.
    assert 'src="usage-event-engine.js"' in html
    assert 'id="request-log-file"' in html
    assert 'id="request-analysis-results"' in html
    assert 'id="request-period-complete"' in html
    assert 'id="request-monthly-budget"' in html
    assert 'id="request-budget-warning"' in html
    assert 'id="request-spend-context"' in html
    assert 'id="request-budget-status"' in html
    assert 'id="request-operational-metrics"' in html
    assert 'id="request-variance"' in html
    assert 'id="request-spend-breakdowns"' in html
    assert 'id="download-usage-review"' in html
    assert 'data-builder-mode="price"' in html
    assert 'data-builder-mode="usage"' in html
    for control in (
        "request-filter-from",
        "request-filter-through",
        "request-filter-provider",
        "request-filter-model",
        "request-filter-project",
        "request-filter-workload",
        "request-filter-status",
    ):
        assert f'id="{control}"' in html
    assert 'id="request-event-rows"' in html


def test_usage_event_and_review_schemas_are_versioned_and_fail_closed():
    event_schema = json.loads(
        (ROOT / "schemas" / "ai-cost-lens-usage-event-1.0.schema.json").read_text()
    )
    review_schema = json.loads(
        (ROOT / "schemas" / "ai-cost-lens-usage-review-1.1.schema.json").read_text()
    )
    assert (
        event_schema["properties"]["schema_version"]["const"]
        == "ai-cost-lens-usage-event/1.0"
    )
    assert event_schema["additionalProperties"] is False
    assert "selected_cost" in event_schema["required"]
    assert (
        review_schema["properties"]["schema_version"]["const"]
        == "ai-cost-lens-usage-review/1.1"
    )
    assert (
        review_schema["properties"]["evidence_gate"]["properties"][
            "savings_claim_allowed"
        ]["const"]
        is False
    )
    assert (
        review_schema["properties"]["privacy"]["properties"]["source_file_uploaded"][
            "const"
        ]
        is False
    )
    reconciliation = review_schema["properties"]["reconciliation"]
    assert reconciliation["additionalProperties"] is False
    assert reconciliation["properties"]["bill"]["properties"]["status"]["enum"] == [
        "NOT_SUPPLIED",
        "SCOPE_NOT_CONFIRMED",
        "REQUEST_COST_MISSING",
        "MIXED_CURRENCY",
        "REQUEST_CURRENCY_MISSING",
        "BILL_CURRENCY_MISSING",
        "CURRENCY_MISMATCH",
        "COMPARABLE",
    ]
    assert "spend" in review_schema["required"]
    spend = review_schema["properties"]["spend"]
    assert spend["additionalProperties"] is False
    assert spend["properties"]["run_rate_status"]["enum"] == [
        "AVAILABLE",
        "NOT_SUPPORTED",
    ]
    assert {"budget", "period_variance", "operational_metrics"}.issubset(
        spend["required"]
    )
    assert (
        spend["properties"]["budget"]["properties"]["savings_claim_allowed"]["const"]
        is False
    )
    assert (
        spend["properties"]["period_variance"]["properties"]["savings_claim_allowed"][
            "const"
        ]
        is False
    )
