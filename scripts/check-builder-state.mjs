import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';

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
    if (this.id) nodes.set(this.id, this);
  }
  get value() { return this._value; }
  set value(value) { this._value = String(value); if (this.attrs.type === 'file' && !value) this.files = []; }
  setAttribute(k,v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(k,fn) { (this.listeners[k] ||= []).push(fn); }
  async emit(k) { for (const fn of this.listeners[k] || []) await fn({target:this,currentTarget:this,preventDefault(){}}); }
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
  querySelector(selector) { return this.querySelectorAll(selector)[0]; }
  reset() { for (const field of this.querySelectorAll('input, select, textarea')) { field.value = field.defaultValue; field.checked = field.defaultChecked; } }
  showModal() { this.open = true; }
  close() { this.open = false; }
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
const context = {document,window,TextEncoder,crypto:webcrypto};
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
await assertFresh('openai');
await file('openai-usage-file',read('tests/fixtures/openai-dashboard-usage.csv'));
await file('openai-cost-file',read('tests/fixtures/openai-dashboard-cost.csv'));
await submit(); assert.equal(api.state.data.schema_version,'ai-cost-lens-openai-bill-review/0.1');
assert.notEqual(el('bill-mode-tag').textContent,'PERIOD MISMATCH');
const alignedCost = read('tests/fixtures/openai-dashboard-cost.csv');
await file('openai-cost-file',alignedCost.split('\n').filter((line,i) => i !== 1).join('\n'));
await submit();
assert.equal(el('bill-mode-tag').textContent,'PERIOD MISMATCH');
assert.match(el('bill-finding-limit').textContent,/different daily buckets/);
assert.match(el('bill-finding-limit').textContent,/Export the same date range/);
assert.match(el('bill-finding-title').textContent,/not a matched financial review/);
assert.equal(el('memo-decision-code').textContent,'PERIOD MISMATCH');
assert.match(el('bill-boundary-copy').textContent,/before using this review for a financial decision/);
await assertFresh('openai');
await files('smart-upload-files', [
  {name:'activity.csv',text:read('tests/fixtures/openai-dashboard-usage.csv')},
  {name:'cost.csv',text:read('tests/fixtures/openai-dashboard-cost.csv')},
]);
assert.equal(api.state.uploadRoute.kind,'openai');
await submit();
assert.equal(api.state.data.schema_version,'ai-cost-lens-openai-bill-review/0.1');
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
console.log('PASS: five builder transition/correction sequences and non-blocking print lifecycle');
