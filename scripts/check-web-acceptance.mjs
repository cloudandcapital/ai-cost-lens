import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { performance } from 'node:perf_hooks';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const source = read('web/app.js');
const boundary = source.indexOf('  document.querySelectorAll(".nav-item").forEach', source.indexOf('  function showToast'));
assert.ok(boundary > 0);
// Render smoke tests use a DOM double, not a substitute for browser/layout QA.
const elements = new Map();
const navButtons = [];
const element = (id) => {
  if (!elements.has(id)) elements.set(id, { id, innerHTML: '', textContent: '', value: '1', dataset: {}, style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, replaceChildren() {}, querySelectorAll() { return id === '.question-nav' ? navButtons : []; } });
  return elements.get(id);
};
navButtons.push(element('review-tab'), element('anatomy-tab'), element('evidence-tab'));
const document = { getElementById: element, querySelector: element, querySelectorAll() { return []; }, body: element('body') };
const context = { TextEncoder, crypto: webcrypto, document, window: { scrollTo() {} } };
runInNewContext(source.slice(0, boundary) + 'globalThis.api = {parseCsv, validDate, validateResult, buildLocalReview, buildSampledReview, buildOpenAIBillReview, buildSingleBillReview, summarizeSingleBill, renderAll, state};})();', context);
const api = context.api;
for (const date of ['2026-02-31', '2026-02-29', '2026-04-31', '2026-13-01', 'not-a-date']) assert.throws(() => api.validDate(date, 'Date'));
for (const date of ['2024-02-29', '2026-02-28', '2026-12-31']) assert.equal(api.validDate(date, 'Date'), date);
const demo = JSON.parse(read('web/data/illustrative-review-result.json'));
api.validateResult(demo);
api.validateResult(JSON.parse(JSON.stringify(demo)));
let rejectedMutations = 0;
const requiredLeaves = (obj, prefix = []) => Object.entries(obj).flatMap(([key, value]) => {
  if (['planning'].includes(key) && !prefix.length) return [];
  return value && typeof value === 'object' && !Array.isArray(value) ? requiredLeaves(value, [...prefix, key]) : [[...prefix, key]];
});
for (const path of requiredLeaves(demo)) {
  const copy = structuredClone(demo);
  let parent = copy;
  for (const key of path.slice(0, -1)) parent = parent[key];
  delete parent[path.at(-1)];
  assert.throws(() => api.validateResult(copy), path.join('.'));
  rejectedMutations++;
}
for (const replacement of [null, {}, [], 'bad', 1]) {
  const copy = structuredClone(demo); copy.baseline.costs = replacement;
  assert.throws(() => api.validateResult(copy));
}
for (const number of [NaN, Infinity, -Infinity, 1e100]) {
  const copy = structuredClone(demo); copy.baseline.costs.model_cost = number;
  assert.throws(() => api.validateResult(copy));
}
for (const planning of [{}, { payback: {} }]) {
  const copy = structuredClone(demo); copy.planning = planning;
  assert.throws(() => api.validateResult(copy));
}
assert.throws(() => JSON.parse('{bad json'));
assert.throws(() => api.validateResult(JSON.parse('{"schema_version":"ai-cost-lens-review-result/1.0","baseline":{}}')));
const spend = read('web/templates/ai-cost-lens-spend-template.csv');
const work = read('web/templates/ai-cost-lens-work-log-template.csv');
const config = { acceptanceRule: 'Correct', verifier: 'Reviewer', qualityFloor: 0.5, hourlyRate: 60, baselinePolicyApproved: true, proposedPolicyApproved: true, baselineShared: 0, proposedShared: 0, changeCost: 0, outcomeLogComplete: true, sampleRandom: true };
const built = await api.buildLocalReview(spend, work, config);
api.validateResult(built);
api.validateResult(JSON.parse(JSON.stringify(built)));
if (process.argv.length === 4) {
  const appRoundtrip = await api.buildLocalReview(readFileSync(process.argv[2], 'utf8'), readFileSync(process.argv[3], 'utf8'), config);
  api.validateResult(appRoundtrip);
  assert.equal(appRoundtrip.baseline.costs.model_cost, built.baseline.costs.model_cost);
  assert.equal(appRoundtrip.proposed.measures.cost_per_usable_result, built.proposed.measures.cost_per_usable_result);
  console.log('Application CSV round trip: passed');
}
// CSV conventions emitted by spreadsheet software: BOM, CRLF, fully quoted cells.
const quoted = (text) => '\uFEFF' + text.trim().split('\n').map((line) => line.split(',').map((cell) => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n';
const roundtrip = await api.buildLocalReview(quoted(spend), quoted(work), config);
assert.equal(roundtrip.baseline.costs.model_cost, built.baseline.costs.model_cost);
assert.equal(roundtrip.proposed.measures.cost_per_usable_result, built.proposed.measures.cost_per_usable_result);
await assert.rejects(api.buildLocalReview(spend.replace('2026-08-01', '2026-02-31'), work, config), /calendar/);
await assert.rejects(api.buildLocalReview(spend + spend.trim().split('\n')[1] + '\n', work, config), /duplicates/);
await assert.rejects(api.buildLocalReview(spend, work + work.trim().split('\n')[1] + '\n', config), /appears more than once/i);
const unequal = spend + spend.trim().split('\n')[1].replace('2026-08-01', '2026-08-02') + '\n';
await assert.rejects(api.buildLocalReview(unequal, work, config), /different durations/);
await assert.rejects(api.buildLocalReview(spend.replace('18.40', '-18.40'), work, config), /credits or refunds/);
await assert.rejects(api.buildLocalReview(spend.replace('proposed,2026-08-15,Invoice extraction', 'proposed,2026-08-15,Other workload'), work, config), /same workload/);
await assert.rejects(api.buildLocalReview(spend.replace('calculated,USD', 'calculated,EUR'), work, config), /currencies/);
await assert.rejects(api.buildLocalReview(spend.replace('baseline,', 'other,'), work, config), /period/i);
assert.equal(built.comparison.same_cost_basis, false);
assert.equal(built.comparison.savings_claim_allowed, false);
const requestMismatch = await api.buildLocalReview(spend.replace(',3,240000', ',30,240000'), work, config);
assert.equal(requestMismatch.comparison.evidence_complete, false);
assert.equal(requestMismatch.comparison.savings_claim_allowed, false);
const bill = await api.buildOpenAIBillReview(read('tests/fixtures/openai-dashboard-usage.csv'), read('tests/fixtures/openai-dashboard-cost.csv'));
// A universal one-bill review must not need a proposed period or any outcomes.
const spendHeaders = spend.trim().split('\n')[0];
const singleRows = (rows) => spendHeaders + '\n' + rows.map((row) => row.join(',')).join('\n') + '\n';
const invoiceRow = ['baseline', '2026-08-01', 'Team subscription', '', '', '', '', '', '', '', '', '20', 'provider_reported', 'USD'];
const invoice = await api.buildSingleBillReview(singleRows([invoiceRow]));
let one = api.summarizeSingleBill(invoice);
assert.equal(one.level, 'Invoice or subscription only');
assert.equal(one.totals.providerCost, 20);
assert.equal(one.totals.requests, null);
assert.equal(one.providerUnit, null);
assert.match(one.missing.join(' '), /no evidence of utilization/);
const singleSpend = spend.trim().split('\n').filter((line, index) => index === 0 || line.startsWith('baseline,')).join('\n');
const singleWork = work.trim().split('\n').filter((line, index) => index === 0 || line.startsWith('baseline,')).join('\n');
const usageOnly = await api.buildSingleBillReview(singleSpend);
one = api.summarizeSingleBill(usageOnly);
assert.equal(one.level, 'Cost and usage');
assert.equal(one.totals.requests, 3);
assert.equal(one.totals.cachedInput, 40000);
assert.equal(one.providerUnit, null);
const singleConfig = { acceptanceRule: 'Ready after human verification', verifier: 'Customer reviewer', complete: true, hourlyRate: '60', sharedCost: '2' };
const completeSingle = await api.buildSingleBillReview(singleSpend, singleWork, singleConfig);
one = api.summarizeSingleBill(completeSingle);
assert.equal(one.level, 'Cost, usage and outcomes');
assert.equal(one.ready, 1);
assert.equal(one.providerUnit, 18.4);
assert.equal(one.fullUnit, 24.4);
assert.equal(one.retries, 1);
assert.ok(!('comparison' in completeSingle));
const noOverheads = await api.buildSingleBillReview(singleSpend, singleWork, { ...singleConfig, hourlyRate: '', sharedCost: '' });
assert.equal(api.summarizeSingleBill(noOverheads).providerUnit, 18.4);
assert.equal(api.summarizeSingleBill(noOverheads).fullUnit, null);
const tokensAndOutcomes = api.summarizeSingleBill(await api.buildSingleBillReview(singleSpend.replace(',3,240000', ',,240000'), singleWork, singleConfig));
assert.equal(tokensAndOutcomes.providerUnit, 18.4);
assert.match(tokensAndOutcomes.missing.join(' '), /Request reconciliation is unavailable/);
const missingMinutes = api.summarizeSingleBill(await api.buildSingleBillReview(singleSpend, singleWork.replace(',1.0', ','), singleConfig));
assert.equal(missingMinutes.providerUnit, 18.4);
assert.equal(missingMinutes.fullUnit, null);
assert.equal(missingMinutes.minutes, null);
for (const [csv, cfg] of [[singleSpend, { ...singleConfig, complete: false }], [singleSpend.replace(',3,240000', ',30,240000'), singleConfig]]) {
  const partial = api.summarizeSingleBill(await api.buildSingleBillReview(csv, singleWork, cfg));
  assert.equal(partial.providerUnit, null);
  assert.equal(partial.fullUnit, null);
}
const noReady = api.summarizeSingleBill(await api.buildSingleBillReview(singleSpend, singleWork.replaceAll('ready_to_use', 'needs_correction'), singleConfig));
assert.equal(noReady.ready, 0);
assert.equal(noReady.providerUnit, null);
const zeroInvoice = [...invoiceRow]; zeroInvoice[11] = '0'; zeroInvoice[6] = '0';
assert.equal(api.summarizeSingleBill(await api.buildSingleBillReview(singleRows([zeroInvoice]))).totals.providerCost, 0);
const partialRow = [...invoiceRow]; partialRow[1] = '2026-08-02'; partialRow[6] = '5';
const partialUsage = api.summarizeSingleBill(await api.buildSingleBillReview(singleRows([invoiceRow, partialRow])));
assert.equal(partialUsage.totals.requests, null);
assert.equal(partialUsage.level, 'Cost and usage');
for (const basis of ['allocated', 'calculated']) {
  const row = [...invoiceRow]; row[12] = basis;
  assert.equal(api.summarizeSingleBill(await api.buildSingleBillReview(singleRows([row]))).basis, basis);
}
await assert.rejects(api.buildSingleBillReview(spend), /baseline/);
await assert.rejects(api.buildSingleBillReview(singleSpend, work, singleConfig), /baseline/);
await assert.rejects(api.buildSingleBillReview(singleRows([invoiceRow, invoiceRow])), /duplicate/i);
for (const [column, value, message] of [[1, '2026-02-31', /calendar/], [11, '-20', /credits/], [11, 'Infinity', /number/], [13, 'US', /currency/]]) {
  const row = [...invoiceRow]; row[column] = value;
  await assert.rejects(api.buildSingleBillReview(singleRows([row])), message);
}
await assert.rejects(api.buildSingleBillReview(singleSpend, singleWork + '\n' + singleWork.split('\n')[1], singleConfig), /unique/);
await assert.rejects(api.buildSingleBillReview(singleSpend, singleWork.replace('base-001,ready_to_use,1,0', 'base-001,ready_to_use,1,2'), singleConfig), /Retry/);
await assert.rejects(api.buildSingleBillReview(singleSpend, singleWork, { ...singleConfig, verifier: '' }), /verified/);
for (const review of [invoice, usageOnly, completeSingle, noOverheads]) {
  api.validateResult(JSON.parse(JSON.stringify(review)));
  api.state.data = review;
  api.renderAll();
  assert.equal(element('.question-nav').hidden, true);
  assert.match(element('bill-finding-title').textContent, /no savings claim/);
  assert.match(element('memo-decision-code').textContent, /NO SAVINGS/);
  for (const el of elements.values()) assert.doesNotMatch(el.innerHTML + el.textContent, /\b(?:NaN|Infinity|undefined)\b/);
  for (const path of requiredLeaves(review)) {
    const copy = structuredClone(review); let parent = copy;
    for (const key of path.slice(0, -1)) parent = parent[key];
    delete parent[path.at(-1)];
    assert.throws(() => api.validateResult(copy), path.join('.'));
  }
}
for (const mutation of [
  (r) => { r.source.spend[0].provider_cost = '1e999'; },
  (r) => { r.source.work[0].human_minutes = '-1'; },
  (r) => { r.source.spend[0].provider = {}; },
  (r) => { r.source.spend[0].date = '2026-02-31'; },
  (r) => { delete r.source.work[0].result_id; },
  (r) => { r.source.spend.push(structuredClone(r.source.spend[0])); },
]) {
  const copy = structuredClone(completeSingle); mutation(copy);
  assert.throws(() => api.validateResult(copy));
}
console.log('Single-bill evidence levels, zero/missing inputs, outcome gates, JSON validation and render smoke: passed');
api.validateResult(bill);
api.validateResult(JSON.parse(JSON.stringify(bill)));
for (const review of [demo, built, bill]) {
  api.state.data = review;
  api.renderAll();
  for (const el of elements.values()) assert.doesNotMatch(el.innerHTML + el.textContent, /\b(?:NaN|Infinity|undefined)\b/, el.id);
}
assert.equal(element('.question-nav').hidden, true);
assert.ok(navButtons.every((button) => button.disabled && button.tabIndex === -1));
api.state.data = demo;
api.renderAll();
assert.equal(element('.question-nav').hidden, false);
assert.ok(navButtons.every((button) => !button.disabled && button.tabIndex === 0));
for (const key of ['bill', 'usage', 'coverage', 'reconciliation', 'limitations', 'source']) {
  const copy = structuredClone(bill); copy[key] = {};
  assert.throws(() => api.validateResult(copy));
}
const samples = { baseline: { population: 2, ready: 1, correction: 1, escalation: 0, humanMinutes: 2 }, proposed: { population: 2, ready: 2, correction: 0, escalation: 0, humanMinutes: 1 } };
const sampled = await api.buildSampledReview(spend, samples, config);
api.validateResult(sampled);
api.state.data = sampled;
api.renderAll();
for (const el of elements.values()) assert.doesNotMatch(el.innerHTML + el.textContent, /\b(?:NaN|Infinity|undefined)\b/, el.id);
await assert.rejects(api.buildSampledReview(unequal, samples, config), /different durations/);
assert.throws(() => api.parseCsv('x\n' + 'a'.repeat(5 * 1024 * 1024), 'Spend'), /5 MiB/);
assert.throws(() => api.parseCsv('id\n' + Array.from({length: 20001}, (_, i) => i).join('\n'), 'Spend'), /20,000/);
const measurements = [];
for (const count of [1000, 10000, 20000]) {
  const csv = 'id,date,cost\n' + Array.from({length: count}, (_, i) => `${i},2026-08-01,1.25`).join('\n');
  const start = performance.now();
  assert.equal(api.parseCsv(csv, 'Spend benchmark').length, count);
  measurements.push({ rows: count, bytes: Buffer.byteLength(csv), milliseconds: Math.round(performance.now() - start) });
}
const wideCsv = 'id,date,cost,note\n' + Array.from({length: 20000}, (_, i) => `${i},2026-08-01,1.25,${'x'.repeat(210)}`).join('\n');
const wideStart = performance.now();
assert.equal(api.parseCsv(wideCsv, 'Spend benchmark').length, 20000);
measurements.push({rows: 20000, bytes: Buffer.byteLength(wideCsv), milliseconds: Math.round(performance.now() - wideStart)});
const html = read('web/index.html');
assert.match(html, /rel="canonical" href="https:\/\/lens.cloudandcapital.com\/"/);
assert.match(html, /class="wordmark" href="https:\/\/cloudandcapital.com"/);
assert.match(html, /property="og:image" content="https:\/\/lens.cloudandcapital.com\/social-preview.png"/);
assert.match(html, /does not contact an AI API/);
assert.doesNotMatch(source, /XMLHttpRequest|sendBeacon|WebSocket/);
assert.deepEqual([...source.matchAll(/fetch\(([^)]*)\)/g)].map((m) => m[1]), ['"data/illustrative-review-result.json"']);
const png = readFileSync(new URL('web/social-preview.png', root));
assert.equal(png.readUInt32BE(16), 2190);
assert.equal(png.readUInt32BE(20), 964);
assert.ok(read('web/favicon.svg').includes('<svg'));
console.log(JSON.stringify({ result: 'passed', rejectedMissingFields: rejectedMutations, csvBenchmark: measurements }, null, 2));
