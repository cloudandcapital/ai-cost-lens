(() => {
  "use strict";

  const state = {
    data: null,
    demoData: null,
    view: "review",
    story: false,
    builderMode: null,
    outcomeMode: "sample",
    breakEvenReady: false,
  };

  const money = (value, digits = 0) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: state.data?.currency || state.data?.bill?.currency || "USD",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);

  const compact = (value) =>
    new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
      value,
    );
  const wholeNumber = (value) =>
    new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);

  const pct = (value, digits = 0) => `${(value * 100).toFixed(digits)}%`;
  const pctOrMissing = (value, digits = 0) =>
    value === null || value === undefined ? "Not available" : pct(value, digits);
  const cents = (value) => `${(value * 100).toFixed(1)}¢`;
  const unitMoney = (value) => (value < 1 ? cents(value) : money(value, 2));
  const signedMoney = (value) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${money(Math.abs(value), 2)}`;

  const escapeHtml = (value) =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
  const cloneData = (value) => JSON.parse(JSON.stringify(value));

  function parseCsv(text, label) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    const normalized = String(text).replace(/^\uFEFF/, "");
    for (let index = 0; index < normalized.length; index += 1) {
      const character = normalized[index];
      if (quoted) {
        if (character === '"' && normalized[index + 1] === '"') {
          field += '"';
          index += 1;
        } else if (character === '"') {
          quoted = false;
        } else {
          field += character;
        }
      } else if (character === '"') {
        quoted = true;
      } else if (character === ",") {
        row.push(field.trim());
        field = "";
      } else if (character === "\n") {
        row.push(field.trim());
        if (row.some((value) => value !== "")) rows.push(row);
        row = [];
        field = "";
      } else if (character !== "\r") {
        field += character;
      }
    }
    if (quoted) throw new Error(`${label} has an unclosed quoted field.`);
    row.push(field.trim());
    if (row.some((value) => value !== "")) rows.push(row);
    if (rows.length < 2) throw new Error(`${label} needs a header and at least one data row.`);
    const headers = rows[0];
    if (new Set(headers).size !== headers.length) throw new Error(`${label} has a duplicate column name.`);
    return rows.slice(1).map((values, rowIndex) => {
      if (values.length !== headers.length) {
        throw new Error(`${label} row ${rowIndex + 2} has ${values.length} fields; expected ${headers.length}.`);
      }
      return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
    });
  }

  function requireColumns(rows, columns, label) {
    const available = new Set(Object.keys(rows[0] || {}));
    const missing = columns.filter((column) => !available.has(column));
    if (missing.length) throw new Error(`${label} is missing: ${missing.join(", ")}.`);
  }

  function finiteNumber(value, field, { integer = false } = {}) {
    if (value === "" || value === null || value === undefined) throw new Error(`${field} is required.`);
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || (integer && !Number.isInteger(parsed))) {
      throw new Error(`${field} must be a non-negative${integer ? " whole" : ""} number.`);
    }
    return parsed;
  }

  function optionalNumber(value, field, options = {}) {
    return String(value ?? "").trim() === "" ? null : finiteNumber(value, field, options);
  }

  function validDate(value, field) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
      throw new Error(`${field} must use YYYY-MM-DD.`);
    }
    return value;
  }

  async function sha256(text) {
    if (!globalThis.crypto?.subtle) return null;
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(text),
    );
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function policyApproval(config, period) {
    const specific = period === "baseline" ? config.baselinePolicyApproved : config.proposedPolicyApproved;
    return typeof specific === "boolean" ? specific : Boolean(config.policyApproved);
  }

  function spendCostBasis(spend, period) {
    const aliases = {
      provider_reported: "observed",
      observed: "observed",
      calculated: "calculated",
      allocated: "allocated",
    };
    const declared = new Set(
      spend.map((row, index) => {
        const raw = row.cost_basis?.trim().toLowerCase();
        const basis = aliases[raw];
        if (!basis) {
          throw new Error(
            `Spend ${period} row ${index + 2} cost_basis must be provider_reported, calculated, or allocated.`,
          );
        }
        return basis;
      }),
    );
    if (declared.size !== 1) {
      throw new Error(`Spend ${period} rows must use one cost_basis.`);
    }
    return [...declared][0];
  }

  function costBasisLabel(basis) {
    if (basis === "observed") return "Provider reported cost";
    if (basis === "calculated") return "Calculated cost";
    if (basis === "allocated") return "Allocated cost";
    return "Cost basis not supplied";
  }

  function providerCostTerm(baseline, proposed) {
    const bases = new Set([baseline.evidence.cost_basis, proposed.evidence.cost_basis]);
    if (bases.size !== 1) return "provider cost";
    const [basis] = bases;
    if (basis === "observed") return "provider bill";
    if (basis === "calculated") return "calculated provider cost";
    if (basis === "allocated") return "allocated provider cost";
    return "provider cost";
  }

  function providerCostsReported(baseline, proposed, comparison = {}) {
    return comparison.provider_cost_reported ?? [baseline, proposed].every(
      (scenario) => scenario.evidence.cost_basis === "observed",
    );
  }

  function sentenceCase(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function buildPlanningRecord(baseline, proposed, planning) {
    if (!planning) return null;
    const plan = planning.plan;
    const planRecurring = plan.providerCost + plan.sharedCost + plan.humanCost;
    const planReadyResults = plan.completedResults * plan.readyRate;
    const planUnit = planRecurring / planReadyResults;
    const costDrivers = [
      ["Provider cost", baseline.costs.model_cost - plan.providerCost],
      ["Shared infrastructure", baseline.costs.shared_infrastructure_cost - plan.sharedCost],
      ["Human review and correction", baseline.costs.human_review_cost - plan.humanCost],
    ]
      .sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]))
      .slice(0, 2)
      .map(([label, amount]) => ({
        label,
        amount: round(amount),
        direction: amount > 0 ? "unfavorable" : amount < 0 ? "favorable" : "on_plan",
      }));
    const monthlyOperatingSavings =
      (baseline.measures.cost_per_usable_result - proposed.measures.cost_per_usable_result) *
      planning.expectedReadyPerMonth;
    const changeCost = proposed.costs.one_time_change_cost;
    const horizonNet = monthlyOperatingSavings * planning.horizonMonths - changeCost;
    const hasOperatingSavings = monthlyOperatingSavings > 0;
    const paybackMonths = hasOperatingSavings
      ? changeCost
        ? changeCost / monthlyOperatingSavings
        : 0
      : null;
    const withinHorizon = paybackMonths !== null && paybackMonths <= planning.horizonMonths;
    return {
      label: planning.label,
      plan: {
        provider_cost: round(plan.providerCost),
        shared_infrastructure_cost: round(plan.sharedCost),
        human_review_cost: round(plan.humanCost),
        recurring_operating_cost: round(planRecurring),
        completed_results: plan.completedResults,
        ready_result_rate: round(plan.readyRate),
        ready_results: round(planReadyResults),
        cost_per_ready_result: round(planUnit),
      },
      actual: {
        provider_cost: baseline.costs.model_cost,
        shared_infrastructure_cost: baseline.costs.shared_infrastructure_cost,
        human_review_cost: baseline.costs.human_review_cost,
        recurring_operating_cost: baseline.costs.recurring_operating_cost,
        completed_results: baseline.outcomes.completed_results,
        ready_result_rate: baseline.measures.usable_result_rate,
        ready_results: baseline.outcomes.usable_results,
        cost_per_ready_result: baseline.measures.cost_per_usable_result,
      },
      variance: {
        provider_cost: round(baseline.costs.model_cost - plan.providerCost),
        shared_infrastructure_cost: round(baseline.costs.shared_infrastructure_cost - plan.sharedCost),
        human_review_cost: round(baseline.costs.human_review_cost - plan.humanCost),
        recurring_operating_cost: round(baseline.costs.recurring_operating_cost - planRecurring),
        ready_results: round(baseline.outcomes.usable_results - planReadyResults),
        ready_result_rate_points: round((baseline.measures.usable_result_rate - plan.readyRate) * 100, 1),
        cost_per_ready_result: round(baseline.measures.cost_per_usable_result - planUnit),
        primary_cost_drivers: costDrivers,
      },
      payback: {
        expected_ready_results_per_month: planning.expectedReadyPerMonth,
        decision_horizon_months: planning.horizonMonths,
        monthly_operating_savings: round(monthlyOperatingSavings),
        one_time_change_cost: round(changeCost),
        payback_months: paybackMonths === null ? null : round(paybackMonths),
        within_decision_horizon: withinHorizon,
        horizon_net_savings: round(horizonNet),
        status: !hasOperatingSavings
          ? "no_operating_payback"
          : withinHorizon
            ? "within_horizon"
            : "outside_horizon",
      },
    };
  }

  function buildScenario(period, spendRows, workRows, config, hashes) {
    const spend = spendRows.filter((row) => row.period.toLowerCase() === period);
    const work = workRows.filter((row) => row.period.toLowerCase() === period);
    if (!spend.length) throw new Error(`The spend file has no ${period} rows.`);
    if (!work.length) throw new Error(`The work log has no ${period} rows.`);

    const dates = spend.map((row, index) => validDate(row.date, `Spend ${period} row ${index + 2} date`));
    const minDate = [...dates].sort()[0];
    const maxDate = [...dates].sort().at(-1);
    const workload = spend[0].workload.trim();
    if (!workload) throw new Error(`Spend ${period} workload is required.`);
    if (spend.some((row) => row.workload.trim() !== workload)) {
      throw new Error(`Spend ${period} rows contain more than one workload.`);
    }

    const currencies = new Set(spend.map((row) => row.currency.trim().toUpperCase()));
    if (currencies.size !== 1 || !/^[A-Z]{3}$/.test([...currencies][0])) {
      throw new Error(`Spend ${period} rows must use one three-letter currency.`);
    }
    const basis = spendCostBasis(spend, period);

    let requests = 0;
    let processedInput = 0;
    let cachedInput = 0;
    let cacheWriteInput = 0;
    let outputTokens = 0;
    let providerCost = 0;
    spend.forEach((row, index) => {
      const rowNumber = index + 2;
      const rowRequests = finiteNumber(row.requests, `Spend ${period} row ${rowNumber} requests`, { integer: true });
      const rowInput = finiteNumber(row.input_tokens, `Spend ${period} row ${rowNumber} input_tokens`, { integer: true });
      const rowCached = finiteNumber(row.cached_input_tokens, `Spend ${period} row ${rowNumber} cached_input_tokens`, { integer: true });
      const rowCacheWrite = finiteNumber(row.cache_write_input_tokens, `Spend ${period} row ${rowNumber} cache_write_input_tokens`, { integer: true });
      if (rowCached + rowCacheWrite > rowInput) {
        throw new Error(`Spend ${period} row ${rowNumber} has more cached and cache-write tokens than input tokens.`);
      }
      requests += rowRequests;
      processedInput += rowInput;
      cachedInput += rowCached;
      cacheWriteInput += rowCacheWrite;
      outputTokens += finiteNumber(row.output_tokens, `Spend ${period} row ${rowNumber} output_tokens`, { integer: true });
      providerCost += finiteNumber(row.provider_cost, `Spend ${period} row ${rowNumber} provider_cost`);
    });
    if (requests === 0) throw new Error(`Spend ${period} requests must be greater than zero.`);

    const seen = new Set();
    let accepted = 0;
    const statusCounts = {
      ready_to_use: 0,
      needs_correction: 0,
      needs_escalation: 0,
    };
    let workRequests = 0;
    let retries = 0;
    let workRequestsKnown = true;
    let retriesKnown = true;
    let reviewMinutes = 0;
    let correctionMinutes = 0;
    work.forEach((row, index) => {
      const rowNumber = index + 2;
      const resultId = row.result_id.trim();
      if (!resultId) throw new Error(`Work ${period} row ${rowNumber} result_id is required.`);
      if (seen.has(resultId)) throw new Error(`Work ${period} result_id ${resultId} appears more than once.`);
      seen.add(resultId);
      if (row.date) {
        const day = validDate(row.date, `Work ${period} row ${rowNumber} date`);
        if (day < minDate || day > maxDate) {
          throw new Error(`Work ${period} row ${rowNumber} falls outside the spend period.`);
        }
      }
      if (row.workload && row.workload.trim() !== workload) {
        throw new Error(`Work ${period} row ${rowNumber} does not match workload “${workload}”.`);
      }
      let outcomeStatus = row.outcome_status?.trim().toLowerCase();
      if (outcomeStatus) {
        if (!Object.hasOwn(statusCounts, outcomeStatus)) {
          throw new Error(
            `Work ${period} row ${rowNumber} outcome_status must be ready_to_use, needs_correction, or needs_escalation.`,
          );
        }
      } else {
        const acceptedValue = row.accepted?.trim().toLowerCase();
        if (!["true", "false"].includes(acceptedValue)) {
          throw new Error(
            `Work ${period} row ${rowNumber} needs outcome_status or accepted=true/false.`,
          );
        }
        outcomeStatus = acceptedValue === "true" ? "ready_to_use" : "needs_escalation";
      }
      statusCounts[outcomeStatus] += 1;
      if (outcomeStatus === "ready_to_use") accepted += 1;
      if (row.model_requests === undefined || row.model_requests === "") {
        workRequestsKnown = false;
      } else {
        const modelRequests = finiteNumber(row.model_requests, `Work ${period} row ${rowNumber} model_requests`, { integer: true });
        workRequests += modelRequests;
        if (row.retry_requests === undefined || row.retry_requests === "") {
          retriesKnown = false;
        } else {
          const retryRequests = finiteNumber(row.retry_requests, `Work ${period} row ${rowNumber} retry_requests`, { integer: true });
          if (retryRequests > modelRequests) {
            throw new Error(`Work ${period} row ${rowNumber} retries cannot exceed model requests.`);
          }
          retries += retryRequests;
        }
      }
      if (row.human_minutes !== undefined && row.human_minutes !== "") {
        reviewMinutes += finiteNumber(row.human_minutes, `Work ${period} row ${rowNumber} human_minutes`);
      } else {
        reviewMinutes += finiteNumber(row.human_review_minutes, `Work ${period} row ${rowNumber} human_review_minutes`);
        correctionMinutes += row.correction_minutes === undefined || row.correction_minutes === ""
          ? 0
          : finiteNumber(row.correction_minutes, `Work ${period} row ${rowNumber} correction_minutes`);
      }
    });
    if (accepted === 0) throw new Error(`The ${period} work log has no accepted results.`);

    const issues = [];
    if (workRequestsKnown && requests !== workRequests) {
      issues.push(`The spend file reports ${requests.toLocaleString()} requests while the work log accounts for ${workRequests.toLocaleString()}.`);
    }
    if (config.outcomeLogComplete === false) {
      issues.push("The reviewer did not confirm that the outcome log covers the full workload and period.");
    }
    const route = [...new Set(spend.map((row) => row.route.trim()).filter(Boolean))].join(", ") || `${period} route`;
    const models = [...new Set(spend.map((row) => row.model.trim()).filter(Boolean))];
    const providers = [...new Set(spend.map((row) => row.provider.trim()).filter(Boolean))];
    const hourlyRate = config.hourlyRate;
    const humanCost = ((reviewMinutes + correctionMinutes) / 60) * hourlyRate;
    const sharedCost = period === "baseline" ? config.baselineShared : config.proposedShared;
    const changeCost = period === "proposed" ? config.changeCost : 0;
    const recurring = providerCost + humanCost + sharedCost;
    const allIn = recurring + changeCost;
    const completed = work.length;
    const coverageComplete = !issues.length;

    return {
      dates,
      currency: [...currencies][0],
      workload,
      scenario: {
        id: period,
        label: period === "baseline" ? "Current route" : "Proposed route",
        model: {
          provider: providers.join(", ") || "Provider not named",
          name: models.join(", ") || "Model not named",
          route,
        },
        costs: {
          model_cost: round(providerCost),
          shared_infrastructure_cost: round(sharedCost),
          human_review_cost: round(humanCost),
          one_time_change_cost: round(changeCost),
          recurring_operating_cost: round(recurring),
          all_in_pilot_cost: round(allIn),
        },
        usage: {
          requests,
          retries: retriesKnown && workRequestsKnown ? retries : null,
          unique_input_tokens: null,
          processed_input_tokens: processedInput,
          cached_input_tokens: cachedInput,
          cache_write_input_tokens: cacheWriteInput,
          output_tokens: outputTokens,
        },
        outcomes: {
          basis: "observed_log",
          completed_results: completed,
          usable_results: accepted,
          status_counts: statusCounts,
          human_review_minutes: round(reviewMinutes + correctionMinutes),
          review_minutes: round(reviewMinutes),
          correction_minutes: round(correctionMinutes),
          verifier: config.verifier,
          acceptance_rule: config.acceptanceRule,
        },
        policy: {
          approved: policyApproval(config, period),
          retention_mode: policyApproval(config, period) ? "Declared approved by reviewer" : "Approval not established",
        },
        evidence: {
          cost_basis: basis,
          outcome_basis: "observed_log",
          source: `${costBasisLabel(basis)} from the universal spend template + detailed outcome log`,
          observed_at: maxDate,
          coverage: coverageComplete
            ? `Complete ${period} outcome log declared for the spend period${workRequestsKnown ? "; request counts supplied" : "; request counts not supplied"}`
            : `Partial ${period} workload evidence`,
          coverage_status: coverageComplete ? "complete" : "partial",
          reconciliation_issues: issues,
          cost_boundary: "provider cost + declared shared infrastructure + human review and correction",
          provider_usage_sha256: hashes.spend,
          provider_cost_sha256: hashes.spend,
          outcome_log_sha256: hashes.work,
        },
        measures: {
          cost_per_usable_result: round(recurring / accepted),
          all_in_cost_per_usable_result: round(allIn / accepted),
          usable_result_rate: round(accepted / completed),
          retry_rate: retriesKnown && workRequestsKnown ? round(retries / requests) : null,
          cache_reuse_rate: processedInput ? round(cachedInput / processedInput) : 0,
          cache_write_rate: processedInput ? round(cacheWriteInput / processedInput) : 0,
          context_reprocessing_ratio: null,
          human_review_minutes_per_usable_result: round((reviewMinutes + correctionMinutes) / accepted),
        },
      },
    };
  }

  async function buildLocalReview(spendText, workText, config) {
    const spendRows = parseCsv(spendText, "Spend file");
    const workRows = parseCsv(workText, "Work log");
    requireColumns(
      spendRows,
      ["period", "date", "workload", "provider", "model", "route", "requests", "input_tokens", "cached_input_tokens", "cache_write_input_tokens", "output_tokens", "provider_cost", "cost_basis", "currency"],
      "Spend file",
    );
    requireColumns(
      workRows,
      ["period", "result_id"],
      "Work log",
    );
    const workHeaders = new Set(Object.keys(workRows[0] || {}));
    if (!workHeaders.has("outcome_status") && !workHeaders.has("accepted")) {
      throw new Error("Work log is missing outcome_status. Older files may use accepted instead.");
    }
    if (!workHeaders.has("human_minutes") && !workHeaders.has("human_review_minutes")) {
      throw new Error("Work log is missing human_minutes. Older files may use human_review_minutes.");
    }
    const allowedPeriods = new Set(["baseline", "proposed"]);
    if (spendRows.some((row) => !allowedPeriods.has(row.period.toLowerCase()))) {
      throw new Error("Spend period must be baseline or proposed.");
    }
    if (workRows.some((row) => !allowedPeriods.has(row.period.toLowerCase()))) {
      throw new Error("Work-log period must be baseline or proposed.");
    }
    const hashes = { spend: await sha256(spendText), work: await sha256(workText) };
    const baselineBuild = buildScenario("baseline", spendRows, workRows, config, hashes);
    const proposedBuild = buildScenario("proposed", spendRows, workRows, config, hashes);
    if (baselineBuild.currency !== proposedBuild.currency) {
      throw new Error("Baseline and proposed spend use different currencies.");
    }
    if (baselineBuild.workload !== proposedBuild.workload) {
      throw new Error("Baseline and proposed files must describe the same workload.");
    }
    const baseline = baselineBuild.scenario;
    const proposed = proposedBuild.scenario;
    const planning = buildPlanningRecord(baseline, proposed, config.planning);
    const baselineUnit = baseline.measures.cost_per_usable_result;
    const proposedUnit = proposed.measures.cost_per_usable_result;
    const recurringDifference = proposed.costs.recurring_operating_cost - baseline.costs.recurring_operating_cost;
    const unitDifference = proposedUnit - baselineUnit;
    const unitChangePct = baselineUnit ? (unitDifference / baselineUnit) * 100 : 0;
    const qualityHolds = proposed.measures.usable_result_rate >= config.qualityFloor;
    const bothPolicyApproved = baseline.policy.approved && proposed.policy.approved;
    const evidenceComplete = [baseline, proposed].every(
      (scenario) => scenario.evidence.coverage_status === "complete" && !scenario.evidence.reconciliation_issues.length,
    );
    const sameCostBasis = baseline.evidence.cost_basis === proposed.evidence.cost_basis;
    const providerCostReported = [baseline, proposed].every(
      (scenario) => scenario.evidence.cost_basis === "observed",
    );
    const savingsClaimAllowed = unitDifference < 0 && qualityHolds && bothPolicyApproved && evidenceComplete && sameCostBasis && providerCostReported;
    const normalizedProposed = proposedUnit * baseline.outcomes.usable_results;
    const normalizedDifference = normalizedProposed - baseline.costs.recurring_operating_cost;
    const savingsPerResult = baselineUnit - proposedUnit;
    const payback = savingsPerResult > 0 && proposed.costs.one_time_change_cost > 0
      ? Math.ceil(proposed.costs.one_time_change_cost / savingsPerResult)
      : null;
    let status = "no_improvement";
    let recommendation = "Leave the current route in place. The proposed route does not lower recurring cost per usable result.";
    if (unitDifference < 0 && savingsClaimAllowed) {
      status = "observed_improvement";
      recommendation = payback
        ? `The proposed route has a lower observed cost per usable result. The one time change cost is earned back after about ${payback.toLocaleString()} accepted results.`
        : "The proposed route has a lower observed cost per usable result and clears the declared quality and policy gates.";
    } else if (unitDifference < 0) {
      status = "needs_evidence";
      recommendation = providerCostReported
        ? "Test the proposed route, but fix the evidence gaps before calling the lower number savings."
        : `The proposed route has a lower ${costBasisLabel(proposed.evidence.cost_basis).toLowerCase()} per usable result. Confirm it with provider-reported spend before calling the difference savings.`;
    }
    const allDates = [...baselineBuild.dates, ...proposedBuild.dates].sort();
    return {
      schema_version: "ai-cost-lens-review-result/1.0",
      mode: "real",
      currency: baselineBuild.currency,
      period: { start: allDates[0], end: allDates.at(-1), timezone: "UTC" },
      workload: {
        name: baselineBuild.workload,
        description: `Finance review of one repeatable AI workload across a baseline and proposed period.`,
        outcome_unit: "usable result",
        accepted_quality_threshold: config.qualityFloor,
      },
      baseline,
      proposed,
      comparison: {
        status,
        finding: "",
        limitation: savingsClaimAllowed
          ? "The observed cost and accepted-work records reconcile for the declared boundary. This conclusion does not extend beyond this workload and period."
          : providerCostReported
            ? "The lower number does not clear every evidence, quality, and policy gate required for a savings claim."
            : `${costBasisLabel(proposed.evidence.cost_basis)} is not a provider-reported invoice amount. The comparison can support a test decision, not booked savings.`,
        recommendation,
        savings_claim_allowed: savingsClaimAllowed,
        same_cost_basis: sameCostBasis,
        provider_cost_reported: providerCostReported,
        quality_holds: qualityHolds,
        both_policy_approved: bothPolicyApproved,
        evidence_complete: evidenceComplete,
        recurring_cost_difference: round(recurringDifference),
        cost_per_usable_result_difference: round(unitDifference),
        cost_per_usable_result_change_pct: round(unitChangePct, 1),
        usable_result_rate_change_points: round((proposed.measures.usable_result_rate - baseline.measures.usable_result_rate) * 100, 1),
        normalized_proposed_cost_at_baseline_volume: round(normalizedProposed),
        normalized_cost_difference: round(normalizedDifference),
        payback_usable_results: payback,
      },
      ...(planning ? { planning } : {}),
    };
  }

  function wilsonInterval(successes, total, z = 1.96) {
    if (!total) return [0, 0];
    const rate = successes / total;
    const denominator = 1 + (z * z) / total;
    const center = (rate + (z * z) / (2 * total)) / denominator;
    const margin =
      (z / denominator) *
      Math.sqrt((rate * (1 - rate)) / total + (z * z) / (4 * total * total));
    return [round(Math.max(0, center - margin)), round(Math.min(1, center + margin))];
  }

  function buildSampledScenario(period, spendRows, sample, config, hashes) {
    const spend = spendRows.filter((row) => row.period.toLowerCase() === period);
    if (!spend.length) throw new Error(`The spend file has no ${period} rows.`);

    const dates = spend.map((row, index) => validDate(row.date, `Spend ${period} row ${index + 2} date`));
    const minDate = [...dates].sort()[0];
    const maxDate = [...dates].sort().at(-1);
    const workload = spend[0].workload.trim();
    if (!workload) throw new Error(`Spend ${period} workload is required.`);
    if (spend.some((row) => row.workload.trim() !== workload)) {
      throw new Error(`Spend ${period} rows contain more than one workload.`);
    }

    const currencies = new Set(spend.map((row) => row.currency.trim().toUpperCase()));
    if (currencies.size !== 1 || !/^[A-Z]{3}$/.test([...currencies][0])) {
      throw new Error(`Spend ${period} rows must use one three-letter currency.`);
    }
    const basis = spendCostBasis(spend, period);

    let requests = 0;
    let processedInput = 0;
    let cachedInput = 0;
    let cacheWriteInput = 0;
    let outputTokens = 0;
    let providerCost = 0;
    spend.forEach((row, index) => {
      const rowNumber = index + 2;
      const rowInput = finiteNumber(row.input_tokens, `Spend ${period} row ${rowNumber} input_tokens`, { integer: true });
      const rowCached = finiteNumber(row.cached_input_tokens, `Spend ${period} row ${rowNumber} cached_input_tokens`, { integer: true });
      const rowCacheWrite = finiteNumber(row.cache_write_input_tokens, `Spend ${period} row ${rowNumber} cache_write_input_tokens`, { integer: true });
      if (rowCached + rowCacheWrite > rowInput) {
        throw new Error(`Spend ${period} row ${rowNumber} has more cached and cache-write tokens than input tokens.`);
      }
      requests += finiteNumber(row.requests, `Spend ${period} row ${rowNumber} requests`, { integer: true });
      processedInput += rowInput;
      cachedInput += rowCached;
      cacheWriteInput += rowCacheWrite;
      outputTokens += finiteNumber(row.output_tokens, `Spend ${period} row ${rowNumber} output_tokens`, { integer: true });
      providerCost += finiteNumber(row.provider_cost, `Spend ${period} row ${rowNumber} provider_cost`);
    });
    if (requests === 0) throw new Error(`Spend ${period} requests must be greater than zero.`);

    const population = finiteNumber(sample.population, `${period} results in period`, { integer: true });
    const ready = finiteNumber(sample.ready, `${period} ready sample`, { integer: true });
    const correction = finiteNumber(sample.correction, `${period} correction sample`, { integer: true });
    const escalation = finiteNumber(sample.escalation, `${period} escalation sample`, { integer: true });
    const sampleMinutes = finiteNumber(sample.humanMinutes, `${period} sample human minutes`);
    const sampleSize = ready + correction + escalation;
    if (!sampleSize) throw new Error(`The ${period} sample is empty.`);
    if (!ready) throw new Error(`The ${period} sample has no ready-to-use results.`);
    if (sampleSize > population) {
      throw new Error(`The ${period} sample cannot be larger than the declared results in the period.`);
    }

    const readyRate = ready / sampleSize;
    const estimatedReady = population * readyRate;
    const estimatedCorrection = population * (correction / sampleSize);
    const estimatedEscalation = population * (escalation / sampleSize);
    const projectedHumanMinutes = (sampleMinutes / sampleSize) * population;
    const humanCost = (projectedHumanMinutes / 60) * config.hourlyRate;
    const sharedCost = period === "baseline" ? config.baselineShared : config.proposedShared;
    const changeCost = period === "proposed" ? config.changeCost : 0;
    const recurring = providerCost + humanCost + sharedCost;
    const allIn = recurring + changeCost;
    const route = [...new Set(spend.map((row) => row.route.trim()).filter(Boolean))].join(", ") || `${period} route`;
    const models = [...new Set(spend.map((row) => row.model.trim()).filter(Boolean))];
    const providers = [...new Set(spend.map((row) => row.provider.trim()).filter(Boolean))];
    const [intervalLow, intervalHigh] = wilsonInterval(ready, sampleSize);

    return {
      dates,
      currency: [...currencies][0],
      workload,
      scenario: {
        id: period,
        label: period === "baseline" ? "Current route" : "Proposed route",
        model: {
          provider: providers.join(", ") || "Provider not named",
          name: models.join(", ") || "Model not named",
          route,
        },
        costs: {
          model_cost: round(providerCost),
          shared_infrastructure_cost: round(sharedCost),
          human_review_cost: round(humanCost),
          one_time_change_cost: round(changeCost),
          recurring_operating_cost: round(recurring),
          all_in_pilot_cost: round(allIn),
        },
        usage: {
          requests,
          retries: null,
          unique_input_tokens: null,
          processed_input_tokens: processedInput,
          cached_input_tokens: cachedInput,
          cache_write_input_tokens: cacheWriteInput,
          output_tokens: outputTokens,
        },
        outcomes: {
          basis: "sampled",
          completed_results: population,
          usable_results: round(estimatedReady),
          status_counts: {
            ready_to_use: round(estimatedReady),
            needs_correction: round(estimatedCorrection),
            needs_escalation: round(estimatedEscalation),
          },
          sample_counts: {
            ready_to_use: ready,
            needs_correction: correction,
            needs_escalation: escalation,
          },
          sample_size: sampleSize,
          sample_method: config.sampleRandom ? "declared random or systematic" : "user selected",
          ready_rate_interval_95: [intervalLow, intervalHigh],
          human_review_minutes: round(projectedHumanMinutes),
          sample_human_minutes: round(sampleMinutes),
          review_minutes: round(projectedHumanMinutes),
          correction_minutes: 0,
          verifier: config.verifier,
          acceptance_rule: config.acceptanceRule,
        },
        policy: {
          approved: policyApproval(config, period),
          retention_mode: policyApproval(config, period) ? "Declared approved by reviewer" : "Approval not established",
        },
        evidence: {
          cost_basis: basis,
          outcome_basis: "sampled",
          source: `${costBasisLabel(basis)} from the universal spend template + sampled outcome counts`,
          observed_at: maxDate,
          coverage: `${sampleSize} of ${population.toLocaleString()} results reviewed; outcome yield and human time extrapolated`,
          coverage_status: "sampled",
          reconciliation_issues: [],
          cost_boundary: "provider cost + declared shared infrastructure + sampled human review and correction",
          provider_usage_sha256: hashes.spend,
          provider_cost_sha256: hashes.spend,
          outcome_log_sha256: hashes.sample,
        },
        measures: {
          cost_per_usable_result: round(recurring / estimatedReady),
          all_in_cost_per_usable_result: round(allIn / estimatedReady),
          usable_result_rate: round(readyRate),
          retry_rate: null,
          cache_reuse_rate: processedInput ? round(cachedInput / processedInput) : 0,
          cache_write_rate: processedInput ? round(cacheWriteInput / processedInput) : 0,
          context_reprocessing_ratio: null,
          human_review_minutes_per_usable_result: round(projectedHumanMinutes / estimatedReady),
        },
      },
    };
  }

  async function buildSampledReview(spendText, samples, config) {
    const spendRows = parseCsv(spendText, "Spend file");
    requireColumns(
      spendRows,
      ["period", "date", "workload", "provider", "model", "route", "requests", "input_tokens", "cached_input_tokens", "cache_write_input_tokens", "output_tokens", "provider_cost", "cost_basis", "currency"],
      "Spend file",
    );
    const allowedPeriods = new Set(["baseline", "proposed"]);
    if (spendRows.some((row) => !allowedPeriods.has(row.period.toLowerCase()))) {
      throw new Error("Spend period must be baseline or proposed.");
    }
    const sampleText = JSON.stringify({ samples, sampleRandom: config.sampleRandom });
    const hashes = { spend: await sha256(spendText), sample: await sha256(sampleText) };
    const baselineBuild = buildSampledScenario("baseline", spendRows, samples.baseline, config, hashes);
    const proposedBuild = buildSampledScenario("proposed", spendRows, samples.proposed, config, hashes);
    if (baselineBuild.currency !== proposedBuild.currency) {
      throw new Error("Baseline and proposed spend use different currencies.");
    }
    if (baselineBuild.workload !== proposedBuild.workload) {
      throw new Error("Baseline and proposed files must describe the same workload.");
    }

    const baseline = baselineBuild.scenario;
    const proposed = proposedBuild.scenario;
    const planning = buildPlanningRecord(baseline, proposed, config.planning);
    const baselineUnit = baseline.measures.cost_per_usable_result;
    const proposedUnit = proposed.measures.cost_per_usable_result;
    const recurringDifference = proposed.costs.recurring_operating_cost - baseline.costs.recurring_operating_cost;
    const unitDifference = proposedUnit - baselineUnit;
    const unitChangePct = baselineUnit ? (unitDifference / baselineUnit) * 100 : 0;
    const qualityHolds = proposed.measures.usable_result_rate >= config.qualityFloor;
    const normalizedProposed = proposedUnit * baseline.outcomes.usable_results;
    const normalizedDifference = normalizedProposed - baseline.costs.recurring_operating_cost;
    const savingsPerResult = baselineUnit - proposedUnit;
    const payback = savingsPerResult > 0 && proposed.costs.one_time_change_cost > 0
      ? Math.ceil(proposed.costs.one_time_change_cost / savingsPerResult)
      : null;
    const lower = unitDifference < 0;
    const sameCostBasis = baseline.evidence.cost_basis === proposed.evidence.cost_basis;
    const providerCostReported = [baseline, proposed].every(
      (scenario) => scenario.evidence.cost_basis === "observed",
    );
    const allDates = [...baselineBuild.dates, ...proposedBuild.dates].sort();

    return {
      schema_version: "ai-cost-lens-review-result/1.0",
      mode: "sampled",
      currency: baselineBuild.currency,
      period: { start: allDates[0], end: allDates.at(-1), timezone: "UTC" },
      workload: {
        name: baselineBuild.workload,
        description: "Finance review of one repeatable AI workload using provider spend and sampled outcomes.",
        outcome_unit: "ready result",
        accepted_quality_threshold: config.qualityFloor,
      },
      baseline,
      proposed,
      comparison: {
        status: lower ? "sampled_improvement" : "sampled_no_improvement",
        finding: "",
        limitation: `${providerCostReported ? "Provider spend is reported" : `${costBasisLabel(proposed.evidence.cost_basis)} is used`}. Outcome yield and human time are extrapolated from samples of ${baseline.outcomes.sample_size} and ${proposed.outcomes.sample_size}; this is not booked savings.`,
        recommendation: lower
          ? "The proposed route looks lower per ready result in this sample. Repeat or expand the sample before treating the difference as savings."
          : "The proposed route does not improve cost per ready result in this sample. Do not change routes on the provider rate alone.",
        savings_claim_allowed: false,
        same_cost_basis: sameCostBasis,
        provider_cost_reported: providerCostReported,
        quality_holds: qualityHolds,
        both_policy_approved: baseline.policy.approved && proposed.policy.approved,
        evidence_complete: false,
        outcome_evidence_basis: "sampled",
        recurring_cost_difference: round(recurringDifference),
        cost_per_usable_result_difference: round(unitDifference),
        cost_per_usable_result_change_pct: round(unitChangePct, 1),
        usable_result_rate_change_points: round((proposed.measures.usable_result_rate - baseline.measures.usable_result_rate) * 100, 1),
        normalized_proposed_cost_at_baseline_volume: round(normalizedProposed),
        normalized_cost_difference: round(normalizedDifference),
        payback_usable_results: payback,
      },
      ...(planning ? { planning } : {}),
    };
  }

  function openAIBucketDay(row, label) {
    if (row.start_time_iso) {
      const day = row.start_time_iso.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) {
        throw new Error(`${label} start_time_iso is invalid.`);
      }
      return day;
    }
    const seconds = finiteNumber(row.start_time, `${label} start_time`, { integer: true });
    return new Date(seconds * 1000).toISOString().slice(0, 10);
  }

  function rowCoverage(rows, field) {
    const attributed = rows.filter((row) => row[field] !== "unattributed").length;
    return {
      attributed_rows: attributed,
      total_rows: rows.length,
      row_coverage_pct: round((attributed / rows.length) * 100, 1),
    };
  }

  function openAIUsageTotals(rows) {
    const fields = [
      "requests",
      "input_tokens",
      "uncached_input_tokens",
      "cached_input_tokens",
      "cache_write_input_tokens",
      "output_tokens",
    ];
    return Object.fromEntries(
      fields.map((field) => [field, rows.reduce((total, row) => total + row[field], 0)]),
    );
  }

  function groupOpenAIUsage(rows, field) {
    const groups = new Map();
    rows.forEach((row) => {
      if (!groups.has(row[field])) groups.set(row[field], []);
      groups.get(row[field]).push(row);
    });
    return [...groups.entries()]
      .map(([name, values]) => ({ [field]: name, ...openAIUsageTotals(values) }))
      .sort((a, b) => b.requests - a.requests || String(a[field]).localeCompare(String(b[field])));
  }

  async function buildOpenAIBillReview(usageText, costText) {
    const rawUsage = parseCsv(usageText, "OpenAI usage export");
    const rawCosts = parseCsv(costText, "OpenAI cost export");
    requireColumns(
      rawUsage,
      ["start_time", "end_time", "project_id", "num_model_requests", "model", "service_tier", "input_tokens", "output_tokens", "input_cached_tokens", "input_cache_write_tokens", "input_uncached_tokens"],
      "OpenAI usage export",
    );
    requireColumns(
      rawCosts,
      ["start_time", "end_time", "amount_value", "amount_currency", "line_item", "project_id"],
      "OpenAI cost export",
    );
    const usageDates = [...new Set(rawUsage.map((row, index) => openAIBucketDay(row, `Usage row ${index + 2}`)))].sort();
    const costDates = [...new Set(rawCosts.map((row, index) => openAIBucketDay(row, `Cost row ${index + 2}`)))].sort();
    const usageRows = rawUsage.flatMap((row, index) => {
      if (![row.num_model_requests, row.model, row.input_tokens, row.output_tokens].some((value) => value)) return [];
      const label = `Usage row ${index + 2}`;
      const input = finiteNumber(row.input_tokens || 0, `${label} input_tokens`, { integer: true });
      const cached = finiteNumber(row.input_cached_tokens || 0, `${label} input_cached_tokens`, { integer: true });
      const cacheWrite = finiteNumber(row.input_cache_write_tokens || 0, `${label} input_cache_write_tokens`, { integer: true });
      const uncached = row.input_uncached_tokens === ""
        ? input - cached - cacheWrite
        : finiteNumber(row.input_uncached_tokens, `${label} input_uncached_tokens`, { integer: true });
      if (uncached < 0 || uncached + cached + cacheWrite !== input) {
        throw new Error(`${label} input token categories do not reconcile to input_tokens.`);
      }
      return [{
        date: openAIBucketDay(row, label),
        model: row.model || "unattributed",
        project: row.project_id || "unattributed",
        api_key: row.api_key_id || "unattributed",
        service_tier: row.service_tier || "unattributed",
        requests: finiteNumber(row.num_model_requests || 0, `${label} num_model_requests`, { integer: true }),
        input_tokens: input,
        uncached_input_tokens: uncached,
        cached_input_tokens: cached,
        cache_write_input_tokens: cacheWrite,
        output_tokens: finiteNumber(row.output_tokens || 0, `${label} output_tokens`, { integer: true }),
      }];
    });
    if (!usageRows.length) throw new Error("The OpenAI usage export has no populated usage rows.");
    const costRows = rawCosts.flatMap((row, index) => {
      if (row.amount_value === "") return [];
      const label = `Cost row ${index + 2}`;
      const currency = row.amount_currency.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`${label} amount_currency must be a three-letter code.`);
      return [{
        date: openAIBucketDay(row, label),
        amount: finiteNumber(row.amount_value, `${label} amount_value`),
        currency,
        project: row.project_id || "unattributed",
        api_key: row.api_key_id || "unattributed",
        line_item: row.line_item || "unattributed",
      }];
    });
    if (!costRows.length) throw new Error("The OpenAI cost export has no populated cost rows.");
    const currencies = new Set(costRows.map((row) => row.currency));
    if (currencies.size !== 1) throw new Error("One bill review cannot mix currencies.");
    const aligned = JSON.stringify(usageDates) === JSON.stringify(costDates);
    const costProject = rowCoverage(costRows, "project");
    const projectJoin = costProject.row_coverage_pct === 100;
    const limitations = [
      "The saved cost export does not attribute billed dollars to models, so AI Cost Lens does not allocate cost using token share.",
      "The provider exports do not establish whether a result was usable, how much human correction it required, or what business outcome it produced.",
    ];
    if (!projectJoin) limitations.splice(1, 0, "The saved cost export does not fully attribute cost to projects, so project-level billed cost is unavailable.");
    if (!aligned) limitations.unshift("The usage and cost exports do not cover the same daily buckets.");
    return {
      schema_version: "ai-cost-lens-openai-bill-review/0.1",
      provider: "openai",
      mode: "real",
      period: {
        timezone: "UTC",
        start: [...usageDates, ...costDates].sort()[0],
        end: [...usageDates, ...costDates].sort().at(-1),
        usage_dates: usageDates,
        cost_dates: costDates,
        aligned,
      },
      bill: {
        basis: "provider_reported",
        currency: [...currencies][0],
        total: round(costRows.reduce((total, row) => total + row.amount, 0)),
        populated_rows: costRows.length,
        days_with_cost: new Set(costRows.map((row) => row.date)).size,
      },
      usage: {
        basis: "provider_reported",
        totals: openAIUsageTotals(usageRows),
        populated_rows: usageRows.length,
        days_with_usage: new Set(usageRows.map((row) => row.date)).size,
        by_model: groupOpenAIUsage(usageRows, "model"),
        by_project: groupOpenAIUsage(usageRows, "project"),
      },
      coverage: {
        usage_model: rowCoverage(usageRows, "model"),
        usage_project: rowCoverage(usageRows, "project"),
        usage_api_key: rowCoverage(usageRows, "api_key"),
        usage_service_tier: rowCoverage(usageRows, "service_tier"),
        cost_project: costProject,
        cost_api_key: rowCoverage(costRows, "api_key"),
        cost_line_item: rowCoverage(costRows, "line_item"),
      },
      reconciliation: {
        status: aligned ? "ready_for_bill_review" : "period_mismatch",
        periods_aligned: aligned,
        project_cost_join_supported: projectJoin,
        model_cost_allocation_supported: false,
        outcome_cost_supported: false,
        savings_claim_allowed: false,
      },
      finding: "This export supports a total bill review and a usage-mix review. It does not support billed cost by model or cost per usable result.",
      limitations,
      next_step: "Add a workload outcome log before comparing cost per usable result or claiming savings.",
      source: {
        usage_export: "OpenAI Usage dashboard completions CSV",
        cost_export: "OpenAI Usage dashboard cost CSV",
        usage_sha256: await sha256(usageText),
        cost_sha256: await sha256(costText),
      },
    };
  }

  function validateResult(data) {
    if (data?.schema_version === "ai-cost-lens-openai-bill-review/0.1") {
      if (!data.bill || !data.usage || !data.coverage || !data.reconciliation) {
        throw new Error("The OpenAI bill review is missing required sections.");
      }
      return;
    }
    if (!data || data.schema_version !== "ai-cost-lens-review-result/1.0") {
      throw new Error("That file is not an AI Cost Lens review result.");
    }
    if (!data.baseline || !data.proposed || !data.comparison || !data.workload) {
      throw new Error("The review result is missing required sections.");
    }
  }

  function scenarioLabel(scenario) {
    return `${escapeHtml(scenario.label)} · ${escapeHtml(scenario.model.name)}`;
  }

  function outcomeCounts(scenario) {
    if (scenario.outcomes.sample_counts) {
      const supplied = scenario.outcomes.sample_counts;
      return {
        completed: scenario.outcomes.sample_size,
        ready: Number(supplied.ready_to_use),
        correction: Number(supplied.needs_correction),
        escalation: Number(supplied.needs_escalation),
        sampled: true,
      };
    }
    const completed = scenario.outcomes.completed_results;
    const supplied = scenario.outcomes.status_counts || {};
    const ready = Number(supplied.ready_to_use ?? scenario.outcomes.usable_results);
    const correction = Number(supplied.needs_correction ?? 0);
    const escalation = Number(
      supplied.needs_escalation ?? Math.max(completed - ready - correction, 0),
    );
    return { completed, ready, correction, escalation, sampled: false };
  }

  function renderYieldRoute(scenario) {
    const counts = outcomeCounts(scenario);
    const shares = [counts.ready, counts.correction, counts.escalation].map(
      (value) => (counts.completed ? (value / counts.completed) * 100 : 0),
    );
    const perHundred = shares.map((value) => Math.round(value));
    return `
      <div class="yield-route">
        <div class="yield-route-head">
          <strong>${escapeHtml(scenario.label)}</strong>
          <span>${compact(counts.completed)} ${counts.sampled ? "reviewed" : "attempts"}</span>
        </div>
        <div class="yield-bar" aria-label="${perHundred[0]} ready to use, ${perHundred[1]} need correction, and ${perHundred[2]} need escalation for every 100 ${counts.sampled ? "sampled results" : "attempts"}">
          <div class="yield-ready" style="width:${shares[0].toFixed(2)}%"></div>
          <div class="yield-correction" style="width:${shares[1].toFixed(2)}%"></div>
          <div class="yield-escalation" style="width:${shares[2].toFixed(2)}%"></div>
        </div>
        <div class="yield-legend">
          <div><strong>${perHundred[0]}</strong><span>ready to use</span></div>
          <div><strong>${perHundred[1]}</strong><span>need correction</span></div>
          <div><strong>${perHundred[2]}</strong><span>need escalation</span></div>
        </div>
      </div>`;
  }

  function renderTruthSection() {
    const { baseline, proposed, comparison } = state.data;
    const baselineUnit = baseline.measures.cost_per_usable_result;
    const proposedUnit = proposed.measures.cost_per_usable_result;
    const lower = proposedUnit < baselineUnit;
    const change = baselineUnit ? ((proposedUnit - baselineUnit) / baselineUnit) * 100 : 0;
    const sampled = baseline.outcomes.basis === "sampled" || proposed.outcomes.basis === "sampled";
    const providerTerm = providerCostTerm(baseline, proposed);
    const costBasisEvidence = comparison.same_cost_basis
      ? costBasisLabel(proposed.evidence.cost_basis).toUpperCase()
      : "MIXED COST BASIS";
    const evidenceLabel = sampled
      ? `SAMPLED n=${baseline.outcomes.sample_size} / ${proposed.outcomes.sample_size} · ${baseline.outcomes.sample_method === "declared random or systematic" && proposed.outcomes.sample_method === "declared random or systematic" ? "RANDOM / SYSTEMATIC" : "USER-SELECTED"} · ${costBasisEvidence}`
      : state.data.mode === "illustrative"
        ? "ILLUSTRATIVE"
        : `OBSERVED OUTCOMES · ${costBasisEvidence}`;
    const metricRows = [
      {
        label: sentenceCase(providerTerm),
        current: money(baseline.costs.model_cost),
        proposed: money(proposed.costs.model_cost),
        change: baseline.costs.model_cost
          ? `${proposed.costs.model_cost <= baseline.costs.model_cost ? "↓" : "↑"} ${Math.abs(((proposed.costs.model_cost - baseline.costs.model_cost) / baseline.costs.model_cost) * 100).toFixed(1)}%`
          : "Not comparable",
        meaning: providerCostsReported(baseline, proposed, comparison)
          ? "Provider-reported model and API charges"
          : "Model and API cost using the declared basis",
      },
      {
        label: "Total recurring cost",
        current: money(baseline.costs.recurring_operating_cost),
        proposed: money(proposed.costs.recurring_operating_cost),
        change: baseline.costs.recurring_operating_cost
          ? `${proposed.costs.recurring_operating_cost <= baseline.costs.recurring_operating_cost ? "↓" : "↑"} ${Math.abs(((proposed.costs.recurring_operating_cost - baseline.costs.recurring_operating_cost) / baseline.costs.recurring_operating_cost) * 100).toFixed(1)}%`
          : "Not comparable",
        meaning: "Provider + shared + human work",
      },
      {
        label: "Ready results",
        current: compact(baseline.outcomes.usable_results),
        proposed: compact(proposed.outcomes.usable_results),
        change: `${proposed.outcomes.usable_results >= baseline.outcomes.usable_results ? "+" : "−"}${compact(Math.abs(proposed.outcomes.usable_results - baseline.outcomes.usable_results))}`,
        meaning: "Outputs that cleared the same rule",
      },
      {
        label: "Cost per ready result",
        current: unitMoney(baselineUnit),
        proposed: unitMoney(proposedUnit),
        change: `${lower ? "↓" : "↑"} ${Math.abs(change).toFixed(1)}%`,
        meaning: "The decision metric",
        emphasis: true,
      },
    ];
    document.getElementById("truth-summary").textContent =
      `Four numbers tell the story. ${sentenceCase(providerTerm)} can fall while the cost of usable work rises.`;
    document.getElementById("unit-economics-card").innerHTML = `
      <div class="decision-table-heading">
        <div><span>DECISION LEDGER</span><strong>${lower ? "The proposed route is cheaper per ready result." : "The cheaper bill did not produce cheaper work."}</strong></div>
        <span class="evidence-pill ${state.data.mode === "illustrative" ? "is-illustrative" : sampled ? "is-sampled" : "is-observed"}">${escapeHtml(evidenceLabel)}</span>
      </div>
      <div class="decision-table-wrap">
        <table class="decision-table">
          <thead><tr><th>Metric</th><th>${escapeHtml(baseline.label)}</th><th>${escapeHtml(proposed.label)}</th><th>Change</th><th>What it includes</th></tr></thead>
          <tbody>
            ${metricRows.map((row) => `
              <tr class="${row.emphasis ? "decision-row" : ""}">
                <th scope="row">${escapeHtml(row.label)}</th>
                <td data-label="${escapeHtml(baseline.label)}">${escapeHtml(row.current)}</td>
                <td data-label="${escapeHtml(proposed.label)}">${escapeHtml(row.proposed)}</td>
                <td data-label="Change">${escapeHtml(row.change)}</td>
                <td data-label="What it includes">${escapeHtml(row.meaning)}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <p class="table-boundary">${escapeHtml(
        comparison.savings_claim_allowed
          ? "The bill, ready result log, quality floor, policy, and cost basis reconcile."
          : sampled
            ? "The spend is observed. Outcome yield and human work are extrapolated from the reviewed samples, so the difference remains a test result, not booked savings."
            : "This is a financial comparison, not booked savings. The evidence check below shows what is still missing.",
      )}</p>`;
    document.getElementById("outcome-yield-card").innerHTML = `
      <div class="yield-header">
        <div><span>OUTCOME YIELD</span><strong>For every 100 attempts</strong></div>
        <span>QUALITY FLOOR ${pct(state.data.workload.accepted_quality_threshold)}</span>
      </div>
      ${renderYieldRoute(baseline)}
      ${renderYieldRoute(proposed)}`;
    configureBreakEvenExplorer();
    renderLumenPanel();
  }

  function setRange(input, value, maximum) {
    const safeMax = Math.max(maximum, value, 1);
    input.min = "0";
    input.max = String(safeMax);
    input.step = "any";
    input.value = String(value);
    input.dataset.original = String(value);
  }

  function configureBreakEvenExplorer() {
    const { proposed } = state.data;
    const yieldInput = document.getElementById("yield-slider");
    yieldInput.value = String(proposed.measures.usable_result_rate * 100);
    yieldInput.dataset.original = yieldInput.value;
    setRange(
      document.getElementById("provider-slider"),
      proposed.costs.model_cost,
      Math.max(proposed.costs.model_cost * 2, state.data.baseline.costs.model_cost * 1.2),
    );
    setRange(
      document.getElementById("human-slider"),
      proposed.costs.human_review_cost,
      Math.max(proposed.costs.human_review_cost * 2, state.data.baseline.costs.human_review_cost * 1.2),
    );
    updateBreakEvenExplorer();
  }

  function updateBreakEvenExplorer() {
    if (!state.data || state.data.schema_version !== "ai-cost-lens-review-result/1.0") return;
    const { baseline, proposed } = state.data;
    const yieldRate = Number(document.getElementById("yield-slider").value) / 100;
    const providerCost = Number(document.getElementById("provider-slider").value);
    const humanCost = Number(document.getElementById("human-slider").value);
    const resultCount = proposed.outcomes.completed_results;
    const readyResults = resultCount * yieldRate;
    const modeledRecurring = providerCost + proposed.costs.shared_infrastructure_cost + humanCost;
    const modeledUnit = readyResults ? modeledRecurring / readyResults : Infinity;
    const currentUnit = baseline.measures.cost_per_usable_result;
    const delta = currentUnit ? ((modeledUnit - currentUnit) / currentUnit) * 100 : 0;
    const breakEvenYield = resultCount && currentUnit
      ? (modeledRecurring / (currentUnit * resultCount)) * 100
      : Infinity;

    document.getElementById("yield-slider-value").textContent = `${(yieldRate * 100).toFixed(1)}%`;
    document.getElementById("provider-slider-value").textContent = money(providerCost);
    document.getElementById("human-slider-value").textContent = money(humanCost);
    document.getElementById("break-even-unit-cost").textContent = Number.isFinite(modeledUnit)
      ? unitMoney(modeledUnit)
      : "Unavailable";
    const hasReadyResults = readyResults > 0;
    document.getElementById("break-even-verdict").textContent = !hasReadyResults
      ? "NO READY RESULTS"
      : delta <= 0
        ? "PROPOSED ROUTE WINS"
        : "CURRENT ROUTE STILL WINS";
    document.getElementById("break-even-verdict").classList.toggle("wins", hasReadyResults && delta <= 0);
    document.getElementById("break-even-copy").textContent = !hasReadyResults
      ? `At 0% ready, the proposed route produces no usable result, so a unit cost cannot be calculated. At these costs it needs ${breakEvenYield.toFixed(1)}% of attempts to be ready to match ${unitMoney(currentUnit)}.`
      : breakEvenYield <= 100
        ? `At these costs, the proposed route needs ${breakEvenYield.toFixed(1)}% of attempts to be ready to match ${unitMoney(currentUnit)}. The slider currently models ${readyResults.toFixed(0)} ready results and a ${Math.abs(delta).toFixed(1)}% ${delta <= 0 ? "advantage" : "premium"}.`
        : `Even a 100% ready result rate would not match ${unitMoney(currentUnit)} at these costs. Reduce the provider or human work line first.`;
  }

  function lumenFacts() {
    const { baseline, proposed, comparison, mode } = state.data;
    const providerChange = baseline.costs.model_cost
      ? ((proposed.costs.model_cost - baseline.costs.model_cost) / baseline.costs.model_cost) * 100
      : 0;
    const recurringChange = baseline.costs.recurring_operating_cost
      ? ((proposed.costs.recurring_operating_cost - baseline.costs.recurring_operating_cost) / baseline.costs.recurring_operating_cost) * 100
      : 0;
    const completed = proposed.outcomes.completed_results;
    const requiredReady = Math.ceil(proposed.costs.recurring_operating_cost / baseline.measures.cost_per_usable_result);
    const requiredRate = completed ? (requiredReady / completed) * 100 : null;
    return { baseline, proposed, comparison, mode, providerChange, recurringChange, requiredReady, requiredRate };
  }

  function renderLumenPanel() {
    const facts = lumenFacts();
    const unitChange = facts.comparison.cost_per_usable_result_change_pct;
    const providerTerm = providerCostTerm(facts.baseline, facts.proposed);
    document.getElementById("lumen-panel-title").textContent = unitChange > 0
      ? "Don't switch yet."
      : facts.comparison.savings_claim_allowed
        ? "The proposed route earned approval."
        : "The proposed route earned another test.";
    document.getElementById("lumen-panel-copy").textContent = unitChange > 0
      ? `${sentenceCase(providerTerm)} is lower, but fewer results are ready and human work is higher. Full cost per ready result is ${Math.abs(unitChange).toFixed(1)}% worse.`
      : `The cost per ready result is ${Math.abs(unitChange).toFixed(1)}% lower. The evidence check decides whether that is a real saving or still only an estimate.`;
    document.getElementById("lumen-signals").innerHTML = `
      <div><span>${escapeHtml(sentenceCase(providerTerm))}</span><strong>${facts.providerChange <= 0 ? "↓" : "↑"} ${Math.abs(facts.providerChange).toFixed(1)}%</strong></div>
      <div><span>Ready result rate</span><strong>${pct(facts.baseline.measures.usable_result_rate)} → ${pct(facts.proposed.measures.usable_result_rate)}</strong></div>
      <div><span>Full unit cost</span><strong>${unitMoney(facts.baseline.measures.cost_per_usable_result)} → ${unitMoney(facts.proposed.measures.cost_per_usable_result)}</strong></div>`;
    document.getElementById("lumen-conversation").innerHTML = "";
  }

  function lumenResponse(kind) {
    const facts = lumenFacts();
    const { baseline, proposed, comparison, mode } = facts;
    const issueCount = (baseline.evidence.reconciliation_issues || []).length +
      (proposed.evidence.reconciliation_issues || []).length;
    const providerTerm = providerCostTerm(baseline, proposed);
    const planning = state.data.planning;
    const planCostPosition = planning
      ? planning.variance.recurring_operating_cost > 0
        ? "over"
        : planning.variance.recurring_operating_cost < 0
          ? "under"
          : "exactly on"
      : null;
    const planYieldPosition = planning
      ? planning.variance.ready_result_rate_points > 0
        ? "above"
        : planning.variance.ready_result_rate_points < 0
          ? "below"
          : "exactly on"
      : null;
    const responses = {
      why: `The provider bill fell from ${money(baseline.costs.model_cost)} to ${money(proposed.costs.model_cost)}, but that is only one part of the full cost. Ready results fell from ${compact(baseline.outcomes.usable_results)} to ${compact(proposed.outcomes.usable_results)}, while human review and correction rose from ${money(baseline.costs.human_review_cost)} to ${money(proposed.costs.human_review_cost)}. That pushed the proposed route to ${unitMoney(proposed.measures.cost_per_usable_result)} per ready result, ${Math.abs(comparison.cost_per_usable_result_change_pct).toFixed(1)}% above the current route.`,
      changed: `${sentenceCase(providerTerm)} ${facts.providerChange <= 0 ? "fell" : "rose"} ${Math.abs(facts.providerChange).toFixed(1)}%. Total recurring cost ${facts.recurringChange <= 0 ? "fell" : "rose"} ${Math.abs(facts.recurringChange).toFixed(1)}%. But the ready result rate moved from ${pct(baseline.measures.usable_result_rate)} to ${pct(proposed.measures.usable_result_rate)}, which is why the lower bill did not produce a lower cost per usable result.`,
      improve: facts.requiredRate === null
        ? "The review does not contain enough volume data to calculate a break-even yield."
        : `At the current proposed cost, at least ${compact(facts.requiredReady)} of ${compact(proposed.outcomes.completed_results)} attempts must be ready to match the current ${unitMoney(baseline.measures.cost_per_usable_result)} unit cost. That is a ${facts.requiredRate.toFixed(1)}% ready result rate, compared with ${pct(proposed.measures.usable_result_rate)} now. The break-even explorer lets you test a different yield, provider bill, or human work cost.`,
      evidence: mode === "illustrative"
        ? `The math is complete, but the inputs are illustrative. Before finance relies on this, use the real provider bill and outcome log for one specific workload. Apply the same definition of "ready" to both routes, measure the human correction time, and enter the real cost of making the change. ${issueCount ? `${issueCount} file or math issue${issueCount === 1 ? " is" : "s are"} also open.` : "The synthetic files match each other."}`
        : issueCount
          ? `${issueCount} reconciliation issue${issueCount === 1 ? " is" : "s are"} still open. Open The evidence to see the exact missing or mismatched fields before approving a savings claim.`
          : comparison.savings_claim_allowed
            ? "The bill, work volume, quality rule, policy approval, and included costs all match for this review. That supports this decision for this workload and period, not a claim about the model everywhere."
            : providerCostsReported(baseline, proposed, comparison)
              ? "The files match, but at least one check still blocks a savings claim. Open The evidence to see whether the problem is quality, policy approval, missing outcomes, or mismatched cost data."
              : `The files match, but ${providerTerm} does not come from the provider bill for both routes. Treat the result as a test signal until the bill confirms it.`,
      cfo: comparison.cost_per_usable_result_change_pct > 0
        ? `The proposed route reduces ${providerTerm}, but not the cost of usable work. After shared infrastructure and human correction, each ready result costs ${unitMoney(proposed.measures.cost_per_usable_result)} versus ${unitMoney(baseline.measures.cost_per_usable_result)} today. Keep the current route and test whether the proposed route can reach at least ${facts.requiredRate?.toFixed(1) ?? "the required"}% ready results before changing the default.`
        : `The proposed route produces a ready result for ${unitMoney(proposed.measures.cost_per_usable_result)} versus ${unitMoney(baseline.measures.cost_per_usable_result)} today. ${comparison.savings_claim_allowed ? "The evidence supports the difference for this workload and period." : "Treat the difference as a test result until the missing checks are complete."}`,
      plan: planning
        ? `The current route finished ${money(Math.abs(planning.variance.recurring_operating_cost))} ${planCostPosition} its recurring cost plan. ${planning.variance.primary_cost_drivers.map((driver) => `${sentenceCase(driver.label)} was ${money(Math.abs(driver.amount))} ${driver.amount > 0 ? "over plan" : driver.amount < 0 ? "under plan" : "on plan"}`).join(". ")}. Ready result yield was ${Math.abs(planning.variance.ready_result_rate_points).toFixed(1)} points ${planYieldPosition} plan.`
        : "No approved plan was supplied with this review. Add the planned provider, infrastructure, human work, volume, and ready result assumptions to create a Plan vs Actual check.",
      payback: planning
        ? planning.payback.status === "within_horizon"
          ? `At ${compact(planning.payback.expected_ready_results_per_month)} ready results per month, the modeled change pays back in ${planning.payback.payback_months.toFixed(1)} months, inside the ${planning.payback.decision_horizon_months}-month horizon. The horizon net is ${money(planning.payback.horizon_net_savings)} before any unmodeled risk.`
          : planning.payback.status === "outside_horizon"
            ? `The proposed route would save money each month, but it would take ${planning.payback.payback_months.toFixed(1)} months to recover the change cost. That is longer than the ${planning.payback.decision_horizon_months}-month limit you set.`
            : `There is no operating payback at the supplied quality and cost levels. At ${compact(planning.payback.expected_ready_results_per_month)} ready results per month, the proposed route costs ${money(Math.abs(planning.payback.monthly_operating_savings))} more each month.`
        : "No monthly volume or decision horizon was supplied, so this review can express payback in ready results but not in time.",
      challenge: `The answer depends on four things: both routes did the same work, "ready" meant the same thing on both sides, all human work was counted, and no important cost was left out. This review uses ${money(proposed.costs.one_time_change_cost)} for the change itself and ${money(proposed.costs.shared_infrastructure_cost)} for shared infrastructure. ${mode === "illustrative" ? "Because this is a synthetic example, it demonstrates the method. It does not predict how a real vendor or model will perform." : "Change any of those inputs and the decision could change too."}`,
    };
    return responses[kind] || "I can explain the cost change, the break-even point, the evidence gaps, the plan, the payback, or the assumptions that could reverse the conclusion.";
  }

  function askLumen(kind, question) {
    const conversation = document.getElementById("lumen-conversation");
    conversation.insertAdjacentHTML("beforeend", `
      <div class="lumen-message user-message"><span>YOU</span><p>${escapeHtml(question)}</p></div>
      <div class="lumen-message analyst-message"><span>LUMEN</span><p>${escapeHtml(lumenResponse(kind))}</p></div>`);
    conversation.scrollTop = conversation.scrollHeight;
  }

  function renderPlanning() {
    const section = document.getElementById("planning-section");
    const planning = state.data.planning;
    section.hidden = !planning;
    if (!planning) return;

    const signedNumber = (value) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${compact(Math.abs(value))}`;
    const varianceClass = (value, higherIsBetter = false) => {
      if (!value) return "on-plan";
      const favorable = higherIsBetter ? value > 0 : value < 0;
      return favorable ? "favorable" : "unfavorable";
    };
    const rows = [
      ["Provider cost", money(planning.plan.provider_cost), money(planning.actual.provider_cost), signedMoney(planning.variance.provider_cost), varianceClass(planning.variance.provider_cost)],
      ["Shared infrastructure", money(planning.plan.shared_infrastructure_cost), money(planning.actual.shared_infrastructure_cost), signedMoney(planning.variance.shared_infrastructure_cost), varianceClass(planning.variance.shared_infrastructure_cost)],
      ["Human work", money(planning.plan.human_review_cost), money(planning.actual.human_review_cost), signedMoney(planning.variance.human_review_cost), varianceClass(planning.variance.human_review_cost)],
      ["Total recurring cost", money(planning.plan.recurring_operating_cost), money(planning.actual.recurring_operating_cost), signedMoney(planning.variance.recurring_operating_cost), varianceClass(planning.variance.recurring_operating_cost)],
      ["Ready results", compact(planning.plan.ready_results), compact(planning.actual.ready_results), signedNumber(planning.variance.ready_results), varianceClass(planning.variance.ready_results, true)],
      ["Ready result rate", pct(planning.plan.ready_result_rate), pct(planning.actual.ready_result_rate), `${planning.variance.ready_result_rate_points > 0 ? "+" : ""}${planning.variance.ready_result_rate_points.toFixed(1)} pts`, varianceClass(planning.variance.ready_result_rate_points, true)],
      ["Cost per ready result", unitMoney(planning.plan.cost_per_ready_result), unitMoney(planning.actual.cost_per_ready_result), signedMoney(planning.variance.cost_per_ready_result), varianceClass(planning.variance.cost_per_ready_result)],
    ];
    document.getElementById("planning-label").textContent = planning.label;
    document.getElementById("planning-rows").innerHTML = rows.map(([label, plan, actual, variance, className]) => `
      <tr>
        <th scope="row">${escapeHtml(label)}</th>
        <td>${escapeHtml(plan)}</td>
        <td>${escapeHtml(actual)}</td>
        <td class="variance-${className}">${escapeHtml(variance)}</td>
      </tr>`).join("");

    const drivers = planning.variance.primary_cost_drivers || [];
    const qualityVariance = planning.variance.ready_result_rate_points;
    document.getElementById("variance-notes").innerHTML = [
      ...drivers.map((driver) => `<p><strong>${escapeHtml(driver.label)}</strong><span>${escapeHtml(signedMoney(driver.amount))} ${escapeHtml(driver.direction.replace("_", " "))}</span></p>`),
      `<p><strong>Ready result rate</strong><span>${qualityVariance >= 0 ? "+" : ""}${qualityVariance.toFixed(1)} points ${qualityVariance >= 0 ? "above" : "below"} plan</span></p>`,
    ].join("");

    const payback = planning.payback;
    const paybackVerdict = document.getElementById("payback-verdict");
    const paybackCopy = document.getElementById("payback-copy");
    if (payback.status === "within_horizon") {
      paybackVerdict.textContent = payback.payback_months === 0
        ? "IMMEDIATE OPERATING PAYBACK"
        : `${payback.payback_months.toFixed(1)} MONTH PAYBACK`;
      paybackCopy.textContent = `At the expected monthly ready result volume, the proposed route pays back inside the ${payback.decision_horizon_months}-month decision horizon.`;
    } else if (payback.status === "outside_horizon") {
      paybackVerdict.textContent = "PAYBACK FALLS OUTSIDE THE HORIZON";
      paybackCopy.textContent = `The proposed route would save money each month, but it would not recover the change cost within ${payback.decision_horizon_months} months.`;
    } else {
      paybackVerdict.textContent = "NO OPERATING PAYBACK";
      paybackCopy.textContent = "The proposed route costs more per ready result, so additional volume makes the shortfall larger instead of paying back the change.";
    }
    const horizonValue = payback.horizon_net_savings;
    document.getElementById("payback-metrics").innerHTML = `
      <div><dt>Expected ready results</dt><dd>${compact(payback.expected_ready_results_per_month)} / month</dd></div>
      <div><dt>Monthly savings or shortfall</dt><dd>${signedMoney(payback.monthly_operating_savings)}</dd></div>
      <div><dt>One time change cost</dt><dd>${money(payback.one_time_change_cost)}</dd></div>
      <div><dt>${payback.decision_horizon_months}-month net</dt><dd class="${horizonValue >= 0 ? "positive" : "negative"}">${signedMoney(horizonValue)}</dd></div>`;
  }

  function renderReview() {
    const { baseline, proposed, comparison, workload, period, mode } = state.data;
    document.getElementById("period-label").textContent = `${period.start} to ${period.end} · ${period.timezone}`;
    document.getElementById("mode-tag").textContent =
      mode === "illustrative"
        ? "ILLUSTRATIVE DATA · NOT CUSTOMER DATA"
        : mode === "sampled"
          ? "SAMPLED OUTCOMES · FINANCIAL ESTIMATE"
          : "OBSERVED OUTCOME REVIEW";
    document.getElementById("workload-name").textContent = workload.name;
    document.getElementById("workload-description").textContent = workload.description;
    const baselineUnit = baseline.measures.cost_per_usable_result;
    const proposedUnit = proposed.measures.cost_per_usable_result;
    const modelCostChange = baseline.costs.model_cost
      ? ((proposed.costs.model_cost - baseline.costs.model_cost) / baseline.costs.model_cost) * 100
      : null;
    const readyResultCostChange = baselineUnit
      ? ((proposedUnit - baselineUnit) / baselineUnit) * 100
      : null;
    const providerTerm = providerCostTerm(baseline, proposed);
    if (comparison.savings_claim_allowed) {
      document.getElementById("finding-title").textContent =
        modelCostChange !== null && modelCostChange < 0 && readyResultCostChange !== null
          ? `The provider bill fell ${Math.abs(modelCostChange).toFixed(1)}%. The cost of a ready result fell ${Math.abs(readyResultCostChange).toFixed(1)}%.`
          : `${proposed.label} cost ${unitMoney(proposedUnit)} for each result that was ready to use. ${baseline.label} cost ${unitMoney(baselineUnit)}. The difference is supported for this workload and period.`;
    } else if (mode === "sampled" && proposedUnit < baselineUnit) {
      document.getElementById("finding-title").textContent =
        `${proposed.label} comes out at ${unitMoney(proposedUnit)} per ready result in the sampled review. ` +
        `${baseline.label} comes out at ${unitMoney(baselineUnit)}. The difference is worth testing, not booking.`;
    } else if (proposedUnit < baselineUnit) {
      document.getElementById("finding-title").textContent =
        `${proposed.label} comes out at ${unitMoney(proposedUnit)} for each result that was ready ` +
        `to use. ${baseline.label} cost ${unitMoney(baselineUnit)}. It looks better, but ${costBasisLabel(proposed.evidence.cost_basis).toLowerCase()} is not booked provider spend.`;
    } else {
      document.getElementById("finding-title").textContent =
        modelCostChange !== null && modelCostChange < 0 && readyResultCostChange !== null && readyResultCostChange > 0
          ? `${sentenceCase(providerTerm)} fell ${Math.abs(modelCostChange).toFixed(1)}%. The cost of a ready result rose ${readyResultCostChange.toFixed(1)}%.`
          : `${proposed.label} cost ${unitMoney(proposedUnit)} for each result that was ready to use, compared with ${unitMoney(baselineUnit)} for ${baseline.label.toLowerCase()}.`;
    }
    document.getElementById("finding-limit").textContent = comparison.limitation;
    document.getElementById("decision-title").textContent = comparison.recommendation;
    document.getElementById("decision-code").textContent =
      comparison.savings_claim_allowed && proposedUnit < baselineUnit
        ? "SAVE NOW"
        : proposedUnit < baselineUnit
          ? "TEST FIRST"
          : "KEEP CURRENT ROUTE";
    renderTruthSection();
    renderPlanning();

    const bars = [
      {
        className: "baseline",
        label: baseline.label,
        note: "Recurring operating cost",
        value: baseline.measures.cost_per_usable_result,
      },
      {
        className: "proposed",
        label: proposed.label,
        note: "Recurring operating cost",
        value: proposed.measures.cost_per_usable_result,
      },
    ];
    if (proposed.costs.one_time_change_cost > 0) {
      bars.push({
        className: "pilot",
        label: `${proposed.label}, first period`,
        note: "Includes one time change cost",
        value: proposed.measures.all_in_cost_per_usable_result,
      });
    }
    const values = bars.map((bar) => bar.value);
    const maxValue = Math.max(...values) * 1.06;

    const chart = document.getElementById("unit-cost-chart");
    chart.setAttribute(
      "aria-label",
      proposed.costs.one_time_change_cost > 0
        ? `Current recurring cost is ${unitMoney(values[0])} per ready result. Proposed recurring cost is ${unitMoney(values[1])}. Proposed first period cost including change work is ${unitMoney(values[2])}.`
        : `Current recurring cost is ${unitMoney(values[0])} per ready result. Proposed recurring cost is ${unitMoney(values[1])}. No one time change cost is included in this review.`,
    );
    chart.innerHTML = bars
      .map(
        (bar) => `
          <div class="bar-row ${bar.className}">
            <div class="bar-label">
              <strong>${escapeHtml(bar.label)}</strong>
              <small>${escapeHtml(bar.note)}</small>
            </div>
            <div class="bar-track" aria-hidden="true">
              <div class="bar-fill" style="width:${((bar.value / maxValue) * 100).toFixed(1)}%"></div>
            </div>
            <div class="bar-value">${unitMoney(bar.value)}<small>per ready result</small></div>
          </div>`,
      )
      .join("");

    const metrics = [
      {
        label: "Recurring cost",
        value: `${money(baseline.costs.recurring_operating_cost)} → ${money(proposed.costs.recurring_operating_cost)}`,
        note: `${money(Math.abs(comparison.recurring_cost_difference))} ${comparison.recurring_cost_difference <= 0 ? "lower" : "higher"} in the compared period`,
      },
      {
        label: "Ready result rate",
        value: `${pct(baseline.measures.usable_result_rate)} → ${pct(proposed.measures.usable_result_rate)}`,
        note: `${Math.abs(comparison.usable_result_rate_change_points).toFixed(1)} points ${comparison.usable_result_rate_change_points >= 0 ? "higher" : "lower"}`,
      },
      {
        label: "Retries",
        value: baseline.measures.retry_rate === null || proposed.measures.retry_rate === null
          ? "Not supplied"
          : `${pct(baseline.measures.retry_rate)} → ${pct(proposed.measures.retry_rate)}`,
        note: baseline.measures.retry_rate === null || proposed.measures.retry_rate === null
          ? "The quick sample does not infer retry counts"
          : `${compact(Math.abs(baseline.usage.retries - proposed.usage.retries))} ${baseline.usage.retries >= proposed.usage.retries ? "fewer" : "more"} retry events`,
      },
      {
        label: "One time change cost",
        value: proposed.costs.one_time_change_cost
          ? money(proposed.costs.one_time_change_cost)
          : "None included",
        note: proposed.costs.one_time_change_cost
          ? `${money(proposed.costs.all_in_pilot_cost)} in the first period, all in`
          : "Add migration, testing, and rollout work before approval",
      },
    ];
    document.getElementById("metric-ledger").innerHTML = metrics
      .map(
        (item) => `
          <div class="metric-cell">
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.value)}</strong>
            <small>${escapeHtml(item.note)}</small>
          </div>`,
      )
      .join("");

    const evidenceIssues = [
      ...baseline.evidence.reconciliation_issues,
      ...proposed.evidence.reconciliation_issues,
    ];
    const lowerUnitCost = proposed.measures.cost_per_usable_result < baseline.measures.cost_per_usable_result;
    const gateFailures = [
      !comparison.quality_holds && "the quality floor",
      !comparison.both_policy_approved && "policy approval",
      !comparison.evidence_complete && "complete outcome evidence",
      !comparison.same_cost_basis && "the same kind of cost data on both routes",
      !providerCostsReported(baseline, proposed, comparison) && "a provider bill for both routes",
    ].filter(Boolean);
    const gateFailureText = gateFailures.length > 1
      ? `${gateFailures.slice(0, -1).join(", ")} and ${gateFailures.at(-1)}`
      : gateFailures[0] || "a decision gate";
    const illustrative = mode === "illustrative";
    const opportunityRows = [
      {
        state: "save",
        label: "SAVE NOW",
        title: comparison.savings_claim_allowed ? "Proven savings" : "No proven savings yet",
        value: comparison.savings_claim_allowed ? money(Math.abs(comparison.normalized_cost_difference)) : "—",
        note: comparison.savings_claim_allowed
          ? "At the current volume, the lower full cost is supported by the bill and the work records."
          : "Nothing shows up here until the provider bill, usable work, quality, and policy checks all agree.",
      },
      {
        state: "test",
        label: "TEST FIRST",
        title: lowerUnitCost && !comparison.savings_claim_allowed ? "Proposed model route" : "No open route test",
        value: lowerUnitCost && !comparison.savings_claim_allowed
          ? `${money(Math.abs(comparison.normalized_cost_difference))} difference`
          : "—",
        note: lowerUnitCost && !comparison.savings_claim_allowed
          ? `The unit cost is ${Math.abs(comparison.cost_per_usable_result_change_pct).toFixed(1)}% lower at equivalent accepted volume, but ${gateFailureText} still blocks a savings claim.`
          : "This comparison does not point to another route worth testing.",
      },
      {
        state: "fix",
        label: "FIX THE EVIDENCE",
        title: evidenceIssues.length
          ? "Fix the missing or mismatched data"
          : illustrative
            ? "Replace the example with real evidence"
            : "No file or math mismatch found",
        value: evidenceIssues.length
          ? `${evidenceIssues.length} issue${evidenceIssues.length === 1 ? "" : "s"}`
          : illustrative
            ? "Example"
            : "Files match",
        note: evidenceIssues[0] || (illustrative
          ? "The synthetic inputs match each other. They do not prove what would happen with a real workload or vendor."
          : "The bill and work log match for this review. Quality, policy, and approval checks still apply."),
      },
      {
        state: "leave",
        label: !lowerUnitCost ? "KEEP CURRENT ROUTE" : "HOLD SEPARATE",
        title: !lowerUnitCost ? "Proposed route" : proposed.costs.one_time_change_cost ? "One time change cost" : "No separate cost to protect",
        value: !lowerUnitCost
          ? `${Math.abs(comparison.cost_per_usable_result_change_pct).toFixed(1)}% higher`
          : proposed.costs.one_time_change_cost ? money(proposed.costs.one_time_change_cost) : "—",
        note: !lowerUnitCost
          ? "The proposed route costs more per ready result after provider, infrastructure, and human costs are included. A cheaper model bill is not a saving here."
          : proposed.costs.one_time_change_cost
            ? comparison.payback_usable_results
              ? `Keep it separate from recurring cost. It earns back after about ${compact(comparison.payback_usable_results)} accepted results if the monthly savings hold.`
              : "Keep this separate from recurring cost. The supplied comparison does not establish a payback."
            : "No one time or policy cost was entered for this row.",
      },
    ];
    document.getElementById("opportunity-ledger").innerHTML = opportunityRows
      .map(
        (row) => `
          <article class="opportunity-row state-${row.state}">
            <span class="opportunity-state">${escapeHtml(row.label)}</span>
            <div>
              <strong>${escapeHtml(row.title)}</strong>
              <p>${escapeHtml(row.note)}</p>
            </div>
            <em>${escapeHtml(row.value)}</em>
          </article>`,
      )
      .join("");

    document.getElementById("claim-status").textContent = comparison.savings_claim_allowed
      ? "Savings claim supported"
      : "Modeled difference, not booked savings";
    document.getElementById("payback-status").textContent = comparison.payback_usable_results
      ? `Modeled payback: ${compact(comparison.payback_usable_results)} usable results`
      : !lowerUnitCost
        ? "No payback: recurring unit cost is higher"
        : "Payback not established from the supplied evidence";
  }

  function anatomyCard(scenario) {
    const recurring = scenario.costs.recurring_operating_cost;
    const parts = [
      ["Model usage", scenario.costs.model_cost, "model"],
      ["Shared infrastructure", scenario.costs.shared_infrastructure_cost, "shared"],
      ["Human review", scenario.costs.human_review_cost, "human"],
    ];
    return `
      <article class="anatomy-card">
        <header>
          <div>
            <p class="kicker">${escapeHtml(scenario.model.route)}</p>
            <h2>${escapeHtml(scenario.label)}</h2>
          </div>
          <span>${money(recurring)}</span>
        </header>
        <div class="stacked-bar" aria-label="Recurring cost composition">
          ${parts
            .map(
              ([, value, key]) =>
                `<div class="stack-${key}" style="width:${((value / recurring) * 100).toFixed(2)}%"></div>`,
            )
            .join("")}
        </div>
        <div class="cost-lines">
          ${parts
            .map(
              ([label, value, key]) => `
                <div class="cost-line">
                  <i class="stack-${key}"></i>
                  <span>${escapeHtml(label)}</span>
                  <strong>${money(value)} · ${((value / recurring) * 100).toFixed(0)}%</strong>
                </div>`,
            )
            .join("")}
        </div>
      </article>`;
  }

  function renderAnatomy() {
    const { baseline, proposed } = state.data;
    document.getElementById("anatomy-grid").innerHTML =
      anatomyCard(baseline) + anatomyCard(proposed);

    const rows = [
      {
        label: "Cache reuse (all input)",
        base: pct(baseline.measures.cache_reuse_rate),
        proposed: pct(proposed.measures.cache_reuse_rate),
        note: "Share of processed input read from cache across all provider requests, including retries.",
      },
      {
        label: "Cache writes",
        base: pct(baseline.measures.cache_write_rate),
        proposed: pct(proposed.measures.cache_write_rate),
        note: "Context written to cache. This can carry a different rate from an ordinary input or cache read.",
      },
      {
        label: "Context reprocessed",
        base: pctOrMissing(baseline.measures.context_reprocessing_ratio),
        proposed: pctOrMissing(proposed.measures.context_reprocessing_ratio),
        note:
          baseline.measures.context_reprocessing_ratio === null ||
          proposed.measures.context_reprocessing_ratio === null
            ? "The provider report does not identify unique context, so AI Cost Lens leaves this measure blank."
            : "A review signal for repeated context. It is not automatically waste.",
      },
      {
        label: "Human review",
        base: `${wholeNumber(baseline.outcomes.human_review_minutes)} min`,
        proposed: `${wholeNumber(proposed.outcomes.human_review_minutes)} min`,
        note: "Human work belongs in the economics when it is required to make output usable.",
      },
      {
        label: "Processed input (all attempts)",
        base: compact(baseline.usage.processed_input_tokens),
        proposed: compact(proposed.usage.processed_input_tokens),
        note:
          baseline.usage.unique_input_tokens === null
            ? "Unique context is not exposed by this provider report."
            : `Both scenarios began with ${compact(baseline.usage.unique_input_tokens)} unique input tokens.`,
      },
    ];
    document.getElementById("behavior-ledger").innerHTML = rows
      .map(
        (row) => `
          <div class="behavior-row">
            <span>${escapeHtml(row.label)}</span>
            <strong>${escapeHtml(row.base)}</strong>
            <strong>${escapeHtml(row.proposed)}</strong>
            <em>${escapeHtml(row.note)}</em>
          </div>`,
      )
      .join("");
  }

  function evidenceCard(scenario) {
    const status = scenario.evidence.coverage_status || "unspecified";
    const costBasisText = status === "illustrative"
      ? "modeled cost"
      : costBasisLabel(scenario.evidence.cost_basis);
    const issues = scenario.evidence.reconciliation_issues || [];
    const randomSample = scenario.outcomes.sample_method === "declared random or systematic";
    const sample = scenario.outcomes.sample_counts
      ? `<div><dt>Outcome evidence</dt><dd>${escapeHtml(scenario.outcomes.sample_method)} sample · ${scenario.outcomes.sample_size} reviewed of ${compact(scenario.outcomes.completed_results)} period results</dd></div>
         <div><dt>${randomSample ? "Ready-rate range" : "Statistical range"}</dt><dd>${randomSample ? `${pct(scenario.outcomes.ready_rate_interval_95[0])} to ${pct(scenario.outcomes.ready_rate_interval_95[1])} · assumes the declared sampling method` : "Not shown · the sample was not declared random or systematic"}</dd></div>`
      : scenario.outcomes.basis === "illustrative"
        ? `<div><dt>Outcome evidence</dt><dd>Illustrative workload record · not customer data</dd></div>`
        : `<div><dt>Outcome evidence</dt><dd>One row per completed result</dd></div>`;
    return `
      <article class="evidence-card">
        <header>
          <h2>${escapeHtml(scenario.label)}</h2>
          <div class="evidence-chips">
            <span class="basis-chip">${escapeHtml(costBasisText)}</span>
            <span class="evidence-status status-${escapeHtml(status)}">${escapeHtml(status === "illustrative" ? "illustrative inputs" : `${status} coverage`)}</span>
          </div>
        </header>
        <dl>
          <div><dt>Model route</dt><dd>${scenarioLabel(scenario)}</dd></div>
          <div><dt>Source</dt><dd>${escapeHtml(scenario.evidence.source)}</dd></div>
          <div><dt>Coverage</dt><dd>${escapeHtml(scenario.evidence.coverage)}</dd></div>
          ${sample}
          <div><dt>Cost boundary</dt><dd>${escapeHtml(scenario.evidence.cost_boundary || "Not declared")}</dd></div>
          <div><dt>Latest evidence date</dt><dd>${escapeHtml(scenario.evidence.observed_at)}</dd></div>
          <div><dt>Verifier</dt><dd>${escapeHtml(scenario.outcomes.verifier)}</dd></div>
          <div><dt>Accepted when</dt><dd>${escapeHtml(scenario.outcomes.acceptance_rule)}</dd></div>
          <div><dt>Policy</dt><dd>${scenario.policy.approved ? "Approved" : "Not approved"} · ${escapeHtml(scenario.policy.retention_mode)}</dd></div>
        </dl>
        <div class="issue-list ${issues.length ? "has-issues" : "is-clear"}">
          <p class="kicker">${issues.length ? "STILL TO RESOLVE" : status === "illustrative" ? "INTERNAL CHECK" : "RECONCILIATION"}</p>
          ${
            issues.length
              ? `<ul>${issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}</ul>`
              : status === "illustrative"
                ? "<p>The synthetic spend, cost, and outcome rows reconcile internally. This is not evidence from a real workload.</p>"
                : status === "sampled"
                ? "<p>The spend file reconciles. Outcome yield and human time remain sampled estimates.</p>"
                : "<p>Usage, provider cost, and the outcome log reconcile for the declared scope.</p>"
          }
        </div>
      </article>`;
  }

  function renderEvidence() {
    const { baseline, proposed, comparison } = state.data;
    document.getElementById("evidence-grid").innerHTML =
      evidenceCard(baseline) + evidenceCard(proposed);
    const boundaryTitle = document.getElementById("boundary-title");
    const boundaryCopy = document.getElementById("boundary-copy");
    const illustrative = state.data.mode === "illustrative";
    boundaryTitle.textContent = illustrative
      ? "The example's numbers match. But this is not real-world proof."
      : comparison.evidence_complete
      ? "The evidence reconciles for this comparison."
      : comparison.outcome_evidence_basis === "sampled"
        ? "The sample is useful. It is not the whole population."
      : "The missing proof stays visible.";
    boundaryCopy.textContent = illustrative
      ? "The synthetic record is internally consistent enough to demonstrate the method. It cannot support a customer savings claim, a vendor performance claim, or a production route decision. Replace it with one bounded real workload before relying on the conclusion."
      : comparison.evidence_complete
      ? comparison.same_cost_basis
        ? providerCostsReported(baseline, proposed, comparison)
          ? "Both sides use cost from the provider bill, and the evidence is complete. The conclusion still applies only to this workload and period."
          : `Both sides use ${costBasisLabel(proposed.evidence.cost_basis).toLowerCase()}. The comparison can guide a test, but it is not booked savings until the provider bill confirms it.`
        : "The two cost numbers were built in different ways. Treat the result as an estimate until both sides use the same kind of cost data."
      : comparison.outcome_evidence_basis === "sampled"
        ? `${providerCostsReported(baseline, proposed, comparison) ? "Provider spend is reported" : `${costBasisLabel(proposed.evidence.cost_basis)} is used`}. Ready result yield and human time are extrapolated from the reviewed outputs. Repeat the sample or add a detailed outcome log before treating the difference as booked savings.`
        : "At least one side has incomplete or mismatched evidence. The review can show the modeled difference, but it cannot turn that difference into a savings claim.";
  }

  function renderOpenAIBill() {
    const { bill, usage, period, reconciliation, limitations, next_step: nextStep } = state.data;
    const totalInput = usage.totals.input_tokens;
    const cacheShare = totalInput ? usage.totals.cached_input_tokens / totalInput : 0;
    document.getElementById("bill-period-label").textContent = `${period.start} to ${period.end} · ${period.timezone}`;
    document.getElementById("bill-mode-tag").textContent = state.data.mode === "illustrative" ? "ILLUSTRATIVE EXPORT" : "REAL PROVIDER EXPORT";
    document.getElementById("bill-finding-title").textContent =
      `OpenAI reported ${money(Number(bill.total), Number(bill.total) < 1 ? 4 : 2)} across ${compact(usage.totals.requests)} requests. The export shows which models handled the traffic, but not what each model cost.`;
    document.getElementById("bill-finding-limit").textContent = limitations[0];
    const metrics = [
      ["Provider reported cost", money(Number(bill.total), Number(bill.total) < 1 ? 4 : 2), `${bill.populated_rows} populated cost row${bill.populated_rows === 1 ? "" : "s"}`],
      ["Requests", compact(usage.totals.requests), `${usage.by_model.length} model${usage.by_model.length === 1 ? "" : "s"} observed`],
      ["Input tokens", compact(totalInput), `${pct(cacheShare, 1)} read from cache`],
      ["Output tokens", compact(usage.totals.output_tokens), `${usage.days_with_usage} day${usage.days_with_usage === 1 ? "" : "s"} with usage`],
    ];
    document.getElementById("bill-metric-ledger").innerHTML = metrics.map(([label, value, note]) => `
      <div class="metric-cell"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></div>
    `).join("");
    document.getElementById("bill-model-rows").innerHTML = usage.by_model.map((row) => {
      const share = row.input_tokens ? row.cached_input_tokens / row.input_tokens : 0;
      return `<tr>
        <td>${escapeHtml(row.model)}</td>
        <td>${compact(row.requests)}</td>
        <td>${compact(row.input_tokens)}</td>
        <td>${compact(row.output_tokens)}</td>
        <td>${pct(share, 1)}</td>
        <td class="unavailable">Unavailable</td>
      </tr>`;
    }).join("");
    const ledger = [
      ["save", "SAVE NOW", "No proven savings item", "—", "A total bill and token mix are not enough to prove that a route, cache policy, or model change saved money."],
      ["test", "TEST FIRST", "Choose one repeatable workload", "One bounded test", "Compare the same job, quality floor, accepted results, retries, and human correction before changing the route."],
      ["fix", "FIX THE EVIDENCE", reconciliation.project_cost_join_supported ? "Add the outcome record" : "Add cost attribution and outcomes", reconciliation.project_cost_join_supported ? "1 gap" : "2 gaps", reconciliation.project_cost_join_supported ? "The bill has project attribution, but it still lacks accepted work and human effort." : "The cost export has no supported project join, and the provider report does not say whether the work was usable."],
      ["leave", "DO NOT ALLOCATE", "Do not spread the total bill across models", "Unsupported", "Token share is usage evidence. It is not a defensible allocation of observed billed dollars."],
    ];
    document.getElementById("bill-opportunity-ledger").innerHTML = ledger.map(([kind, label, title, value, note]) => `
      <article class="opportunity-row state-${kind}">
        <span class="opportunity-state">${escapeHtml(label)}</span>
        <div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(note)}</p></div>
        <em>${escapeHtml(value)}</em>
      </article>
    `).join("");
    document.getElementById("bill-next-step").textContent = nextStep;
    document.getElementById("bill-boundary-copy").textContent = period.aligned
      ? `${usage.by_model.length} model route${usage.by_model.length === 1 ? "" : "s"} and ${usage.by_project.length} project record${usage.by_project.length === 1 ? "" : "s"} are visible in the usage export. Model cost allocation and cost per usable result remain unavailable until the evidence supports them.`
      : "The usage and cost date buckets do not align. Export the same date range again before using this review for a financial decision.";
  }

  function memoList(pairs) {
    return pairs.map(([label, value]) => `
      <div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>
    `).join("");
  }

  function percentChange(current, proposed) {
    if (!current) return "Not comparable";
    const change = ((proposed - current) / current) * 100;
    return `${change >= 0 ? "+" : "−"}${Math.abs(change).toFixed(1)}%`;
  }

  function renderFinanceMemo() {
    if (!state.data) return;
    const isBill = state.data.schema_version === "ai-cost-lens-openai-bill-review/0.1";
    const memoPlanning = document.getElementById("memo-planning");
    if (isBill) {
      const { bill, usage, period, reconciliation, limitations, next_step: nextStep } = state.data;
      const total = Number(bill.total);
      document.getElementById("memo-title").textContent = "OpenAI bill review";
      document.getElementById("memo-meta").textContent = `${period.start} to ${period.end} · ${period.timezone}`;
      document.getElementById("memo-decision-code").textContent = "RECONCILE FIRST";
      document.getElementById("memo-decision-title").textContent =
        `The bill proves ${money(total, total < 1 ? 4 : 2)} of provider spend. It does not prove cost by model or savings by outcome.`;
      document.getElementById("memo-decision-limit").textContent = limitations[0];
      document.getElementById("memo-numbers-title").textContent = "What the provider export shows";
      document.getElementById("memo-table-head").innerHTML = "<tr><th>Measure</th><th>Observed</th><th>What it proves</th></tr>";
      const billRows = [
        ["Provider reported cost", money(total, total < 1 ? 4 : 2), "The organization total for the exported period"],
        ["Requests", compact(usage.totals.requests), "Observed request volume"],
        ["Input tokens", compact(usage.totals.input_tokens), "Observed input usage, including cached input"],
        ["Output tokens", compact(usage.totals.output_tokens), "Observed output usage"],
      ];
      document.getElementById("memo-table-body").innerHTML = billRows.map(([label, value, meaning]) =>
        `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td><td>${escapeHtml(meaning)}</td></tr>`,
      ).join("");
      document.getElementById("memo-rules").innerHTML = memoList([
        ["Cost boundary", "Provider reported organization cost"],
        ["Allocation rule", "Do not allocate billed dollars by token share"],
        ["Outcome rule", "No outcome claim without a matching work record"],
      ]);
      document.getElementById("memo-evidence").innerHTML = memoList([
        ["Period", period.aligned ? "Usage and cost periods align" : "Usage and cost periods do not align"],
        ["Cost by model", reconciliation.model_cost_allocation_supported ? "Supported" : "Unavailable from these exports"],
        ["Ready outcomes", "Not included in the provider export"],
        ["Savings claim", reconciliation.savings_claim_allowed ? "Supported" : "Not supported"],
      ]);
      memoPlanning.hidden = true;
      document.getElementById("memo-next-step").textContent = nextStep;
      document.getElementById("memo-footer-status").textContent =
        state.data.mode === "illustrative" ? "Illustrative export" : "Provider reported bill · outcome evidence not supplied";
      return;
    }

    const { baseline, proposed, comparison, workload, period, planning, mode } = state.data;
    const baselineUnit = baseline.measures.cost_per_usable_result;
    const proposedUnit = proposed.measures.cost_per_usable_result;
    const proposedIsLower = proposedUnit < baselineUnit;
    const decisionCode = comparison.savings_claim_allowed && proposedIsLower
      ? "SAVE NOW"
      : proposedIsLower
        ? "TEST FIRST"
        : "KEEP CURRENT ROUTE";
    document.getElementById("memo-title").textContent = "AI spend decision memo";
    document.getElementById("memo-meta").textContent = `${workload.name}\n${period.start} to ${period.end} · ${period.timezone}`;
    document.getElementById("memo-decision-code").textContent = decisionCode;
    document.getElementById("memo-decision-title").textContent = comparison.recommendation;
    document.getElementById("memo-decision-limit").textContent = comparison.limitation;
    document.getElementById("memo-numbers-title").textContent = "Current route versus proposed route";
    document.getElementById("memo-table-head").innerHTML = `<tr><th>Measure</th><th>${escapeHtml(baseline.label)}</th><th>${escapeHtml(proposed.label)}</th><th>Difference</th></tr>`;
    const routeRows = [
      ["Provider cost", money(baseline.costs.model_cost), money(proposed.costs.model_cost), percentChange(baseline.costs.model_cost, proposed.costs.model_cost)],
      ["Shared infrastructure", money(baseline.costs.shared_infrastructure_cost), money(proposed.costs.shared_infrastructure_cost), signedMoney(proposed.costs.shared_infrastructure_cost - baseline.costs.shared_infrastructure_cost)],
      ["Human review and correction", money(baseline.costs.human_review_cost), money(proposed.costs.human_review_cost), percentChange(baseline.costs.human_review_cost, proposed.costs.human_review_cost)],
      ["Total recurring cost", money(baseline.costs.recurring_operating_cost), money(proposed.costs.recurring_operating_cost), percentChange(baseline.costs.recurring_operating_cost, proposed.costs.recurring_operating_cost)],
      ["Ready result rate", pct(baseline.measures.usable_result_rate, 1), pct(proposed.measures.usable_result_rate, 1), `${comparison.usable_result_rate_change_points >= 0 ? "+" : "−"}${Math.abs(comparison.usable_result_rate_change_points).toFixed(1)} points`],
      ["Ready results", compact(baseline.outcomes.usable_results), compact(proposed.outcomes.usable_results), `${proposed.outcomes.usable_results >= baseline.outcomes.usable_results ? "+" : "−"}${compact(Math.abs(proposed.outcomes.usable_results - baseline.outcomes.usable_results))}`],
      ["Cost per ready result", unitMoney(baselineUnit), unitMoney(proposedUnit), percentChange(baselineUnit, proposedUnit)],
    ];
    document.getElementById("memo-table-body").innerHTML = routeRows.map(([label, current, next, difference]) =>
      `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(current)}</td><td>${escapeHtml(next)}</td><td>${escapeHtml(difference)}</td></tr>`,
    ).join("");
    document.getElementById("memo-rules").innerHTML = memoList([
      ["Ready means", baseline.outcomes.acceptance_rule],
      ["Checked by", baseline.outcomes.verifier],
      ["Quality floor", pct(workload.accepted_quality_threshold, 1)],
      ["Policy", `Current: ${baseline.policy.approved ? "approved" : "not approved"}; proposed: ${proposed.policy.approved ? "approved" : "not approved"}`],
      ["Cost boundary", baseline.evidence.cost_boundary],
    ]);
    document.getElementById("memo-evidence").innerHTML = memoList([
      ["Current route", `${baseline.evidence.coverage_status}: ${baseline.evidence.coverage}`],
      ["Proposed route", `${proposed.evidence.coverage_status}: ${proposed.evidence.coverage}`],
      ["Cost basis", comparison.same_cost_basis ? costBasisLabel(proposed.evidence.cost_basis) : "Mixed cost basis"],
      ["Savings claim", comparison.savings_claim_allowed ? "Supported for this workload and period" : "Not supported"],
    ]);
    if (planning) {
      memoPlanning.hidden = false;
      const payback = planning.payback;
      const paybackLabel = payback.payback_months === null
        ? "No operating payback"
        : `${payback.payback_months.toFixed(1)} months`;
      document.getElementById("memo-plan-grid").innerHTML = [
        ["Recurring cost variance", signedMoney(planning.variance.recurring_operating_cost)],
        ["Ready results variance", `${planning.variance.ready_results >= 0 ? "+" : "−"}${compact(Math.abs(planning.variance.ready_results))}`],
        ["Monthly savings or shortfall", signedMoney(payback.monthly_operating_savings)],
        ["Payback", paybackLabel],
      ].map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
    } else {
      memoPlanning.hidden = true;
    }
    const nextStep = mode === "illustrative"
      ? "Replace the example with one bounded real workload before relying on the conclusion."
      : proposedIsLower && !comparison.savings_claim_allowed
        ? "Repeat the same workload with complete cost and outcome evidence before approving the change."
        : proposedIsLower
          ? "Document the approval and monitor the same cost and quality measures after the change."
          : "Keep the current route. Test whether the proposed route can improve ready results or reduce human correction before changing the default.";
    document.getElementById("memo-next-step").textContent = nextStep;
    document.getElementById("memo-footer-status").textContent = mode === "illustrative"
      ? "Illustrative data · not customer evidence"
      : comparison.savings_claim_allowed
        ? "Evidence supports this workload and period only"
        : "Modeled difference · not booked savings";
  }

  function renderAll() {
    validateResult(state.data);
    const isBill = state.data.schema_version === "ai-cost-lens-openai-bill-review/0.1";
    const reviewNav = document.querySelector(".question-nav");
    reviewNav.hidden = isBill;
    reviewNav.setAttribute("aria-hidden", String(isBill));
    reviewNav.querySelectorAll("button").forEach((button) => {
      button.disabled = isBill;
      button.tabIndex = isBill ? -1 : 0;
    });
    document.getElementById("bill-review-screen").classList.toggle("active", isBill);
    document.querySelectorAll(".view").forEach((section) => {
      if (isBill) section.classList.remove("active");
    });
    document.getElementById("story-toggle").hidden = isBill;
    renderFinanceMemo();
    if (isBill) {
      renderOpenAIBill();
      return;
    }
    document.getElementById("story-toggle").hidden = false;
    renderReview();
    renderAnatomy();
    renderEvidence();
    setView(state.view);
  }

  function setView(view) {
    if (state.data?.schema_version === "ai-cost-lens-openai-bill-review/0.1") return;
    state.view = view;
    document.querySelectorAll(".nav-item").forEach((item) => {
      item.classList.toggle("active", item.dataset.view === view);
    });
    document.querySelectorAll(".view").forEach((section) => {
      section.classList.toggle("active", section.id === `view-${view}`);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.add("visible");
    window.setTimeout(() => toast.classList.remove("visible"), 2600);
  }

  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", () => setView(item.dataset.view));
  });

  document.getElementById("story-toggle").addEventListener("click", (event) => {
    state.story = !state.story;
    document.body.classList.toggle("story-mode", state.story);
    event.currentTarget.textContent = state.story ? "Full review" : "Share view";
    if (state.story) setView("review");
  });

  const reviewDialog = document.getElementById("review-dialog");

  function resetBuilderStart() {
    state.builderMode = null;
    document.querySelectorAll(".builder-mode").forEach((item) => {
      item.classList.remove("active");
      item.setAttribute("aria-pressed", "false");
    });
    document.getElementById("workload-builder-fields").hidden = true;
    document.getElementById("openai-builder-fields").hidden = true;
    document.getElementById("builder-actions").hidden = true;
    document.getElementById("builder-path-help").hidden = false;
    document.getElementById("review-dialog-title").textContent = "What would you like to check?";
  }

  document.getElementById("start-review").addEventListener("click", () => {
    document.getElementById("builder-error").classList.remove("visible");
    resetBuilderStart();
    reviewDialog.showModal();
  });
  document.getElementById("close-review").addEventListener("click", () => reviewDialog.close());
  reviewDialog.addEventListener("click", (event) => {
    if (event.target === reviewDialog) reviewDialog.close();
  });

  document.querySelectorAll(".builder-mode").forEach((button) => {
    button.addEventListener("click", () => {
      state.builderMode = button.dataset.builderMode;
      if (state.builderMode === "example") {
        if (!state.demoData) {
          showToast("The worked example is still loading. Try again in a moment.");
          return;
        }
        state.data = cloneData(state.demoData);
        state.view = "review";
        state.story = false;
        document.body.classList.remove("story-mode");
        document.getElementById("story-toggle").textContent = "Share view";
        renderAll();
        setView("review");
        reviewDialog.close();
        showToast("Worked example open. No files needed.");
        return;
      }
      document.querySelectorAll(".builder-mode").forEach((item) => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      const isOpenAI = state.builderMode === "openai";
      document.getElementById("workload-builder-fields").hidden = isOpenAI;
      document.getElementById("openai-builder-fields").hidden = !isOpenAI;
      document.getElementById("builder-actions").hidden = false;
      document.getElementById("builder-path-help").hidden = true;
      document.getElementById("review-dialog-title").textContent = isOpenAI
        ? "Check what the OpenAI bill can actually prove."
        : "Test whether the proposed change is actually cheaper.";
      document.getElementById("builder-action-note").textContent = isOpenAI
        ? "The provider total and usage mix stay separate when the exports do not support a join."
        : state.outcomeMode === "sample"
          ? "The quick path produces a sampled estimate. It never becomes booked savings."
          : "Use the detailed log when you have one row per completed result.";
      document.getElementById("build-review").textContent = isOpenAI ? "Review the OpenAI bill" : "Build the finance review";
      document.getElementById("builder-error").classList.remove("visible");
    });
  });

  document.querySelectorAll(".outcome-mode").forEach((button) => {
    button.addEventListener("click", () => {
      state.outcomeMode = button.dataset.outcomeMode;
      document.querySelectorAll(".outcome-mode").forEach((item) => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      const sampled = state.outcomeMode === "sample";
      document.getElementById("sample-outcome-fields").hidden = !sampled;
      document.getElementById("detailed-outcome-fields").hidden = sampled;
      document.getElementById("builder-action-note").textContent = sampled
        ? "The quick path produces a sampled estimate. It never becomes booked savings."
        : "Use the detailed log when you have one row per completed result.";
      document.getElementById("builder-error").classList.remove("visible");
    });
  });

  [["spend-file", "spend-file-name"], ["work-file", "work-file-name"], ["openai-usage-file", "openai-usage-file-name"], ["openai-cost-file", "openai-cost-file-name"]].forEach(
    ([inputId, labelId]) => {
      document.getElementById(inputId).addEventListener("change", (event) => {
        const [file] = event.target.files;
        if (file) document.getElementById(labelId).textContent = file.name;
      });
    },
  );

  document.getElementById("review-builder").addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorBox = document.getElementById("builder-error");
    errorBox.classList.remove("visible");
    const submit = document.getElementById("build-review");
    submit.disabled = true;
    submit.textContent = "Checking the evidence…";
    try {
      if (state.builderMode === "openai") {
        const [usageFile] = document.getElementById("openai-usage-file").files;
        const [costFile] = document.getElementById("openai-cost-file").files;
        if (!usageFile || !costFile) throw new Error("Add both OpenAI CSV exports before building the bill review.");
        state.data = await buildOpenAIBillReview(await usageFile.text(), await costFile.text());
        validateResult(state.data);
        renderAll();
        reviewDialog.close();
        showToast("OpenAI bill reviewed locally. Your files never left the browser.");
        return;
      }
      if (state.builderMode !== "workload") throw new Error("Choose what you want to review first.");
      const [spendFile] = document.getElementById("spend-file").files;
      if (!spendFile) throw new Error("Add the spend and usage CSV before building the review.");
      const planningValues = {
        providerCost: optionalNumber(document.getElementById("plan-provider-cost").value, "Plan provider cost"),
        sharedCost: optionalNumber(document.getElementById("plan-shared-cost").value, "Plan shared cost"),
        humanCost: optionalNumber(document.getElementById("plan-human-cost").value, "Plan human cost"),
        completedResults: optionalNumber(document.getElementById("plan-results").value, "Plan results", { integer: true }),
        readyRate: optionalNumber(document.getElementById("plan-ready-rate").value, "Plan ready result rate"),
        expectedReadyPerMonth: optionalNumber(document.getElementById("expected-ready-month").value, "Expected ready results per month", { integer: true }),
        horizonMonths: optionalNumber(document.getElementById("decision-horizon").value, "Decision horizon", { integer: true }),
      };
      const suppliedPlanningValues = Object.values(planningValues).filter((value) => value !== null).length;
      if (suppliedPlanningValues > 0 && suppliedPlanningValues < Object.keys(planningValues).length) {
        throw new Error("Fill every optional plan and decision-horizon field, or leave all of them blank.");
      }
      if (planningValues.readyRate !== null && (planningValues.readyRate <= 0 || planningValues.readyRate > 100)) {
        throw new Error("Plan ready result rate must be greater than 0% and at most 100%.");
      }
      const planning = suppliedPlanningValues
        ? {
            label: "Approved plan for the current route",
            plan: {
              providerCost: planningValues.providerCost,
              sharedCost: planningValues.sharedCost,
              humanCost: planningValues.humanCost,
              completedResults: planningValues.completedResults,
              readyRate: planningValues.readyRate / 100,
            },
            expectedReadyPerMonth: planningValues.expectedReadyPerMonth,
            horizonMonths: planningValues.horizonMonths,
          }
        : null;
      const config = {
        acceptanceRule: document.getElementById("acceptance-rule").value.trim(),
        verifier: document.getElementById("verifier").value.trim(),
        qualityFloor: finiteNumber(document.getElementById("quality-floor").value, "Quality floor") / 100,
        hourlyRate: finiteNumber(document.getElementById("hourly-rate").value, "Human review rate"),
        baselinePolicyApproved: document.getElementById("baseline-policy-approved").checked,
        proposedPolicyApproved: document.getElementById("proposed-policy-approved").checked,
        baselineShared: finiteNumber(document.getElementById("baseline-shared").value, "Baseline shared cost"),
        proposedShared: finiteNumber(document.getElementById("proposed-shared").value, "Proposed shared cost"),
        changeCost: finiteNumber(document.getElementById("change-cost").value, "One time change cost"),
        sampleRandom: document.getElementById("sample-random").checked,
        outcomeLogComplete: document.getElementById("outcome-log-complete").checked,
        planning,
      };
      if (!config.acceptanceRule || !config.verifier) throw new Error("Accepted means and Verified by are required.");
      if (config.qualityFloor <= 0 || config.qualityFloor > 1) throw new Error("Quality floor must be between 1% and 100%.");
      if (state.outcomeMode === "sample") {
        const sampleValue = (id, label) => finiteNumber(document.getElementById(id).value, label);
        const samples = {
          baseline: {
            population: sampleValue("baseline-population", "Current results in period"),
            ready: sampleValue("baseline-ready", "Current ready sample"),
            correction: sampleValue("baseline-correction", "Current correction sample"),
            escalation: sampleValue("baseline-escalation", "Current escalation sample"),
            humanMinutes: sampleValue("baseline-human-minutes", "Current sample human minutes"),
          },
          proposed: {
            population: sampleValue("proposed-population", "Proposed results in period"),
            ready: sampleValue("proposed-ready", "Proposed ready sample"),
            correction: sampleValue("proposed-correction", "Proposed correction sample"),
            escalation: sampleValue("proposed-escalation", "Proposed escalation sample"),
            humanMinutes: sampleValue("proposed-human-minutes", "Proposed sample human minutes"),
          },
        };
        state.data = await buildSampledReview(await spendFile.text(), samples, config);
      } else {
        const [workFile] = document.getElementById("work-file").files;
        if (!workFile) throw new Error("Add the detailed work log before building this review.");
        state.data = await buildLocalReview(await spendFile.text(), await workFile.text(), config);
      }
      validateResult(state.data);
      renderAll();
      setView("review");
      reviewDialog.close();
      showToast("Finance review built locally. Your files never left the browser.");
    } catch (error) {
      errorBox.textContent = error.message || "The review could not be built.";
      errorBox.classList.add("visible");
    } finally {
      submit.disabled = false;
      submit.textContent = state.builderMode === "openai"
        ? "Review the OpenAI bill"
        : state.builderMode === "workload"
          ? "Build the finance review"
          : "Continue";
    }
  });

  document.getElementById("download-review").addEventListener("click", () => {
    if (!state.data) return;
    const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    const label = state.data.workload?.name || (state.data.provider === "openai" ? "openai-bill-review" : "review");
    anchor.download = `ai-cost-lens-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "review"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById("print-memo").addEventListener("click", () => {
    if (!state.data) return;
    renderFinanceMemo();
    document.body.classList.add("printing-memo");
    window.print();
    window.setTimeout(() => document.body.classList.remove("printing-memo"), 1500);
  });

  window.addEventListener("afterprint", () => {
    document.body.classList.remove("printing-memo");
  });

  document.getElementById("review-file").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    try {
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch (_error) {
        throw new Error("That file isn't valid JSON. Choose a saved AI Cost Lens review.");
      }
      validateResult(data);
      state.data = data;
      renderAll();
      setView("review");
      showToast(`${file.name} is open. Nothing was uploaded.`);
    } catch (error) {
      showToast(error.message || "That file could not be opened.");
    } finally {
      event.target.value = "";
    }
  });

  ["yield-slider", "provider-slider", "human-slider"].forEach((id) => {
    document.getElementById(id).addEventListener("input", updateBreakEvenExplorer);
  });
  document.getElementById("reset-break-even").addEventListener("click", () => {
    ["yield-slider", "provider-slider", "human-slider"].forEach((id) => {
      const input = document.getElementById(id);
      input.value = input.dataset.original;
    });
    updateBreakEvenExplorer();
  });

  const lumenDialog = document.getElementById("lumen-dialog");
  document.getElementById("open-lumen").addEventListener("click", () => {
    const conversation = document.getElementById("lumen-conversation");
    if (!conversation.children.length) {
      conversation.innerHTML = `<div class="lumen-message analyst-message"><span>LUMEN</span><p>${escapeHtml(lumenResponse("unknown"))}</p></div>`;
    }
    lumenDialog.showModal();
  });
  document.getElementById("close-lumen").addEventListener("click", () => lumenDialog.close());
  lumenDialog.addEventListener("click", (event) => {
    if (event.target === lumenDialog) lumenDialog.close();
  });
  document.querySelectorAll("[data-lumen-question]").forEach((button) => {
    button.addEventListener("click", () => askLumen(button.dataset.lumenQuestion, button.textContent.trim()));
  });
  /* AI_COST_LENS_DEMO_LOADER_START */
  async function loadDemo() {
    const response = await fetch("data/illustrative-review-result.json");
    if (!response.ok) {
      throw new Error("The illustrative review could not be loaded.");
    }
    state.data = await response.json();
    state.demoData = cloneData(state.data);
    renderAll();
  }

  loadDemo().catch((error) => showToast(error.message));
  /* AI_COST_LENS_DEMO_LOADER_END */
})();
