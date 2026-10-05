"""Regression checks for the October provider review; all calculations run offline."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]


def run_node(script):
    result = subprocess.run(
        ["node", "-e", COMMON + script], cwd=ROOT, capture_output=True, text=True
    )
    assert result.returncode == 0, result.stderr


COMMON = r"""
const assert = require("node:assert/strict");
const c = require("./web/data/pricing-catalog-v0.5.js");
const e = require("./web/pricing-engine.js");
const byId = Object.fromEntries(c.models.map(m => [m.id, m]));
const sol = byId["openai/gpt-6.1-sol"];
const sonnet = byId["anthropic/claude-sonnet-5.5"];
const scenario = {input_tokens: 1000, output_tokens: 500, calls_per_month: 1000,
  cached_input_share: .5, cache_refreshes_per_month: 100, pricing_date: "2026-10-05"};
"""


@pytest.mark.parametrize(
    "mode,factor", [("standard", 1), ("batch", 0.5), ("flex", 0.5), ("fast", 2)]
)
def test_sol_cache_reads_writes_output_and_geography(mode, factor):
    run_node(f"""
const result = e.priceModel(sol, scenario, {{processing_mode: "{mode}", geography: "us"}});
// 500K uncached, 450K cache read, 50K cache write, 500K output.
assert.equal(result.estimated_monthly_cost_usd, Number((6.17 * {factor} * 1.1).toFixed(8)));
assert.deepEqual(result.rates_per_1m_tokens, {{input: 2 * {factor} * 1.1,
 cached_input: Number((.1 * {factor} * 1.1).toFixed(8)), cache_write: 2.5 * {factor} * 1.1, output: 10 * {factor} * 1.1}});
""")


@pytest.mark.parametrize("mode,factor", [("standard", 1), ("batch", 0.5)])
@pytest.mark.parametrize("duration,total", [("5m", 6.215), ("1h", 6.29)])
def test_sonnet_cache_duration_batch_and_us(mode, factor, duration, total):
    run_node(f"""
const result = e.priceModel(sonnet, {{...scenario, cache_write_duration: "{duration}"}},
 {{processing_mode: "{mode}", geography: "us"}});
assert.equal(result.estimated_monthly_cost_usd, Number(({total} * {factor} * 1.1).toFixed(8)));
assert.equal(result.cache_write_rate_field, "cache_write_{duration}");
""")


def test_context_boundary_applies_to_whole_request_and_counts_cached_input():
    run_node(r"""
for (const mode of ["standard", "batch", "flex", "fast"]) {
 const factor = mode === "fast" ? 2 : mode === "standard" ? 1 : .5;
 const base = {...scenario, calls_per_month: 1, cache_refreshes_per_month: 0, output_tokens: 1000, cached_input_share: 1};
 const at = e.priceModel(sol, {...base, input_tokens: 272000}, {processing_mode: mode});
 const over = e.priceModel(sol, {...base, input_tokens: 272001}, {processing_mode: mode});
 assert.equal(at.pricing_adjustment, "standard_context");
 assert.equal(over.pricing_adjustment, "long_context");
 assert.deepEqual(over.rates_per_1m_tokens, {input: 4*factor, cached_input: .2*factor, cache_write: 5*factor, output: 15*factor});
 assert.equal(over.estimated_monthly_cost_usd, Number((.0694002 * factor).toFixed(8)));
}
const base = {...scenario, calls_per_month: 1, cache_refreshes_per_month: 0, output_tokens: 1000};
assert.equal(e.priceModel(sonnet, {...base, input_tokens: 900000}).pricing_adjustment, "standard_context");
e.priceModel(sol, {...base, input_tokens: 922000, output_tokens: 128000});
assert.throws(() => e.priceModel(sol, {...base, input_tokens: 922001}), /922000/);
assert.throws(() => e.priceModel(sol, {...base, output_tokens: 128001}), /128000/);
assert.throws(() => e.priceModel(sonnet, {...base, input_tokens: 999001}), /context window/);
""")


def test_release_snapshot_review_promotion_and_scheduled_change_boundaries():
    run_node(r"""
e.validateCatalog(c);
for (const [model, before, release] of [[sol, "2026-09-28", "2026-09-29"], [sonnet, "2026-09-27", "2026-09-28"]]) {
 assert.equal(model.released_at, release);
 assert.equal(model.effective_at, release);
 assert.throws(() => e.priceModel(model, {...scenario, pricing_date: before}), /before/);
 e.priceModel(model, {...scenario, pricing_date: release});
}
const prior = require("./docs/pricing-snapshots/pricing-catalog-2026-09-23.js");
assert.equal(prior.models.length, 17);
assert.equal(c.models.length, 19);
assert.equal(e.selectCatalog([prior, c], "2026-10-04").catalog_version, "2026-09-23");
assert.equal(e.selectCatalog([prior, c], "2026-10-05").catalog_version, "2026-10-05");
e.requireCatalogDateCoverage(c, "2026-11-21");
assert.throws(() => e.requireCatalogDateCoverage(c, "2026-11-22"), /review date/);
assert.throws(() => e.requireCatalogDateCoverage(c, "2026-02-30"), /real calendar date/);
const promo = byId["openai/gpt-5.6-sol"];
e.priceModel(promo, {...scenario, pricing_date: "2026-11-21"});
assert.throws(() => e.priceModel(promo, {...scenario, pricing_date: "2026-11-22"}), /freshly verified/);
const gemini = byId["google/gemini-3.8-flash"];
const noWrites = {...scenario, cache_refreshes_per_month: 0};
e.priceModel(gemini, {...noWrites, pricing_date: "2026-12-31"});
assert.throws(() => e.priceModel(gemini, {...noWrites, pricing_date: "2027-01-01"}), /freshly verified/);
const changed = JSON.parse(JSON.stringify(c));
changed.models.find(m => m.id === sol.id).released_at = "2026-09-30";
assert.throws(() => e.validateCatalog(changed), /before release/);
""")


def test_unsupported_modes_geographies_and_estimate_evidence_gate():
    run_node(r"""
assert.deepEqual(e.availableProcessingModes(sol), ["standard", "batch", "flex", "fast"]);
assert.deepEqual(e.availableProcessingModes(sonnet), ["standard", "batch"]);
for (const mode of ["standard", "batch", "flex"]) e.priceModel(sol, scenario, {processing_mode: mode, geography: "eu"});
assert.throws(() => e.priceModel(sol, scenario, {processing_mode: "fast", geography: "eu"}), /does not support/);
for (const geography of ["regional", "uae", "fedramp"]) assert.throws(() => e.priceModel(sol, scenario, {geography}), /geography rate/);
for (const processing_mode of ["fast", "flex", "priority", "ultrafast"]) assert.throws(() => e.priceModel(sonnet, scenario, {processing_mode}));
assert.throws(() => e.priceModel(sonnet, scenario, {geography: "eu"}), /geography rate/);
const results = e.compareModels(c, [sol.id, sonnet.id], scenario);
const record = e.buildEstimateRecord(c, results, scenario, {tokens: 1000, method: "manual"}, "2026-10-05T00:00:00Z");
assert.equal(record.evidence_gate.savings_claim_allowed, false);
assert.equal(record.evidence_gate.decision, "TEST_FIRST");
assert.equal(record.estimate_basis.prompt_text_stored, false);
""")


def test_request_log_launch_midnight_rates_and_unsupported_routes():
    run_node(r"""
const usage = require("./web/usage-event-engine.js");
const row = {model: "gpt-6.1-sol", provider: "OpenAI", timestamp: "2026-09-29T00:00:00Z",
 input_tokens: 1000, output_tokens: 500, cached_input_tokens: 400, cache_write_tokens: 100,
 processing_mode: "standard", inference_geography: "global", currency: "USD", tool_charges: 0};
const price = (changes = {}) => usage.normalizeRows([{...row, ...changes}], {catalog: c})[0];
assert.equal(price().calculated_cost, .00629);
assert.equal(price({timestamp: "2026-09-28T23:59:59.999Z"}).cost_basis, "unpriced");
assert.equal(price({timestamp: "2026-09-28T17:00:00-07:00"}).calculated_cost, .00629);
assert.equal(price({processing_mode: "fast", inference_geography: "eu"}).cost_basis, "unpriced");
assert.equal(price({processing_mode: "priority", inference_geography: "eu"}).cost_basis, "unpriced");
assert.equal(price({processing_mode: "fast", inference_geography: "us"}).calculated_cost, .013838);
assert.equal(price({input_tokens: 922001}).cost_basis, "unpriced");
assert.equal(price({timestamp: "2026-11-21T23:59:59.999Z"}).cost_basis, "calculated");
assert.equal(price({timestamp: "2026-11-22T00:00:00Z"}).cost_basis, "unpriced");
const claude = {provider: "Anthropic", model: "claude-sonnet-5-5", timestamp: "2026-09-28T00:00:00Z",
 cache_write_duration_seconds: 3600};
assert.equal(price(claude).calculated_cost, .00648);
assert.equal(price({...claude, timestamp: "2026-09-27T23:59:59.999Z"}).cost_basis, "unpriced");
assert.equal(price({...claude, processing_mode: "fast"}).cost_basis, "unpriced");
const billed = price({processing_mode: "fast", inference_geography: "eu", provider_reported_cost: .02});
assert.equal(billed.calculated_cost, null);
assert.equal(billed.selected_cost, .02);
assert.equal(billed.cost_basis, "provider_reported");
const review = usage.buildReview([row], {catalog: c});
assert.equal(review.evidence_gate.savings_claim_allowed, false);
assert.equal(review.privacy.source_file_uploaded, false);
assert.equal(review.privacy.parsed_locally, true);
""")
