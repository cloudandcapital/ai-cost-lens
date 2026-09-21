(function attachVerificationEngine(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AICostLensVerification = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildVerificationEngine() {
  "use strict";

  const SCHEMA = "ai-cost-lens-verification/1.0";
  const MAX_ROWS = 2000;
  const MAX_OUTPUT_CHARACTERS = 200000;
  const round = (value, digits = 8) => Number(Number(value).toFixed(digits));
  const normalizeKey = (value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const aliases = Object.freeze({
    case_id: ["case_id", "test_id", "sample_id", "task_id"],
    route: ["route", "variant", "arm"],
    output_text: ["output_text", "output", "response", "completion"],
    expected_format: ["expected_format", "format"],
    required_terms: ["required_terms", "must_contain"],
    forbidden_terms: ["forbidden_terms", "must_not_contain"],
    required_json_fields: ["required_json_fields", "required_fields"],
    exact_label: ["exact_label", "expected_label"],
    max_characters: ["max_characters", "max_chars"],
    outcome_status: ["outcome_status", "result_status", "human_outcome"],
    human_minutes: ["human_minutes", "review_minutes"],
  });

  function valueMap(row, index) {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`Row ${index + 1} must be one flat object.`);
    if (Object.values(row).some((value) => value !== null && typeof value === "object")) throw new Error(`Row ${index + 1} must not contain nested data.`);
    const result = new Map();
    Object.entries(row).forEach(([key, value]) => {
      const normalized = normalizeKey(key);
      if (!normalized) throw new Error("Every verification column needs a non-empty name.");
      if (result.has(normalized)) throw new Error(`Multiple verification columns normalize to ${normalized}. Rename one before importing.`);
      result.set(normalized, value);
    });
    return result;
  }

  function pick(map, field) {
    const present = aliases[field]
      .filter((name) => map.has(name))
      .map((name) => ({ name, value: map.get(name) }))
      .filter((item) => item.value !== null && item.value !== undefined && String(item.value).trim() !== "");
    if (new Set(present.map((item) => String(item.value).trim())).size > 1) {
      throw new Error(`Multiple source columns map to ${field.replaceAll("_", " ")} with different values: ${present.map((item) => item.name).join(", ")}.`);
    }
    if (present.length) return present[0].value;
    for (const name of aliases[field]) if (map.has(name)) return map.get(name);
    return null;
  }

  function requiredText(value, label, max = 160) {
    const result = String(value ?? "").trim();
    if (!result) throw new Error(`${label} is required.`);
    if (result.length > max) throw new Error(`${label} exceeds ${max} characters.`);
    return result;
  }

  function optionalText(value, label, max = 160) {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const result = String(value).trim();
    if (result.length > max) throw new Error(`${label} exceeds ${max} characters.`);
    return result;
  }

  function optionalNumber(value, label, { integer = false, max = Infinity } = {}) {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > max || (integer && !Number.isSafeInteger(parsed))) {
      throw new Error(`${label} must be a non-negative${integer ? " whole" : ""} number${Number.isFinite(max) ? ` no greater than ${max}` : ""}, or blank.`);
    }
    return parsed;
  }

  function probability(value, label, fallback) {
    const candidate = value === null || value === undefined || value === "" ? fallback : Number(value);
    if (!Number.isFinite(candidate) || candidate < 0 || candidate > 1) throw new Error(`${label} must be between 0 and 1.`);
    return candidate;
  }

  function normalizeRoute(value, index) {
    const route = requiredText(value, `Row ${index + 1} route`, 40).toLowerCase();
    if (["baseline", "current", "a"].includes(route)) return "baseline";
    if (["candidate", "proposed", "alternative", "b"].includes(route)) return "candidate";
    throw new Error(`Row ${index + 1} route must be baseline/current or candidate/proposed.`);
  }

  function normalizeFormat(value, index) {
    const format = String(value || "text").trim().toLowerCase();
    if (["text", "plain", "plaintext"].includes(format)) return "text";
    if (format === "json") return "json";
    throw new Error(`Row ${index + 1} expected format must be text, json, or blank.`);
  }

  function normalizeOutcome(value, index) {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const outcome = String(value).trim().toLowerCase().replace(/[ -]+/g, "_");
    if (["ready", "ready_to_use", "usable", "pass", "passed"].includes(outcome)) return "ready_to_use";
    if (["needs_correction", "correction", "fix", "needs_fix"].includes(outcome)) return "needs_correction";
    if (["needs_escalation", "escalation", "unusable", "fail", "failed"].includes(outcome)) return "needs_escalation";
    throw new Error(`Row ${index + 1} outcome status must be ready_to_use, needs_correction, needs_escalation, or blank.`);
  }

  function splitList(value, label, index) {
    if (value === null || value === undefined || String(value).trim() === "") return [];
    const values = String(value).split(";").map((item) => item.trim()).filter(Boolean);
    if (values.length > 30) throw new Error(`Row ${index + 1} ${label} has more than 30 entries.`);
    values.forEach((item) => {
      if (item.length > 200) throw new Error(`Row ${index + 1} ${label} contains an entry over 200 characters.`);
    });
    return [...new Set(values)];
  }

  function normalizeRow(row, index) {
    const map = valueMap(row, index);
    const output = String(pick(map, "output_text") ?? "");
    if (output.length > MAX_OUTPUT_CHARACTERS) throw new Error(`Row ${index + 1} output exceeds ${MAX_OUTPUT_CHARACTERS.toLocaleString("en-US")} characters.`);
    return {
      case_id: requiredText(pick(map, "case_id"), `Row ${index + 1} case ID`),
      route: normalizeRoute(pick(map, "route"), index),
      output,
      rule: {
        expected_format: normalizeFormat(pick(map, "expected_format"), index),
        required_terms: splitList(pick(map, "required_terms"), "required terms", index),
        forbidden_terms: splitList(pick(map, "forbidden_terms"), "forbidden terms", index),
        required_json_fields: splitList(pick(map, "required_json_fields"), "required JSON fields", index),
        exact_label: optionalText(pick(map, "exact_label"), `Row ${index + 1} exact label`, 500),
        max_characters: optionalNumber(pick(map, "max_characters"), `Row ${index + 1} maximum characters`, { integer: true, max: MAX_OUTPUT_CHARACTERS }),
      },
      outcome_status: normalizeOutcome(pick(map, "outcome_status"), index),
      human_minutes: optionalNumber(pick(map, "human_minutes"), `Row ${index + 1} human minutes`, { max: 1000000 }),
    };
  }

  function stableRule(rule) {
    return JSON.stringify({
      expected_format: rule.expected_format,
      required_terms: [...rule.required_terms].sort(),
      forbidden_terms: [...rule.forbidden_terms].sort(),
      required_json_fields: [...rule.required_json_fields].sort(),
      exact_label: rule.exact_label,
      max_characters: rule.max_characters,
    });
  }

  function hasJsonPath(value, path) {
    const parts = path.split(".").map((part) => part.trim()).filter(Boolean);
    if (!parts.length || parts.some((part) => ["__proto__", "prototype", "constructor"].includes(part))) return false;
    let current = value;
    for (const part of parts) {
      if (current === null || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, part)) return false;
      current = current[part];
    }
    return true;
  }

  function evaluateOutput(item) {
    const checks = [{ id: "non_empty", label: "Output is not empty", passed: item.output.trim().length > 0 }];
    let parsedJson = null;
    if (item.rule.expected_format === "json") {
      try {
        parsedJson = JSON.parse(item.output);
        checks.push({ id: "valid_json", label: "Output is valid JSON", passed: true });
      } catch (_error) {
        checks.push({ id: "valid_json", label: "Output is valid JSON", passed: false });
      }
    }
    const lower = item.output.toLocaleLowerCase("en-US");
    item.rule.required_terms.forEach((term, index) => checks.push({
      id: `required_term_${index + 1}`,
      label: `Contains required term: ${term}`,
      passed: lower.includes(term.toLocaleLowerCase("en-US")),
    }));
    item.rule.forbidden_terms.forEach((term, index) => checks.push({
      id: `forbidden_term_${index + 1}`,
      label: `Omits forbidden term: ${term}`,
      passed: !lower.includes(term.toLocaleLowerCase("en-US")),
    }));
    item.rule.required_json_fields.forEach((path, index) => checks.push({
      id: `required_json_field_${index + 1}`,
      label: `JSON field is present: ${path}`,
      passed: parsedJson !== null && hasJsonPath(parsedJson, path),
    }));
    if (item.rule.exact_label !== null) checks.push({
      id: "exact_label",
      label: `Output exactly matches: ${item.rule.exact_label}`,
      passed: item.output.trim() === item.rule.exact_label,
    });
    if (item.rule.max_characters !== null) checks.push({
      id: "max_characters",
      label: `Output is at most ${item.rule.max_characters.toLocaleString("en-US")} characters`,
      passed: item.output.length <= item.rule.max_characters,
    });
    return {
      passed: checks.every((check) => check.passed),
      checks,
      output_characters: item.output.length,
      outcome_status: item.outcome_status,
      human_minutes: item.human_minutes,
    };
  }

  function wilsonInterval(successes, total, z = 1.96) {
    if (!total) return null;
    const rate = successes / total;
    const denominator = 1 + (z * z) / total;
    const center = (rate + (z * z) / (2 * total)) / denominator;
    const spread = (z * Math.sqrt((rate * (1 - rate) + (z * z) / (4 * total)) / total)) / denominator;
    return [round(Math.max(0, center - spread), 6), round(Math.min(1, center + spread), 6)];
  }

  function summarizeRoute(caseResults, route, sampleMethod) {
    const results = caseResults.map((item) => item[route]);
    const deterministicPassed = results.filter((item) => item.passed).length;
    const checkCount = results.reduce((sum, item) => sum + item.checks.length, 0);
    const checksPassed = results.reduce((sum, item) => sum + item.checks.filter((check) => check.passed).length, 0);
    const outcomesComplete = results.every((item) => item.outcome_status !== null);
    const humanTimeComplete = results.every((item) => item.human_minutes !== null);
    const outcomeCounts = {
      ready_to_use: results.filter((item) => item.outcome_status === "ready_to_use").length,
      needs_correction: results.filter((item) => item.outcome_status === "needs_correction").length,
      needs_escalation: results.filter((item) => item.outcome_status === "needs_escalation").length,
    };
    const readyRate = outcomesComplete ? outcomeCounts.ready_to_use / results.length : null;
    return {
      cases: results.length,
      deterministic_cases_passed: deterministicPassed,
      deterministic_pass_rate: round(deterministicPassed / results.length, 6),
      check_instances: checkCount,
      check_instances_passed: checksPassed,
      outcomes_complete: outcomesComplete,
      outcome_counts: outcomeCounts,
      ready_rate: readyRate === null ? null : round(readyRate, 6),
      ready_rate_interval_95: readyRate === null || sampleMethod !== "random_or_systematic" ? null : wilsonInterval(outcomeCounts.ready_to_use, results.length),
      human_time_complete: humanTimeComplete,
      human_minutes: humanTimeComplete ? round(results.reduce((sum, item) => sum + item.human_minutes, 0), 4) : null,
    };
  }

  function normalizeOptions(rawOptions = {}) {
    const sampleMethod = String(rawOptions.sample_method || "user_selected").toLowerCase();
    if (!["user_selected", "random_or_systematic"].includes(sampleMethod)) throw new Error("Sample method must be user_selected or random_or_systematic.");
    return {
      generated_at: rawOptions.generated_at || new Date().toISOString(),
      source_name: optionalText(rawOptions.source_name, "Source name", 240) || "Local paired-output verification",
      source_file_hash: optionalText(rawOptions.source_file_hash, "Source-file hash", 128),
      sample_method: sampleMethod,
      blinded: Boolean(rawOptions.blinded),
      randomized_order: Boolean(rawOptions.randomized_order),
      minimum_deterministic_pass_rate: probability(rawOptions.minimum_deterministic_pass_rate, "Minimum deterministic pass rate", 1),
      minimum_ready_rate: probability(rawOptions.minimum_ready_rate, "Minimum ready rate", 0),
      maximum_ready_rate_regression: probability(rawOptions.maximum_ready_rate_regression, "Maximum ready-rate regression", 0.05),
    };
  }

  function pairRows(rows) {
    if (!Array.isArray(rows) || !rows.length) throw new Error("The verification file needs at least one baseline/candidate pair.");
    if (rows.length > MAX_ROWS) throw new Error(`The verification file exceeds ${MAX_ROWS.toLocaleString("en-US")} rows.`);
    const normalized = rows.map(normalizeRow);
    const cases = new Map();
    normalized.forEach((row) => {
      if (!cases.has(row.case_id)) cases.set(row.case_id, {});
      const pair = cases.get(row.case_id);
      if (pair[row.route]) throw new Error(`Case ${row.case_id} has more than one ${row.route} row.`);
      pair[row.route] = row;
    });
    const pairs = [];
    for (const [caseId, pair] of cases.entries()) {
      if (!pair.baseline || !pair.candidate) throw new Error(`Case ${caseId} needs exactly one baseline row and one candidate row.`);
      if (stableRule(pair.baseline.rule) !== stableRule(pair.candidate.rule)) throw new Error(`Case ${caseId} uses different deterministic rules across routes.`);
      pairs.push({ case_id: caseId, rule: pair.baseline.rule, baseline: pair.baseline, candidate: pair.candidate });
    }
    return pairs.sort((left, right) => left.case_id.localeCompare(right.case_id));
  }

  function prepareBlindReview(rows, rawOptions = {}) {
    const pairs = pairRows(rows);
    const randomValues = rawOptions.random_values;
    if (!Array.isArray(randomValues) || randomValues.length < pairs.length) {
      throw new Error("Blind review needs one local random value for every paired case.");
    }
    randomValues.slice(0, pairs.length).forEach((value) => {
      if (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) >= 1) throw new Error("Blind-review random values must be between 0 and 1.");
    });
    return {
      schema_version: "ai-cost-lens-verification-session/1.0",
      created_at: rawOptions.created_at || new Date().toISOString(),
      randomized_order: true,
      case_count: pairs.length,
      cases: pairs.map((pair, index) => {
        const ordered = Number(randomValues[index]) >= 0.5
          ? [pair.candidate, pair.baseline]
          : [pair.baseline, pair.candidate];
        return {
          case_id: pair.case_id,
          rule: pair.rule,
          presentations: ordered.map((item, presentationIndex) => ({
            slot: presentationIndex === 0 ? "A" : "B",
            route: item.route,
            output_text: item.output,
          })),
        };
      }),
      privacy: { browser_memory_only: true, export_allowed: false, output_text_in_final_record: false },
    };
  }

  function completeBlindReview(session, rawScores, rawOptions = {}) {
    if (!session || session.schema_version !== "ai-cost-lens-verification-session/1.0" || !Array.isArray(session.cases)) {
      throw new Error("A prepared local blind-review session is required.");
    }
    if (!Array.isArray(rawScores)) throw new Error("Blind-review scores are required.");
    const scoreMap = new Map();
    rawScores.forEach((score, index) => {
      const caseId = requiredText(score?.case_id, `Score ${index + 1} case ID`);
      const slot = requiredText(score?.slot, `Score ${index + 1} slot`, 1).toUpperCase();
      if (!["A", "B"].includes(slot)) throw new Error(`Score ${index + 1} slot must be A or B.`);
      const key = `${caseId}\u0000${slot}`;
      if (scoreMap.has(key)) throw new Error(`Case ${caseId} has more than one score for output ${slot}.`);
      const outcomeStatus = normalizeOutcome(score?.outcome_status, index);
      if (outcomeStatus === null) throw new Error(`Case ${caseId} output ${slot} needs a human outcome.`);
      scoreMap.set(key, {
        outcome_status: outcomeStatus,
        human_minutes: optionalNumber(score?.human_minutes, `Case ${caseId} output ${slot} human minutes`, { max: 1000000 }),
      });
    });
    const rows = [];
    session.cases.forEach((item) => {
      if (!item || !item.rule || !Array.isArray(item.presentations) || item.presentations.length !== 2) throw new Error("The blind-review session is incomplete.");
      item.presentations.forEach((presentation) => {
        const score = scoreMap.get(`${item.case_id}\u0000${presentation.slot}`);
        if (!score) throw new Error(`Case ${item.case_id} output ${presentation.slot} has not been scored.`);
        rows.push({
          case_id: item.case_id,
          route: presentation.route,
          output_text: presentation.output_text,
          expected_format: item.rule.expected_format,
          required_terms: item.rule.required_terms.join(";"),
          forbidden_terms: item.rule.forbidden_terms.join(";"),
          required_json_fields: item.rule.required_json_fields.join(";"),
          exact_label: item.rule.exact_label,
          max_characters: item.rule.max_characters,
          outcome_status: score.outcome_status,
          human_minutes: score.human_minutes,
        });
      });
    });
    if (scoreMap.size !== rows.length) throw new Error("The blind-review scores contain a case or output that is not in this session.");
    return buildVerification(rows, { ...rawOptions, blinded: true, randomized_order: true });
  }

  function buildVerification(rows, rawOptions = {}) {
    const options = normalizeOptions(rawOptions);
    const caseResults = pairRows(rows).map((pair) => ({
      case_id: pair.case_id,
      rule: pair.baseline.rule,
      baseline: evaluateOutput(pair.baseline),
      candidate: evaluateOutput(pair.candidate),
    }));
    const baseline = summarizeRoute(caseResults, "baseline", options.sample_method);
    const candidate = summarizeRoute(caseResults, "candidate", options.sample_method);
    const deterministicGate = candidate.deterministic_pass_rate >= options.minimum_deterministic_pass_rate;
    const outcomesComparable = baseline.outcomes_complete && candidate.outcomes_complete;
    const outcomeGate = outcomesComparable
      ? candidate.ready_rate >= options.minimum_ready_rate
        && candidate.ready_rate >= baseline.ready_rate - options.maximum_ready_rate_regression
      : null;
    const qualityGate = deterministicGate && outcomeGate === true;
    const strongMethod = options.sample_method === "random_or_systematic" && options.blinded && options.randomized_order && caseResults.length >= 30;
    const status = !deterministicGate || outcomeGate === false
      ? "QUALITY_FAIL"
      : !outcomesComparable
        ? "INCOMPLETE"
        : strongMethod
          ? "VERIFIED_PASS"
          : "DIRECTIONAL_PASS";
    const failedCases = caseResults.filter((item) => !item.candidate.passed || item.candidate.outcome_status === "needs_escalation").map((item) => item.case_id);
    return {
      schema_version: SCHEMA,
      application_version: "0.5.0",
      generated_at: options.generated_at,
      source: { name: options.source_name, sha256: options.source_file_hash, uploaded: false },
      method: {
        same_case_pairs: true,
        sample_method: options.sample_method,
        blinded: options.blinded,
        randomized_order: options.randomized_order,
        case_count: caseResults.length,
      },
      thresholds: {
        minimum_deterministic_pass_rate: options.minimum_deterministic_pass_rate,
        minimum_ready_rate: options.minimum_ready_rate,
        maximum_ready_rate_regression: options.maximum_ready_rate_regression,
      },
      baseline,
      candidate,
      comparison: {
        status,
        deterministic_gate_passed: deterministicGate,
        outcome_gate_passed: outcomeGate,
        quality_gate_passed: qualityGate,
        deterministic_pass_rate_change_points: round((candidate.deterministic_pass_rate - baseline.deterministic_pass_rate) * 100, 4),
        ready_rate_change_points: outcomesComparable ? round((candidate.ready_rate - baseline.ready_rate) * 100, 4) : null,
        human_minutes_difference: baseline.human_time_complete && candidate.human_time_complete ? round(candidate.human_minutes - baseline.human_minutes, 4) : null,
        failed_candidate_case_ids: failedCases,
      },
      cases: caseResults.map((item) => ({
        case_id: item.case_id,
        rule: item.rule,
        baseline: item.baseline,
        candidate: item.candidate,
      })),
      evidence_gate: {
        decision: status === "QUALITY_FAIL" ? "KEEP_BASELINE" : status === "VERIFIED_PASS" ? "QUALITY_GATE_PASSED" : "TEST_FIRST",
        savings_claim_allowed: false,
        reason: "This record tests output quality on paired cases. It does not establish provider-billed savings, equivalent production periods, policy approval, implementation, or realized results.",
      },
      privacy: {
        parsed_locally: true,
        output_text_stored: false,
        source_file_uploaded: false,
      },
    };
  }

  return Object.freeze({ SCHEMA, aliases, buildVerification, prepareBlindReview, completeBlindReview, wilsonInterval });
});
