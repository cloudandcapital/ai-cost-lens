from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).parents[1]
PRELUDE = r"""
const e = require('./web/experiment-engine.js');
const v = require('./web/verification-engine.js');
const example = e.illustrativeExample(v);
const copy = value => JSON.parse(JSON.stringify(value));
function empty() { const r=copy(example); r.mode='user_supplied'; r.runs=[]; return e.restoreExperiment(r); }
function trial(id='one', extra={}) {
  return {id, partition:'validation', independent_execution:true,
    reserved_before_tuning:true, baseline_cost:.40, candidate_cost:.22,
    cost_source:'Recorded execution', matching_evidence_confirmed:true, ...extra};
}
function evidence(id='new') { const r=copy(example.runs[0].verification); r.source.sha256=id; return r; }
function caught(fn) { try { fn(); return null; } catch (err) {return err.message;} }
"""


def run_node(script: str) -> dict:
    result = subprocess.run(
        ["node", "-e", PRELUDE + script],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_repeated_examples_count_distinct_tasks_and_never_authorize_savings():
    result = run_node("console.log(JSON.stringify(example));")
    assert result["summary"]["decision"] == "REVIEW_CANDIDATE"
    assert result["summary"]["validation_runs"] == 2
    assert result["summary"]["unique_validation_cases"] == 40
    assert result["summary"]["validation_observations"] == 80
    assert result["summary"]["runs"][0]["baseline_api_cost_per_ready"] == 0.01
    assert result["summary"]["runs"][0]["candidate_api_cost_per_ready"] == 0.0055
    assert result["evidence_gate"]["savings_claim_allowed"] is False
    assert result["evidence_gate"]["route_change_approved"] is False
    assert result["mode"] == "illustrative"
    assert "confidence_interval" not in json.dumps(result)


def test_small_nonzero_api_unit_costs_keep_precision():
    result = run_node(
        "const r=e.addRun(empty(),trial('tiny',{baseline_cost:1e-7,candidate_cost:4e-8}),evidence());"
        "console.log(JSON.stringify(r.summary.runs[0]));"
    )
    assert result["baseline_api_cost_per_ready"] == 2.5e-9
    assert result["candidate_api_cost_per_ready"] == 1e-9
    assert result["lower_api_unit_cost"] is True


def test_plan_rejects_multiple_changes_and_wrong_change_kind():
    result = run_node(r"""
const raw={...example.plan,...example.plan.thresholds};
const multiple=copy(raw); multiple.candidate.model='Another model';
const wrong=copy(raw); wrong.change_kind='effort';
const unconfirmed=copy(raw); unconfirmed.other_settings_unchanged=false;
console.log(JSON.stringify({multiple:caught(()=>e.createExperiment(multiple)),
  wrong:caught(()=>e.createExperiment(wrong)), unconfirmed:caught(()=>e.createExperiment(unconfirmed))}));
""")
    assert "exactly one" in result["multiple"]
    assert "exactly one" in result["wrong"]
    assert "Confirm" in result["unconfirmed"]


def test_holdout_leakage_case_changes_and_rule_changes_are_blocked():
    result = run_node(r"""
const tuning=e.addRun(empty(),trial('tuning',{partition:'tuning'}),evidence('tuning'));
const first=e.addRun(empty(),trial(),evidence('first'));
const changed=evidence('different'); changed.cases[0].rule.exact_label='different rubric';
const newCases=evidence('new cases'); newCases.cases[0].case_id='new case';
console.log(JSON.stringify({
  leakage:caught(()=>e.addRun(tuning,trial('validation'),evidence('validation'))),
  retuning:caught(()=>e.addRun(first,trial('later',{partition:'tuning'}),evidence('later'))),
  changedRule:caught(()=>e.addRun(first,trial('two'),changed)),
  changedCases:caught(()=>e.addRun(first,trial('two'),newCases))
}));
""")
    assert "different case IDs" in result["leakage"]
    assert "Validation has started" in result["retuning"]
    assert "same cases" in result["changedRule"]
    assert "same cases" in result["changedCases"]


def test_duplicate_execution_and_unconfirmed_evidence_cannot_add_repetitions():
    result = run_node(r"""
const one=e.addRun(empty(),trial(),evidence('first'));
console.log(JSON.stringify({
  id:caught(()=>e.addRun(one,trial(),evidence('second'))),
  source:caught(()=>e.addRun(one,trial('two'),evidence('first'))),
  independent:caught(()=>e.addRun(empty(),trial('one',{independent_execution:false}),evidence())),
  reserved:caught(()=>e.addRun(empty(),trial('one',{reserved_before_tuning:false}),evidence()))
}));
""")
    assert "already recorded" in result["id"]
    assert "already been recorded" in result["source"]
    assert "new execution" in result["independent"]
    assert "reserved before tuning" in result["reserved"]


def test_forged_summary_cannot_hide_a_quality_regression_on_reopen():
    result = run_node(r"""
const tampered=copy(example);
tampered.runs[1].verification.cases[0].candidate.checks[0].passed=false;
tampered.runs[1].verification.cases[0].candidate.outcome_status='needs_escalation';
tampered.summary.decision='REVIEW_CANDIDATE';
tampered.evidence_gate.savings_claim_allowed=true;
console.log(JSON.stringify(e.restoreExperiment(tampered)));
""")
    assert result["summary"]["decision"] == "REJECT_CHANGE"
    assert result["summary"]["runs"][1]["quality_held"] is False
    assert result["evidence_gate"]["savings_claim_allowed"] is False


def test_small_samples_single_runs_and_unblinded_samples_remain_directional():
    result = run_node(r"""
const one=e.addRun(empty(),trial(),evidence('one'));
let small=empty(),unblinded=empty();
for(let n=1;n<=3;n++) {
  const a=evidence('small-'+n); a.cases=a.cases.slice(0,10);
  small=e.addRun(small,trial('small-'+n),a);
  const b=evidence('open-'+n); b.method.blinded=false;
  unblinded=e.addRun(unblinded,trial('open-'+n),b);
}
console.log(JSON.stringify({one:one.summary,small:small.summary,unblinded:unblinded.summary}));
""")
    assert result["one"]["decision"] == "NEEDS_MORE_EVIDENCE"
    assert result["small"]["decision"] == "NEEDS_MORE_EVIDENCE"
    assert result["small"]["unique_validation_cases"] == 10
    assert result["unblinded"]["decision"] == "NEEDS_MORE_EVIDENCE"


def test_higher_unit_cost_cannot_be_hidden_by_a_quality_pass():
    result = run_node(r"""
const r=e.addRun(empty(),trial('expensive',{candidate_cost:.50}),evidence());
console.log(JSON.stringify(r.summary));
""")
    assert result["decision"] == "REJECT_CHANGE"
    assert result["runs"][0]["quality_held"] is True
    assert result["runs"][0]["lower_api_unit_cost"] is False


def test_missing_cost_is_unknown_and_invalid_financial_types_are_rejected():
    result = run_node(r"""
console.log(JSON.stringify({
  missing:caught(()=>e.addRun(empty(),trial('x',{baseline_cost:''}),evidence())),
  negative:caught(()=>e.addRun(empty(),trial('x',{baseline_cost:-1}),evidence())),
  array:caught(()=>e.addRun(empty(),trial('x',{baseline_cost:[1]}),evidence())),
  currency:caught(()=>e.createExperiment({...example.plan,...example.plan.thresholds,currency:'US'})),
  zero:e.addRun(empty(),trial('free',{candidate_cost:0}),evidence()).summary.runs[0].candidate_api_cost_per_ready
}));
""")
    assert "required" in result["missing"]
    assert "non-negative" in result["negative"]
    assert "must be a number" in result["array"]
    assert "three-letter" in result["currency"]
    assert result["zero"] == 0


def test_saved_record_rebuild_drops_unknown_raw_output_fields():
    result = run_node(r"""
const raw=copy(example);
raw.raw_output='DO_NOT_SAVE_THIS_OUTPUT';
raw.runs[0].verification.cases[0].candidate.output_text='DO_NOT_SAVE_THIS_OUTPUT';
raw.runs[0].verification.cases[0].candidate.checks[0].label='DO_NOT_SAVE_THIS_OUTPUT';
raw.runs[0].verification.metadata={prompt:'DO_NOT_SAVE_THIS_OUTPUT'};
const restored=e.restoreExperiment(raw);
console.log(JSON.stringify({record:restored,contains:JSON.stringify(restored).includes('DO_NOT_SAVE_THIS_OUTPUT')}));
""")
    assert result["contains"] is False
    assert result["record"]["privacy"]["outputs_stored"] is False


def test_missing_human_outcomes_and_duplicate_checks_are_rejected():
    result = run_node(r"""
const missing=evidence(); missing.cases[0].candidate.outcome_status=null;
const repeated=evidence(); repeated.cases[0].candidate.checks.push(copy(repeated.cases[0].candidate.checks[0]));
console.log(JSON.stringify({missing:caught(()=>e.addRun(empty(),trial(),missing)),
  repeated:caught(()=>e.addRun(empty(),trial(),repeated))}));
""")
    assert "human outcomes" in result["missing"]
    assert "duplicate checks" in result["repeated"]


def test_resaved_or_hashless_matching_evidence_needs_a_separate_confirmation():
    result = run_node(r"""
const one=e.addRun(empty(),trial('one'),evidence('LF bytes'));
const crlf=evidence('CRLF bytes');
const hashless=evidence(); delete hashless.source.sha256;
const before=JSON.stringify(one);
console.log(JSON.stringify({
  resaved:caught(()=>e.addRun(one,trial('two',{matching_evidence_confirmed:false}),crlf)),
  hashless:caught(()=>e.addRun(one,trial('two',{matching_evidence_confirmed:false}),hashless)),
  unchanged:before===JSON.stringify(one),
  confirmed:e.addRun(one,trial('two'),crlf)
}));
""")
    assert "re-saved file is not another execution" in result["resaved"]
    assert "match one" in result["hashless"]
    assert result["unchanged"] is True
    assert result["confirmed"]["runs"][1]["matching_evidence_confirmed"] is True
    assert result["confirmed"]["summary"]["unique_validation_cases"] == 40
    assert "not independently verified" in " ".join(
        result["confirmed"]["summary"]["warnings"]
    )


def test_reopened_matching_runs_without_the_new_confirmation_do_not_gain_a_verdict():
    result = run_node(r"""
const raw=copy(example); raw.mode='user_supplied';
raw.runs.forEach(r=>delete r.matching_evidence_confirmed);
raw.summary.decision='REVIEW_CANDIDATE';
console.log(JSON.stringify(e.restoreExperiment(raw)));
""")
    assert result["summary"]["decision"] == "NEEDS_MORE_EVIDENCE"
    assert "do not have the separate" in result["summary"]["reason"]


def test_zero_ready_candidate_rejects_even_with_zero_quality_floors():
    result = run_node(r"""
const raw=copy(example); raw.mode='user_supplied';raw.runs=[];
raw.plan.thresholds={minimum_deterministic_pass_rate:0,minimum_ready_rate:0,maximum_ready_rate_regression:1};
let record=e.restoreExperiment(raw);
for(let i=1;i<=2;i++) {
 const ev=evidence('zero-'+i);ev.cases.forEach(c=>c.candidate.outcome_status='needs_escalation');
 record=e.addRun(record,trial('zero-'+i),ev);
}
console.log(JSON.stringify(record));
""")
    assert result["summary"]["decision"] == "REJECT_CHANGE"
    assert "zero ready results" in result["summary"]["reason"]
    assert result["summary"]["runs"][0]["quality_held"] is False
    assert result["summary"]["runs"][0]["candidate_api_cost_per_ready"] is None
    assert "0%" in " ".join(result["summary"]["warnings"])


def test_no_ready_baseline_explains_the_unavailable_cost_comparison():
    result = run_node(r"""
let record=empty();
for(let i=1;i<=2;i++) {
 const ev=evidence('no-base-'+i);ev.cases.forEach(c=>c.baseline.outcome_status='needs_escalation');
 record=e.addRun(record,trial('no-base-'+i),ev);
}
console.log(JSON.stringify(record.summary));
""")
    assert result["decision"] == "NEEDS_MORE_EVIDENCE"
    assert "starting setup has no ready results" in result["reason"]
    assert "two new runs" not in result["reason"]


def test_rejection_reasons_distinguish_quality_and_cost_failures():
    result = run_node(r"""
const bad=evidence();bad.cases[0].candidate.outcome_status='needs_escalation';
console.log(JSON.stringify({quality:e.addRun(empty(),trial('quality'),bad).summary,
cost:e.addRun(empty(),trial('cost',{candidate_cost:.5}),evidence()).summary}));
""")
    assert "locked quality thresholds" in result["quality"]["reason"]
    assert "did not decrease" not in result["quality"]["reason"]
    assert "API cost per ready result did not decrease" in result["cost"]["reason"]
    assert "failed the locked quality" not in result["cost"]["reason"]


def test_illustrative_record_is_read_only_but_reopens_and_exports():
    result = run_node(r"""
console.log(JSON.stringify({blocked:caught(()=>e.addRun(example,trial('own'),evidence())),
 reopened:e.restoreExperiment(e.exportExperiment(example)).summary.decision,
 containsOutput:JSON.stringify(e.exportExperiment(example)).includes('output_text')}));
""")
    assert "read-only" in result["blocked"]
    assert result["reopened"] == "REVIEW_CANDIDATE"
    assert result["containsOutput"] is False


def test_edit_check_covers_cases_and_example_status_without_claiming_authentication():
    result = run_node(r"""
const saved=e.exportExperiment(example);
const edited=copy(saved);edited.runs[0].verification.cases[0].candidate.outcome_status='needs_correction';
const mode=copy(saved);mode.mode='user_supplied';
const noCheck=copy(saved);delete noCheck.integrity;
console.log(JSON.stringify({same:e.restoreExperiment(saved).integrity_check,
 edited:e.restoreExperiment(edited).integrity_check,
 mode:e.restoreExperiment(mode).integrity_check,
 noCheck:e.restoreExperiment(noCheck).integrity_check}));
""")
    assert result["same"]["status"] == "matches"
    assert "not a signature" in result["same"]["note"]
    assert result["edited"]["status"] == "changed"
    assert result["mode"]["status"] == "changed"
    assert result["noCheck"]["status"] == "unavailable"
    assert "not authenticated" in result["noCheck"]["note"]


def test_totals_and_relative_change_remain_precise_for_tiny_costs():
    result = run_node(r"""
const r=e.addRun(empty(),trial('tiny',{baseline_cost:4e-8,candidate_cost:3e-8}),evidence());
console.log(JSON.stringify(r.summary.runs[0]));
""")
    assert result["baseline_api_cost"] == 4e-8
    assert result["candidate_api_cost"] == 3e-8
    assert abs(result["api_unit_cost_change_fraction"] + 0.25) < 1e-12


def test_blank_unchanged_settings_inherit_but_the_changed_setting_is_named():
    result = run_node(r"""
const raw={...example.plan,...example.plan.thresholds};raw.candidate=copy(raw.candidate);raw.candidate.model='';
const ok=e.createExperiment(raw);
const bad=copy(raw);bad.change_kind='model';bad.candidate.caching=bad.baseline.caching;
console.log(JSON.stringify({model:ok.plan.candidate.model,error:caught(()=>e.createExperiment(bad))}));
""")
    assert result["model"] == "Same example model"
    assert "Model needs different before and after" in result["error"]


def test_changed_and_unchecked_import_history_survives_downloads_and_new_runs():
    result = run_node(r"""
const native=e.createExperiment({...example.plan,...example.plan.thresholds,mode:'user_supplied'});
const clean=e.exportExperiment(e.addRun(native,trial('first'),evidence('first')));
const scenarios={};
for (const kind of ['changed','unavailable','relabelled']) {
  const raw=copy(kind==='relabelled' ? e.exportExperiment(example) : clean);
  if (kind==='changed') raw.runs[0].candidate_cost=.21;
  if (kind==='unavailable') delete raw.integrity;
  if (kind==='relabelled') raw.mode='user_supplied';
  raw.integrity_check={status:'matches',reopened_from:null,note:'Forged clean notice'};
  let record=e.restoreExperiment(raw);
  const first=record.integrity_check;
  const rounds=[];
  for (let index=0;index<4;index++) {
    const saved=e.exportExperiment(record);
    record=e.restoreExperiment(saved);
    rounds.push({origin:saved.integrity.reopened_from,stale:Object.hasOwn(saved,'integrity_check'),check:record.integrity_check});
  }
  record=e.addRun(record,trial('additional'),evidence('additional-'+kind));
  const final=e.restoreExperiment(e.exportExperiment(record));
  scenarios[kind]={first,rounds,afterNewRun:final.integrity_check};
}
console.log(JSON.stringify(scenarios));
""")
    for kind, scenario in result.items():
        origin = "unavailable" if kind == "unavailable" else "changed"
        assert scenario["first"]["status"] == origin
        for saved in scenario["rounds"]:
            assert saved["origin"] == origin
            assert saved["stale"] is False
            assert saved["check"]["status"] == "matches"
            assert saved["check"]["reopened_from"] == origin
            assert "An earlier import" in saved["check"]["note"]
            assert "does not clear that warning" in saved["check"]["note"]
        assert scenario["afterNewRun"]["reopened_from"] == origin
        assert "An earlier import" in scenario["afterNewRun"]["note"]


def test_fresh_exports_do_not_claim_an_import_or_include_runtime_notices():
    result = run_node(r"""
const saved=e.exportExperiment(example);
const again=e.exportExperiment(e.restoreExperiment(saved));
console.log(JSON.stringify({saved,again,check:e.restoreExperiment(again).integrity_check}));
""")
    for key in ["saved", "again"]:
        assert "integrity_check" not in result[key]
        assert "reopened_from" not in result[key]["integrity"]
    assert result["check"]["status"] == "matches"
    assert result["check"]["reopened_from"] is None
    assert "earlier import" not in result["check"]["note"]


def test_removing_or_invalidating_import_history_does_not_match_its_edit_check():
    result = run_node(r"""
const raw=e.exportExperiment(example);delete raw.integrity;
const saved=e.exportExperiment(e.restoreExperiment(raw));
const removed=copy(saved);delete removed.integrity.reopened_from;
const forged=copy(saved);forged.integrity.reopened_from='matches';
console.log(JSON.stringify({removed:e.restoreExperiment(removed).integrity_check,
 forged:e.restoreExperiment(forged).integrity_check}));
""")
    for check in result.values():
        assert check["status"] == "changed"
        assert check["reopened_from"] == "changed"


def test_setup_errors_name_extra_fields_and_preserve_exact_model_names():
    result = run_node(r"""
const raw={...example.plan,...example.plan.thresholds};
raw.baseline={...raw.baseline,model:'example-model-a'};
raw.candidate={...raw.candidate,model:'Example-Model-A'};
const multiple=copy(raw);multiple.candidate.effort='Changed effort';
const unchanged=copy(raw);unchanged.candidate.model=unchanged.baseline.model;unchanged.candidate.caching=unchanged.baseline.caching;
console.log(JSON.stringify({casing:caught(()=>e.createExperiment(raw)),
 multiple:caught(()=>e.createExperiment(multiple)),unchanged:caught(()=>e.createExperiment(unchanged))}));
""")
    assert "Model also differs" in result["casing"]
    assert "capitalization" in result["casing"]
    assert "Caching needs different" not in result["casing"]
    assert "Model, Effort also differ" in result["multiple"]
    assert "Caching needs different" in result["unchanged"]


def test_invented_repeats_have_own_wording_and_per_run_markers():
    result = run_node("console.log(JSON.stringify(example));")
    notice = " ".join(result["summary"]["warnings"])
    assert "runs and declarations are made up" in notice
    assert "declared by the user" not in notice
    assert result["summary"]["runs"][0]["matching_evidence_confirmed"] is False
    assert result["summary"]["runs"][1]["matching_evidence_confirmed"] is True


def test_unchanged_selected_setting_explains_the_change_and_the_alternative():
    result = run_node(r"""
const raw={...example.plan,...example.plan.thresholds};
raw.candidate={...raw.candidate,caching:raw.baseline.caching,model:'Another model'};
const multiple=copy(raw);multiple.candidate.effort='Another effort';
const missing=copy(raw);missing.baseline.caching=null;missing.candidate.caching=null;
console.log(JSON.stringify({single:caught(()=>e.createExperiment(raw)),
 multiple:caught(()=>e.createExperiment(multiple)),missing:caught(()=>e.createExperiment(missing))}));
""")
    for key in ["single", "missing"]:
        assert "Caching needs different before and after values" in result[key]
        assert "Model also differs" in result[key]
        assert "or choose Model as the change to test" in result[key]
    assert "Caching needs different before and after values" in result["multiple"]
    assert "Model, Effort also differ" in result["multiple"]
    assert "Choose one setting to test" in result["multiple"]
