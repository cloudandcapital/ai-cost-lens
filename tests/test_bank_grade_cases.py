from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]
WEB = ROOT / "web"
CASES = ROOT / "examples" / "bank-grade"


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_bank_grade_cases_produce_the_expected_finance_decisions():
    script = r"""
const fs = require("fs");
let source = fs.readFileSync(process.argv[1], "utf8");
source = source.replace(
  "  function validateResult(data) {",
  "  globalThis.__buildLocalReview = buildLocalReview; globalThis.__buildSampledReview = buildSampledReview; return;\n  function validateResult(data) {",
);
eval(source);

(async () => {
  const root = process.argv[2];
  const detailed = async (spend, outcomes, config) => {
    const result = await globalThis.__buildLocalReview(
      fs.readFileSync(`${root}/${spend}`, "utf8"),
      fs.readFileSync(`${root}/${outcomes}`, "utf8"),
      JSON.parse(fs.readFileSync(`${root}/${config}`, "utf8")),
    );
    return result;
  };
  const falseEconomy = await detailed("false-economy-spend.csv", "false-economy-outcomes.csv", "false-economy-config.json");
  const trueSavings = await detailed("true-savings-spend.csv", "true-savings-outcomes.csv", "true-savings-config.json");
  const policyGate = await detailed("true-savings-spend.csv", "true-savings-outcomes.csv", "policy-gate-config.json");
  const weakInputs = JSON.parse(fs.readFileSync(`${root}/weak-sample-inputs.json`, "utf8"));
  const weakSample = await globalThis.__buildSampledReview(
    fs.readFileSync(`${root}/weak-sample-spend.csv`, "utf8"),
    weakInputs.samples,
    weakInputs.config,
  );
  console.log(JSON.stringify({ falseEconomy, trueSavings, policyGate, weakSample }));
})();
"""
    result = subprocess.run(
        ["node", "-e", script, str(WEB / "app.js"), str(CASES)],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)

    false_economy = payload["falseEconomy"]
    assert (
        false_economy["proposed"]["costs"]["model_cost"]
        < false_economy["baseline"]["costs"]["model_cost"]
    )
    assert false_economy["comparison"]["cost_per_usable_result_change_pct"] > 0
    assert false_economy["comparison"]["savings_claim_allowed"] is False
    assert false_economy["comparison"]["status"] == "no_improvement"

    true_savings = payload["trueSavings"]
    assert true_savings["comparison"]["savings_claim_allowed"] is True
    assert true_savings["comparison"]["status"] == "observed_improvement"
    assert true_savings["comparison"]["payback_usable_results"] == 2542

    policy_gate = payload["policyGate"]
    assert policy_gate["comparison"]["quality_holds"] is True
    assert policy_gate["comparison"]["both_policy_approved"] is False
    assert policy_gate["comparison"]["savings_claim_allowed"] is False

    weak_sample = payload["weakSample"]
    assert weak_sample["comparison"]["outcome_evidence_basis"] == "sampled"
    assert weak_sample["comparison"]["savings_claim_allowed"] is False
    assert weak_sample["proposed"]["outcomes"]["sample_method"] == "user selected"
