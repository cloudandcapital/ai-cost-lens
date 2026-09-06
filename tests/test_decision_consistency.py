"""Regression cases for the decision contradictions found in the release review."""

import json
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]


@pytest.mark.parametrize(
    "current,other,quality,approved,time,expected",
    [
        (1.842105, 6.875, True, True, True, "KEEP CURRENT ROUTE"),
        (1.25, 1.75, True, True, True, "KEEP CURRENT ROUTE"),
        (1.25, 1.25, True, True, True, "NO COST ADVANTAGE"),
        (0, 0.5, True, True, True, "KEEP CURRENT ROUTE"),
        (0, 0, True, True, True, "NO COST ADVANTAGE"),
        (1, 0.05, False, True, True, "QUALITY BELOW MINIMUM"),
        (1, 0.5, True, False, True, "CHECK APPROVAL"),
        (1, 0.5, True, True, False, "ADD MISSING TIME"),
        (1, 0.5, True, True, True, "TEST FIRST"),
    ],
)
def test_shared_decision(current, other, quality, approved, time, expected):
    data = dict(
        experience="simple",
        baseline={"measures": {"cost_per_usable_result": current}},
        proposed={"measures": {"cost_per_usable_result": other}},
        comparison=dict(
            quality_holds=quality,
            both_policy_approved=approved,
            human_cost_included=time,
            savings_claim_allowed=False,
        ),
    )
    script = """
const fs = require('fs');
let source = fs.readFileSync('web/app.js', 'utf8');
source = source.replace('  function renderAll() {', '  globalThis.decide = decisionFor; return;\\n  function renderAll() {');
eval(source);
console.log(JSON.stringify(decide(JSON.parse(process.argv[1]))));
"""
    result = subprocess.run(
        ["node", "-e", script, json.dumps(data)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    decision = json.loads(result.stdout)
    assert decision["code"] == expected
    if current == 0:
        assert decision["percent"] is None


def test_simple_evidence_is_not_a_provider_invoice():
    app = (ROOT / "web/app.js").read_text()
    simple = app.split('if (state.builderMode === "simple") {', 1)[1].split(
        'if (state.builderMode === "single")', 1
    )[0]
    assert '"provider_reported"' not in simple
    assert "scenario.evidence.provider_cost_sha256 = null" in simple
    assert "scenario.usage[key] = null" in simple
    assert "start: null, end: null" in simple


def test_calculations_rendered_decisions_and_saved_record_roundtrip():
    script = r"""
const fs = require('fs');
const assert = require('assert/strict');
const elements = {};
const element = id => elements[id] ||= {textContent:'',innerHTML:'',value:'',hidden:false,style:{},dataset:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},replaceChildren(){},querySelectorAll(){return []}};
global.document = {getElementById:element,querySelector:element,querySelectorAll:()=>[],body:element('body')};
global.window = {scrollTo(){}};
let source = fs.readFileSync('web/app.js','utf8');
source = source.replace('  function renderAll() {', '  globalThis.api = {validDate, finiteNumber, buildSampledReview: buildSimpleReview, validateResult, renderAll, updateBreakEvenExplorer, lumenResponse, setData(d){state.data=d}}; return;\n  function renderAll() {');
eval(source);
const config = {acceptanceRule:'First-pass usable',verifier:'Test reviewer',qualityFloor:.8,hourlyRate:30,baselinePolicyApproved:true,proposedPolicyApproved:true,baselineShared:0,proposedShared:0,changeCost:0,sampleRandom:false,planning:null};
const header = 'period,date,workload,provider,model,route,requests,input_tokens,cached_input_tokens,cache_write_input_tokens,output_tokens,provider_cost,cost_basis,currency';
async function build(a,b,minutesA=30,minutesB=200,readyB=16,overrides={}) {
 const csv = header+'\nbaseline,2026-09-01,Same tasks,A,A,Current,40,0,0,0,0,'+a+',calculated,USD\nproposed,2026-09-01,Same tasks,B,B,Other,40,0,0,0,0,'+b+',calculated,USD';
 const result = await api.buildSampledReview(csv,{baseline:{population:40,ready:19,correction:1,escalation:0,humanMinutes:minutesA},proposed:{population:40,ready:readyB,correction:20-readyB,escalation:0,humanMinutes:minutesB}},{...config,...overrides});
 result.experience="simple"; return result;
}
function render(d,code) {
 api.setData(d); api.renderAll();
 assert.equal(elements['decision-code'].textContent,code);
 assert.equal(elements['memo-decision-code'].textContent,code);
 assert.equal(elements['decision-title'].textContent,elements['memo-next-step'].textContent);
 for (const kind of ['why','changed','cfo']) assert.ok(api.lumenResponse(kind).includes(d.comparison.recommendation));
 for (const [id,e] of Object.entries(elements)) assert.ok(!/NaN|Infinity|>undefined</.test(e.textContent+' '+e.innerHTML), id+': '+e.textContent+' '+e.innerHTML);
}
(async()=>{
 assert.throws(()=>api.validDate('2026-02-30','Date'), /YYYY-MM-DD/);
 assert.equal(api.validDate('2024-02-29','Date'),'2024-02-29');
 assert.throws(()=>api.finiteNumber('9007199254740992','Count',{integer:true}), /number/);
 const d = await build(40,20);
 assert.equal(d.baseline.costs.recurring_operating_cost,70);
 assert.equal(d.proposed.costs.recurring_operating_cost,220);
 assert.equal(d.baseline.outcomes.usable_results,38);
 assert.equal(d.proposed.outcomes.usable_results,32);
 assert.equal(d.proposed.measures.cost_per_usable_result,6.875);
 render(d,'KEEP CURRENT ROUTE');
 render(JSON.parse(JSON.stringify(d)),'KEEP CURRENT ROUTE');
 const named = JSON.parse(JSON.stringify(d)); named.experience = 'simple';
 named.baseline.model.name = 'My current tool'; named.proposed.model.name = '<Other & tool>';
 render(named,'KEEP CURRENT ROUTE');
 assert.equal(named.baseline.label,'My current tool');
 assert.equal(named.proposed.label,'<Other & tool>');
 for (const id of ['unit-cost-chart','memo-table-head']) {
   assert.ok(elements[id].innerHTML.includes('My current tool'));
   assert.ok(elements[id].innerHTML.includes('&lt;Other &amp; tool&gt;'));
 }
 assert.ok(elements['unit-cost-chart'].innerHTML.includes('Recurring cost per ready result'));
 assert.ok(!elements['unit-cost-chart'].innerHTML.includes('Recurring operating cost'));

 render(await build(40,20,0,0,16),'TEST FIRST');
 render(await build(40,1,0,0,10),'QUALITY BELOW MINIMUM');
 render(await build(40,1,0,0,19,{proposedPolicyApproved:false}),'CHECK APPROVAL');
 render(await build(0,20,0,0,19),'KEEP CURRENT ROUTE');
 assert.equal(elements['break-even-verdict'].textContent,'CURRENT ROUTE STILL WINS');
 render(await build(0,0,0,0,19),'NO COST ADVANTAGE');
 assert.equal(elements['break-even-verdict'].textContent,'NO COST ADVANTAGE');
 render(await build(40,40,0,0,19),'NO COST ADVANTAGE');
 render(await build(1000000,500000,0,0,19),'TEST FIRST');
 await assert.rejects(build(40,20,0,0,0), /zero usable outputs/);
 const tampered = JSON.parse(JSON.stringify(d)); tampered.proposed.measures.cost_per_usable_result = .001;
 assert.throws(()=>api.validateResult(tampered), /inconsistent|validation failed/);
 const flags = JSON.parse(JSON.stringify(d)); flags.comparison.savings_claim_allowed=true; flags.comparison.quality_holds=true;
 api.validateResult(flags); assert.equal(flags.comparison.savings_claim_allowed,false);
 const missing = JSON.parse(JSON.stringify(d)); delete missing.proposed.outcomes;
 assert.throws(()=>api.validateResult(missing), /inconsistent|validation failed/);
 console.log('calculation, rendering, edge cases, and saved-record checks passed');
})().catch(e=>{console.error(e);process.exit(1)});
"""
    result = subprocess.run(
        ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_download_and_print_callbacks_use_the_current_validated_record():
    script = r"""
const fs = require('fs'), assert = require('assert/strict');
const handlers = {}, elements = {}, classes = new Set();
const element = id => elements[id] ||= {textContent:'',innerHTML:'',value:'',style:{},dataset:{},children:[],classList:{add(x){classes.add(x)},remove(x){classes.delete(x)},toggle(){}},setAttribute(){},replaceChildren(){},querySelectorAll(){return []},addEventListener(kind,cb){handlers[id+':'+kind]=cb},appendChild(){},remove(){},click(){}};
global.document = {getElementById:element,querySelector:element,querySelectorAll:()=>[],body:element('body'),createElement:()=>element('anchor')};
let printed = false, blob;
global.window = {scrollTo(){},setTimeout(){},addEventListener(){},print(){printed=true;assert.ok(classes.has('printing-memo'));assert.equal(elements['memo-decision-code'].textContent,'QUALITY BELOW MINIMUM')}};
global.URL = {createObjectURL(b){blob=b;return 'blob:test'},revokeObjectURL(){}};
let source = fs.readFileSync('web/app.js','utf8');
source = source.replace('  function renderAll() {','  globalThis.useRecord = d => {state.data=d;renderAll()};\n  function renderAll() {');
source = source.replace('  loadDemo().catch((error) => showToast(error.message));','');
eval(source);
(async()=>{
 const data = JSON.parse(fs.readFileSync('web/data/illustrative-review-result.json','utf8'));
 useRecord(data);
 handlers['download-review:click']();
 const saved = JSON.parse(await blob.text());
 assert.equal(saved.comparison.decision_code,'QUALITY BELOW MINIMUM');
 assert.deepEqual(saved.baseline.costs,data.baseline.costs);
 assert.equal(elements.anchor.download,'ai-cost-lens-customer-due-diligence-case-summaries.json');
 handlers['print-memo:click']();assert.ok(printed);
 await handlers['review-file:change']({target:{files:[{text:async()=>'{invalid',name:'bad.json'}],value:'bad.json'}});
 assert.match(elements.toast.textContent,/valid JSON/);
 assert.equal(elements['decision-code'].textContent,'QUALITY BELOW MINIMUM');
})().catch(e=>{console.error(e);process.exit(1)});
"""
    result = subprocess.run(
        ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
    )
    assert result.returncode == 0, result.stdout + result.stderr
