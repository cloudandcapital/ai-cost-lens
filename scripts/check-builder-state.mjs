import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const openAITokenizer = require('gpt-tokenizer/encoding/o200k_base');
const pricingCatalog = require('../web/data/pricing-catalog-v0.5.js');
const pricingEngine = require('../web/pricing-engine.js');
const opportunityEngine = require('../web/opportunity-engine.js');
const usageEventEngine = require('../web/usage-event-engine.js');
const scenarioEngine = require('../web/scenario-engine.js');
const verificationEngine = require('../web/verification-engine.js');
const actualsEngine = require('../web/actuals-engine.js');

// Minimal DOM adapter: actual HTML defaults and actual app event handlers.
// This checks state transitions, not browser layout or native file dialogs.
const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const nodes = new Map();
class Element {
  constructor(tag = 'div', attrs = {}) {
    this.tagName = tag; this.attrs = attrs; this.id = attrs.id; this.children = [];
    this.dataset = Object.fromEntries(Object.entries(attrs).filter(([k]) => k.startsWith('data-')).map(([k,v]) => [k.slice(5).replace(/-([a-z])/g, (_,c) => c.toUpperCase()),v]));
    this.defaultValue = attrs.value || ''; this._value = this.defaultValue;
    this.defaultChecked = 'checked' in attrs; this.checked = this.defaultChecked;
    this.hidden = 'hidden' in attrs; this.disabled = 'disabled' in attrs;
    this.files = []; this.textContent = ''; this.innerHTML = ''; this.listeners = {};
    const classes = new Set((attrs.class || '').split(' '));
    this.classList = { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c), toggle: (c, force = !classes.has(c)) => force ? classes.add(c) : classes.delete(c) };
    this.style = { setProperty() {} };
    if (tag === 'template') this.content = this;
    if (this.id) nodes.set(this.id, this);
  }
  get value() { return this._value; }
  set value(value) { this._value = String(value); if (this.attrs.type === 'file' && !value) this.files = []; }
  setAttribute(k,v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(k,fn) { (this.listeners[k] ||= []).push(fn); }
  async emit(k) { for (const fn of this.listeners[k] || []) await fn({target:this,currentTarget:this,preventDefault(){}}); }
  click() { return this.emit('click'); }
  matches(selector) {
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('[')) return selector.slice(1,-1) in this.attrs;
    if (selector === 'input[type="file"]') return this.tagName === 'input' && this.attrs.type === 'file';
    return this.tagName === selector;
  }
  querySelectorAll(selector) {
    const selectors = selector.split(',').map(s => s.trim());
    return this.children.flatMap(child => [...(selectors.some(s => child.matches(s)) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { const parts = selector.split(' '); if (parts.length > 1) return this.querySelector(parts[0])?.querySelector(parts.slice(1).join(' ')); return this.querySelectorAll(selector)[0]; }
  reset() { for (const field of this.querySelectorAll('input, select, textarea')) { field.value = field.defaultValue; field.checked = field.defaultChecked; } }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() {}
  scrollIntoView() {}
  replaceChildren() { this.children = []; this.innerHTML = ''; }
}
const document = new Element('document');
const stack = [document];
const voidTags = new Set(['input','meta','link','img','br','hr','source','area','base','col','embed','param','track','wbr']);
for (const token of read('web/index.html').match(/<[^>]+>|[^<]+/g)) {
  if (token.startsWith('</')) { stack.pop(); continue; }
  if (token.startsWith('<!')) continue;
  if (!token.startsWith('<')) { stack.at(-1).textContent += token.trim(); continue; }
  const tag = token.match(/^<(\w+)/)?.[1]; if (!tag) continue;
  const attrs = Object.fromEntries([...token.slice(tag.length + 1, -1).matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(m => [m[1],m[2] || '']));
  const el = new Element(tag, attrs); stack.at(-1).children.push(el);
  if (!voidTags.has(tag) && !token.endsWith('/>')) stack.push(el);
}
document.getElementById = (id) => { assert.ok(nodes.has(id), id); return nodes.get(id); };
document.body = document.querySelector('body');
const window = new Element('window');
const timers = [];
window.setTimeout = (fn) => timers.push(fn);
window.scrollTo = () => {};
window.print = () => {}; // Intentionally returns BEFORE printing has finished.
const media = new Element('media'); media.matches = false;
window.matchMedia = () => media;
const source = read('web/app.js').replace(/  \/\* AI_COST_LENS_DEMO_LOADER_START \*\/[\s\S]*?  \/\* AI_COST_LENS_DEMO_LOADER_END \*\//,
  'globalThis.api = {state, renderAll};');
const context = {
  document,
  window,
  TextEncoder,
  crypto:webcrypto,
  AI_COST_LENS_PRICING_CATALOG:pricingCatalog,
  AICostLensOpenAITokenizer:openAITokenizer,
  AICostLensPricing:pricingEngine,
  AICostLensOpportunities:opportunityEngine,
  AICostLensUsageEvents:usageEventEngine,
  AICostLensScenarios:scenarioEngine,
  AICostLensVerification:verificationEngine,
  AICostLensActuals:actualsEngine,
};
runInNewContext(source, context);
const {api} = context;
const el = id => document.getElementById(id);
const click = id => el(id).emit('click');
const mode = value => document.querySelectorAll('.builder-mode').find(n => n.dataset.builderMode === value).emit('click');
const provider = value => document.querySelectorAll('.import-provider').find(n => n.dataset.importProvider === value).emit('click');
const outcome = value => document.querySelectorAll('.outcome-mode').find(n => n.dataset.outcomeMode === value).emit('click');
const file = async (id, text, name = id + '.csv') => { el(id).files = [{name,size:Buffer.byteLength(text),text:async()=>text}]; await el(id).emit('change'); };
const files = async (id, values) => { el(id).files = values.map(({name,text,type=''}) => ({name,type,size:Buffer.byteLength(text),text:async()=>text})); await el(id).emit('change'); };
const submit = () => el('review-builder').emit('submit');
const spend = read('web/templates/ai-cost-lens-spend-template.csv');
const work = read('web/templates/ai-cost-lens-work-log-template.csv');
const onlyBaseline = text => text.trim().split('\n').filter((line,i) => !i || line.startsWith('baseline,')).join('\n');
const invoice = spend.split('\n')[0] + '\nbaseline,2026-08-01,Unrelated subscription,,,,,,,,,20,provider_reported,USD\n';
const catalogHtml = el('model-catalog-rows').innerHTML;
assert.equal((catalogHtml.match(/class="model-catalog-card"/g) || []).length, pricingCatalog.models.length);
const tieredCount = pricingCatalog.models.filter(model => model.long_context).length;
assert.equal((catalogHtml.match(/class="model-catalog-rate"/g) || []).length, (pricingCatalog.models.length + tieredCount) * 4);
assert.equal((catalogHtml.match(/<span>Input<\/span>/g) || []).length, pricingCatalog.models.length + tieredCount);
assert.equal((catalogHtml.match(/<span>Cached input<\/span>/g) || []).length, pricingCatalog.models.length + tieredCount);
assert.equal((catalogHtml.match(/<span>Output<\/span>/g) || []).length, pricingCatalog.models.length + tieredCount);
assert.match(catalogHtml, /GPT-6 Sol[\s\S]*?over 272,000 input tokens per request[\s\S]*?<span>Input<\/span><strong>\$4<\/strong>[\s\S]*?<span>Output<\/span><strong>\$15<\/strong>/);
assert.match(catalogHtml, /Claude Sonnet 5[\s\S]*?<span>Input<\/span><strong>\$2<\/strong>[\s\S]*?<span>Cached input<\/span><strong>\$0\.20<\/strong>[\s\S]*?<span>Output<\/span><strong>\$10<\/strong>/);
api.state.data = JSON.parse(read('web/data/illustrative-review-result.json'));
api.state.demoData = api.state.data;
api.renderAll();
await click('start-review'); await mode('single');
await file('single-spend-file', onlyBaseline(spend)); await file('single-work-file', onlyBaseline(work));
el('single-ready-rule').value = 'Customer accepted'; el('single-verifier').value = 'Reviewer';
el('single-complete').checked = true; el('single-hourly-rate').value = '60'; el('single-shared-cost').value = '2';
await submit();
assert.equal(api.state.data.source.work.length, 2);
const valid = api.state.data;
await click('start-review'); await mode('single'); await file('single-spend-file', invoice, 'unrelated-invoice.csv');
if (process.argv.includes('--reproduce')) {
  assert.equal(el('single-work-file').files.length, 1);
  assert.equal(el('single-verifier').value, 'Reviewer');
  assert.equal(el('single-complete').checked, true);
  assert.equal(el('single-hourly-rate').value, '60');
  assert.equal(el('single-shared-cost').value, '2');
  console.log('REPRODUCED: new invoice retained old work file, ready rule, verifier, completeness, human rate and shared cost.');
  process.exit(0);
}
assert.equal(api.state.data, valid, 'Starting a new review preserves the current valid result');
assert.equal(el('single-work-file').files.length, 0);
for (const id of ['single-ready-rule','single-verifier','single-hourly-rate','single-shared-cost']) assert.equal(el(id).value, '', id);
assert.equal(el('single-complete').checked, false);
await submit();
assert.equal(api.state.data.source.work.length, 0);
assert.equal(api.state.data.config.sharedCost, '');
assert.match(el('bill-mode-tag').textContent, /BILL FOUNDATION · NO SAVINGS CLAIM/);
assert.doesNotMatch(el('bill-finding-limit').textContent, /Outcome unit cost withheld|Request reconciliation is unavailable/);

// Every path transition starts fresh, using native HTML defaults.
const fileLabels = ['spend-file-name','work-file-name','openai-usage-file-name','openai-cost-file-name','claude-spend-file-name','claude-usage-file-name','claude-cost-file-name'];
const labelDefaults = Object.fromEntries(fileLabels.map(id => [id,el(id).textContent]));
async function assertFresh(nextMode) {
  const previous = api.state.data;
  api.state.uploadRoute = {kind:'stale'};
  api.state.pendingMappedImport = {review:'stale'};
  api.state.invoicePdfCandidate = {provider:'stale'};
  for (const input of el('review-builder').querySelectorAll('input')) {
    if (input.attrs.type === 'file') input.files = [{name:'stale.csv'}];
    else if (input.attrs.type === 'checkbox') input.checked = !input.defaultChecked;
    else input.value = '999';
  }
  fileLabels.forEach(id => { el(id).textContent = 'stale.csv'; });
  el('builder-error').textContent = 'old error'; el('builder-error').classList.add('visible');
  await click('start-review');
  assert.equal(api.state.data,previous);
  assert.equal(api.state.builderMode,null); assert.equal(api.state.outcomeMode,'sample');
  assert.equal(api.state.uploadRoute,null); assert.equal(api.state.pendingMappedImport,null); assert.equal(api.state.invoicePdfCandidate,null);
  for (const input of el('review-builder').querySelectorAll('input')) {
    if (input.attrs.type === 'file') assert.equal(input.files.length,0,input.id);
    else { assert.equal(input.value,input.defaultValue,input.id); assert.equal(input.checked,input.defaultChecked,input.id); }
  }
  for (const id of fileLabels) assert.equal(el(id).textContent,labelDefaults[id],id);
  assert.equal(el('builder-error').textContent,'');
  assert.equal(el('builder-error').classList.contains('visible'),false);
  assert.equal(el('structured-mapper').hidden,true);
  assert.equal(el('invoice-pdf-status').hidden,true);
  assert.equal(el('invoice-amount-choice-label').hidden,true);
  await mode(nextMode);
  for (const name of ['single','workload','openai']) {
    for (const input of el(name + '-builder-fields').querySelectorAll('input')) {
      if (name !== nextMode) assert.equal(input.disabled,true,input.id);
    }
  }
}
await assertFresh('workload');
await file('spend-file',spend); await file('work-file',work); await outcome('detailed');
await submit(); assert.equal(api.state.data.schema_version,'ai-cost-lens-review-result/1.0');
await click('start-review'); await mode('openai');
const openAIProvider = document.querySelectorAll('.import-provider').find(n => n.dataset.importProvider === 'openai');
const claudeProvider = document.querySelectorAll('.import-provider').find(n => n.dataset.importProvider === 'claude');
assert.equal(openAIProvider.classList.contains('active'),true);
assert.equal(openAIProvider.getAttribute('aria-pressed'),'true');
assert.equal(claudeProvider.classList.contains('active'),false);
assert.equal(claudeProvider.getAttribute('aria-pressed'),'false');
await provider('claude');
assert.equal(openAIProvider.classList.contains('active'),false);
assert.equal(claudeProvider.classList.contains('active'),true);
await provider('openai');
assert.equal(openAIProvider.classList.contains('active'),true);
assert.equal(claudeProvider.classList.contains('active'),false);
await click('start-review'); await mode('openai');
assert.equal(openAIProvider.classList.contains('active'),true);
assert.equal(openAIProvider.getAttribute('aria-pressed'),'true');
assert.equal(claudeProvider.classList.contains('active'),false);
await assertFresh('openai');
await file('openai-usage-file',read('tests/fixtures/openai-dashboard-usage.csv'));
await file('openai-cost-file',read('tests/fixtures/openai-dashboard-cost.csv'));
await submit(); assert.equal(api.state.data.schema_version,'ai-cost-lens-openai-bill-review/0.1');
assert.notEqual(el('bill-mode-tag').textContent,'PERIOD MISMATCH');
const alignedCost = read('tests/fixtures/openai-dashboard-cost.csv');
await file('openai-cost-file',alignedCost.split('\n').filter((line,i) => i !== 1).join('\n'));
await submit();
assert.equal(el('bill-mode-tag').textContent,'PERIOD MISMATCH');
assert.match(el('bill-finding-limit').textContent,/different UTC bucket start or end times/);
assert.match(el('bill-finding-limit').textContent,/same calendar dates may still include a partial bucket/);
assert.match(el('bill-finding-title').textContent,/not a matched financial review/);
assert.equal(el('memo-decision-code').textContent,'PERIOD MISMATCH');
assert.match(el('bill-boundary-copy').textContent,/even if their calendar dates match/);
const partialUsage = read('tests/fixtures/openai-dashboard-usage.csv').replaceAll('1788307200,1788393600','1788310800,1788393600');
await file('openai-usage-file',partialUsage);
await file('openai-cost-file',alignedCost);
await submit();
assert.equal(el('bill-mode-tag').textContent,'PERIOD MISMATCH');
assert.match(el('bill-source-copy').textContent,/do not match/);
await assertFresh('openai');
await provider('claude');
await files('smart-upload-files', [
  {name:'activity.csv',text:read('tests/fixtures/openai-dashboard-usage.csv')},
  {name:'cost.csv',text:read('tests/fixtures/openai-dashboard-cost.csv')},
]);
assert.equal(api.state.uploadRoute.kind,'openai');
assert.equal(api.state.importProvider,'openai');
assert.equal(document.querySelectorAll('.import-provider').find(n => n.dataset.importProvider === 'openai').classList.contains('active'),true);
assert.equal(el('openai-import-fields').hidden,false);
assert.equal(el('claude-import-fields').hidden,true);
assert.equal(el('build-review').textContent,'Review the OpenAI bill');
assert.equal(el('smart-upload-files').files.length,2);
await submit();
assert.equal(api.state.data.schema_version,'ai-cost-lens-openai-bill-review/0.1');
await assertFresh('openai');
await provider('openai');
await files('smart-upload-files', [{name:'claude.csv',text:read('tests/fixtures/synthetic-claude-team-spend.csv')}]);
assert.equal(api.state.uploadRoute.kind,'claude_spend');
assert.equal(api.state.importProvider,'claude');
assert.equal(document.querySelectorAll('.import-provider').find(n => n.dataset.importProvider === 'claude').classList.contains('active'),true);
assert.equal(el('openai-import-fields').hidden,true);
assert.equal(el('claude-import-fields').hidden,false);
assert.equal(el('build-review').textContent,'Check the Claude export');
assert.equal(el('smart-upload-files').files.length,1);
await assertFresh('openai');
const mappedText = 'billing_date,vendor,route,spend,currency_code,request_count,private_email\n2026-08-01,Anthropic,Support,12.5,USD,0,private@example.invalid\n2026-08-02,Anthropic,Support,7.5,USD,,other@example.invalid\n';
await files('smart-upload-files', [{name:'unknown.csv',text:mappedText}]);
assert.equal(api.state.uploadRoute.kind,'mapping');
assert.equal(el('structured-mapper').hidden,false);
assert.match(el('mapping-preview').textContent,/USD 20.00/);
const beforeMappedConfirmation = api.state.data;
await submit();
assert.equal(api.state.data,beforeMappedConfirmation);
assert.ok(api.state.pendingMappedImport);
await submit();
assert.equal(api.state.data.config.reviewSource,'structured_mapping');
assert.doesNotMatch(JSON.stringify(api.state.data),/private@example|other@example/);
await assertFresh('openai');
await provider('claude');
await file('claude-spend-file',read('tests/fixtures/synthetic-claude-team-spend.csv'));
el('claude-period-start').value = '2026-08-01'; el('claude-period-end').value = '2026-08-31';
const beforeClaudeConfirmation = api.state.data;
await submit();
assert.equal(api.state.data,beforeClaudeConfirmation,'Claude confirmation does not replace the displayed review');
assert.equal(el('claude-confirmation').hidden,false);
assert.match(el('claude-confirmation').textContent,/Provider: Anthropic/);
assert.match(el('claude-confirmation').textContent,/Personal identifiers were discarded/);
el('claude-period-end').value = '2026-09-01'; await el('claude-period-end').emit('change');
assert.equal(api.state.pendingClaudeImport,null,'Changing a confirmed period invalidates the pending import');
assert.equal(el('claude-confirmation').hidden,true);
el('claude-period-end').value = '2026-08-31';
await submit();
await submit();
assert.equal(api.state.data.schema_version,'ai-cost-lens-single-bill-review/0.1');
assert.deepEqual(JSON.parse(JSON.stringify(api.state.data.config.grossNet)),{gross:5.05,net:4,adjustment:1.05,classification:'unclassified_gross_to_net'});
assert.match(el('bill-source-copy').textContent,/gross-to-net adjustment/i);
assert.match(el('bill-source-copy').textContent,/does not identify that difference as a credit/i);
assert.doesNotMatch(JSON.stringify(api.state.data),/example\.invalid|acct-synthetic/);
await assertFresh('single');
await file('single-spend-file',invoice.replace('2026-08-01','2026-02-31'));
el('single-verifier').value = 'Preserve while correcting';
const beforeFailure = api.state.data;
await submit();
assert.equal(api.state.data,beforeFailure);
assert.equal(el('single-spend-file').files.length,1);
assert.equal(el('single-verifier').value,'Preserve while correcting');
assert.equal(el('builder-error').classList.contains('visible'),true);
await file('single-spend-file',invoice); await submit();
assert.equal(api.state.data.source.spend[0].workload,'Unrelated subscription');
assert.equal(el('builder-error').classList.contains('visible'),false);

await click('print-memo');
while (timers.length) timers.shift()();
assert.equal(document.body.classList.contains('printing-memo'),true,'Non-blocking print must survive all timers');
await window.emit('afterprint');
assert.equal(document.body.classList.contains('printing-memo'),false);
await click('print-memo');
media.matches = true; await media.emit('change');
media.matches = false; await media.emit('change');
assert.equal(document.body.classList.contains('printing-memo'),false,'Media exit cleans up without afterprint');
window.print = () => { throw new Error('Printing unavailable'); };
await click('print-memo');
assert.equal(document.body.classList.contains('printing-memo'),false,'Failed print does not strand print-only UI');
console.log('PASS: seven-path entry, builder transition/correction sequences and non-blocking print lifecycle');

// Integrated no-file comparison: real HTML defaults and registered submit handler.
await click('start-review'); await mode('simple');
assert.equal(el('simple-current-cost').disabled,false);
assert.equal(el('spend-file').disabled,true);
el('simple-current-name').value = 'Diana current';
el('simple-other-name').value = '<Diana other>';
await submit();
assert.equal(api.state.data.experience,'simple');
assert.equal(api.state.data.baseline.costs.recurring_operating_cost,70);
assert.equal(api.state.data.proposed.costs.recurring_operating_cost,220);
assert.equal(el('decision-code').textContent,'KEEP CURRENT ROUTE');
assert.match(el('memo-table-head').innerHTML,/Diana current/);
assert.match(el('memo-table-head').innerHTML,/&lt;Diana other&gt;/);
assert.equal(api.state.data.period.start,null);
assert.equal(api.state.data.baseline.usage.requests,null);
const simpleRecord = JSON.stringify(api.state.data);
await file('review-file',simpleRecord,'comparison.json');
assert.equal(api.state.data.experience,'simple');
await click('start-review'); await mode('simple');
el('simple-current-cost').value = '0'; el('simple-other-cost').value = '0';
el('simple-hourly-rate').value = '0';
await submit();
assert.equal(el('decision-code').textContent,'NO COST ADVANTAGE');
await click('start-review'); await mode('simple');
el('simple-other-usable').value = '0';
const prior = api.state.data;
await submit();
assert.equal(api.state.data,prior);
assert.match(el('builder-error').textContent,/zero usable outputs/);
await click('start-review'); await mode('example');
assert.equal(el('review-title').textContent,'What did one ready result really cost?');
await click('start-review'); await mode('openai');
assert.equal(el('simple-current-cost').disabled,true);
assert.equal(el('openai-usage-file').disabled,false);
console.log('PASS: simple comparison, free plans, JSON round trip, invalid-input rollback and existing-path transitions');

// Workbench integration: exercise the real event handlers, not only the pure engines.
api.state.data = JSON.parse(read('web/data/illustrative-review-result.json'));
api.renderAll();
assert.match(el('opportunity-summary').innerHTML,/Largest supported amount/);
assert.match(el('opportunity-workbench-list').innerHTML,/Retries deserve a closer look/);
await click('start-review'); await mode('usage');
assert.equal(el('view-opportunities').classList.contains('active'),true);
await click('try-illustrative-request-log');
assert.equal(api.state.usageReview.event_count,7);
assert.equal(api.state.usageReviewIllustrative,true);
assert.equal(api.state.usageReview.evidence_gate.savings_claim_allowed,false);
assert.match(api.state.usageReview.source.name,/Illustrative request log/);
assert.equal(el('request-analysis-mode').textContent,'ILLUSTRATIVE DATA');
assert.equal(el('request-analysis-title').textContent,'What the example calls show');
assert.equal(el('request-analysis-results').hidden,false);
await click('start-review'); await mode('price');
assert.equal(el('price-prompt-dialog').open,true);
await click('close-price-prompt');

const requestCsv = [
  'event_id,timestamp,provider,model,project,team,workload,customer,input_tokens,cached_input_tokens,provider_reported_cost,currency,status,latency_ms,outcome_status',
  ...Array.from({length:14},(_,index) => `request-${index + 1},2026-09-${String(index + 1).padStart(2,'0')}T12:00:00Z,${index < 7 ? 'OpenAI' : 'Anthropic'},${index < 7 ? 'gpt-5.6-sol' : 'claude-sonnet-5'},Product,Platform,Summaries,Internal,100,20,${index < 7 ? 10 : 20},USD,success,${100 + index * 10},ready_to_use`),
].join('\n');
await file('request-log-file',requestCsv,'request-log.csv');
assert.equal(api.state.usageReviewIllustrative,false);
el('request-period-complete').checked = true;
el('request-monthly-budget').value = '500';
el('request-compute-cost').value = '6';
el('request-retrieval-data-cost').value = '3';
el('request-network-cost').value = '2';
el('request-tooling-cost').value = '4';
el('request-pipeline-cost').value = '5';
el('request-human-review-cost').value = '1';
await click('analyze-request-log');
assert.equal(api.state.usageReview.schema_version,'ai-cost-lens-usage-review/1.1');
assert.equal(api.state.usageReview.spend.projected_30_day_cost,450);
assert.equal(api.state.usageReview.spend.run_rate_status,'AVAILABLE');
assert.equal(api.state.usageReview.spend.budget.status,'WATCH');
assert.equal(api.state.usageReview.spend.period_variance.total_cost_change,70);
assert.equal(api.state.usageReview.spend.operational_metrics.cache_share,.2);
assert.equal(api.state.usageReview.spend.cost_stack.status,'FULLY_LOADED');
assert.equal(api.state.usageReview.spend.cost_stack.fully_loaded_cost,231);
assert.equal(api.state.usageReview.spend.allocation.period_level_cost_kept_unallocated,21);
assert.equal(api.state.usageReview.spend.allocation.decision_support.status,'PASS');
assert.equal(api.state.usageReview.evidence_layers.usage_telemetry.status,'AVAILABLE');
assert.equal(api.state.usageReview.evidence_layers.request_cost.status,'PROVIDER_REPORTED');
assert.equal(api.state.usageReview.evidence_layers.billing_evidence.status,'NOT_SUPPLIED');
assert.match(el('request-spend-context').innerHTML,/30-day run rate/);
assert.match(el('request-spend-context').innerHTML,/\$450\.00/);
assert.match(el('request-evidence-layers').innerHTML,/Telemetry diagnoses/);
assert.match(el('request-cost-stack').innerHTML,/FULLY LOADED/);
assert.match(el('request-cost-stack').innerHTML,/\$231\.00/);
assert.match(el('request-allocation-status').innerHTML,/allocation check/);
assert.match(el('request-budget-status').innerHTML,/WATCH/);
assert.match(el('request-operational-metrics').innerHTML,/20\.0%/);
assert.match(el('request-variance').innerHTML,/Average-cost effect/);
assert.match(el('request-spend-breakdowns').innerHTML,/By provider/);
assert.match(el('request-spend-breakdowns').innerHTML,/By team or owner/);
assert.equal(el('request-analysis-results').hidden,false);

await click('price-prompt');
el('prompt-text').value = 'Summarize the material contract risks for finance review.';
el('prompt-current-model').value = 'openai/gpt-5.6-sol';
el('prompt-alt-1').value = 'openai/gpt-5.6-luna';
el('prompt-alt-2').value = '';
el('prompt-alt-3').value = '';
await el('price-prompt-form').emit('submit');
assert.equal(el('price-results').hidden,false);
assert.match(el('price-result-read').textContent,/worth testing, not a proven switch/);
await click('send-price-to-review');
assert.equal(el('review-dialog').open,true);
assert.equal(el('simple-current-name').value,'GPT-5.6 Sol');
assert.equal(el('simple-other-name').value,'GPT-5.6 Luna');
el('simple-current-checked').value = '100';
el('simple-current-usable').value = '95';
el('simple-current-minutes').value = '0';
el('simple-other-checked').value = '100';
el('simple-other-usable').value = '92';
el('simple-other-minutes').value = '0';
await submit();
assert.equal(api.state.data.pricing_estimate.evidence_gate.savings_claim_allowed,false);
assert.equal(api.state.data.comparison.savings_claim_allowed,false);

await click('price-prompt');
el('prompt-input-tokens').value = '1000';
el('prompt-current-model').value = 'openai/gpt-5.6-sol';
el('prompt-alt-1').value = 'custom/user-supplied-rate';
el('prompt-alt-2').value = '';
el('prompt-alt-3').value = '';
el('prompt-custom-label').value = 'Private contract route';
el('prompt-custom-provider').value = 'Private gateway';
el('prompt-custom-source').value = '2026 contract rate card';
el('prompt-custom-input').value = '1';
el('prompt-custom-cached').value = '.25';
el('prompt-custom-output').value = '5';
el('prompt-custom-effective').value = '2099-09-01';
await el('price-prompt-form').emit('submit');
assert.match(el('price-prompt-error').textContent,/cannot be later than the pricing date/);
el('prompt-custom-effective').value = '2026-09-01';
await el('price-prompt-form').emit('submit');
assert.match(el('price-result-rows').innerHTML,/Private contract route/);
assert.match(el('price-result-rows').innerHTML,/user-supplied/);
assert.match(el('price-assumptions').innerHTML,/did not verify it/);
await click('close-price-prompt');

const verificationCsv = [
  'case_id,route,output_text,exact_label,max_characters,outcome_status',
  'spacing,baseline,"approved",approved,8,ready_to_use',
  'spacing,candidate,"  approved  ",approved,8,ready_to_use',
].join('\n');
await file('verification-file',verificationCsv,'paired-output.csv');
await click('run-paired-verification');
assert.equal(api.state.verificationRecord.comparison.status,'QUALITY_FAIL');
assert.equal(api.state.verificationRecord.cases[0].candidate.output_characters,12);
assert.equal(JSON.stringify(api.state.verificationRecord).includes('  approved  '),false);

api.state.data = JSON.parse(read('web/data/illustrative-review-result.json'));
api.renderAll();
el('scenario-route').value = 'baseline';
el('scenario-model').value = 'openai/gpt-5.6-luna';
await el('scenario-form').emit('submit');
assert.ok(api.state.pendingScenario,el('scenario-error').textContent);
assert.equal(api.state.pendingScenario.evidence_gate.savings_claim_allowed,false);
assert.equal(el('scenario-result').hidden,false);
await click('send-scenario-to-verify');
assert.equal(api.state.view,'verify');
assert.match(el('verification-status').innerHTML,/GPT-5.6 Luna/);

for (const [id,value] of Object.entries({
  'actuals-baseline-period':'2026-07',
  'actuals-post-period':'2026-09',
  'actuals-baseline-cost':'100000',
  'actuals-post-cost':'70000',
  'actuals-baseline-volume':'1000',
  'actuals-post-volume':'900',
  'actuals-baseline-rate':'90',
  'actuals-post-rate':'92',
  'actuals-change-cost':'5000',
  'actuals-quality-floor':'90',
  'actuals-implemented-at':'2026-09-01',
})) el(id).value = value;
for (const id of ['actuals-quality-verified','actuals-policy-approved','actuals-provider-reported','actuals-periods-comparable','actuals-outcomes-complete']) el(id).checked = true;
await el('actuals-form').emit('submit');
assert.equal(api.state.actualsLedger.gates.source_record_is_real,false);
assert.equal(api.state.actualsLedger.gates.realized_savings_claim_allowed,false);
assert.equal(el('actuals-result').hidden,false);
assert.match(el('actuals-conclusion').textContent,/evidence gates remain open/);
console.log('PASS: prompt pricing, opportunity, scenario-to-verification and actuals event flows');
