(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AICostLensExperiments = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SCHEMA = "ai-cost-lens-experiment/1.0";
  const fields = ["model", "effort", "prompt_version", "caching", "processing"];
  const changes = { model: "model", effort: "effort", prompt: "prompt_version", caching: "caching", batch: "processing" };
  const round = (n) => Number(n.toFixed(8));

  function text(value, label, max = 240, optional = false) {
    if (value === null || value === undefined || String(value).trim() === "") {
      if (optional) return null;
      throw new Error(`${label} is required.`);
    }
    if (typeof value !== "string" || value.trim().length > max) throw new Error(`${label} must be text of at most ${max} characters.`);
    return value.trim();
  }

  function number(value, label, max = Infinity) {
    if (value === null || value === undefined || typeof value === "boolean" || String(value).trim() === "") throw new Error(`${label} is required; enter zero only when confirmed.`);
    if (!["string", "number"].includes(typeof value)) throw new Error(`${label} must be a number.`);
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > max) throw new Error(`${label} must be a non-negative number${Number.isFinite(max) ? ` no greater than ${max}` : ""}.`);
    return n;
  }

  function setup(raw, label) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${label} settings are required.`);
    const result = { label: text(raw.label, `${label} label`) };
    fields.forEach((field) => { result[field] = text(raw[field], `${label} ${field.replaceAll("_", " ")}`, 160, true); });
    return result;
  }

  function createExperiment(raw) {
    if (!raw || typeof raw !== "object") throw new Error("A test plan is required.");
    if (!Object.hasOwn(changes, raw.change_kind)) throw new Error("Choose one supported change: caching, batch, prompt, effort, or model.");
    const baseline = setup(raw.baseline, "Starting setup");
    const candidate = setup(raw.candidate, "Changed setup");
    const different = fields.filter((field) => baseline[field] !== candidate[field]);
    if (different.length !== 1 || different[0] !== changes[raw.change_kind] || !baseline[different[0]] || !candidate[different[0]]) {
      throw new Error("Record exactly one changed setting, matching the selected change. Supply both its before and after values.");
    }
    if (raw.other_settings_unchanged !== true) throw new Error("Confirm that the other settings and task requirements stayed the same.");
    const currency = text(raw.currency, "Currency", 3).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Currency must be a three-letter code.");
    const mode = raw.mode || "user_supplied";
    if (!["user_supplied", "illustrative"].includes(mode)) throw new Error("Unsupported test evidence mode.");
    return recompute({
      schema_version: SCHEMA,
      generated_at: text(raw.generated_at || new Date().toISOString(), "Created at", 40),
      mode,
      plan: {
        workload: text(raw.workload, "Workload"),
        quality_rule: text(raw.quality_rule, "Ready-result rule", 1000),
        change_kind: raw.change_kind,
        currency,
        baseline,
        candidate,
        other_settings_unchanged: true,
        thresholds: {
          minimum_deterministic_pass_rate: number(raw.minimum_deterministic_pass_rate, "Minimum check pass rate", 1),
          minimum_ready_rate: number(raw.minimum_ready_rate, "Minimum ready-result rate", 1),
          maximum_ready_rate_regression: number(raw.maximum_ready_rate_regression, "Maximum ready-rate regression", 1),
        },
      },
      runs: [],
    });
  }

  // Recompute quality from output-free per-case evidence, never from an imported headline.
  function qualityEvidence(raw) {
    if (!raw || raw.schema_version !== "ai-cost-lens-verification/1.0" || !Array.isArray(raw.cases) || !raw.cases.length || raw.cases.length > 1000) {
      throw new Error("Use a completed AI Cost Lens paired verification record with at most 1,000 cases.");
    }
    const ids = new Set();
    const cases = raw.cases.map((item) => {
      const caseId = text(item.case_id, "Case ID", 160);
      if (ids.has(caseId)) throw new Error(`Case ${caseId} appears more than once in the verification record.`);
      ids.add(caseId);
      const result = { case_id: caseId };
      for (const route of ["baseline", "candidate"]) {
        const source = item[route];
        if (!source || !Array.isArray(source.checks) || !source.checks.length || source.checks.length > 128) throw new Error(`Case ${caseId} needs a bounded set of checks on both setups.`);
        const checks = source.checks.map((check) => {
          if (typeof check.passed !== "boolean") throw new Error(`Case ${caseId} has an invalid check result.`);
          return { id: text(check.id, "Check ID", 240), passed: check.passed };
        }).sort((a, b) => a.id.localeCompare(b.id));
        if (new Set(checks.map((check) => check.id)).size !== checks.length) throw new Error(`Case ${caseId} has duplicate checks.`);
        if (!["ready_to_use", "needs_correction", "needs_escalation"].includes(source.outcome_status)) throw new Error(`Case ${caseId} needs human outcomes on both setups.`);
        result[route] = {
          checks,
          outcome_status: source.outcome_status,
          human_minutes: source.human_minutes === null || source.human_minutes === undefined ? null : number(source.human_minutes, "Review minutes", 1000000),
        };
      }
      if (JSON.stringify(result.baseline.checks.map((c) => c.id)) !== JSON.stringify(result.candidate.checks.map((c) => c.id))) throw new Error(`Case ${caseId} uses different checks across setups.`);
      // The verifier already requires identical rules on the two setups. Keep a stable,
      // bounded rule signature to prevent changing the rubric between repeated runs.
      const rule = item.rule;
      if (!rule || typeof rule !== "object") throw new Error(`Case ${caseId} is missing its deterministic rule.`);
      result.rule = {
        expected_format: text(rule.expected_format, "Expected format", 20),
        required_terms: list(rule.required_terms), forbidden_terms: list(rule.forbidden_terms),
        required_json_fields: list(rule.required_json_fields),
        exact_label: text(rule.exact_label, "Exact label", 500, true),
        max_characters: rule.max_characters === null ? null : number(rule.max_characters, "Maximum length", 200000),
      };
      return result;
    }).sort((a, b) => a.case_id.localeCompare(b.case_id));
    return {
      schema_version: "ai-cost-lens-verification/1.0",
      source: { name: text(raw.source?.name, "Verification source", 240), sha256: text(raw.source?.sha256, "Source hash", 128, true) },
      method: {
        sample_method: raw.method?.sample_method === "random_or_systematic" ? "random_or_systematic" : "user_selected",
        blinded: raw.method?.blinded === true,
        randomized_order: raw.method?.randomized_order === true,
      },
      cases,
    };
  }

  function list(values) {
    if (!Array.isArray(values) || values.length > 30) throw new Error("Invalid verification rule list.");
    return values.map((v) => text(v, "Rule value", 200)).sort();
  }

  function signature(evidence) {
    return JSON.stringify(evidence.cases.map((item) => [item.case_id, item.rule, item.baseline.checks.map((c) => c.id)]));
  }

  function routeSummary(evidence, route) {
    const cases = evidence.cases.map((item) => item[route]);
    const ready = cases.filter((item) => item.outcome_status === "ready_to_use").length;
    return {
      cases: cases.length, ready,
      ready_rate: ready / cases.length,
      deterministic_pass_rate: cases.filter((item) => item.checks.every((check) => check.passed)).length / cases.length,
      human_minutes: cases.some((item) => item.human_minutes === null) ? null : round(cases.reduce((sum, item) => sum + item.human_minutes, 0)),
    };
  }

  function addRun(current, raw, suppliedEvidence) {
    if (!current || current.schema_version !== SCHEMA) throw new Error("Lock a starting point before recording a run.");
    if (current.runs.length >= 50) throw new Error("A test record supports at most 50 runs.");
    const id = text(raw.id, "Run ID", 80);
    if (current.runs.some((run) => run.id === id)) throw new Error("That run ID is already recorded.");
    if (!["tuning", "validation"].includes(raw.partition)) throw new Error("Choose tuning or reserved validation cases.");
    if (raw.independent_execution !== true) throw new Error("Confirm that these outputs and costs came from a new execution of the locked setups.");
    if (raw.partition === "validation" && raw.reserved_before_tuning !== true) throw new Error("Confirm that validation cases were reserved before tuning.");
    if (raw.partition === "tuning" && current.runs.some((run) => run.partition === "validation")) throw new Error("Validation has started. Use a new test record for further tuning.");
    const evidence = qualityEvidence(suppliedEvidence);
    const samePartition = current.runs.filter((run) => run.partition === raw.partition);
    if (samePartition.length && signature(samePartition[0].verification) !== signature(evidence)) throw new Error("Repeat the same cases and deterministic rules within this test partition.");
    const otherIds = new Set(current.runs.filter((run) => run.partition !== raw.partition).flatMap((run) => run.verification.cases.map((item) => item.case_id)));
    if (evidence.cases.some((item) => otherIds.has(item.case_id))) throw new Error("Tuning and validation must use different case IDs. Keep reserved cases out of tuning.");
    if (evidence.source.sha256 && current.runs.some((run) => run.verification.source.sha256 === evidence.source.sha256)) throw new Error("This source file has already been recorded. Import results from a new execution before adding another run.");
    const run = {
      id, partition: raw.partition,
      independent_execution: true,
      reserved_before_tuning: raw.partition === "validation",
      baseline_cost: number(raw.baseline_cost, "Starting API cost"),
      candidate_cost: number(raw.candidate_cost, "Changed API cost"),
      cost_source: text(raw.cost_source, "Run cost source", 500),
      verification: evidence,
    };
    const trial = { ...current, runs: [...current.runs, run] };
    // Bound aggregate arithmetic, including restored records.
    for (const route of ["baseline", "candidate"]) {
      if (!Number.isFinite(trial.runs.reduce((sum, item) => sum + item[`${route}_cost`], 0))) throw new Error("Combined test costs exceed the supported numeric range.");
    }
    const result = recompute(trial);
    if (new TextEncoder().encode(JSON.stringify(result)).length > 5 * 1024 * 1024) throw new Error("This test exceeds the 5 MiB saved-record limit. Start a separate test for additional runs.");
    return result;
  }

  function recompute(record) {
    const validation = record.runs.filter((run) => run.partition === "validation");
    const thresholds = record.plan.thresholds;
    const runs = record.runs.map((run) => {
      const baseline = routeSummary(run.verification, "baseline");
      const candidate = routeSummary(run.verification, "candidate");
      const qualityHeld = candidate.deterministic_pass_rate >= thresholds.minimum_deterministic_pass_rate
        && candidate.ready_rate >= thresholds.minimum_ready_rate
        && candidate.ready_rate >= baseline.ready_rate - thresholds.maximum_ready_rate_regression - 1e-12;
      const baselineUnit = baseline.ready ? run.baseline_cost / baseline.ready : null;
      const candidateUnit = candidate.ready ? run.candidate_cost / candidate.ready : null;
      return { id: run.id, partition: run.partition, baseline, candidate, quality_held: qualityHeld,
        baseline_api_cost_per_ready: baselineUnit === null ? null : round(baselineUnit),
        candidate_api_cost_per_ready: candidateUnit === null ? null : round(candidateUnit),
        lower_api_unit_cost: baselineUnit !== null && candidateUnit !== null && candidateUnit < baselineUnit };
    });
    const checked = runs.filter((run) => run.partition === "validation");
    const uniqueCases = new Set(validation.flatMap((run) => run.verification.cases.map((item) => item.case_id))).size;
    const strongMethod = validation.every((run) => run.verification.method.sample_method === "random_or_systematic" && run.verification.method.blinded && run.verification.method.randomized_order);
    const rejected = checked.some((run) => !run.quality_held || (run.baseline_api_cost_per_ready !== null && run.candidate_api_cost_per_ready !== null && !run.lower_api_unit_cost));
    const enough = validation.length >= 2 && uniqueCases >= 30 && strongMethod && checked.every((run) => run.quality_held && run.lower_api_unit_cost);
    const decision = rejected ? "REJECT_CHANGE" : enough ? "REVIEW_CANDIDATE" : "NEEDS_MORE_EVIDENCE";
    const reason = rejected
      ? "A validation run failed the locked quality rule or did not lower API cost per ready result. Keep the starting setup and investigate."
      : enough
        ? "Repeated reserved-case tests support a finance review of this candidate. Check human work, full operating cost, policy, and production actuals before adopting it."
        : "Collect at least two new runs on the same 30 or more reserved cases, with complete human outcomes, consistent checks, and a declared blind, randomized review. These are minimum workflow checks, not statistical proof.";
    return { ...record,
      summary: {
        decision, reason, validation_runs: validation.length, unique_validation_cases: uniqueCases,
        validation_observations: checked.reduce((sum, run) => sum + run.baseline.cases, 0),
        runs,
        candidate_ready_rate_range: checked.length ? [Math.min(...checked.map((run) => run.candidate.ready_rate)), Math.max(...checked.map((run) => run.candidate.ready_rate))] : null,
        statistical_note: "Repeated runs reuse cases. They are not additional independent tasks; no pooled confidence interval is calculated. Case content, source authenticity, and independence are user declarations.",
      },
      evidence_gate: { savings_claim_allowed: false, route_change_approved: false,
        reason: "This record covers declared test runs and API cost only. It does not verify invoices, total workflow savings, or production results." },
      privacy: { parsed_locally: true, outputs_stored: false, provider_credentials_required: false },
    };
  }

  function restoreExperiment(raw) {
    if (!raw || raw.schema_version !== SCHEMA || !raw.plan || !Array.isArray(raw.runs)) throw new Error("Choose a saved AI Cost Lens test record.");
    const plan = raw.plan;
    let record = createExperiment({ ...plan, ...plan.thresholds, generated_at: raw.generated_at, mode: raw.mode });
    raw.runs.forEach((run) => { record = addRun(record, run, run.verification); });
    return record;
  }

  function illustrativeExample(verifier) {
    let record = createExperiment({
      mode: "illustrative", generated_at: "2026-10-24T00:00:00.000Z", workload: "Illustrative invoice extraction test",
      quality_rule: "All required invoice fields match the checked answer; no material correction remains.", change_kind: "caching", currency: "USD",
      baseline: { label: "Starting setup", model: "Same example model", effort: "Same effort", prompt_version: "v1", caching: "Off", processing: "Standard" },
      candidate: { label: "Stable prefix cached", model: "Same example model", effort: "Same effort", prompt_version: "v1", caching: "On", processing: "Standard" },
      other_settings_unchanged: true, minimum_deterministic_pass_rate: 1, minimum_ready_rate: .9, maximum_ready_rate_regression: 0,
    });
    for (let trial = 1; trial <= 2; trial += 1) {
      const rows = Array.from({ length: 40 }, (_, index) => ["baseline", "candidate"].map((route) => ({
        case_id: `invoice-${String(index + 1).padStart(2, "0")}`, route,
        output_text: `checked-${index + 1}`, exact_label: `checked-${index + 1}`,
        outcome_status: "ready_to_use", human_minutes: .25,
      }))).flat();
      const evidence = verifier.buildVerification(rows, { sample_method: "random_or_systematic", blinded: true, randomized_order: true,
        source_name: `Invented example run ${trial}`, source_file_hash: `illustrative-run-${trial}` });
      record = addRun(record, { id: `example-${trial}`, partition: "validation", independent_execution: true, reserved_before_tuning: true,
        baseline_cost: trial === 1 ? .40 : .42, candidate_cost: trial === 1 ? .22 : .23, cost_source: "Invented API costs for teaching; no provider requests or bills" }, evidence);
    }
    return record;
  }

  return Object.freeze({ SCHEMA, createExperiment, addRun, restoreExperiment, illustrativeExample });
});
