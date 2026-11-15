"""Source-backed November catalog boundaries, runnable without pytest."""

import subprocess
from pathlib import Path

ROOT = Path(__file__).parents[1]


def test_november_catalog_keeps_historical_prices_and_exact_date_gates():
    script = r"""
const assert = require('node:assert/strict');
const current = require('./web/data/pricing-catalog-v0.5.js');
const older = require('./docs/pricing-snapshots/pricing-catalog-2026-10-18.js');
const pricing = require('./web/pricing-engine.js');
pricing.validateCatalog(current); pricing.validateCatalog(older);
assert.equal(current.catalog_version, '2026-11-15');
assert.equal(current.review_by, '2026-11-28');
assert.equal(current.models.length, 23); assert.equal(older.models.length, 22);
assert.equal(older.catalog_version, '2026-10-18');
assert.equal(older.review_by, '2026-11-21');
assert.equal(pricing.selectCatalog([older, current], '2026-11-14'), older);
assert.equal(pricing.selectCatalog([older, current], '2026-11-15'), current);
for (const old of older.models) {
 const next = current.models.find(model => model.id === old.id);
 for (const field of ['standard','batch','flex','fast','priority','long_context',
   'rate_change','routed_to_model_id','routing_confirmed_at','scheduled_rate_change']) {
   assert.deepEqual(next[field], old[field], old.id + ' ' + field);
 }
 assert.equal(next.verified_at, '2026-11-15');
}
assert(current.sources.every(source => source.checked_at === '2026-11-15'));
assert.equal(current.models.find(model => model.id === 'openai/gpt-5.6-sol').promotional_rate_guaranteed_through, '2026-11-30');
assert.equal(older.models.find(model => model.id === 'openai/gpt-5.6-sol').promotional_rate_guaranteed_through, '2026-11-21');
pricing.requireCatalogDateCoverage(current, '2026-11-28');
assert.throws(() => pricing.requireCatalogDateCoverage(current, '2026-11-29'), /review date/);
const base = {input_tokens: 10000, output_tokens: 1000, calls_per_month: 100,
 cached_input_share: .5, cache_refreshes_per_month: 0, pricing_date: '2026-12-01'};
assert.throws(() => pricing.priceModel(current.models.find(m => m.id === 'google/gemini-4-argon'), base), /freshly verified/);
assert.throws(() => pricing.priceModel(current.models.find(m => m.id === 'openai/gpt-5.6-sol'), base), /freshly verified/);
"""
    subprocess.run(["node", "-e", script], cwd=ROOT, check=True)


def test_terra_rates_modes_context_and_historical_coverage():
    script = r"""
const assert = require('node:assert/strict');
const c = require('./web/data/pricing-catalog-v0.5.js');
const p = require('./web/pricing-engine.js');
const u = require('./web/usage-event-engine.js');
const terra = c.models.find(model => model.id === 'openai/gpt-6.1-terra');
const scenario = {input_tokens:1000,output_tokens:500,calls_per_month:1000,
 cached_input_share:.5,cache_refreshes_per_month:100,pricing_date:'2026-11-15'};
for (const [mode, factor] of [['standard',1],['batch',.5],['flex',.5],['fast',2]]) {
 for (const [geography, uplift] of [['global',1],['us',1.1],['eu',1.1]]) {
  const result=p.priceModel(terra,scenario,{processing_mode:mode,geography});
  assert.equal(result.estimated_monthly_cost_usd,Number((3.085*factor*uplift).toFixed(8)));
 }
}
assert.throws(()=>p.priceModel(terra,{...scenario,pricing_date:'2026-11-14'}),/before/);
assert.throws(()=>p.priceModel(terra,scenario,{geography:'regional'}),/geography rate/);
const long=p.priceModel(terra,{...scenario,input_tokens:272001,output_tokens:1000,
 calls_per_month:1,cached_input_share:1,cache_refreshes_per_month:0});
assert.deepEqual(long.rates_per_1m_tokens,{input:2,cached_input:.1,cache_write:2.5,output:7.5});
assert.equal(long.estimated_monthly_cost_usd,.0347001);
assert.throws(()=>p.priceModel(terra,{...scenario,input_tokens:1050000,output_tokens:1}),/context window/);
assert.throws(()=>p.priceModel(terra,{...scenario,output_tokens:128001}),/128000/);
const row={provider:'OpenAI',model:'gpt-6.1-terra',input_tokens:1000,output_tokens:500,
 cached_input_tokens:0,cache_write_tokens:0,processing_mode:'standard',tool_charges:0,currency:'USD'};
assert.equal(u.normalizeRows([{...row,timestamp:'2026-11-14T12:00:00Z'}],{catalog:c})[0].cost_basis,'unpriced');
assert.equal(u.normalizeRows([{...row,timestamp:'2026-11-15T12:00:00Z'}],{catalog:c})[0].calculated_cost,.0035);
const comparison=p.compareModels(c,[terra.id],scenario);
const record=p.buildEstimateRecord(c,comparison,scenario,{tokens:1000,method:'manual'});
assert.equal(record.catalog.version,'2026-11-15');
assert.equal(record.evidence_gate.savings_claim_allowed,false);
assert.equal(record.evidence_gate.decision,'TEST_FIRST');
console.log(JSON.stringify({terra_route_cases:12,estimated_monthly_cost:comparison[0].estimated_monthly_cost_usd}));
"""
    subprocess.run(["node", "-e", script], cwd=ROOT, check=True)


if __name__ == "__main__":
    test_november_catalog_keeps_historical_prices_and_exact_date_gates()
    test_terra_rates_modes_context_and_historical_coverage()
    print("November catalog and Terra boundary checks passed")
