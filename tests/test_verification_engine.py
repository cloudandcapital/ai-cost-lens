from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]
WEB = ROOT / "web"
ENGINE = WEB / "verification-engine.js"


def run_node(script: str) -> dict:
    result = subprocess.run(
        ["node", "-e", script, str(ENGINE)],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_paired_verification_runs_deterministic_and_human_quality_gates():
    payload = run_node(r"""
const engine = require(process.argv[1]);
const rows = [
  {case_id: "case-1", route: "baseline", output_text: '{"summary":"ok","risk":{"level":"low"}}', expected_format: "json", required_terms: "summary", forbidden_terms: "secret", required_json_fields: "summary;risk.level", max_characters: "100", outcome_status: "ready_to_use", human_minutes: "2"},
  {case_id: "case-1", route: "candidate", output_text: '{"summary":"ok","risk":{"level":"low"}}', expected_format: "json", required_terms: "summary", forbidden_terms: "secret", required_json_fields: "summary;risk.level", max_characters: "100", outcome_status: "ready_to_use", human_minutes: "1"},
  {case_id: "case-2", route: "baseline", output_text: "approved", exact_label: "approved", outcome_status: "ready_to_use", human_minutes: "2"},
  {case_id: "case-2", route: "candidate", output_text: "approved", exact_label: "approved", outcome_status: "needs_correction", human_minutes: "3"},
];
console.log(JSON.stringify(engine.buildVerification(rows, {
  generated_at: "2026-09-21T00:00:00.000Z", source_file_hash: "abc",
  sample_method: "random_or_systematic", blinded: true, randomized_order: true,
  minimum_deterministic_pass_rate: 1, minimum_ready_rate: .5, maximum_ready_rate_regression: .5,
})));
""")
    assert payload["schema_version"] == "ai-cost-lens-verification/1.0"
    assert payload["baseline"]["deterministic_pass_rate"] == 1
    assert payload["candidate"]["deterministic_pass_rate"] == 1
    assert payload["baseline"]["ready_rate"] == 1
    assert payload["candidate"]["ready_rate"] == 0.5
    assert payload["comparison"]["quality_gate_passed"] is True
    assert payload["comparison"]["status"] == "DIRECTIONAL_PASS"
    assert payload["comparison"]["human_minutes_difference"] == 0
    assert payload["evidence_gate"]["savings_claim_allowed"] is False
    assert payload["privacy"] == {
        "parsed_locally": True,
        "output_text_stored": False,
        "source_file_uploaded": False,
    }
    schema = json.loads(
        (ROOT / "schemas" / "ai-cost-lens-verification-1.0.schema.json").read_text()
    )
    assert set(payload) == set(schema["required"])
    assert set(payload["method"]) == set(schema["properties"]["method"]["required"])
    assert set(payload["comparison"]) == set(
        schema["properties"]["comparison"]["required"]
    )
    serialized = json.dumps(payload)
    assert '"output_text"' not in serialized
    assert '{"summary"' not in serialized


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_verification_fails_candidate_regression_and_names_affected_cases():
    payload = run_node(r"""
const engine = require(process.argv[1]);
const rows = [
  {case_id: "alpha", route: "baseline", output_text: "ALLOW", exact_label: "ALLOW", outcome_status: "ready_to_use"},
  {case_id: "alpha", route: "candidate", output_text: "DENY", exact_label: "ALLOW", outcome_status: "needs_escalation"},
];
console.log(JSON.stringify(engine.buildVerification(rows, {
  minimum_deterministic_pass_rate: 1, minimum_ready_rate: .9, maximum_ready_rate_regression: 0,
})));
""")
    assert payload["comparison"]["status"] == "QUALITY_FAIL"
    assert payload["comparison"]["deterministic_gate_passed"] is False
    assert payload["comparison"]["outcome_gate_passed"] is False
    assert payload["comparison"]["quality_gate_passed"] is False
    assert payload["comparison"]["failed_candidate_case_ids"] == ["alpha"]
    assert payload["evidence_gate"]["decision"] == "KEEP_BASELINE"


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_verification_rejects_unpaired_duplicate_and_rule_mismatch_rows():
    payload = run_node(r"""
const engine = require(process.argv[1]);
const caught = {};
for (const [key, rows] of Object.entries({
  unpaired: [{case_id: "x", route: "baseline", output_text: "ok"}],
  duplicate: [
    {case_id: "x", route: "baseline", output_text: "ok"},
    {case_id: "x", route: "baseline", output_text: "ok"},
    {case_id: "x", route: "candidate", output_text: "ok"},
  ],
  mismatch: [
    {case_id: "x", route: "baseline", output_text: "ok", max_characters: 5},
    {case_id: "x", route: "candidate", output_text: "ok", max_characters: 10},
  ],
  nested: [
    {case_id: "x", route: "baseline", output_text: "ok", metadata: {secret: true}},
    {case_id: "x", route: "candidate", output_text: "ok"},
  ],
})) {
  try { engine.buildVerification(rows); caught[key] = false; }
  catch (_error) { caught[key] = true; }
}
console.log(JSON.stringify(caught));
""")
    assert payload == {
        "unpaired": True,
        "duplicate": True,
        "mismatch": True,
        "nested": True,
    }


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_builtin_blind_review_randomizes_labels_and_discards_outputs_from_record():
    payload = run_node(r"""
const engine = require(process.argv[1]);
const rows = [
  {case_id: "one", route: "baseline", output_text: "baseline secret one", required_terms: "secret"},
  {case_id: "one", route: "candidate", output_text: "candidate secret one", required_terms: "secret"},
  {case_id: "two", route: "baseline", output_text: "baseline secret two", required_terms: "secret"},
  {case_id: "two", route: "candidate", output_text: "candidate secret two", required_terms: "secret"},
];
const session = engine.prepareBlindReview(rows, {random_values: [.9, .1], created_at: "2026-09-21T00:00:00Z"});
const record = engine.completeBlindReview(session, [
  {case_id: "one", slot: "A", outcome_status: "ready_to_use", human_minutes: 1},
  {case_id: "one", slot: "B", outcome_status: "needs_correction", human_minutes: 2},
  {case_id: "two", slot: "A", outcome_status: "ready_to_use", human_minutes: 1},
  {case_id: "two", slot: "B", outcome_status: "ready_to_use", human_minutes: 1},
], {sample_method: "random_or_systematic", generated_at: "2026-09-21T00:00:00Z"});
console.log(JSON.stringify({session, record}));
""")
    session = payload["session"]
    assert session["cases"][0]["presentations"][0]["route"] == "candidate"
    assert session["cases"][1]["presentations"][0]["route"] == "baseline"
    record = payload["record"]
    assert record["method"]["blinded"] is True
    assert record["method"]["randomized_order"] is True
    assert record["baseline"]["outcome_counts"] == {
        "ready_to_use": 1,
        "needs_correction": 1,
        "needs_escalation": 0,
    }
    assert record["candidate"]["outcome_counts"] == {
        "ready_to_use": 2,
        "needs_correction": 0,
        "needs_escalation": 0,
    }
    assert "baseline secret" not in json.dumps(record)
    assert "candidate secret" not in json.dumps(record)
    assert record["privacy"]["output_text_stored"] is False


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_verification_engine_has_valid_syntax():
    result = subprocess.run(
        ["node", "--check", str(ENGINE)],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr


def test_verification_template_has_no_fake_results():
    template = WEB / "templates" / "ai-cost-lens-verification-template.csv"
    html = (WEB / "index.html").read_text()
    app = (WEB / "app.js").read_text()
    assert template.is_file()
    lines = template.read_text().splitlines()
    assert len(lines) == 1
    assert lines[0].startswith("case_id,route,output_text")
    assert 'id="start-blind-verification"' in html
    assert 'id="verification-blind-review"' in html
    assert 'id="verification-blind-progress" aria-live="polite"' in html
    assert 'id="cancel-blind-review"' in html
    assert "prepareBlindReview" in app
    assert "completeBlindReview" in app
    assert "preserveColumns: verificationEngine.aliases.output_text" in app
    assert 'aria-labelledby="blind-output-label-${presentation.slot}"' in app
    assert "clearBlindReviewSession({ clearFile: true })" in app
    assert "resetVerificationMethodDeclarations" in app
    assert "state.pendingVerification = cloneData(record)" in app
    assert (
        "state.data.verification_evidence = cloneData(state.pendingVerification)" in app
    )
    assert "paired verification record supports the quality sample only" in app


def test_verification_schema_is_versioned_private_and_fail_closed():
    schema = json.loads(
        (ROOT / "schemas" / "ai-cost-lens-verification-1.0.schema.json").read_text()
    )
    assert schema["additionalProperties"] is False
    assert (
        schema["properties"]["schema_version"]["const"]
        == "ai-cost-lens-verification/1.0"
    )
    assert (
        schema["properties"]["evidence_gate"]["properties"]["savings_claim_allowed"][
            "const"
        ]
        is False
    )
    assert (
        schema["properties"]["privacy"]["properties"]["output_text_stored"]["const"]
        is False
    )
    assert (
        schema["properties"]["privacy"]["properties"]["source_file_uploaded"]["const"]
        is False
    )
    assert '"output_text":' not in json.dumps(schema)
