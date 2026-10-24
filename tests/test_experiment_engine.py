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
function empty() { const r=copy(example); r.runs=[]; return e.restoreExperiment(r); }
function trial(id='one', extra={}) {
  return {id, partition:'validation', independent_execution:true,
    reserved_before_tuning:true, baseline_cost:.40, candidate_cost:.22,
    cost_source:'Recorded execution', ...extra};
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
