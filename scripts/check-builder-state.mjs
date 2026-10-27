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
const experimentEngine = require('../web/experiment-engine.js');
const actualsEngine = require('../web/actuals-engine.js');
const evidenceTools = require('../web/evidence-tools.js');

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
  async emit(k, target = this) { for (const fn of this.listeners[k] || []) await fn({target,currentTarget:this,preventDefault(){}}); }
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
  focus() { document.activeElement = this; }
  scrollIntoView() {}
  replaceChildren() { this.children = []; this.innerHTML = ''; }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); }
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
document.createElement = (tag) => new Element(tag);
document.body = document.querySelector('body');
const window = new Element('window');
const timers = [];
window.setTimeout = (fn) => timers.push(fn);
window.scrollTo = () => {};
window.print = () => {}; // Intentionally returns BEFORE printing has finished.
window.confirm = () => true; // These existing cases intentionally replace the current review.
let downloadedBlob;
class DownloadURL extends URL {
  static createObjectURL(blob) { downloadedBlob = blob; return 'blob:local-test-download'; }
  static revokeObjectURL() {}
}
const media = new Element('media'); media.matches = false;
window.matchMedia = () => media;
const source = read('web/app.js').replace(/  \/\* AI_COST_LENS_DEMO_LOADER_START \*\/[\s\S]*?  \/\* AI_COST_LENS_DEMO_LOADER_END \*\//,
  'globalThis.api = {state, renderAll};');
const context = {
  document,
  window,
  TextEncoder,
  Blob,
  URL: DownloadURL,
  crypto:webcrypto,
  AI_COST_LENS_PRICING_CATALOG:pricingCatalog,
  AICostLensOpenAITokenizer:openAITokenizer,
  AICostLensPricing:pricingEngine,
  AICostLensOpportunities:opportunityEngine,
  AICostLensUsageEvents:usageEventEngine,
  AICostLensScenarios:scenarioEngine,
  AICostLensVerification:verificationEngine,
  AICostLensExperiments:experimentEngine,
  AICostLensActuals:actualsEngine,
  AICostLensEvidenceTools:evidenceTools,
};
runInNewContext(read('web/experiment-ui.js'), context);
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
const currentCatalogModels = pricingCatalog.models.filter(model => !model.routed_to_model_id);
assert.equal((catalogHtml.match(/class="model-catalog-card"/g) || []).length, currentCatalogModels.length);
const tieredCount = currentCatalogModels.filter(model => model.long_context).length;
assert.equal((catalogHtml.match(/class="model-catalog-rate"/g) || []).length, (currentCatalogModels.length + tieredCount) * 4);
assert.equal((catalogHtml.match(/<span>Input<\/span>/g) || []).length, currentCatalogModels.length + tieredCount);
assert.equal((catalogHtml.match(/<span>Cached input<\/span>/g) || []).length, currentCatalogModels.length + tieredCount);
assert.equal((catalogHtml.match(/<span>Output<\/span>/g) || []).length, currentCatalogModels.length + tieredCount);
assert(!catalogHtml.includes('Gemini 3.5 Flash</a>') && !catalogHtml.includes('Gemini 3.7 Flash</a>'));
assert.match(catalogHtml, /Claude Haiku 5\.5[\s\S]*?over 100,000 input tokens per request[\s\S]*?<span>Input<\/span><strong>\$0\.50<\/strong>/);
assert.match(catalogHtml, /GPT-6 Sol[\s\S]*?over 272,000 input tokens per request[\s\S]*?<span>Input<\/span><strong>\$4\.00<\/strong>[\s\S]*?<span>Output<\/span><strong>\$15\.00<\/strong>/);
assert.match(catalogHtml, /Claude Sonnet 5[\s\S]*?<span>Input<\/span><strong>\$2\.00<\/strong>[\s\S]*?<span>Cached input<\/span><strong>\$0\.20<\/strong>[\s\S]*?<span>Output<\/span><strong>\$10\.00<\/strong>/);
api.state.data = JSON.parse(read('web/data/illustrative-review-result.json'));
api.state.demoData = api.state.data;
api.renderAll();
assert.match(el('memo-title').textContent,/ILLUSTRATIVE/,'The example PDF must declare its evidence status in the header.');
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
  for (const name of ['single','workload','openai','tools']) {
    for (const input of el(name + '-builder-fields').querySelectorAll('input')) {
      if (name !== nextMode) assert.equal(input.disabled,true,input.id);
    }
  }
}
await assertFresh('tools');
assert.equal(el('tools-basis').value,'','A new tools review must not certify checked bills by default.');
for (const [id,value] of Object.entries({'tools-name':'Team tools','tools-currency':'USD','tools-start':'2026-10-01','tools-end':'2026-10-20','tools-basis':'provider_reported','tool-name-1':'Writing plan','tool-kind-1':'subscription','tool-amount-1':'20','tool-source-1':'October invoice','tool-name-2':'Writing plan','tool-kind-2':'usage','tool-amount-2':'5','tool-source-2':'Separate usage charge'})) el(id).value = value;
el('tools-basis').value = '';
const beforeMissingBasis = api.state.data;
await submit();
assert.equal(api.state.data,beforeMissingBasis);
assert.match(el('tools-basis-error').textContent,/Choose what the amounts represent/);
assert.equal(el('tools-basis').getAttribute('aria-invalid'),'true');
assert.equal(document.activeElement,el('tools-basis'));
el('tools-basis').value = 'provider_reported';
await submit();
assert.match(el('tools-scope-error').textContent,/Confirm that these charges/);
assert.equal(document.activeElement,el('tools-scope'));
el('tools-scope').checked = true;
await submit();
assert.equal(api.state.data.config.reviewSource,'tool_spend');
assert.match(el('bill-finding-title').textContent,/\$25\.00/);
assert.equal(el('tool-spend-result').hidden,false);
const toolsRoundTrip = JSON.stringify(api.state.data);
await click('edit-tool-review');
assert.equal(el('tool-amount-1').value,'20');
assert.equal(el('tool-source-2').value,'Separate usage charge');
assert.equal(el('tools-start').value,'2026-10-01');
el('tool-amount-1').value='21';
await el('review-builder').emit('input',el('tool-amount-1'));
assert.equal(el('tools-scope').checked,false,'Edited charges need the boundary checked again.');
el('tools-scope').checked=true;
await submit();
assert.match(el('bill-finding-title').textContent,/\$26\.00/);
const beforeCancelledOpen = api.state.data;
window.confirm = () => false;
api.state.demoData=JSON.parse(read('web/data/illustrative-review-result.json'));
await document.querySelectorAll('[data-example]').find(node=>node.dataset.example==='cost-trap').emit('click');
assert.equal(api.state.data,beforeCancelledOpen,'Cancelling an example preserves the visitor’s own comparison.');
await file('review-file',toolsRoundTrip,'tools-baseline.json');
assert.equal(api.state.data,beforeCancelledOpen,'Cancelling replacement preserves the open comparison.');
const cancelledBuilderPrompts=[];
window.confirm = message => { cancelledBuilderPrompts.push(message); return false; };
await click('start-review'); await mode('simple');
for (const [id,value] of Object.entries({'simple-current-name':'Starting plan','simple-other-name':'Other plan','simple-current-cost':'80','simple-other-cost':'40','simple-monthly-tasks':'100','simple-current-checked':'20','simple-other-checked':'20','simple-current-usable':'18','simple-other-usable':'16','simple-current-minutes':'60','simple-other-minutes':'120','simple-hourly-rate':'30','simple-quality-floor':'90'})) el(id).value=value;
el('simple-other-usable').value='21';
await submit();
assert.equal(cancelledBuilderPrompts.length,0,'An invalid simple draft must show its error before asking to replace anything.');
assert.equal(api.state.data,beforeCancelledOpen);
assert.match(el('simple-other-usable-error').textContent,/greater than the number you checked/);
el('simple-other-usable').value='16';
await submit();
assert.equal(api.state.data,beforeCancelledOpen,'Cancelling a new simple comparison preserves the open review.');
assert.equal(el('simple-current-name').value,'Starting plan','Cancelled builder input stays available.');
assert.equal(el('review-dialog').open,true);
assert.equal(el('build-review').disabled,false);
await click('start-review'); await mode('tools');
for (const [id,value] of Object.entries({'tools-name':'Replacement tools','tools-currency':'USD','tools-start':'2026-10-01','tools-end':'2026-10-20','tools-basis':'provider_reported','tool-name-1':'Other subscription','tool-kind-1':'subscription','tool-amount-1':'10','tool-source-1':'Fictional invoice'})) el(id).value=value;
el('tools-scope').checked=true;
el('tool-amount-1').value='not a charge';
await submit();
assert.equal(cancelledBuilderPrompts.length,1,'An invalid combined-tool draft must not ask for replacement.');
assert.equal(api.state.data,beforeCancelledOpen);
el('tool-amount-1').value='10';
await submit();
assert.equal(api.state.data,beforeCancelledOpen,'Cancelling a new combined-tool baseline preserves the open review.');
assert.equal(el('tools-name').value,'Replacement tools');
assert.equal(cancelledBuilderPrompts.length,2);
assert.ok(cancelledBuilderPrompts.every(message=>message.includes('replace your open review or comparison')));
window.confirm = () => true;
await file('review-file',toolsRoundTrip,'tools-baseline.json');
await click('edit-tool-review');
assert.equal(el('tool-amount-1').value,'20','Reopened tools keep the original editable charges.');
await click('close-review');
const savedTools = api.state.data;
await click('bill-compare-next');
assert.equal(api.state.builderMode,'simple');
assert.equal(api.state.data,savedTools,'Opening a comparison keeps the existing baseline until a valid new review is built');
assert.equal(el('simple-current-cost').value,'','Do not silently allocate the combined baseline to one tool');
await assertFresh('workload');
const beforeDetailedReplacement=api.state.data;
const detailedReplacementPrompts=[];
window.confirm=message=>{detailedReplacementPrompts.push(message);return false;};
await file('spend-file',spend); await outcome('detailed');
await submit();
assert.equal(detailedReplacementPrompts.length,0,'A missing detailed work log must be reported before replacement consent.');
assert.equal(api.state.data,beforeDetailedReplacement);
await file('work-file',work);
await submit();
assert.equal(detailedReplacementPrompts.length,1);
assert.equal(api.state.data,beforeDetailedReplacement,'Cancel preserves the open result after validating uploaded detailed records.');
assert.equal(el('spend-file').files.length,1);
assert.equal(el('work-file').files.length,1);
assert.equal(el('build-review').disabled,false);
window.confirm=()=>true;
await submit(); assert.equal(api.state.data.schema_version,'ai-cost-lens-review-result/1.0');
for (const [scenario, status, allowed] of [
  ['false-economy','no_improvement',false],
  ['true-savings','observed_improvement',true],
]) {
  const path = `examples/synthetic-cases/${scenario}`;
  const config = JSON.parse(read(`${path}-config.json`));
  await assertFresh('workload');
  await file('spend-file',read(`${path}-spend.csv`));
  await outcome('detailed');
  await file('work-file',read(`${path}-outcomes.csv`));
  for (const [id,value] of Object.entries({
    'acceptance-rule': config.acceptanceRule,
    verifier: config.verifier,
    'quality-floor': config.qualityFloor * 100,
    'hourly-rate': config.hourlyRate,
    'baseline-shared': config.baselineShared,
    'proposed-shared': config.proposedShared,
    'change-cost': config.changeCost,
  })) el(id).value = value;
  el('baseline-policy-approved').checked = config.baselinePolicyApproved;
  el('proposed-policy-approved').checked = config.proposedPolicyApproved;
  await submit();
  assert.equal(api.state.data.mode,'real',scenario);
  assert.equal(api.state.data.comparison.status,status,scenario);
  assert.equal(api.state.data.comparison.savings_claim_allowed,allowed,scenario);
}
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
const beforeOpenAIReplacement=api.state.data;
const openAIReplacementPrompts=[];
window.confirm=message=>{openAIReplacementPrompts.push(message);return false;};
await file('openai-usage-file',read('tests/fixtures/openai-dashboard-usage.csv'));
await submit();
assert.equal(openAIReplacementPrompts.length,0,'Missing provider files must not ask to replace a result.');
assert.equal(api.state.data,beforeOpenAIReplacement);
await file('openai-cost-file',read('tests/fixtures/openai-dashboard-cost.csv'));
await submit();
assert.equal(openAIReplacementPrompts.length,1);
assert.equal(api.state.data,beforeOpenAIReplacement,'Cancel preserves the open result after validating provider files.');
assert.equal(el('openai-usage-file').files.length,1);
assert.equal(el('openai-cost-file').files.length,1);
window.confirm=()=>true;
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
const mappedReplacementPrompts=[];
window.confirm=message=>{mappedReplacementPrompts.push(message);return false;};
await submit();
assert.equal(api.state.data,beforeMappedConfirmation);
assert.ok(api.state.pendingMappedImport);
assert.equal(mappedReplacementPrompts.length,0,'A mapping preview does not replace a review.');
const pendingMappedAfterPreview=api.state.pendingMappedImport;
await submit();
assert.equal(mappedReplacementPrompts.length,1);
assert.equal(api.state.data,beforeMappedConfirmation);
assert.equal(api.state.pendingMappedImport,pendingMappedAfterPreview,'Cancel keeps the confirmed mapping available.');
window.confirm=()=>true;
await submit();
assert.equal(api.state.data.config.reviewSource,'structured_mapping');
assert.doesNotMatch(JSON.stringify(api.state.data),/private@example|other@example/);
await assertFresh('openai');
await provider('claude');
await file('claude-spend-file',read('tests/fixtures/synthetic-claude-team-spend.csv'));
el('claude-period-start').value = '2026-08-01'; el('claude-period-end').value = '2026-08-31';
const beforeClaudeConfirmation = api.state.data;
const claudeReplacementPrompts=[];
window.confirm=message=>{claudeReplacementPrompts.push(message);return false;};
await submit();
assert.equal(api.state.data,beforeClaudeConfirmation,'Claude confirmation does not replace the displayed review');
assert.equal(claudeReplacementPrompts.length,0,'A Claude preview must not ask to replace anything.');
assert.equal(el('claude-confirmation').hidden,false);
assert.match(el('claude-confirmation').textContent,/Provider: Anthropic/);
assert.match(el('claude-confirmation').textContent,/Personal identifiers were discarded/);
el('claude-period-end').value = '2026-09-01'; await el('claude-period-end').emit('change');
assert.equal(api.state.pendingClaudeImport,null,'Changing a confirmed period invalidates the pending import');
assert.equal(el('claude-confirmation').hidden,true);
el('claude-period-end').value = '2026-08-31';
await submit();
assert.equal(claudeReplacementPrompts.length,0);
const pendingClaudeAfterPreview=api.state.pendingClaudeImport;
await submit();
assert.equal(claudeReplacementPrompts.length,1);
assert.equal(api.state.data,beforeClaudeConfirmation);
assert.equal(api.state.pendingClaudeImport,pendingClaudeAfterPreview,'Cancel keeps the Claude preview and files available.');
assert.equal(el('claude-spend-file').files.length,1);
window.confirm=()=>true;
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
const singleReplacementPrompts=[];
window.confirm=message=>{singleReplacementPrompts.push(message);return false;};
await submit();
assert.equal(singleReplacementPrompts.length,0,'An invalid bill must show its error before replacement consent.');
assert.equal(api.state.data,beforeFailure);
assert.equal(el('single-spend-file').files.length,1);
assert.equal(el('single-verifier').value,'Preserve while correcting');
assert.equal(el('builder-error').classList.contains('visible'),true);
await file('single-spend-file',invoice); await submit();
assert.equal(singleReplacementPrompts.length,1);
assert.equal(api.state.data,beforeFailure);
assert.equal(el('single-verifier').value,'Preserve while correcting');
assert.equal(el('single-spend-file').files.length,1);
window.confirm=()=>true;
await submit();
assert.equal(api.state.data.source.spend[0].workload,'Unrelated subscription');
console.log('PASS: invalid drafts validate before replacement consent; valid Cancel preserves review, draft and provider previews');

// A second entered bill is a bounded comparison, never evidence of savings.
await click('start-review'); await mode('single');
for (const [id,value] of Object.entries({
  'invoice-provider':'OpenAI','invoice-workload':'Support summaries','invoice-date':'2026-09-30',
  'invoice-period-start':'2026-09-01','invoice-period-end':'2026-09-30','invoice-amount':'90','invoice-currency':'USD',
  'previous-bill-amount':'100','previous-bill-date':'2026-08-30','previous-bill-start':'2026-08-01','previous-bill-end':'2026-08-30',
})) el(id).value=value;
el('previous-bill-scope').checked=true;
await submit();
assert.equal(api.state.data.config.previousBill.amount,'100');
assert.equal(api.state.data.mode,'user_entered');
assert.equal(api.state.data.source.spend[0].cost_basis,'user_entered');
assert.equal(el('bill-usage-section').hidden,true,'A bill with no usage should not show an empty usage table.');
const oldManual=JSON.parse(JSON.stringify(api.state.data));
oldManual.mode='real'; oldManual.source.spend[0].cost_basis='provider_reported';
await file('review-file',JSON.stringify(oldManual),'older-manual-bill.json');
assert.equal(api.state.data.mode,'user_entered','Reopened older manual bills must lose overstated provider provenance.');
assert.equal(api.state.data.source.spend[0].cost_basis,'user_entered');
assert.match(el('bill-period-label').textContent,/declared service period, not independently verified/);
assert.match(el('bill-history-metrics').innerHTML,/−\$10\.00/);
assert.match(el('bill-history-metrics').innerHTML,/10\.0% lower/);
assert.match(el('bill-history-boundary').textContent,/does not explain why.*savings/);
assert.match(el('bill-opportunity-ledger').textContent || el('bill-opportunity-ledger').innerHTML,/two unverified bill totals/);
const savedTwoBills=JSON.parse(JSON.stringify(api.state.data));
savedTwoBills.config.previousBill.amount='-100';
api.state.data=savedTwoBills;
assert.throws(()=>api.renderAll(),/negative cost rows/,'Tampered saved bill must be recalculated and rejected.');
api.state.data=JSON.parse(JSON.stringify(savedTwoBills));
api.state.data.config.previousBill.amount='100';
api.renderAll();
await click('start-review'); await mode('single');
for (const [id,value] of Object.entries({
  'invoice-provider':'OpenAI','invoice-workload':'Support summaries','invoice-date':'2026-09-30',
  'invoice-period-start':'2026-09-01','invoice-period-end':'2026-09-30','invoice-amount':'90','invoice-currency':'USD',
  'previous-bill-amount':'0','previous-bill-date':'2026-08-31','previous-bill-start':'2026-08-01','previous-bill-end':'2026-08-31',
})) el(id).value=value;
el('previous-bill-scope').checked=true;
await submit();
assert.match(el('bill-history-boundary').textContent,/different lengths/);
assert.doesNotMatch(el('bill-history-metrics').innerHTML,/Bill change/);
assert.match(el('bill-history-metrics').innerHTML,/Calendar-day reference/);
assert.match(el('bill-history-boundary').textContent,/fixed monthly plans/);
assert.doesNotMatch(el('bill-opportunity-ledger').innerHTML,/\d+\.\d% lower/);
await click('start-review'); await mode('single');
for (const [id,value] of Object.entries({
  'invoice-provider':'OpenAI','invoice-workload':'Support summaries','invoice-date':'2026-09-30',
  'invoice-period-start':'2026-09-01','invoice-period-end':'2026-09-30','invoice-amount':'90','invoice-currency':'EUR',
  'previous-bill-amount':'100','previous-bill-date':'2026-08-31','previous-bill-start':'2026-08-01','previous-bill-end':'2026-08-31',
})) el(id).value=value;
el('previous-bill-scope').checked=true;
await submit();
assert.match(el('bill-history-metrics').innerHTML,/Calendar-day reference/);
assert.match(el('bill-history-metrics').innerHTML,/€3\.23.*€3\.00/);
assert.doesNotMatch(el('bill-history-metrics').innerHTML,/Bill change|\$100/);
await click('start-review'); await mode('single');
for (const [id,value] of Object.entries({
  'invoice-provider':'OpenAI','invoice-workload':'Support summaries','invoice-date':'2026-09-30',
  'invoice-period-start':'2026-09-01','invoice-period-end':'2026-09-30','invoice-amount':'90','invoice-currency':'USD',
  'previous-bill-amount':'100','previous-bill-date':'2026-08-30','previous-bill-start':'2026-08-01','previous-bill-end':'2026-08-30',
})) el(id).value=value;
await submit();
assert.match(el('bill-history-boundary').textContent,/Matching provider/);
assert.doesNotMatch(el('bill-history-metrics').innerHTML,/Bill change|Calendar-day reference/);
await click('start-review'); await mode('single');
for (const [id,value] of Object.entries({
  'invoice-provider':'OpenAI','invoice-workload':'Support summaries','invoice-date':'2026-09-30',
  'invoice-period-start':'2026-09-01','invoice-period-end':'2026-09-30','invoice-amount':'90','invoice-currency':'USD',
  'previous-bill-amount':'0','previous-bill-date':'2026-08-30','previous-bill-start':'2026-08-01','previous-bill-end':'2026-08-30',
})) el(id).value=value;
el('previous-bill-scope').checked=true;
await submit();
assert.match(el('bill-history-metrics').innerHTML,/Percentage unavailable: the previous bill was zero/);
assert.match(el('bill-history-boundary').textContent,/does not.*savings/);
assert.doesNotMatch(el('bill-opportunity-ledger').innerHTML,/0\.0% higher/);
await click('start-review'); await mode('single');
for (const [id,value] of Object.entries({
  'invoice-provider':'OpenAI','invoice-workload':'Support summaries','invoice-date':'2026-09-30',
  'invoice-period-start':'2026-09-01','invoice-period-end':'2026-09-30','invoice-amount':'120','invoice-currency':'USD',
  'bill-budget-amount':'100',
})) el(id).value=value;
el('bill-budget-scope').checked=true;
await submit();
assert.equal(api.state.data.config.billBudget.amount,'100');
assert.match(el('bill-budget-metrics').innerHTML,/\+\$20\.00/);
assert.match(el('bill-budget-metrics').innerHTML,/120\.0% of the entered budget used/);
assert.match(el('bill-budget-boundary').textContent,/not a live alert.*savings claim/);
assert.match(el('bill-opportunity-ledger').innerHTML,/Investigate the entered budget overage/);
assert.doesNotMatch(el('bill-opportunity-ledger').innerHTML,/set a monthly budget/);
const tamperedBudget=JSON.parse(JSON.stringify(api.state.data));
tamperedBudget.config.billBudget.amount='-1';
api.state.data=tamperedBudget;
assert.throws(()=>api.renderAll(),/negative cost rows/);
api.state.data=JSON.parse(JSON.stringify(tamperedBudget));
api.state.data.config.billBudget.amount='100';
api.renderAll();
await click('start-review'); await mode('single');
for (const [id,value] of Object.entries({
  'invoice-provider':'OpenAI','invoice-workload':'Support summaries','invoice-date':'2026-09-30',
  'invoice-period-start':'2026-09-01','invoice-period-end':'2026-09-30','invoice-amount':'120','invoice-currency':'USD',
  'bill-budget-amount':'100',
})) el(id).value=value;
await submit();
assert.match(el('bill-budget-boundary').textContent,/Budget variance is withheld.*Matching provider/);
assert.doesNotMatch(el('bill-budget-metrics').innerHTML,/Bill versus budget/);
assert.match(el('bill-opportunity-ledger').innerHTML,/Confirm what the budget covers/);
await click('start-review'); await mode('single');
for (const [id,value] of Object.entries({
  'invoice-provider':'OpenAI','invoice-workload':'Support summaries','invoice-date':'2026-09-30',
  'invoice-amount':'120','invoice-currency':'USD','bill-budget-amount':'100',
})) el(id).value=value;
el('bill-budget-scope').checked=true;
await submit();
assert.match(el('bill-budget-boundary').textContent,/Declare the bill.s complete service period/);
assert.doesNotMatch(el('bill-budget-metrics').innerHTML,/Bill versus budget/);
await click('start-review'); await mode('single');
for (const [id,value] of Object.entries({
  'invoice-provider':'OpenAI','invoice-workload':'Support summaries','invoice-date':'2026-09-30',
  'invoice-period-start':'2026-09-01','invoice-period-end':'2026-09-30','invoice-amount':'120','invoice-currency':'USD',
  'bill-budget-amount':'0',
})) el(id).value=value;
const beforeZeroBudget=api.state.data;
await submit();
assert.equal(api.state.data,beforeZeroBudget);
assert.match(el('builder-error').textContent,/must be greater than zero/);
el('bill-budget-amount').value='';
await submit();
assert.equal(el('bill-budget-result').hidden,true);
assert.equal(el('builder-error').classList.contains('visible'),false);
await click('review-usage');
assert.equal(document.body.classList.contains('bill-usage-mode'),true);
assert.equal(el('view-opportunities').classList.contains('active'),true);
assert.equal(el('bill-review-screen').classList.contains('active'),false);
await click('back-to-bill');
assert.equal(el('bill-review-screen').classList.contains('active'),true);
assert.equal(api.state.data.source.spend[0].workload,'Support summaries');

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

// Integrated no-file comparison: a fresh form cannot silently submit sample data.
const sampleInputs = {
  'simple-current-name':'Diana current','simple-other-name':'<Diana other>',
  'simple-current-cost':'40','simple-other-cost':'20','simple-monthly-tasks':'40',
  'simple-current-checked':'20','simple-current-usable':'19','simple-current-minutes':'30',
  'simple-other-checked':'20','simple-other-usable':'16','simple-other-minutes':'200',
  'simple-hourly-rate':'30','simple-quality-floor':'80',
};
const enterSample = (overrides = {}) => { for (const [id,value] of Object.entries({...sampleInputs,...overrides})) el(id).value=value; };
await click('start-review'); await mode('simple');
for (const id of Object.keys(sampleInputs)) assert.equal(el(id).value,'','Fresh comparisons require the visitor\'s inputs.');
const beforeBlankComparison=api.state.data;
await submit();
assert.equal(api.state.data,beforeBlankComparison,'A blank comparison cannot replace the prior result.');
assert.equal(document.activeElement,el('simple-current-name'));
assert.equal(el('simple-approved').checked,false,'Policy must require an explicit reviewer action.');
assert.equal(el('simple-current-cost').disabled,false);
assert.equal(el('spend-file').disabled,true);
enterSample();
el('simple-approved').checked = true;
await submit();
assert.equal(api.state.data.experience,'simple');
assert.equal(api.state.data.baseline.costs.recurring_operating_cost,70);
assert.equal(api.state.data.proposed.costs.recurring_operating_cost,220);
assert.equal(el('decision-code').textContent,'KEEP CURRENT ROUTE');
assert.equal(api.state.data.comparison.decision_code,'COMPARE ESTIMATES');
assert.equal(api.state.data.comparison.finance_posture,'ESTIMATE ONLY');
assert.equal(api.state.data.comparison.summary.cost_finding,el('simple-cost-finding').textContent);
assert.match(api.state.data.comparison.summary.before_switching,/Approval: you confirmed/);
assert.match(api.state.data.comparison.normalized_cost_difference_context,/not the monthly cost change, cash savings/);
assert.equal(el('memo-decision-code').textContent,'COST FINDING');
assert.match(el('memo-table-body').innerHTML,/Monthly tool cost/);
assert.doesNotMatch(el('memo-table-body').innerHTML,/Provider cost|ready result/);
assert.match(el('memo-switch-check').textContent,/Approval: you confirmed/);
assert.match(el('memo-table-head').innerHTML,/Diana current/);
assert.match(el('memo-table-head').innerHTML,/&lt;Diana other&gt;/);
assert.equal(api.state.data.period.start,null);
assert.equal(api.state.data.baseline.usage.requests,null);
const simpleRecord = JSON.stringify(api.state.data);
await file('review-file',simpleRecord,'comparison.json');
assert.equal(api.state.data.experience,'simple');
assert.equal(el('simple-edit-actions').hidden,false);
await click('edit-simple-comparison');
assert.equal(el('simple-current-name').value,'Diana current');
assert.equal(el('simple-other-name').value,'<Diana other>');
assert.equal(el('simple-approved').checked,true);
el('simple-other-name').value='A different tool';
await el('simple-other-name').emit('input');
assert.equal(el('simple-approved').checked,false,'A changed tool name needs a fresh approval declaration.');
assert.equal(el('simple-approval-note').hidden,false,'Explain when a rename clears approval.');
await click('close-review');

// Reproduce the audited edit/approval problems with independently known totals.
await click('start-review'); await mode('simple');
for (const [id,value] of Object.entries({
  'simple-current-name':'Review plan A','simple-other-name':'Review plan B',
  'simple-current-cost':'80','simple-other-cost':'40','simple-monthly-tasks':'100',
  'simple-current-checked':'20','simple-current-usable':'18','simple-current-minutes':'60',
  'simple-other-checked':'20','simple-other-usable':'16','simple-other-minutes':'120',
  'simple-hourly-rate':'30','simple-quality-floor':'75',
})) el(id).value=value;
await submit();
assert.equal(api.state.data.baseline.costs.recurring_operating_cost,230);
assert.equal(api.state.data.proposed.costs.recurring_operating_cost,340);
assert.equal(el('decision-code').textContent,'CHECK APPROVAL');
assert.equal(api.state.data.comparison.savings_claim_allowed,false);
assert.equal(api.state.data.baseline.outcomes.ready_rate_interval_95,null);
assert.equal(api.state.data.proposed.outcomes.ready_rate_interval_95,null);
assert.equal(api.state.data.baseline.evidence.cost_basis,'user_entered');
assert.match(api.state.data.comparison.finding,/Review plan A has the lower estimated cost/);
assert.equal(document.querySelector('.question-nav').hidden,true);
assert.equal(document.querySelector('.mobile-section-picker').hidden,true);
assert(document.querySelectorAll('.nav-item').filter((item)=>!item.hidden).every((item)=>item.dataset.view==='review'),'Simple comparisons must not expose a second opportunity amount.');
assert.match(el('finding-title').textContent,/Review plan A has the lower estimated cost/);
assert.match(el('lumen-panel-copy').textContent,/\$2\.56[\s\S]*\$4\.25[\s\S]*approval/);
const editableRecord=JSON.stringify(api.state.data);
// A separate usage review must not inherit a former bill's amount from another workflow.
api.state.carriedBillIntoUsage=true;
el('request-billed-total').value='999'; el('request-billed-currency').value='USD';
el('request-bill-scope-confirmed').checked=true;
await click('start-review'); await mode('usage');
assert.equal(el('request-billed-total').value,'');
assert.equal(el('request-bill-scope-confirmed').checked,false);
assert.equal(el('back-to-bill').textContent,'Return to comparison');
await click('back-to-bill');
assert.equal(api.state.data.baseline.costs.recurring_operating_cost,230);
assert.equal(api.state.view,'review');
const olderRanges=JSON.parse(editableRecord);
for (const side of ['baseline','proposed']) olderRanges[side].outcomes.ready_rate_interval_95=[0.1,0.99];
await file('review-file',JSON.stringify(olderRanges),'older-user-selected-sample.json');
assert.equal(api.state.data.baseline.outcomes.ready_rate_interval_95,null,'Unsupported historical intervals must not survive reopening and re-export.');
assert.equal(api.state.data.proposed.outcomes.ready_rate_interval_95,null);
await click('start-review'); await mode('simple'); // A new review deliberately has fresh defaults.
assert.equal(el('simple-current-cost').value,'');
await click('close-review');
await file('review-file',editableRecord,'editable-comparison.json');
await click('edit-simple-comparison');
assert.equal(el('simple-current-cost').value,'80');
assert.equal(el('simple-other-minutes').value,'120');
assert.equal(el('simple-quality-floor').value,'75');
assert.equal(el('simple-approved').checked,false);
const unchanged=api.state.data;
el('simple-other-usable').value='21';
await submit();
assert.equal(api.state.data,unchanged,'An invalid edit must leave the prior result intact.');
assert.match(el('simple-other-usable-error').textContent,/greater than the number you checked/);
assert.match(el('simple-other-usable-error').textContent,/Review plan B/);
assert.equal(el('simple-other-usable').getAttribute('aria-invalid'),'true');
el('simple-other-usable').value='16';
await el('review-builder').emit('input',el('simple-other-usable'));
assert.equal(el('simple-other-usable-error').hidden,true,'Editing the field clears its stale error.');
assert.equal(el('simple-other-usable').getAttribute('aria-invalid'),'false');
el('simple-current-cost').value='100';
await submit();
assert.equal(api.state.data.baseline.costs.recurring_operating_cost,250);
assert.equal(api.state.data.proposed.costs.recurring_operating_cost,340);
assert.equal(api.state.data.comparison.both_policy_approved,false);
assert.equal(el('simple-other-usable-error').hidden,true);
assert.equal(el('simple-other-usable').getAttribute('aria-invalid'),'false');
const changed=api.state.data;
const tampered=JSON.parse(editableRecord);
tampered.simple_input_snapshot.fields['simple-current-cost']='999';
await file('review-file',JSON.stringify(tampered),'inconsistent-inputs.json');
assert.equal(api.state.data,changed,'An inconsistent input snapshot must not replace the displayed result.');
const legacy=JSON.parse(editableRecord); delete legacy.simple_input_snapshot;
await file('review-file',JSON.stringify(legacy),'legacy-comparison.json');
assert.equal(api.state.data.experience,'simple');
assert.equal(el('simple-edit-actions').hidden,true,'Older results remain readable without guessed editor inputs.');
console.log('PASS: cost finding remains visible without approval; edit, save/reopen, invalid rollback and legacy reviews');
// A nonzero small bill must not look free, and cents must survive the screen and memo.
for (const test of [
  { costs: ['0.24', '0.16'], minutes: ['0', '0'], rate: '0', totals: [0.24, 0.16], shown: ['$0.24', '$0.16'] },
  { costs: ['80.25', '40.75'], minutes: ['1', '2'], rate: '15', totals: [80.50, 41.25], shown: ['$80.25', '$40.75', '$0.25', '$0.50', '$80.50', '$41.25'] },
  { costs: ['0.004', '0.006'], minutes: ['0', '0'], rate: '0', totals: [0.004, 0.006], shown: ['$0.004000', '$0.006000'] },
  { costs: ['12345.67', '9876.54'], minutes: ['0', '0'], rate: '0', totals: [12345.67, 9876.54], shown: ['$12,345.67', '$9,876.54'] },
]) {
  await click('start-review'); await mode('simple');
  enterSample();
  for (const [id, value] of Object.entries({
    'simple-current-cost': test.costs[0], 'simple-other-cost': test.costs[1],
    'simple-monthly-tasks': '20', 'simple-current-checked': '20', 'simple-current-usable': '18',
    'simple-other-checked': '20', 'simple-other-usable': '16',
    'simple-current-minutes': test.minutes[0], 'simple-other-minutes': test.minutes[1],
    'simple-hourly-rate': test.rate,
  })) el(id).value = value;
  await submit();
  assert.equal(api.state.data.baseline.costs.recurring_operating_cost, test.totals[0]);
  assert.equal(api.state.data.proposed.costs.recurring_operating_cost, test.totals[1]);
  for (const id of ['unit-economics-card', 'memo-table-body']) {
    for (const amount of test.shown) assert(el(id).innerHTML.includes(`>${amount}<`), `${id} lost ${amount}`);
  }
  await file('review-file', JSON.stringify(api.state.data), 'fractional-cost-comparison.json');
  assert.equal(api.state.data.baseline.costs.recurring_operating_cost, test.totals[0]);
  assert.equal(api.state.data.proposed.costs.recurring_operating_cost, test.totals[1]);
  assert.equal(api.state.data.comparison.savings_claim_allowed, false);
}
console.log('PASS: cents, fractional time value, sub-cent estimates, and large totals agree on screen, in the memo, and in JSON');
await click('start-review'); await mode('simple');
enterSample();
el('simple-approved').checked = true;
el('simple-current-cost').value = '0'; el('simple-other-cost').value = '0';
el('simple-hourly-rate').value = '0';
await submit();
assert.equal(el('decision-code').textContent,'NO COST ADVANTAGE');
await click('start-review'); await mode('simple');
enterSample();
el('simple-other-usable').value = '0';
const prior = api.state.data;
await submit();
assert.equal(api.state.data,prior);
assert.match(el('simple-other-usable-error').textContent,/zero usable outputs/);
await click('start-review'); await mode('example');
assert.equal(el('review-title').textContent,'Provider cost down 65%. Cost per ready result up 5%.');
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
await click('analyze-request-log');
assert.equal(api.state.usageReview.event_count,7,'Analyze locally should rerun the selected illustrative data');
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
assert.equal(el('simple-hourly-rate').value,'','Pricing handoff must require a deliberate time value');
assert.equal(el('simple-current-name').value,'GPT-5.6 Sol');
assert.equal(el('simple-other-name').value,'GPT-5.6 Luna');
el('simple-current-checked').value = '100';
el('simple-current-usable').value = '95';
el('simple-current-minutes').value = '0';
el('simple-other-checked').value = '100';
el('simple-other-usable').value = '92';
el('simple-other-minutes').value = '0';
el('simple-hourly-rate').value = '30';
el('simple-quality-floor').value = '80';
await submit();
assert.equal(api.state.data.pricing_estimate.evidence_gate.savings_claim_allowed,false);
assert.equal(api.state.data.comparison.savings_claim_allowed,false);
await click('edit-simple-comparison');
assert.ok(api.state.priceEstimate,'Editing keeps the unchanged price estimate provenance.');
el('simple-current-cost').value='123';
await el('simple-current-cost').emit('input');
assert.equal(api.state.priceEstimate,null,'A manually edited charge must not inherit the old rate estimate.');
await submit();
assert.equal(api.state.data.pricing_estimate,undefined);
assert.equal(api.state.data.baseline.costs.model_cost,123);
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
assert.match(el('actuals-conclusion').textContent,/not a realized savings claim/);
assert.match(el('actuals-open-gates').innerHTML,/illustrative or sampled/);
console.log('PASS: prompt pricing, opportunity, scenario-to-verification and actuals event flows');

// Exercise the real experiment form handlers and their handoffs to the memo.
const experimentUI = context.AICostLensExperimentUI;
window.print = () => {};
await click('experiment-example');
assert.equal(experimentUI.getRecord().summary.unique_validation_cases,40);
assert.equal(experimentUI.getRecord().summary.validation_observations,80);
assert.match(el('experiment-summary').innerHTML,/ILLUSTRATIVE TEST/);
assert.equal(el('experiment-run-form').hidden,true,'Invented example runs are read-only.');
assert.match(el('experiment-summary').innerHTML,/runs and declarations are made up/);
assert.doesNotMatch(el('experiment-summary').innerHTML,/Their separate execution is explicitly declared by the user/);
assert.match(el('experiment-runs').innerHTML,/Invented repeat/);
await click('experiment-attach');
assert.match(el('experiment-error').textContent,/same workload/);
await click('download-workspace');
const unattachedArchive=JSON.parse(await downloadedBlob.text());
assert.equal(unattachedArchive.experiment_attachment.attached,false);
assert.equal(unattachedArchive.experiment_record.mode,'illustrative');
await click('experiment-new');
assert.ok(experimentUI.getRecord(),'Clearing a test requires the explicit reset checkbox.');
el('experiment-reset-confirm').checked = true;
await click('experiment-new');

api.state.data = JSON.parse(read('web/data/illustrative-review-result.json'));
api.state.data.mode = 'real';
for (const route of ['baseline','proposed']) api.state.data[route].period = {start:'2026-09-01',end:'2026-09-30'};
api.renderAll();
const gatesBeforeExperiment = JSON.stringify(api.state.data.comparison);
assert.equal(el('experiment-workload').value,api.state.data.workload.name);
assert.equal(el('experiment-quality-rule').value,api.state.data.baseline.outcomes.acceptance_rule);
assert.equal(el('experiment-baseline-label').value,'Starting test setup');
assert.equal(el('experiment-candidate-label').value,'Changed test setup');
el('experiment-change').value = 'caching';
el('experiment-baseline-caching').value = 'Off';
el('experiment-candidate-caching').value = 'On';
el('experiment-unchanged').checked = true;
await el('experiment-plan').emit('submit');
assert.ok(experimentUI.getRecord(),el('experiment-error').textContent);
assert.equal(el('experiment-plan').hidden,true);
assert.equal(el('experiment-locked').hidden,false);
assert.equal(experimentUI.getAttachment().attached,false,'Locking a test does not attach it automatically.');
assert.equal(el('experiment-run-form').hidden,false);
assert.equal(el('experiment-paired-threshold-note').hidden,false);
assert.match(el('experiment-paired-threshold-note').textContent,/paired-check pass does not establish/);
assert.match(el('experiment-paired-threshold-note').textContent,/^This paired check uses its own thresholds/);
const illustrativeRuns = experimentEngine.illustrativeExample(verificationEngine).runs;
async function enterExperimentRun(index, evidence = illustrativeRuns[index].verification) {
  await file('experiment-verification-file',JSON.stringify(evidence),'paired-run.json');
  el('experiment-partition').value = 'validation';
  el('experiment-baseline-cost').value = '.40';
  el('experiment-candidate-cost').value = '.22';
  el('experiment-cost-source').value = 'Declared cost for this execution';
  el('experiment-independent').checked = true;
  el('experiment-reserved').checked = true;
  await el('experiment-run-form').emit('submit');
}
await enterExperimentRun(0);
assert.equal(experimentUI.getRecord().summary.decision,'NEEDS_MORE_EVIDENCE');
assert.equal(el('experiment-independent').checked,false,'A new run needs fresh attestations.');
assert.equal(el('experiment-baseline-cost').value,'','A new run cannot reuse a previous cost by accident.');
await enterExperimentRun(0);
assert.equal(experimentUI.getRecord().runs.length,1);
assert.match(el('experiment-error').textContent,/already been recorded/);
await enterExperimentRun(1);
assert.equal(experimentUI.getRecord().runs.length,1,'A re-saved matching result needs its own confirmation.');
assert.equal(el('experiment-matching-wrap').hidden,false);
el('experiment-matching-confirm').checked=true;
await el('experiment-run-form').emit('submit');
assert.equal(experimentUI.getRecord().summary.decision,'REVIEW_CANDIDATE');
assert.match(el('experiment-runs').innerHTML,/0\.0055/);
assert.match(el('experiment-runs').innerHTML,/Total API cost/);
assert.match(el('experiment-runs').innerHTML,/Unit-cost change/);
assert.match(el('experiment-runs').innerHTML,/Declared repeat/);
await click('experiment-attach');
assert.equal(experimentUI.getAttachment().attached,true);
await click('print-memo');
assert.match(el('memo-experiment').innerHTML,/not a validation of the review’s proposed route/);
assert.match(el('memo-experiment').innerHTML,/40 distinct validation cases/);
assert.match(el('memo-experiment').innerHTML,/API cost per ready result/);
await window.emit('afterprint');
assert.equal(JSON.stringify(api.state.data.comparison),gatesBeforeExperiment,'Experiments must not approve savings or change finance gates.');
await click('experiment-print');
assert.equal(document.body.classList.contains('printing-experiment'),true);
assert.match(el('experiment-printout').innerHTML,/Cost evidence supplied/);
assert.match(el('experiment-printout').innerHTML,/Locked setting/);
assert.match(el('experiment-printout').innerHTML,/Declared repeat/);
await window.emit('afterprint');
assert.equal(document.body.classList.contains('printing-experiment'),false);
const savedExperiment = experimentUI.getRecord();
savedExperiment.summary.decision = 'REJECT_CHANGE';
savedExperiment.evidence_gate.savings_claim_allowed = true;
const beforeTestReplacement=JSON.stringify(experimentUI.getRecord());
await file('experiment-file',JSON.stringify(savedExperiment),'saved-test.json');
assert.equal(JSON.stringify(experimentUI.getRecord()),beforeTestReplacement,'Opening a saved test cannot silently overwrite the open one.');
assert.match(el('experiment-error').textContent,/test is already open/);
el('experiment-reset-confirm').checked=true;
await file('experiment-file',JSON.stringify(savedExperiment),'saved-test.json');
assert.equal(experimentUI.getRecord().summary.decision,'REVIEW_CANDIDATE','Reopening recomputes the decision.');
assert.equal(experimentUI.getRecord().evidence_gate.savings_claim_allowed,false);
await click('experiment-attach');
api.renderAll();
assert.equal(el('memo-experiment').hidden,false);
assert.equal(el('experiment-actuals-note').hidden,false);
await click('experiment-to-actuals');
assert.equal(api.state.view,'actuals');
api.state.data = JSON.parse(read('web/data/illustrative-review-result.json'));
api.renderAll();
assert.equal(el('memo-experiment').hidden,true,'An unrelated review must not inherit the prior test summary.');
const beforeInvalidOpen = JSON.stringify(experimentUI.getRecord());
el('experiment-reset-confirm').checked=true;
await file('experiment-file','{}','invalid-test.json');
assert.equal(JSON.stringify(experimentUI.getRecord()),beforeInvalidOpen,'An invalid file must not replace the open test.');
for (const origin of ['changed','unavailable']) {
  const imported=JSON.parse(JSON.stringify(savedExperiment));
  if (origin==='changed') imported.runs[0].candidate_cost=.20;
  else delete imported.integrity;
  el('experiment-reset-confirm').checked=true;
  await file('experiment-file',JSON.stringify(imported),`${origin}-test.json`);
  await click('experiment-download');
  let roundTrip=JSON.parse(await downloadedBlob.text());
  assert.equal(roundTrip.integrity.reopened_from,origin);
  assert.equal(Object.hasOwn(roundTrip,'integrity_check'),false,'Downloaded records must not include stale runtime notices.');
  for (let iteration=0;iteration<2;iteration++) {
    el('experiment-reset-confirm').checked=true;
    await file('experiment-file',JSON.stringify(roundTrip),'round-trip.json');
    assert.match(el('experiment-summary').innerHTML,/An earlier import/);
    assert.match(el('experiment-summary').innerHTML,/does not clear that warning/);
    await click('experiment-print');
    assert.match(el('experiment-printout').innerHTML,/An earlier import/);
    await window.emit('afterprint');
    await click('download-workspace');
    const workspace=JSON.parse(await downloadedBlob.text());
    assert.equal(workspace.experiment_record.integrity.reopened_from,origin);
    assert.equal(Object.hasOwn(workspace.experiment_record,'integrity_check'),false);
    await click('experiment-download');
    roundTrip=JSON.parse(await downloadedBlob.text());
  }
}
console.log('PASS: controlled test lock, fresh runs, duplicate rejection, recomputed reopening, print and finance handoffs');
