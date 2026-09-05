import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { performance } from 'node:perf_hooks';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { makeTextPdf } from './pdf-fixture.mjs';

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
runInNewContext(source.slice(0, boundary) + 'globalThis.api = {parseCsv, validDate, validateResult, buildLocalReview, buildSampledReview, buildOpenAIBillReview, buildSingleBillReview, buildClaudeSpendReview, buildClaudeApiReview, parseFlatStructured, suggestStructuredMapping, buildMappedReview, extractPdfText, extractInvoiceCandidate, inspectUploadedFiles, summarizeSingleBill, failedSavingsGateText, lumenResponse, renderAll, state};})();', context);
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
const claudeSpend = await api.buildClaudeSpendReview(read('tests/fixtures/synthetic-claude-team-spend.csv'), '2026-08-01', '2026-08-31');
let claude = api.summarizeSingleBill(claudeSpend.review);
assert.equal(claude.totals.providerCost, 4);
assert.equal(claude.totals.requests, 17);
assert.equal(claude.totals.processedInput, 2300);
assert.equal(claude.totals.outputTokens, 600);
assert.deepEqual([...claudeSpend.confirmation.products], ['Chat', 'Claude Code']);
assert.equal(claudeSpend.confirmation.identifiersDiscarded, true);
assert.equal(claudeSpend.review.config.reviewSource, 'claude_spend_report');
assert.doesNotMatch(JSON.stringify(claudeSpend.review), /example\.invalid|acct-synthetic/);
const claudeApi = await api.buildClaudeApiReview(read('tests/fixtures/synthetic-claude-usage-api.json'), read('tests/fixtures/synthetic-claude-cost-api.json'), '2026-08-01', '2026-08-01');
claude = api.summarizeSingleBill(claudeApi.review);
assert.equal(claude.totals.providerCost, 2);
assert.equal(claude.totals.requests, null);
assert.equal(claude.totals.processedInput, 1700);
assert.equal(claude.totals.cachedInput, 200);
assert.equal(claude.totals.cacheWriteInput, 100);
assert.equal(claude.totals.outputTokens, 400);
assert.equal(claudeApi.review.config.reviewSource, 'claude_admin_api');
assert.doesNotMatch(JSON.stringify(claudeApi.review), /user_synthetic|key_synthetic|workspace_synthetic/);
await assert.rejects(api.buildClaudeSpendReview(read('tests/fixtures/synthetic-claude-team-spend.csv').replace('1.20', '-1.20'), '2026-08-01', '2026-08-31'), /credits or refunds/);
await assert.rejects(api.buildClaudeApiReview(read('tests/fixtures/synthetic-claude-usage-api.json').replace('false', 'true'), read('tests/fixtures/synthetic-claude-cost-api.json'), '2026-08-01', '2026-08-01'), /partial API page/);
await assert.rejects(api.buildClaudeApiReview(read('tests/fixtures/synthetic-claude-usage-api.json'), read('tests/fixtures/synthetic-claude-cost-api.json'), '2026-08-01', '2026-08-31'), /declared Claude period/);
await assert.rejects(api.buildClaudeApiReview('{bad json', read('tests/fixtures/synthetic-claude-cost-api.json'), '2026-08-01', '2026-08-01'), /not valid JSON/);
const shiftedCostPeriod = read('tests/fixtures/synthetic-claude-cost-api.json').replace('2026-08-02', '2026-08-03').replace('2026-08-01', '2026-08-02');
await assert.rejects(api.buildClaudeApiReview(read('tests/fixtures/synthetic-claude-usage-api.json'), shiftedCostPeriod, '2026-08-01', '2026-08-01'), /same daily buckets/);
await assert.rejects(api.buildClaudeApiReview(read('tests/fixtures/synthetic-claude-usage-api.json'), read('tests/fixtures/synthetic-claude-cost-api.json').replace('"USD"', '"EUR"'), '2026-08-01', '2026-08-01'), /currency must be USD/);
await assert.rejects(api.buildClaudeApiReview(read('tests/fixtures/synthetic-claude-usage-api.json').replace('"cache_creation":{', '"cache_creation_missing":{'), read('tests/fixtures/synthetic-claude-cost-api.json'), '2026-08-01', '2026-08-01'), /cache_creation must contain/);
const duplicateUsageResult = JSON.parse(read('tests/fixtures/synthetic-claude-usage-api.json'));
duplicateUsageResult.data[0].results.push(structuredClone(duplicateUsageResult.data[0].results[0]));
await assert.rejects(api.buildClaudeApiReview(JSON.stringify(duplicateUsageResult), read('tests/fixtures/synthetic-claude-cost-api.json'), '2026-08-01', '2026-08-01'), /duplicates an earlier result/);

// Claude Team/Enterprise reports retain a reported zero but never turn a blank into zero.
const claudeHeader = read('tests/fixtures/synthetic-claude-team-spend.csv').trim().split('\n')[0];
const claudeRows = read('tests/fixtures/synthetic-claude-team-spend.csv').trim().split('\n').slice(1);
const blankRequests = await api.buildClaudeSpendReview(`${claudeHeader}\n${claudeRows[0].replace(',10,1000,200,', ',,1000,200,')}\n`, '2026-08-01', '2026-08-31');
assert.equal(api.summarizeSingleBill(blankRequests.review).totals.requests, null);
const claudeZeroRequests = await api.buildClaudeSpendReview(`${claudeHeader}\n${claudeRows[0].replace(',10,1000,200,', ',0,1000,200,')}\n`, '2026-08-01', '2026-08-31');
assert.equal(api.summarizeSingleBill(claudeZeroRequests.review).totals.requests, 0);
const claudeMixedRequests = await api.buildClaudeSpendReview(`${claudeHeader}\n${claudeRows[0]}\n${claudeRows[2].replace(',2,800,300,', ',,800,300,')}\n`, '2026-08-01', '2026-08-31');
assert.equal(api.summarizeSingleBill(claudeMixedRequests.review).totals.requests, null);
const reorderedHeaders = claudeHeader.split(',').reverse();
const reorderedRows = claudeRows.map((line) => {
  const parsed = api.parseCsv(`${claudeHeader}\n${line}\n`, 'Synthetic Claude row')[0];
  return reorderedHeaders.map((header) => `"${parsed[header].replaceAll('"', '""')}"`).join(',');
}).join('\r\n');
const reordered = await api.buildClaudeSpendReview(`\uFEFF${reorderedHeaders.join(',')}\r\n${reorderedRows}\r\n`, '2026-08-01', '2026-08-31');
assert.equal(api.summarizeSingleBill(reordered.review).totals.providerCost, 4);
const displayHeaders = claudeHeader.replace('user_email', 'User Email').replace('account_uuid', 'Account UUID').replace('model_family', 'Model Family');
const displayHeaderReview = await api.buildClaudeSpendReview(`${displayHeaders}\n${claudeRows[0]}\n`, '2026-08-01', '2026-08-31');
assert.equal(api.summarizeSingleBill(displayHeaderReview.review).totals.providerCost, 1.2);
await assert.rejects(api.buildClaudeSpendReview(read('tests/fixtures/synthetic-claude-team-spend.csv').replace(',total_requests,', ',requests,'), '2026-08-01', '2026-08-31'), /missing: total_requests/);
await assert.rejects(api.buildClaudeSpendReview(read('tests/fixtures/synthetic-claude-team-spend.csv').replace(',10,1000,200,', ',-1,1000,200,'), '2026-08-01', '2026-08-31'), /non-negative whole number/);
await assert.rejects(api.buildClaudeSpendReview(read('tests/fixtures/synthetic-claude-team-spend.csv').replace(',Chat,', ',=IMPORTXML,', 1), '2026-08-01', '2026-08-31'), /unsupported formula/);
await assert.rejects(api.buildClaudeSpendReview(`${claudeHeader}\n${claudeRows[0]}\n${claudeRows[0]}\n`, '2026-08-01', '2026-08-31'), /duplicates/);

// The unified entry point prefers strict provider schemas before guided mapping.
const localFile = (name, contents, type = '') => ({ name, type, size: Buffer.byteLength(contents), text: async () => contents, arrayBuffer: async () => Buffer.from(contents) });
assert.equal((await api.inspectUploadedFiles([
  localFile('usage.csv', read('tests/fixtures/openai-dashboard-usage.csv')),
  localFile('cost.csv', read('tests/fixtures/openai-dashboard-cost.csv')),
])).kind, 'openai');
assert.equal((await api.inspectUploadedFiles([localFile('claude.csv', read('tests/fixtures/synthetic-claude-team-spend.csv'))])).kind, 'claude_spend');
assert.equal((await api.inspectUploadedFiles([
  localFile('usage.json', read('tests/fixtures/synthetic-claude-usage-api.json'), 'application/json'),
  localFile('cost.json', read('tests/fixtures/synthetic-claude-cost-api.json'), 'application/json'),
])).kind, 'claude_api');

const mappedCsv = [
  'billing_date,service_period_end,vendor,model_name,route,spend,currency_code,request_count,prompt_tokens,completion_tokens,cache_read_tokens,customer_email,account_id',
  '2026-08-01,2026-08-31,Anthropic,claude-sonnet,Support,12.50,USD,0,1000,200,100,private@example.invalid,acct-private',
  '2026-08-02,2026-08-31,Anthropic,claude-sonnet,Support,7.50,USD,,500,100,,other@example.invalid,acct-other',
].join('\n');
const mappedParsed = api.parseFlatStructured(mappedCsv, 'unknown.csv');
const suggested = api.suggestStructuredMapping(mappedParsed);
assert.deepEqual({ ...suggested }, {
  date: 'billing_date', service_end: 'service_period_end', provider: 'vendor', model: 'model_name', workload: 'route',
  cost: 'spend', currency: 'currency_code', requests: 'request_count', input: 'prompt_tokens', output: 'completion_tokens',
  cache_read: 'cache_read_tokens', cache_write: '',
});
const mapped = await api.buildMappedReview(mappedCsv, 'unknown.csv', suggested);
const mappedSummary = api.summarizeSingleBill(mapped.review);
assert.equal(mapped.confirmation.sourceTotal, 20);
assert.equal(mapped.confirmation.normalizedTotal, 20);
assert.equal(mappedSummary.totals.providerCost, 20);
assert.equal(mappedSummary.totals.requests, null, 'incomplete request coverage remains unavailable');
assert.equal(mappedSummary.totals.processedInput, 1500);
assert.equal(mapped.review.config.reviewSource, 'structured_mapping');
assert.doesNotMatch(JSON.stringify(mapped.review), /private@example|acct-private|acct-other/);
assert.equal((await api.inspectUploadedFiles([localFile('unknown.csv', mappedCsv)])).kind, 'mapping');
await assert.rejects(api.buildMappedReview(mappedCsv, 'unknown.csv', { ...suggested, cost: '' }), /Map provider-reported cost/);
await assert.rejects(api.buildMappedReview(mappedCsv.replace('12.50', '-12.50'), 'unknown.csv', suggested), /credits or refunds/);
await assert.rejects(api.buildMappedReview(`${mappedCsv}\n${mappedCsv.split('\n')[1]}`, 'unknown.csv', suggested), /duplicates/);
await assert.rejects(api.buildMappedReview(mappedCsv.replace('7.50,USD', '7.50,EUR'), 'unknown.csv', suggested), /cannot mix currencies/);
assert.throws(() => api.parseFlatStructured('{bad', 'unknown.json'), /not valid JSON/);
const arbitraryNumbers = api.suggestStructuredMapping(api.parseFlatStructured('day,seat_count,estimated_budget\n2026-08-01,12,40', 'unknown.csv'));
assert.equal(arbitraryNumbers.cost, '', 'unrelated numeric fields are never guessed');
assert.equal(arbitraryNumbers.date, '', 'unknown date-like headers are never guessed');

// Real, tiny text PDFs exercise the bundled parser boundary and sanitized invoice extraction.
const pdfFile = (name, bytes) => ({ name, type: 'application/pdf', size: bytes.length, arrayBuffer: async () => bytes });
const openAIPdf = makeTextPdf(['OpenAI, L.L.C.', 'Invoice date: August 31, 2026', 'Service period: August 1, 2026 - August 31, 2026', 'Amount due: USD 42.50']);
const openAIText = await api.extractPdfText(pdfFile('openai.pdf', openAIPdf), pdfjs);
const openAICandidate = api.extractInvoiceCandidate(openAIText);
assert.equal(openAICandidate.provider, 'OpenAI');
assert.equal(openAICandidate.invoiceDate, '2026-08-31');
assert.equal(openAICandidate.serviceStart, '2026-08-01');
assert.equal(openAICandidate.serviceEnd, '2026-08-31');
assert.equal(openAICandidate.suggestedAmount.value, 42.5);
assert.equal(openAICandidate.currency, 'USD');
const anthropicPdf = makeTextPdf(['Anthropic PBC', 'Invoice date: 2026-08-31', 'Invoice total: USD 25.00']);
assert.equal(api.extractInvoiceCandidate(await api.extractPdfText(pdfFile('anthropic.pdf', anthropicPdf), pdfjs)).provider, 'Anthropic');
const ambiguous = api.extractInvoiceCandidate(['Claude subscription from Anthropic', 'Invoice date: 2026-08-31', 'Subtotal USD 100.00', 'Tax USD 8.00', 'Credit USD 10.00', 'Amount due USD 98.00'].join('\n'));
assert.equal(ambiguous.amountCandidates.length, 4);
assert.equal(ambiguous.suggestedAmount, null);
assert.equal(api.extractInvoiceCandidate('Other Cloud Inc\nInvoice date: 2026-08-31\nTotal USD 10.00').supported, false);
await assert.rejects(api.extractPdfText(pdfFile('blank.pdf', makeTextPdf([])), pdfjs), /No extractable/);
await assert.rejects(api.extractPdfText(pdfFile('broken.pdf', Buffer.from('%PDF broken')), pdfjs), /malformed or scanned/);
await assert.rejects(api.extractPdfText(pdfFile('locked.pdf', Buffer.from('x')), { getDocument: () => ({ promise: Promise.reject(Object.assign(new Error('Password required'), { name: 'PasswordException' })) }) }), /encrypted/);
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
const missingRequests = await api.buildSingleBillReview(singleSpend.replace(',3,240000', ',,240000'));
const zeroRequests = await api.buildSingleBillReview(singleSpend.replace(',3,240000', ',0,240000'));
for (const [review, expected] of [
  [missingRequests, /Requests were not supplied for every cost row/],
  [zeroRequests, /No requests were recorded for this period, so cost per request is unavailable/],
  [usageOnly, /provider cost divided by all supplied requests/],
  [await api.buildSingleBillReview(singleRows([invoiceRow, partialRow])), /Requests were not supplied for every cost row/],
]) {
  api.state.data = review;
  api.renderAll();
  assert.match(element('bill-opportunity-ledger').innerHTML, expected);
}
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

// Every route-comparison surface must use the same actual failed-gate explanation.
const reportedSpend = spend.replace(',calculated,USD', ',provider_reported,USD');
const qualityFailWork = work.replace('pilot-002,ready_to_use', 'pilot-002,needs_correction');
const gateCases = [
  [await api.buildLocalReview(reportedSpend, work, { ...config, proposedPolicyApproved: false }), /policy approval/i],
  [await api.buildLocalReview(reportedSpend, qualityFailWork, { ...config, qualityFloor: 0.75 }), /declared quality requirement/i],
  [await api.buildLocalReview(reportedSpend, work, { ...config, outcomeLogComplete: false }), /complete outcome evidence/i],
  [await api.buildLocalReview(reportedSpend, qualityFailWork, { ...config, qualityFloor: 0.75, proposedPolicyApproved: false }), /declared quality requirement and policy approval/i],
];
for (const [review, expected] of gateCases) {
  assert.equal(review.comparison.savings_claim_allowed, false);
  assert.match(review.comparison.recommendation, expected);
  api.state.data = review;
  api.renderAll();
  assert.match(element('finding-title').textContent, expected);
  assert.match(element('decision-title').textContent, expected);
  assert.match(element('memo-decision-title').textContent, expected);
  assert.match(element('opportunity-ledger').innerHTML, expected);
  assert.match(api.lumenResponse('evidence'), expected);
  assert.match(api.lumenResponse('cfo'), expected);
}
api.state.data = gateCases[0][0];
assert.equal(api.lumenResponse('evidence'), 'The files match, but policy approval still blocks a savings claim.');
assert.match(api.lumenResponse('cfo'), /\. Policy approval still blocks a savings claim\.$/);
api.state.data = gateCases[3][0];
assert.equal(api.lumenResponse('evidence'), 'The files match, but the declared quality requirement and policy approval still block a savings claim.');
assert.match(api.lumenResponse('cfo'), /\. The declared quality requirement and policy approval still block a savings claim\.$/);
for (const response of [api.lumenResponse('evidence'), api.lumenResponse('cfo')]) {
  assert.doesNotMatch(response, /(?:^|[.!?]\s+)[a-z]/);
}
const allGatesPass = await api.buildLocalReview(reportedSpend, work, config);
assert.equal(allGatesPass.comparison.savings_claim_allowed, true);
assert.doesNotMatch(allGatesPass.comparison.recommendation, /blocks a savings claim/);
const stagedReviews = [
  [invoice, 'Start with the bill.', 'CRAWL · UNDERSTAND THE BILL', 'Use this bill as the cost baseline'],
  [usageOnly, 'Where is the AI cost going?', 'WALK · EXPLAIN THE USAGE', 'blended cost per request'],
  [completeSingle, 'What did the work actually cost?', 'RUN · CONNECT COST TO OUTCOMES', 'The provider cost per ready result is visible'],
  [noOverheads, 'What did the work actually cost?', 'RUN · CONNECT COST TO OUTCOMES', 'Human and shared cost are optional depth'],
];
for (const [review, title, kicker, guidance] of stagedReviews) {
  api.validateResult(JSON.parse(JSON.stringify(review)));
  api.state.data = review;
  api.renderAll();
  assert.equal(element('.question-nav').hidden, true);
  assert.equal(element('bill-review-title').textContent, title);
  assert.equal(element('bill-review-kicker').textContent, kicker);
  assert.match(element('bill-opportunity-ledger').innerHTML, new RegExp(guidance));
  assert.match(element('bill-mode-tag').textContent, /NO SAVINGS CLAIM/);
  assert.match(element('memo-decision-limit').textContent, /does not claim savings/);
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
api.state.data = bill;
api.renderAll();
assert.equal(element('bill-review-title').textContent, 'Where is the AI cost going?');
assert.match(element('bill-opportunity-ledger').innerHTML, /Most requests went to gpt-economy/);
assert.match(element('bill-metric-ledger').innerHTML, /Blended cost per request/);
assert.match(element('bill-finding-limit').textContent, /useful cost and usage baseline/);
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
