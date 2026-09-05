(() => {
  "use strict";

  const state = {
    data: null,
    demoData: null,
    view: "review",
    story: false,
    builderMode: null,
    outcomeMode: "sample",
    importProvider: "openai",
    pendingClaudeImport: null,
    uploadRoute: null,
    pendingMappedImport: null,
    invoicePdfCandidate: null,
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
  const compactOrMissing = (value) =>
    value === null || value === undefined ? "Not available" : compact(value);
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
    if (new TextEncoder().encode(text).length > 5 * 1024 * 1024) {
      throw new Error(`${label} exceeds the 5 MiB local file limit. Split it into smaller, matching review periods.`);
    }
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
    if (rows.length > 20001) throw new Error(`${label} exceeds 20,000 data rows. Split it into smaller, matching review periods.`);
    const headers = rows[0];
    if (/spend|cost export|usage export/i.test(label)) {
      const seen = new Set();
      rows.slice(1).forEach((values, index) => {
        const key = JSON.stringify(values);
        if (seen.has(key)) throw new Error(`${label} row ${index + 2} duplicates an earlier row. Check the source and consolidate genuinely separate identical charges before retrying; no rows were removed automatically.`);
        seen.add(key);
      });
    }
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
    if (!Number.isFinite(parsed) || parsed < 0 || (integer && !Number.isSafeInteger(parsed))) {
      throw new Error(`${field} must be a non-negative${integer ? " whole" : ""} number.`);
    }
    return parsed;
  }

  function optionalNumber(value, field, options = {}) {
    return String(value ?? "").trim() === "" ? null : finiteNumber(value, field, options);
  }

  function costNumber(value, field) {
    if (Number(value) < 0) throw new Error(`${field}: negative cost rows (credits or refunds) are not supported. Reconcile adjustments to a non-negative workload cost in the source; do not silently discard them.`);
    return finiteNumber(value, field);
  }

  function validDate(value, field) {
    const timestamp = Date.parse(`${value}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
      throw new Error(`${field} must be a real calendar date in YYYY-MM-DD format.`);
    }
    return value;
  }

  function requireMatchingDurations(baseline, proposed) {
    const span = (dates) => (Date.parse([...dates].sort().at(-1)) - Date.parse([...dates].sort()[0])) / 86400000 + 1;
    if (span(baseline.dates) !== span(proposed.dates)) {
      throw new Error("Baseline and proposed date spans have different durations. Use equally long, complete periods before comparing totals; no automatic normalization is applied.");
    }
  }

  async function readLocalFile(file) {
    if (file.size > 5 * 1024 * 1024) throw new Error("The file exceeds the 5 MiB local limit. Choose a smaller file.");
    return file.text();
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

  function summarizeSpendRows(spend, period, { allowZeroRequests = false } = {}) {
    const tokenFields = {
      input_tokens: { total: 0, complete: true, label: "input_tokens" },
      cached_input_tokens: { total: 0, complete: true, label: "cached_input_tokens" },
      cache_write_input_tokens: { total: 0, complete: true, label: "cache_write_input_tokens" },
      output_tokens: { total: 0, complete: true, label: "output_tokens" },
    };
    let requests = 0;
    let requestsComplete = true;
    let providerCost = 0;

    spend.forEach((row, index) => {
      const rowNumber = index + 2;
      const rowRequests = optionalNumber(row.requests, `Spend ${period} row ${rowNumber} requests`, { integer: true });
      if (rowRequests === null) requestsComplete = false;
      else requests += rowRequests;
      providerCost += costNumber(row.provider_cost, `Spend ${period} row ${rowNumber} provider_cost`);

      const supplied = {};
      Object.entries(tokenFields).forEach(([field, aggregate]) => {
        const value = optionalNumber(row[field], `Spend ${period} row ${rowNumber} ${aggregate.label}`, { integer: true });
        supplied[field] = value;
        if (value === null) aggregate.complete = false;
        else aggregate.total += value;
      });

      if (supplied.input_tokens === null && (supplied.cached_input_tokens !== null || supplied.cache_write_input_tokens !== null)) {
        throw new Error(`Spend ${period} row ${rowNumber} needs input_tokens when cache tokens are supplied.`);
      }
      if (
        supplied.input_tokens !== null &&
        supplied.cached_input_tokens !== null &&
        supplied.cache_write_input_tokens !== null &&
        supplied.cached_input_tokens + supplied.cache_write_input_tokens > supplied.input_tokens
      ) {
        throw new Error(`Spend ${period} row ${rowNumber} has more cached and cache-write tokens than input tokens.`);
      }
    });

    if (!allowZeroRequests && requestsComplete && requests === 0) {
      throw new Error(`Spend ${period} requests must be greater than zero when supplied.`);
    }
    const totalOrMissing = (field) => tokenFields[field].complete ? tokenFields[field].total : null;
    return {
      requests: requestsComplete ? requests : null,
      providerCost,
      processedInput: totalOrMissing("input_tokens"),
      cachedInput: totalOrMissing("cached_input_tokens"),
      cacheWriteInput: totalOrMissing("cache_write_input_tokens"),
      outputTokens: totalOrMissing("output_tokens"),
    };
  }

  const singleBillSchema = "ai-cost-lens-single-bill-review/0.1";
  const singleSpendColumns = "period date workload provider model route requests input_tokens cached_input_tokens cache_write_input_tokens output_tokens provider_cost cost_basis currency".split(" ");
  const singleWorkColumns = "period result_id outcome_status model_requests retry_requests human_minutes".split(" ");

  // Saved single-bill reviews retain the supplied rows. Recompute, never trust
  // saved financial claims or derived values when opening them again.
  function summarizeSingleBill(data) {
    const { spend, work } = data.source;
    const { config } = data;
    if (!spend.length || spend.length > 20000 || work.length > 20000) throw new Error("Supply 1 to 20,000 spend rows and at most 20,000 outcome rows.");
    const seen = new Set();
    spend.forEach((row) => {
      if (row.period.trim().toLowerCase() !== "baseline") throw new Error("For one bill, use baseline on every row and remove proposed example rows.");
      validDate(row.date, "Spend date");
      const key = JSON.stringify(singleSpendColumns.map((column) => row[column].trim()));
      if (seen.has(key)) throw new Error("Duplicate spend row: review the source, do not repeat invoice totals.");
      seen.add(key);
    });
    const workload = spend[0].workload.trim();
    const currency = spend[0].currency.trim().toUpperCase();
    if (!workload || spend.some((row) => row.workload.trim() !== workload)) throw new Error("Use one workload or subscription name per single-bill review.");
    if (!/^[A-Z]{3}$/.test(currency) || spend.some((row) => row.currency.trim().toUpperCase() !== currency)) throw new Error("Use one three-letter currency per review.");
    const dates = spend.map((row) => row.date).sort();
    const declaredStart = config.serviceStart ? validDate(config.serviceStart, "Service-period start") : null;
    const declaredEnd = config.serviceEnd ? validDate(config.serviceEnd, "Service-period end") : null;
    if (Boolean(declaredStart) !== Boolean(declaredEnd)) throw new Error("Supply both service-period dates or leave both blank.");
    if (declaredStart && declaredEnd < declaredStart) throw new Error("Service-period end cannot be before its start.");
    const period = { start: declaredStart || dates[0], end: declaredEnd || dates.at(-1), timezone: "UTC" };
    const basis = spendCostBasis(spend, "single bill");
    const totals = summarizeSpendRows(spend, "single bill", { allowZeroRequests: true });
    const hasUsage = spend.some((row) => ["requests", "input_tokens", "output_tokens"].some((field) => row[field].trim() !== ""));
    const missing = [];
    for (const [field, label] of [["requests", "Requests"], ["processedInput", "Input tokens"], ["cachedInput", "Cache-read tokens"], ["cacheWriteInput", "Cache-write tokens"], ["outputTokens", "Output tokens"]]) {
      if (totals[field] === null) missing.push(`${label}: not supplied for every row; the total is unavailable.`);
    }
    const groups = new Map();
    spend.forEach((row) => {
      const key = JSON.stringify([row.provider, row.model, row.route]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    const mix = [...groups.values()].map((rows) => ({
      label: [rows[0].provider || "Provider not supplied", rows[0].model || "Model not supplied", rows[0].route || "Route not supplied"].join(" / "),
      ...summarizeSpendRows(rows, "model/route group", { allowZeroRequests: true }),
    }));
    let ready = 0;
    let minutes = 0;
    let minutesKnown = true;
    let calls = 0;
    let callsKnown = true;
    let retries = 0;
    let retriesKnown = true;
    const resultIds = new Set();
    work.forEach((row) => {
      if (row.period.trim().toLowerCase() !== "baseline") throw new Error("Outcome rows must use baseline and cover the same bill period.");
      if (!row.result_id.trim() || resultIds.has(row.result_id.trim())) throw new Error("Each outcome needs a unique, non-blank result_id.");
      resultIds.add(row.result_id.trim());
      if (row.date && (validDate(row.date, "Outcome date") < period.start || row.date > period.end)) throw new Error("Outcome date is outside the spend date buckets.");
      if (row.workload && row.workload.trim() !== workload) throw new Error("Outcome workload does not match the bill.");
      if (!["ready_to_use", "needs_correction", "needs_escalation"].includes(row.outcome_status)) throw new Error("Use ready_to_use, needs_correction, or needs_escalation for outcome_status.");
      if (row.outcome_status === "ready_to_use") ready++;
      const humanMinutes = optionalNumber(row.human_minutes, "Outcome human_minutes");
      if (humanMinutes === null) minutesKnown = false;
      else minutes += humanMinutes;
      const requests = optionalNumber(row.model_requests, "Outcome model_requests", { integer: true });
      const retry = optionalNumber(row.retry_requests, "Outcome retry_requests", { integer: true });
      if (requests === null) callsKnown = false;
      else calls += requests;
      if (retry === null) retriesKnown = false;
      else {
        if (requests === null || retry > Math.max(requests - 1, 0)) throw new Error("Retry requests require model_requests and cannot exceed additional attempts.");
        retries += retry;
      }
    });
    if (work.length && (!config.acceptanceRule.trim() || !config.verifier.trim())) throw new Error("With outcomes, supply the ready rule and who verified the results.");
    const requestsComparable = totals.requests !== null && callsKnown;
    const requestMismatch = requestsComparable && totals.requests !== calls;
    const outcomeSupported = Boolean(work.length && hasUsage && config.complete && !requestMismatch);
    if (!work.length) missing.push("No outcome records: readiness, cost per ready result and quality are unknown.");
    else if (!outcomeSupported) missing.push("Outcome unit cost withheld: supply usage, declare a complete matching workload/period and resolve any mismatch between spend requests and outcome model_requests.");
    if (work.length && !requestsComparable) missing.push("Request reconciliation is unavailable. Any displayed outcome unit cost relies on your declaration that the full log matches the cost and usage boundary; it is not independently verified.");
    if (!hasUsage) missing.push("Invoice/subscription only: no evidence of utilization, model efficiency, waste, readiness, or savings. Do not allocate a shared subscription to one workload without a documented allocation basis.");
    const hourlyRate = optionalNumber(config.hourlyRate, "Human hourly rate");
    const shared = optionalNumber(config.sharedCost, "Shared infrastructure cost");
    const humanCost = hourlyRate === null || !minutesKnown ? null : minutes / 60 * hourlyRate;
    const fullCost = humanCost === null || shared === null ? null : totals.providerCost + humanCost + shared;
    if (shared === null || hourlyRate === null || !minutesKnown) missing.push("Full operating cost is unavailable until shared infrastructure, all human minutes and the human hourly rate are supplied. Provider-only unit cost excludes these costs.");
    if (outcomeSupported && !ready) missing.push("No ready results: cost per ready result cannot be calculated and is not displayed as a number.");
    missing.push("Single-bill evidence does not establish savings. To test a change, use Compare cost per ready result with two comparable routes and the existing cost, quality, coverage and policy gates.");
    const result = { workload, currency, period, basis, totals, mix, missing, ready, completed: work.length, minutes: minutesKnown && work.length ? minutes : null,
      retries: retriesKnown && work.length ? retries : null,
      level: outcomeSupported ? "Cost, usage and outcomes" : hasUsage ? "Cost and usage" : "Invoice or subscription only",
      providerUnit: outcomeSupported && ready ? totals.providerCost / ready : null,
      fullUnit: outcomeSupported && ready && fullCost !== null ? fullCost / ready : null,
      humanCost, shared, fullCost,
    };
    const checkNumbers = (value) => {
      if (typeof value === "number" && (!Number.isFinite(value) || Math.abs(value) > 1e15)) throw new Error("Review totals exceed the supported numeric range.");
      if (value && typeof value === "object") Object.values(value).forEach(checkNumbers);
    };
    checkNumbers(result);
    return result;
  }

  function singleBillStage(review) {
    if (review.providerUnit !== null) {
      return {
        key: "outcome",
        kicker: "RUN · CONNECT COST TO OUTCOMES",
        tag: "OUTCOME ECONOMICS · NO SAVINGS CLAIM",
        title: "What did the work actually cost?",
      };
    }
    if (review.level === "Cost and usage") {
      return {
        key: "usage",
        kicker: "WALK · EXPLAIN THE USAGE",
        tag: "COST AND USAGE · NO SAVINGS CLAIM",
        title: "Where is the AI cost going?",
      };
    }
    return {
      key: "bill",
      kicker: "CRAWL · UNDERSTAND THE BILL",
      tag: "BILL FOUNDATION · NO SAVINGS CLAIM",
      title: "Start with the bill.",
    };
  }

  function singleBillGuidance(review) {
    const { totals } = review;
    const cost = (value) => money(value, value < 1 ? 4 : 2);
    const costPerRequest = totals.requests ? totals.providerCost / totals.requests : null;
    const cacheShare = totals.processedInput && totals.cachedInput !== null
      ? totals.cachedInput / totals.processedInput
      : null;
    const readyRate = review.completed ? review.ready / review.completed : null;
    const topCost = [...review.mix].sort((a, b) => b.providerCost - a.providerCost)[0];
    const topCostShare = topCost && totals.providerCost ? topCost.providerCost / totals.providerCost : null;
    const requestNote = totals.requests === 0
      ? "No requests were recorded for this period, so cost per request is unavailable."
      : costPerRequest === null
        ? "Requests were not supplied for every cost row. Leave the metric blank until the source supports it."
        : "This is provider cost divided by all supplied requests. It is a workload-level baseline, not a model price.";

    if (review.level === "Invoice or subscription only") {
      return [
        ["save", "START HERE", "Use this bill as the cost baseline", cost(totals.providerCost), `The review records ${cost(totals.providerCost)} against ${review.workload}. That is enough to begin tracking the cost over time.`],
        ["test", "CHECK NEXT", "Find what is using the subscription or API", "Usage", "For a subscription, check active seats and actual use. For API spend, add requests or tokens by workload when the source provides them."],
        ["leave", "OPTIONAL", "No human review record? Leave it blank", "No penalty", "Human effort belongs in the analysis only when people actively review or correct AI output. It is not required for this bill review."],
        ["fix", "CONTROL", "Give the cost an owner and a limit", "One owner", "Assign the bill to a team or use case and set a monthly budget or usage alert before the cost grows unnoticed."],
      ];
    }

    if (review.providerUnit === null) {
      const topLabel = topCost?.label || review.workload;
      const topValue = topCostShare === null ? cost(totals.providerCost) : pct(topCostShare, 1);
      const cacheTitle = cacheShare === null
        ? "Caching is a question, not a saving"
        : cacheShare
          ? "Cached input is already visible"
          : "No cached input is visible";
      const cacheValue = cacheShare === null ? "Not supplied" : pct(cacheShare, 1);
      const cacheNote = cacheShare === null
        ? "If this workload repeatedly sends the same context, check whether the provider or gateway can report and discount cached input. Do not assume it is available."
        : cacheShare
          ? `${pct(cacheShare, 1)} of processed input was reported as cache reads. Confirm that the billing treatment is actually discounted before calling it a saving.`
          : "If prompts repeatedly send the same long context, test provider-supported caching on one bounded workload and compare the billed result.";
      return [
        ["save", "START HERE", `Start with ${topLabel}`, topValue, topCostShare === null ? "This is the largest visible cost bucket in the supplied file." : `${topLabel} represents ${pct(topCostShare, 1)} of the declared provider cost. Investigate the largest visible bucket before smaller ones.`],
        ["test", "UNIT COST", costPerRequest === null ? "Add request volume when available" : "Know the blended cost per request", costPerRequest === null ? "Optional" : cost(costPerRequest), requestNote],
        ["test", "CHECK NEXT", cacheTitle, cacheValue, cacheNote],
        ["leave", "OPTIONAL DEPTH", "Add outcomes only when the decision needs them", "Later", "You already have a cost and usage review. Add ready results, retries, or human effort only when you need to test quality, value, or a route change."],
      ];
    }

    const humanShare = review.fullCost && review.humanCost !== null ? review.humanCost / review.fullCost : null;
    return [
      ["save", "UNIT ECONOMICS", "The provider cost per ready result is visible", cost(review.providerUnit), `${review.ready} of ${review.completed} supplied results were ready under the declared rule.`],
      ["test", "QUALITY", "Keep the ready-result definition stable", pct(readyRate, 1), "Use the same acceptance rule whenever you compare another model or route. A cheaper result is not equivalent if fewer outputs are usable."],
      ["test", "FULLER COST", review.fullUnit === null ? "Human and shared cost are optional depth" : "The fuller operating unit cost is visible", review.fullUnit === null ? "Optional" : cost(review.fullUnit), review.fullUnit === null ? "If nobody reviews or corrects the output, leave human effort blank. If people do, add observed or sampled active time before making a fully loaded claim." : `Human effort represents ${pct(humanShare, 1)} of the supplied operating cost. Keep the measurement method consistent across future comparisons.`],
      ["leave", "DECISION RULE", "One bill is a baseline, not a saving", "Compare", "Use this result as the current benchmark. A savings claim still needs a comparable route, period, workload, quality rule, and cost basis."],
    ];
  }

  async function buildSingleBillReview(spendText, workText = "", config = {}) {
    const spend = parseCsv(spendText, "Universal spend");
    requireColumns(spend, singleSpendColumns, "Universal spend");
    const work = workText.trim() ? parseCsv(workText, "Outcome log") : [];
    if (work.length) requireColumns(work, singleWorkColumns, "Outcome log");
    const data = { schema_version: singleBillSchema, mode: "real", source: { spend, work }, config: {
      acceptanceRule: "", verifier: "", complete: false, hourlyRate: "", sharedCost: "", ...config,
    } };
    const summary = summarizeSingleBill(data);
    data.period = summary.period;
    data.currency = summary.currency;
    if (new TextEncoder().encode(JSON.stringify(data, null, 2)).length > 5 * 1024 * 1024) throw new Error("The saved review would exceed the 5 MiB JSON limit. Aggregate spend buckets or use a smaller complete workload before importing.");
    validateResult(data);
    return data;
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

  function failedSavingsGateText(comparison, baseline, proposed) {
    const failures = [
      !comparison.quality_holds && "the declared quality requirement",
      !comparison.both_policy_approved && "policy approval",
      !comparison.evidence_complete && "complete outcome evidence",
      !comparison.same_cost_basis && "the same kind of cost data on both routes",
      !providerCostsReported(baseline, proposed, comparison) && "a provider bill for both routes",
    ].filter(Boolean);
    return failures.length > 1
      ? `${failures.slice(0, -1).join(", ")} and ${failures.at(-1)}`
      : failures[0] || "a decision gate";
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

    const {
      requests,
      processedInput,
      cachedInput,
      cacheWriteInput,
      outputTokens,
      providerCost,
    } = summarizeSpendRows(spend, period);

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
          if (retryRequests > Math.max(modelRequests - 1, 0)) {
            throw new Error(`Work ${period} row ${rowNumber} retries cannot exceed the additional model requests after the first request.`);
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
    if (workRequestsKnown && requests !== null && requests !== workRequests) {
      issues.push(`The spend file reports ${requests.toLocaleString()} requests while the work log accounts for ${workRequests.toLocaleString()}.`);
    }
    if (config.outcomeLogComplete === false) {
      issues.push("The reviewer did not confirm that the outcome log covers the full workload and period.");
    }
    const measuredRequests = requests ?? (workRequestsKnown ? workRequests : null);
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
        period: { start: minDate, end: maxDate },
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
          requests: measuredRequests,
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
            ? `Complete ${period} outcome log declared for the spend period${requests !== null && workRequestsKnown ? "; requests reconcile to provider usage" : workRequestsKnown ? "; request counts come from the work log" : "; request counts not supplied"}`
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
          retry_rate: retriesKnown && workRequestsKnown && workRequests
            ? round(retries / workRequests)
            : null,
          cache_reuse_rate: processedInput === null || cachedInput === null
            ? null
            : processedInput ? round(cachedInput / processedInput) : 0,
          cache_write_rate: processedInput === null || cacheWriteInput === null
            ? null
            : processedInput ? round(cacheWriteInput / processedInput) : 0,
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
    requireMatchingDurations(baselineBuild, proposedBuild);
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
    const failedGateText = failedSavingsGateText({
      quality_holds: qualityHolds,
      both_policy_approved: bothPolicyApproved,
      evidence_complete: evidenceComplete,
      same_cost_basis: sameCostBasis,
      provider_cost_reported: providerCostReported,
    }, baseline, proposed);
    let status = "no_improvement";
    let recommendation = "Leave the current route in place. The proposed route does not lower recurring cost per usable result.";
    if (unitDifference < 0 && savingsClaimAllowed) {
      status = "observed_improvement";
      recommendation = payback
        ? `The proposed route has a lower observed cost per usable result. The one time change cost is earned back after about ${payback.toLocaleString()} accepted results.`
        : "The proposed route has a lower observed cost per usable result and clears the declared quality and policy gates.";
    } else if (unitDifference < 0) {
      status = "needs_evidence";
      recommendation = `Test the proposed route, but ${failedGateText} still blocks a savings claim.`;
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
          : `The lower number is not proven savings because ${failedGateText} still blocks the claim.`,
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

    const {
      requests,
      processedInput,
      cachedInput,
      cacheWriteInput,
      outputTokens,
      providerCost,
    } = summarizeSpendRows(spend, period);

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
        period: { start: [...dates].sort()[0], end: [...dates].sort().at(-1) },
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
          cache_reuse_rate: processedInput === null || cachedInput === null
            ? null
            : processedInput ? round(cachedInput / processedInput) : 0,
          cache_write_rate: processedInput === null || cacheWriteInput === null
            ? null
            : processedInput ? round(cacheWriteInput / processedInput) : 0,
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
    requireMatchingDurations(baselineBuild, proposedBuild);
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
    const start = finiteNumber(row.start_time, `${label} start_time`, { integer: true });
    const end = finiteNumber(row.end_time, `${label} end_time`, { integer: true });
    if (end <= start || end > 253402300799) throw new Error(`${label} has an invalid time range.`);
    if (row.end_time_iso) validDate(row.end_time_iso.slice(0, 10), `${label} end_time_iso`);
    if (row.start_time_iso) {
      const day = row.start_time_iso.slice(0, 10);
      return validDate(day, `${label} start_time_iso`);
    }
    const seconds = start;
    if (seconds > 253402300799) throw new Error(`${label} start_time is outside the supported calendar range.`);
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

  const openAIUsageColumns = [
    "start_time", "end_time", "project_id", "num_model_requests", "model", "service_tier",
    "input_tokens", "output_tokens", "input_cached_tokens", "input_cache_write_tokens", "input_uncached_tokens",
  ];
  const openAICostColumns = ["start_time", "end_time", "amount_value", "amount_currency", "line_item", "project_id"];

  async function buildOpenAIBillReview(usageText, costText) {
    const rawUsage = parseCsv(usageText, "OpenAI usage export");
    const rawCosts = parseCsv(costText, "OpenAI cost export");
    requireColumns(
      rawUsage,
      openAIUsageColumns,
      "OpenAI usage export",
    );
    requireColumns(
      rawCosts,
      openAICostColumns,
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
        amount: costNumber(row.amount_value, `${label} amount_value`),
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

  const claudeSpendColumns = [
    "user_email", "account_uuid", "product", "model", "model_family", "total_requests",
    "total_prompt_tokens", "total_completion_tokens", "total_net_spend_usd", "total_gross_spend_usd",
  ];

  function safeImportedLabel(value, label) {
    const text = String(value || "").trim();
    if (!text || /^[=+@-]/.test(text) || /<\/?[a-z][^>]*>/i.test(text)) throw new Error(`${label} contains unsupported formula or markup text.`);
    return text;
  }

  function rowsToCsv(rows) {
    const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    return [singleSpendColumns.join(","), ...rows.map((row) => singleSpendColumns.map((column) => quote(row[column])).join(","))].join("\n");
  }

  function claudePeriod(start, end) {
    const from = validDate(start, "Claude reporting-period start");
    const to = validDate(end, "Claude reporting-period end");
    if (to < from) throw new Error("Claude reporting-period end cannot be before its start.");
    return { start: from, end: to };
  }

  async function buildClaudeSpendReview(text, start, end) {
    const period = claudePeriod(start, end);
    const parsed = parseCsv(text, "Claude spend report");
    const raw = parsed.map((source) => {
      const normalized = {};
      Object.entries(source).forEach(([header, value]) => {
        const key = header.trim().toLowerCase().replace(/[\s-]+/g, "_");
        if (Object.hasOwn(normalized, key)) throw new Error(`Claude spend report has duplicate normalized column ${key}.`);
        normalized[key] = value;
      });
      return normalized;
    });
    requireColumns(raw, claudeSpendColumns, "Claude Team/Enterprise spend report");
    const rows = raw.map((row, index) => {
      const label = `Claude spend row ${index + 2}`;
      const product = safeImportedLabel(row.product, `${label} product`);
      const model = safeImportedLabel(row.model || row.model_family, `${label} model`);
      const net = costNumber(row.total_net_spend_usd, `${label} total_net_spend_usd`);
      costNumber(row.total_gross_spend_usd, `${label} total_gross_spend_usd`);
      const requests = optionalNumber(row.total_requests, `${label} total_requests`, { integer: true });
      const promptTokens = optionalNumber(row.total_prompt_tokens, `${label} total_prompt_tokens`, { integer: true });
      const completionTokens = optionalNumber(row.total_completion_tokens, `${label} total_completion_tokens`, { integer: true });
      return {
        period: "baseline", date: period.start, workload: "Claude organization spend", provider: "Anthropic",
        model, route: product, requests: requests === null ? "" : String(requests),
        input_tokens: promptTokens === null ? "" : String(promptTokens),
        cached_input_tokens: "", cache_write_input_tokens: "",
        output_tokens: completionTokens === null ? "" : String(completionTokens),
        provider_cost: String(net), cost_basis: "provider_reported", currency: "USD",
      };
    });
    const review = await buildSingleBillReview(rowsToCsv(rows), "", { acceptanceRule: "", verifier: "", complete: false, hourlyRate: "", sharedCost: "", serviceStart: period.start, serviceEnd: period.end, reviewSource: "claude_spend_report" });
    const summary = summarizeSingleBill(review);
    return { review, confirmation: {
      provider: "Anthropic", period, products: [...new Set(rows.map((row) => row.route))], models: [...new Set(rows.map((row) => row.model))],
      providerCost: summary.totals.providerCost, requests: summary.totals.requests, inputTokens: summary.totals.processedInput,
      outputTokens: summary.totals.outputTokens, missing: ["Cache values", "Retries", "Human effort", "Outcomes"],
      sourceRows: raw.length, identifiersDiscarded: true,
    } };
  }

  function parseClaudeApiJson(text, label) {
    if (new TextEncoder().encode(text).length > 5 * 1024 * 1024) throw new Error(`${label} exceeds the 5 MiB local file limit.`);
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`${label} is not valid JSON.`); }
    if (!data || !Array.isArray(data.data) || typeof data.has_more !== "boolean") throw new Error(`${label} does not match the published Anthropic Admin API schema.`);
    if (data.has_more || data.next_page) throw new Error(`${label} is a partial API page. Export every page and combine complete results before review.`);
    return data;
  }

  function claudeDailyBucket(bucket, label) {
    if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) throw new Error(`${label} is not an object.`);
    if (typeof bucket.starting_at !== "string" || typeof bucket.ending_at !== "string") throw new Error(`${label} is missing its time boundary.`);
    const startTime = Date.parse(bucket.starting_at);
    const endTime = Date.parse(bucket.ending_at);
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime - startTime !== 86400000) throw new Error(`${label} must be one complete daily bucket.`);
    return validDate(bucket.starting_at.slice(0, 10), `${label} start`);
  }

  async function buildClaudeApiReview(usageText, costText, start, end) {
    const period = claudePeriod(start, end);
    const usage = parseClaudeApiJson(usageText, "Claude Messages Usage JSON");
    const costs = parseClaudeApiJson(costText, "Claude Cost JSON");
    const groups = new Map();
    const add = (date, model) => {
      const key = `${date}\u0000${model}`;
      if (!groups.has(key)) groups.set(key, { date, model, cost: 0, input: 0, cached: 0, cacheWrite: 0, output: 0, usage: false });
      return groups.get(key);
    };
    const usageDates = [];
    usage.data.forEach((bucket, bucketIndex) => {
      const date = claudeDailyBucket(bucket, `Usage bucket ${bucketIndex + 1}`); usageDates.push(date);
      if (!Array.isArray(bucket.results)) throw new Error("Claude Messages Usage JSON has an invalid results list.");
      const seen = new Set();
      bucket.results.forEach((item, index) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Usage result ${index + 1} is not an object.`);
        const signature = JSON.stringify(item);
        if (seen.has(signature)) throw new Error(`Usage result ${index + 1} duplicates an earlier result in the same daily bucket.`);
        seen.add(signature);
        const model = safeImportedLabel(item.model || "Mixed models", `Usage result ${index + 1} model`);
        const row = add(date, model); row.usage = true;
        const uncached = finiteNumber(item.uncached_input_tokens, "uncached_input_tokens", { integer: true });
        const cached = finiteNumber(item.cache_read_input_tokens, "cache_read_input_tokens", { integer: true });
        if (!item.cache_creation || typeof item.cache_creation !== "object" || Array.isArray(item.cache_creation)) throw new Error("cache_creation must contain the published cache token fields.");
        const cacheWrite = finiteNumber(item.cache_creation.ephemeral_1h_input_tokens, "ephemeral_1h_input_tokens", { integer: true }) + finiteNumber(item.cache_creation.ephemeral_5m_input_tokens, "ephemeral_5m_input_tokens", { integer: true });
        row.input += uncached + cached + cacheWrite;
        row.cached += cached;
        row.cacheWrite += cacheWrite;
        row.output += finiteNumber(item.output_tokens, "output_tokens", { integer: true });
      });
    });
    const costDates = [];
    costs.data.forEach((bucket, bucketIndex) => {
      const date = claudeDailyBucket(bucket, `Cost bucket ${bucketIndex + 1}`); costDates.push(date);
      if (!Array.isArray(bucket.results)) throw new Error("Claude Cost JSON has an invalid results list.");
      const seen = new Set();
      bucket.results.forEach((item, index) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Cost result ${index + 1} is not an object.`);
        const signature = JSON.stringify(item);
        if (seen.has(signature)) throw new Error(`Cost result ${index + 1} duplicates an earlier result in the same daily bucket.`);
        seen.add(signature);
        if (item.currency !== "USD") throw new Error(`Cost result ${index + 1} currency must be USD.`);
        const model = safeImportedLabel(item.model || "Mixed models", `Cost result ${index + 1} model`);
        add(date, model).cost += costNumber(item.amount, `Cost result ${index + 1} amount`) / 100;
      });
    });
    if (JSON.stringify([...new Set(usageDates)].sort()) !== JSON.stringify([...new Set(costDates)].sort())) throw new Error("PERIOD MISMATCH: Claude usage and cost JSON do not cover the same daily buckets.");
    const visibleDates = [...new Set(usageDates)].sort();
    if (visibleDates[0] !== period.start || visibleDates.at(-1) !== period.end) throw new Error("PERIOD MISMATCH: the declared Claude period does not match the exported daily buckets.");
    const rows = [...groups.values()].map((item) => ({ period: "baseline", date: item.date, workload: "Claude API usage", provider: "Anthropic", model: item.model, route: "Claude API", requests: "", input_tokens: item.usage ? String(item.input) : "", cached_input_tokens: item.usage ? String(item.cached) : "", cache_write_input_tokens: item.usage ? String(item.cacheWrite) : "", output_tokens: item.usage ? String(item.output) : "", provider_cost: String(round(item.cost)), cost_basis: "provider_reported", currency: "USD" }));
    const review = await buildSingleBillReview(rowsToCsv(rows), "", { acceptanceRule: "", verifier: "", complete: false, hourlyRate: "", sharedCost: "", serviceStart: period.start, serviceEnd: period.end, reviewSource: "claude_admin_api" });
    const summary = summarizeSingleBill(review);
    return { review, confirmation: { provider: "Anthropic", period, products: ["Claude API"], models: [...new Set(rows.map((row) => row.model))], providerCost: summary.totals.providerCost, requests: null, inputTokens: summary.totals.processedInput, outputTokens: summary.totals.outputTokens, missing: ["Request count", "Retries", "Human effort", "Outcomes"], sourceRows: usage.data.length + costs.data.length, identifiersDiscarded: true } };
  }

  const mappingFields = ["date", "service_end", "provider", "model", "workload", "cost", "currency", "requests", "input", "output", "cache_read", "cache_write"];
  const mappingAliases = {
    date: ["date", "invoice_date", "billing_date", "period_start", "service_period_start", "usage_date"],
    service_end: ["service_end", "period_end", "service_period_end", "billing_period_end"],
    provider: ["provider", "vendor"],
    model: ["model", "model_name"],
    workload: ["workload", "route", "product", "service", "project"],
    cost: ["provider_cost", "cost", "amount", "net_cost", "total_cost", "spend", "billed_amount"],
    currency: ["currency", "currency_code", "amount_currency"],
    requests: ["requests", "request_count", "total_requests", "num_model_requests"],
    input: ["input_tokens", "prompt_tokens", "total_prompt_tokens"],
    output: ["output_tokens", "completion_tokens", "total_completion_tokens"],
    cache_read: ["cached_input_tokens", "cache_read_tokens", "input_cached_tokens"],
    cache_write: ["cache_write_input_tokens", "cache_write_tokens", "input_cache_write_tokens"],
  };

  const normalizeHeader = (value) => String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

  function identifyingHeader(value) {
    const header = normalizeHeader(value);
    return header === "name" || /(?:^|_)(?:email|e_mail|full_name|first_name|last_name|address|street_address|postal_address|account_uuid|user_uuid|account_id|user_id|customer_id|member_id|employee_id|contact_id)(?:_|$)/.test(header);
  }

  const mappableHeaders = (parsed) => parsed.headers.filter((header) => !identifyingHeader(header));

  function safeMappedLabel(value, label) {
    const text = safeImportedLabel(value, label);
    if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text) || /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i.test(text)) {
      throw new Error(`${label} looks like a personal identifier. Choose a non-identifying provider, model, workload, or route label.`);
    }
    return text;
  }

  function parseFlatStructured(text, filename = "structured file") {
    if (new TextEncoder().encode(text).length > 5 * 1024 * 1024) throw new Error("The structured file exceeds the 5 MiB local limit.");
    let rows;
    if (/\.json$/i.test(filename) || /^\s*[\[{]/.test(text)) {
      let parsed;
      try { parsed = JSON.parse(text); } catch { throw new Error("The structured file is not valid JSON."); }
      rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.data) ? parsed.data : parsed && typeof parsed === "object" ? [parsed] : null;
      if (!rows?.length) throw new Error("The structured JSON needs at least one flat object.");
      if (rows.length > 20000) throw new Error("The structured file exceeds 20,000 data rows.");
      rows.forEach((row, index) => {
        if (!row || typeof row !== "object" || Array.isArray(row) || Object.values(row).some((value) => value !== null && typeof value === "object")) {
          throw new Error(`Structured JSON row ${index + 1} must be one flat object.`);
        }
      });
      const headers = Object.keys(rows[0]);
      if (!headers.length || rows.some((row) => Object.keys(row).length !== headers.length || headers.some((header) => !Object.hasOwn(row, header)))) {
        throw new Error("Every structured JSON row must use the same flat fields.");
      }
      const seen = new Set();
      rows.forEach((row, index) => {
        const signature = JSON.stringify(headers.map((header) => row[header]));
        if (seen.has(signature)) throw new Error(`Structured file row ${index + 1} duplicates an earlier row.`);
        seen.add(signature);
      });
    } else {
      rows = parseCsv(text, "Structured cost file");
    }
    const headers = Object.keys(rows[0]);
    const normalized = headers.map(normalizeHeader);
    if (new Set(normalized).size !== normalized.length) throw new Error("The structured file has duplicate normalized column names.");
    return { rows, headers, normalized };
  }

  function suggestStructuredMapping(parsed) {
    const allowed = mappableHeaders(parsed);
    return Object.fromEntries(mappingFields.map((field) => {
      const matches = allowed.filter((header) => mappingAliases[field].includes(normalizeHeader(header)));
      return [field, matches.length === 1 ? matches[0] : ""];
    }));
  }

  async function buildMappedReview(text, filename, mapping) {
    const parsed = parseFlatStructured(text, filename);
    for (const field of mappingFields) {
      if (mapping[field] && (!parsed.headers.includes(mapping[field]) || identifyingHeader(mapping[field]))) {
        throw new Error("Identifying source fields cannot be included in a mapped review.");
      }
    }
    for (const required of ["date", "cost"]) {
      if (!mapping[required] || !parsed.headers.includes(mapping[required])) throw new Error(`Map ${required === "cost" ? "provider-reported cost" : required} before building the review.`);
    }
    const currencyConstant = String(mapping.currencyConstant || "").trim().toUpperCase();
    const providerConstant = String(mapping.providerConstant || "").trim();
    if (mapping.currency && currencyConstant) throw new Error("Choose either a mapped currency column or one reported currency, not both.");
    if (!mapping.currency && !currencyConstant) throw new Error("Map currency or enter the three-letter reported currency before building the review.");
    if (currencyConstant && !/^[A-Z]{3}$/.test(currencyConstant)) throw new Error("Reported currency must be a three-letter code.");
    if (mapping.provider && providerConstant) throw new Error("Choose either a mapped provider column or one provider name, not both.");
    const checkedProviderConstant = providerConstant ? safeMappedLabel(providerConstant, "Provider") : "";
    const read = (row, field) => mapping[field] ? String(row[mapping[field]] ?? "").trim() : "";
    const normalized = parsed.rows.map((row, index) => {
      const label = `Mapped row ${index + 2}`;
      const date = validDate(read(row, "date"), `${label} date`);
      const serviceEnd = read(row, "service_end");
      if (serviceEnd) validDate(serviceEnd, `${label} service end`);
      const cost = costNumber(read(row, "cost"), `${label} provider-reported cost`);
      const currency = mapping.currency ? read(row, "currency").toUpperCase() : currencyConstant;
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`${label} currency must be a three-letter code.`);
      const optionalInteger = (field, name) => {
        const value = read(row, field);
        return value === "" ? "" : String(finiteNumber(value, `${label} ${name}`, { integer: true }));
      };
      return {
        period: "baseline", date,
        workload: read(row, "workload") ? safeMappedLabel(read(row, "workload"), `${label} workload`) : "Imported provider bill",
        provider: read(row, "provider") ? safeMappedLabel(read(row, "provider"), `${label} provider`) : checkedProviderConstant || "Provider not supplied",
        model: read(row, "model") ? safeMappedLabel(read(row, "model"), `${label} model`) : "",
        route: read(row, "workload") ? safeMappedLabel(read(row, "workload"), `${label} route`) : "Mapped structured file",
        requests: optionalInteger("requests", "requests"),
        input_tokens: optionalInteger("input", "input tokens"),
        cached_input_tokens: optionalInteger("cache_read", "cache read tokens"),
        cache_write_input_tokens: optionalInteger("cache_write", "cache write tokens"),
        output_tokens: optionalInteger("output", "output tokens"),
        provider_cost: String(cost), cost_basis: "provider_reported", currency,
        _serviceEnd: serviceEnd,
      };
    });
    const currencies = new Set(normalized.map((row) => row.currency));
    if (currencies.size !== 1) throw new Error("One bill review cannot mix currencies. Split the file before review; no currency conversion is applied.");
    const serviceEnds = normalized.map((row) => row._serviceEnd).filter(Boolean);
    if (serviceEnds.length && serviceEnds.length !== normalized.length) throw new Error("Service-period end is missing from some mapped rows. Complete it for every row or leave it unmapped.");
    const sourceTotal = normalized.reduce((total, row) => total + Number(row.provider_cost), 0);
    const csv = rowsToCsv(normalized);
    const review = await buildSingleBillReview(csv, "", {
      acceptanceRule: "", verifier: "", complete: false, hourlyRate: "", sharedCost: "",
      serviceStart: serviceEnds.length ? [...normalized.map((row) => row.date)].sort()[0] : "", serviceEnd: serviceEnds.length ? [...serviceEnds].sort().at(-1) : "", reviewSource: "structured_mapping",
    });
    const summary = summarizeSingleBill(review);
    if (Math.abs(summary.totals.providerCost - sourceTotal) > Math.max(0.00001, Math.abs(sourceTotal) * 0.000001)) {
      throw new Error("The normalized cost total does not reconcile to the mapped source rows.");
    }
    return { review, confirmation: {
      rows: normalized.length, currency: [...currencies][0], sourceTotal: round(sourceTotal), normalizedTotal: round(summary.totals.providerCost),
      period: summary.period, missing: mappingFields.filter((field) => !mapping[field] && !mapping[`${field}Constant`]), confirmedFieldsOnly: true,
    } };
  }

  async function extractPdfText(file, suppliedPdfModule = null) {
    if (file.size > 5 * 1024 * 1024) throw new Error("The PDF exceeds the 5 MiB local limit. Enter the invoice fields manually.");
    let pdf = null;
    try {
      const pdfjs = suppliedPdfModule || await import("./vendor/pdf.min.mjs");
      if (!suppliedPdfModule) pdfjs.GlobalWorkerOptions.workerSrc = new URL("vendor/pdf.worker.min.mjs", document.baseURI).href;
      const options = { data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, verbosity: 0 };
      if (!suppliedPdfModule) {
        options.wasmUrl = new URL("vendor/wasm/", document.baseURI).href;
        options.standardFontDataUrl = new URL("vendor/standard_fonts/", document.baseURI).href;
      }
      const loadingTask = pdfjs.getDocument(options);
      pdf = await loadingTask.promise;
      if (pdf.numPages > 20) throw new Error("This invoice has more than 20 pages. Enter the invoice fields manually.");
      const lines = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const content = await (await pdf.getPage(pageNumber)).getTextContent();
        const items = content.items.filter((item) => typeof item.str === "string" && item.str.trim()).map((item) => ({ text: item.str.trim(), x: Number(item.transform?.[4] || 0), y: Number(item.transform?.[5] || 0) }));
        const bands = [];
        items.sort((a, b) => b.y - a.y || a.x - b.x).forEach((item) => {
          let band = bands.find((candidate) => Math.abs(candidate.y - item.y) < 2);
          if (!band) { band = { y: item.y, items: [] }; bands.push(band); }
          band.items.push(item);
        });
        lines.push(...bands.sort((a, b) => b.y - a.y).map((band) => band.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(" ")));
      }
      const text = lines.join("\n").trim();
      if (text.length < 12) throw new Error("No extractable invoice text was found. The PDF may be scanned; enter the invoice fields manually.");
      return text;
    } catch (error) {
      const message = String(error?.message || "");
      if (/password|encrypted/i.test(`${error?.name || ""} ${message}`)) throw new Error("This PDF is encrypted. Unlock it first or enter the invoice fields manually.");
      if (/No extractable|more than 20 pages|5 MiB/.test(message)) throw error;
      throw new Error("This PDF could not be read as a text invoice. It may be malformed or scanned; enter the invoice fields manually.");
    } finally {
      if (pdf?.destroy) await pdf.destroy();
    }
  }

  function invoiceDate(value) {
    const raw = String(value).trim().replace(/,$/, "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return validDate(raw, "Invoice date");
    const numeric = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (numeric) return validDate(`${numeric[3]}-${numeric[1].padStart(2, "0")}-${numeric[2].padStart(2, "0")}`, "Invoice date");
    const months = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
    const monthFirst = raw.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
    const dayFirst = raw.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
    const match = monthFirst || dayFirst;
    if (!match) return null;
    const monthName = (monthFirst ? match[1] : match[2]).toLowerCase();
    const month = months[monthName];
    if (!month) return null;
    const day = monthFirst ? match[2] : match[1];
    const year = match[3];
    return validDate(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, "Invoice date");
  }

  function extractInvoiceCandidate(text) {
    const providerSignals = [
      { provider: "OpenAI", matches: /\b(?:openai|chatgpt)\b/i.test(text) },
      { provider: "Anthropic", matches: /\b(?:anthropic|claude)\b/i.test(text) },
    ].filter((item) => item.matches);
    if (providerSignals.length !== 1) return { supported: false, reason: "The invoice provider could not be confirmed as OpenAI or Anthropic. Enter the invoice fields manually." };
    const lineList = String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const dateFromLabel = (labels) => {
      for (const line of lineList) {
        const match = line.match(new RegExp(`^(?:${labels})\\s*:?\\s*(.+)$`, "i"));
        if (match) { const date = invoiceDate(match[1]); if (date) return date; }
      }
      return "";
    };
    const periodLine = lineList.find((line) => /(?:service|billing)\s+period/i.test(line)) || "";
    const periodDates = [...periodLine.matchAll(/(?:\d{4}-\d{2}-\d{2}|\d{1,2}[\/-]\d{1,2}[\/-]\d{4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4})/gi)].map((match) => invoiceDate(match[0])).filter(Boolean);
    const amountPattern = /\b(subtotal|tax|credit|amount\s+due|amount\s+paid|prior\s+balance|invoice\s+total|total\s+due|total)\b\s*:?\s*(?:(USD|EUR|GBP|US\$)\s*)?([\$€£])?\s*(-?\d[\d,]*(?:\.\d{1,2})?)/i;
    const amountCandidates = lineList.flatMap((line) => {
      const match = line.match(amountPattern);
      if (!match) return [];
      const currencyToken = (match[2] || match[3] || "").toUpperCase();
      const currency = currencyToken === "US$" || currencyToken === "USD" ? "USD" : currencyToken === "EUR" || currencyToken === "€" ? "EUR" : currencyToken === "GBP" || currencyToken === "£" ? "GBP" : "";
      const value = Number(match[4].replaceAll(",", ""));
      if (!Number.isFinite(value)) return [];
      return [{ label: match[1].replace(/\s+/g, " ").toLowerCase(), value, currency }];
    });
    const currencies = new Set(amountCandidates.map((item) => item.currency).filter(Boolean));
    return {
      supported: true, provider: providerSignals[0].provider,
      invoiceDate: dateFromLabel("invoice date|date issued|date of issue|issued on|billing date"),
      serviceStart: periodDates[0] || "", serviceEnd: periodDates[1] || "",
      currency: currencies.size === 1 ? [...currencies][0] : "",
      amountCandidates,
      suggestedAmount: amountCandidates.length === 1 ? amountCandidates[0] : null,
    };
  }

  async function inspectUploadedFiles(files) {
    const selected = [...files];
    if (!selected.length) throw new Error("Choose a CSV, JSON, or text-based PDF.");
    if (selected.length > 2) throw new Error("Choose one file, or one matching provider export pair.");
    const pdfs = selected.filter((file) => /\.pdf$/i.test(file.name) || file.type === "application/pdf");
    if (pdfs.length) {
      if (selected.length !== 1) throw new Error("Review one invoice PDF at a time.");
      return { kind: "pdf", file: pdfs[0] };
    }
    const loaded = await Promise.all(selected.map(async (file) => ({ file, text: await readLocalFile(file) })));
    const csvs = [];
    const jsons = [];
    for (const item of loaded) {
      if (/\.json$/i.test(item.file.name) || /^\s*[\[{]/.test(item.text)) jsons.push(item);
      else csvs.push({ ...item, parsed: parseFlatStructured(item.text, item.file.name) });
    }
    if (csvs.length === 2 && !jsons.length) {
      const has = (parsed, required) => required.every((column) => parsed.headers.includes(column));
      const usage = csvs.find((item) => has(item.parsed, openAIUsageColumns));
      const cost = csvs.find((item) => has(item.parsed, openAICostColumns));
      if (usage && cost && usage !== cost) return { kind: "openai", usageText: usage.text, costText: cost.text };
      throw new Error("These two CSV files are not a recognized matching OpenAI export pair. Choose one unknown structured file at a time for guided mapping.");
    }
    if (jsons.length === 2 && !csvs.length) {
      const parsed = jsons.map((item) => {
        let value; try { value = JSON.parse(item.text); } catch { throw new Error("One selected JSON file is malformed."); }
        const results = value?.data?.flatMap((bucket) => Array.isArray(bucket?.results) ? bucket.results : []) || [];
        return { ...item, value, usage: results.some((row) => Object.hasOwn(row, "uncached_input_tokens")), cost: results.some((row) => Object.hasOwn(row, "amount")) };
      });
      const usage = parsed.find((item) => item.usage && !item.cost);
      const cost = parsed.find((item) => item.cost && !item.usage);
      if (usage && cost) return { kind: "claude_api", usageText: usage.text, costText: cost.text };
      throw new Error("These JSON files are not a complete Claude Messages Usage and Cost report pair.");
    }
    if (loaded.length !== 1) throw new Error("Choose one structured file, or one recognized matching provider pair.");
    if (csvs.length) {
      const item = csvs[0];
      const normalized = new Set(item.parsed.normalized);
      if (claudeSpendColumns.every((column) => normalized.has(column))) return { kind: "claude_spend", text: item.text };
      if (singleSpendColumns.every((column) => item.parsed.headers.includes(column))) {
        if (item.parsed.rows.some((row) => String(row.period).toLowerCase() !== "baseline")) {
          throw new Error("This universal file contains a route comparison. Use Compare two routes so the existing evidence gates remain in force.");
        }
        return { kind: "universal", text: item.text };
      }
      return { kind: "mapping", text: item.text, filename: item.file.name, parsed: item.parsed, mappableHeaders: mappableHeaders(item.parsed), mapping: suggestStructuredMapping(item.parsed) };
    }
    const parsed = parseFlatStructured(jsons[0].text, jsons[0].file.name);
    return { kind: "mapping", text: jsons[0].text, filename: jsons[0].file.name, parsed, mappableHeaders: mappableHeaders(parsed), mapping: suggestStructuredMapping(parsed) };
  }

  function validateResult(data) {
    const fail = (path) => { throw new Error(`Review validation failed at ${path}. Rebuild the review from the original files.`); };
    const shape = (value, spec, path = "review") => {
      if (typeof spec === "string") {
        if (spec.endsWith("?") && value === null) return;
        const kind = spec.replace("?", "");
        if (kind === "number" && (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e15)) fail(path);
        if (kind === "string" && (typeof value !== "string" || value.length > 10000)) fail(path);
        if (kind === "boolean" && typeof value !== "boolean") fail(path);
      } else if (Array.isArray(spec)) {
        if (!Array.isArray(value) || value.length > 20000) fail(path);
        value.forEach((item, index) => shape(item, spec[0], `${path}[${index}]`));
      } else {
        if (!value || typeof value !== "object" || Array.isArray(value)) fail(path);
        Object.entries(spec).forEach(([key, child]) => shape(value[key], child, `${path}.${key}`));
      }
    };
    const fields = (names, type = "number") => Object.fromEntries(names.split(" ").map((key) => [key, type]));
    const close = (a, b, path) => { if (Math.abs(a - b) > Math.max(0.00002, Math.abs(b) * 0.000002)) fail(path); };
    // Bound even unknown fields: JSON may encode non-finite numbers as 1e999,
    // and deeply nested input must not reach recursive rendering or cloning.
    const walk = (value, depth = 0) => {
      if (depth > 20) fail("nesting depth");
      if (typeof value === "number" && (!Number.isFinite(value) || Math.abs(value) > 1e15)) fail("numeric range");
      if (value && typeof value === "object") Object.values(value).forEach((v) => walk(v, depth + 1));
    };
    walk(data);
    shape(data, { schema_version: "string", mode: "string", period: { start: "string", end: "string", timezone: "string" } });
    validDate(data.period.start, "Review period start");
    validDate(data.period.end, "Review period end");
    if (data.period.start > data.period.end || data.period.timezone !== "UTC") fail("period");
    const currency = (value) => { if (!/^[A-Z]{3}$/.test(value)) fail("currency"); };
    if (data.schema_version === singleBillSchema) {
      shape(data, { currency: "string", source: {
        spend: [fields(singleSpendColumns.join(" "), "string")], work: [fields(singleWorkColumns.join(" "), "string")],
      }, config: { acceptanceRule: "string", verifier: "string", complete: "boolean", hourlyRate: "string", sharedCost: "string" } });
      for (const row of [...data.source.spend, ...data.source.work]) {
        Object.values(row).forEach((value) => shape(value, "string", "source row"));
      }
      const summary = summarizeSingleBill(data);
      if (data.mode !== "real" || data.currency !== summary.currency || data.period.start !== summary.period.start || data.period.end !== summary.period.end) fail("single bill metadata");
      return data;
    }
    if (data?.schema_version === "ai-cost-lens-openai-bill-review/0.1") {
      const usage = fields("requests input_tokens uncached_input_tokens cached_input_tokens cache_write_input_tokens output_tokens");
      shape(data, {
        provider: "string", finding: "string", next_step: "string", limitations: ["string"],
        bill: { basis: "string", currency: "string", total: "number", ...fields("populated_rows days_with_cost") },
        period: { aligned: "boolean", usage_dates: ["string"], cost_dates: ["string"] },
        usage: { totals: usage, ...fields("populated_rows days_with_usage"), by_model: [{ model: "string", ...usage }], by_project: [{ project: "string", ...usage }] },
        coverage: Object.fromEntries("usage_model usage_project usage_api_key usage_service_tier cost_project cost_api_key cost_line_item".split(" ").map((key) => [key, fields("attributed_rows total_rows row_coverage_pct")])),
        reconciliation: { status: "string", ...fields("periods_aligned project_cost_join_supported model_cost_allocation_supported outcome_cost_supported savings_claim_allowed", "boolean") },
        source: { usage_export: "string", cost_export: "string", usage_sha256: "string?", cost_sha256: "string?" },
      });
      currency(data.bill.currency);
      if (!data.limitations.length || data.bill.total < 0 || data.provider !== "openai" || data.reconciliation.savings_claim_allowed || data.reconciliation.model_cost_allocation_supported || data.reconciliation.outcome_cost_supported) fail("bill evidence boundary");
      return;
    }
    if (!data || data.schema_version !== "ai-cost-lens-review-result/1.0") {
      throw new Error("That file is not an AI Cost Lens review result.");
    }
    currency(data.currency);
    shape(data, {
      currency: "string",
      workload: { ...fields("name description outcome_unit", "string"), accepted_quality_threshold: "number" },
      comparison: {
        ...fields("status finding limitation recommendation", "string"),
        ...fields("savings_claim_allowed same_cost_basis provider_cost_reported quality_holds both_policy_approved evidence_complete", "boolean"),
        ...fields("recurring_cost_difference cost_per_usable_result_difference cost_per_usable_result_change_pct usable_result_rate_change_points normalized_proposed_cost_at_baseline_volume normalized_cost_difference"),
        payback_usable_results: "number?",
      },
    });
    if (!["real", "sampled", "illustrative"].includes(data.mode)) fail("mode");
    if (data.workload.accepted_quality_threshold <= 0 || data.workload.accepted_quality_threshold > 1) fail("quality threshold");
    const counts = fields("ready_to_use needs_correction needs_escalation");
    for (const key of ["baseline", "proposed"]) {
      const scenario = data[key];
      shape(scenario, {
        id: "string", label: "string", model: fields("provider name route", "string"),
        costs: fields("model_cost shared_infrastructure_cost human_review_cost one_time_change_cost recurring_operating_cost all_in_pilot_cost"),
        usage: fields("requests retries unique_input_tokens processed_input_tokens cached_input_tokens cache_write_input_tokens output_tokens", "number?"),
        outcomes: { ...fields("basis verifier acceptance_rule", "string"), ...fields("completed_results usable_results human_review_minutes review_minutes correction_minutes"), status_counts: counts },
        policy: { approved: "boolean", retention_mode: "string" },
        evidence: { ...fields("cost_basis outcome_basis source observed_at coverage coverage_status cost_boundary", "string"), reconciliation_issues: ["string"], ...fields("provider_usage_sha256 provider_cost_sha256 outcome_log_sha256", "string?") },
        measures: { ...fields("cost_per_usable_result all_in_cost_per_usable_result usable_result_rate human_review_minutes_per_usable_result"), ...fields("retry_rate cache_reuse_rate cache_write_rate context_reprocessing_ratio", "number?") },
      }, key);
      if (Object.values(scenario.costs).some((n) => n < 0) || scenario.costs.recurring_operating_cost <= 0 || scenario.outcomes.usable_results < 0.000001 || scenario.outcomes.completed_results < scenario.outcomes.usable_results || scenario.measures.cost_per_usable_result < 0.000001) fail(`${key} costs or outcomes`);
      if (Object.values(scenario.usage).some((n) => n !== null && n < 0) || Object.values(scenario.outcomes.status_counts).some((n) => n < 0)) fail(`${key} counts`);
      close(scenario.costs.recurring_operating_cost, scenario.costs.model_cost + scenario.costs.shared_infrastructure_cost + scenario.costs.human_review_cost, `${key} recurring cost`);
      close(scenario.costs.all_in_pilot_cost, scenario.costs.recurring_operating_cost + scenario.costs.one_time_change_cost, `${key} pilot cost`);
      close(scenario.measures.cost_per_usable_result, scenario.costs.recurring_operating_cost / scenario.outcomes.usable_results, `${key} unit cost`);
      close(scenario.measures.usable_result_rate, scenario.outcomes.usable_results / scenario.outcomes.completed_results, `${key} yield`);
      close(Object.values(scenario.outcomes.status_counts).reduce((a, b) => a + b, 0), scenario.outcomes.completed_results, `${key} outcome counts`);
      for (const rate of [scenario.measures.usable_result_rate, scenario.measures.retry_rate, scenario.measures.cache_reuse_rate, scenario.measures.cache_write_rate]) {
        if (rate !== null && (rate < 0 || rate > 1)) fail(`${key} rates`);
      }
      validDate(scenario.evidence.observed_at, `${key} observed date`);
      if (scenario.outcomes.basis === "sampled" || scenario.outcomes.sample_counts !== undefined) {
        shape(scenario.outcomes, { sample_counts: counts, ...fields("sample_size sample_human_minutes"), sample_method: "string", ready_rate_interval_95: ["number"] }, `${key}.sample`);
        if (scenario.outcomes.sample_size <= 0 || scenario.outcomes.ready_rate_interval_95.length !== 2) fail(`${key}.sample`);
      }
    }
    if (data.mode !== "illustrative") {
      const periods = [data.baseline, data.proposed].map((scenario) => {
        shape(scenario.period, { start: "string", end: "string" }, "route period");
        validDate(scenario.period.start, "Route start");
        validDate(scenario.period.end, "Route end");
        if (scenario.period.start > scenario.period.end) fail("route period");
        return { dates: [scenario.period.start, scenario.period.end] };
      });
      requireMatchingDurations(...periods);
    }
    const a = data.baseline, b = data.proposed, comparison = data.comparison;
    close(comparison.recurring_cost_difference, b.costs.recurring_operating_cost - a.costs.recurring_operating_cost, "comparison recurring cost");
    close(comparison.cost_per_usable_result_difference, b.measures.cost_per_usable_result - a.measures.cost_per_usable_result, "comparison unit cost");
    const sameBasis = a.evidence.cost_basis === b.evidence.cost_basis;
    const reported = [a, b].every((s) => s.evidence.cost_basis === "observed");
    if (comparison.same_cost_basis !== sameBasis || comparison.provider_cost_reported !== reported) fail("comparison cost basis");
    if (comparison.savings_claim_allowed && (data.mode !== "real" || !sameBasis || !reported || !comparison.evidence_complete || !comparison.quality_holds || !comparison.both_policy_approved || !a.policy.approved || !b.policy.approved || b.measures.usable_result_rate < data.workload.accepted_quality_threshold || comparison.cost_per_usable_result_difference >= 0 || [a,b].some((s) => s.evidence.coverage_status !== "complete" || s.evidence.reconciliation_issues.length))) fail("savings evidence");
    if (data.planning !== undefined && data.planning !== null) {
      const plan = fields("provider_cost shared_infrastructure_cost human_review_cost recurring_operating_cost completed_results ready_result_rate ready_results cost_per_ready_result");
      shape(data.planning, { label: "string", plan, actual: plan, variance: { ...fields("provider_cost shared_infrastructure_cost human_review_cost recurring_operating_cost ready_results ready_result_rate_points cost_per_ready_result"), primary_cost_drivers: [{ label: "string", amount: "number", direction: "string" }] }, payback: { ...fields("expected_ready_results_per_month decision_horizon_months monthly_operating_savings one_time_change_cost horizon_net_savings"), payback_months: "number?", within_decision_horizon: "boolean", status: "string" } }, "planning");
      if (["within_horizon", "outside_horizon"].includes(data.planning.payback.status) && data.planning.payback.payback_months === null) fail("planning payback");
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
    const failedGateText = failedSavingsGateText(comparison, baseline, proposed);
    const failedGateSentence = sentenceCase(failedGateText);
    const failedGateVerb = /,| and /.test(failedGateText) ? "block" : "blocks";
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
        : comparison.savings_claim_allowed
          ? "The bill, work volume, quality rule, policy approval, and included costs all match for this review. That supports this decision for this workload and period, not a claim about the model everywhere."
          : issueCount
            ? `${failedGateSentence} still ${failedGateVerb} a savings claim. Open The evidence for the ${issueCount} reconciliation issue${issueCount === 1 ? "" : "s"}.`
            : `The files match, but ${failedGateText} still ${failedGateVerb} a savings claim.`,
      cfo: comparison.cost_per_usable_result_change_pct > 0
        ? `The proposed route reduces ${providerTerm}, but not the cost of usable work. After shared infrastructure and human correction, each ready result costs ${unitMoney(proposed.measures.cost_per_usable_result)} versus ${unitMoney(baseline.measures.cost_per_usable_result)} today. Keep the current route and test whether the proposed route can reach at least ${facts.requiredRate?.toFixed(1) ?? "the required"}% ready results before changing the default.`
        : `The proposed route produces a ready result for ${unitMoney(proposed.measures.cost_per_usable_result)} versus ${unitMoney(baseline.measures.cost_per_usable_result)} today. ${comparison.savings_claim_allowed ? "The evidence supports the difference for this workload and period." : `${failedGateSentence} still ${failedGateVerb} a savings claim.`}`,
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
        `to use. ${baseline.label} cost ${unitMoney(baselineUnit)}. It looks better, but ${failedSavingsGateText(comparison, baseline, proposed)} still blocks a savings claim.`;
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
    const gateFailureText = failedSavingsGateText(comparison, baseline, proposed);
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
        base: pctOrMissing(baseline.measures.cache_reuse_rate),
        proposed: pctOrMissing(proposed.measures.cache_reuse_rate),
        note: baseline.measures.cache_reuse_rate === null || proposed.measures.cache_reuse_rate === null
          ? "At least one source report did not supply the token fields needed for this measure."
          : "Share of processed input read from cache across all provider requests, including retries.",
      },
      {
        label: "Cache writes",
        base: pctOrMissing(baseline.measures.cache_write_rate),
        proposed: pctOrMissing(proposed.measures.cache_write_rate),
        note: baseline.measures.cache_write_rate === null || proposed.measures.cache_write_rate === null
          ? "At least one source report did not supply cache-write tokens."
          : "Context written to cache. This can carry a different rate from an ordinary input or cache read.",
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
        base: compactOrMissing(baseline.usage.processed_input_tokens),
        proposed: compactOrMissing(proposed.usage.processed_input_tokens),
        note:
          baseline.usage.processed_input_tokens === null || proposed.usage.processed_input_tokens === null
            ? "At least one source report did not supply processed input tokens."
            : baseline.usage.unique_input_tokens === null
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

  function renderSingleBill() {
    const review = summarizeSingleBill(state.data);
    const { totals, period } = review;
    const stage = singleBillStage(review);
    const guidance = singleBillGuidance(review);
    const count = (value) => value === null ? "Not supplied" : compact(value);
    const cost = (value) => value === null ? "Unavailable" : money(value, value < 1 ? 4 : 2);
    const costPerRequest = totals.requests ? totals.providerCost / totals.requests : null;
    const cacheShare = totals.processedInput && totals.cachedInput !== null ? totals.cachedInput / totals.processedInput : null;
    const headline = stage.key === "bill"
      ? `${cost(totals.providerCost)} is the starting cost for ${review.workload}.`
      : stage.key === "usage"
        ? totals.requests
          ? `${cost(totals.providerCost)} across ${count(totals.requests)} requests for ${review.workload}.`
          : `${cost(totals.providerCost)} with usage recorded for ${review.workload}.`
        : `${cost(totals.providerCost)} produced ${count(review.ready)} ready result${review.ready === 1 ? "" : "s"} at ${cost(review.providerUnit)} each.`;
    const metrics = stage.key === "bill"
      ? [
          [costBasisLabel(review.basis), cost(totals.providerCost), "The declared starting point for this review"],
          ["Review depth", "Bill only", "Useful for a cost baseline; usage and outcomes are optional next layers"],
          ["Usage detail", "Not supplied", "Add requests or tokens only when the source supports them"],
          ["Human effort", "Optional", "Leave blank when nobody reviews or corrects the output"],
        ]
      : stage.key === "usage"
        ? [
            [costBasisLabel(review.basis), cost(totals.providerCost), "The declared cost for this workload and period"],
            ["Requests", count(totals.requests), "Includes additional attempts when reported"],
            ["Blended cost per request", cost(costPerRequest), "Provider cost divided by supplied requests; not a model price"],
            ["Input tokens", count(totals.processedInput), `Cache read: ${count(totals.cachedInput)} · Cache write: ${count(totals.cacheWriteInput)}`],
            ["Output tokens", count(totals.outputTokens), "Unknown fields are not zero"],
            ["Cache-read share", cacheShare === null ? "Not supplied" : pct(cacheShare, 1), "Use only the cache fields reported by the source"],
            ["Outcome economics", "Optional", "Add results only when you need to test value or a route change"],
            ["Human effort", "Optional", "Add only when people actively review or correct the output"],
          ]
        : [
            [costBasisLabel(review.basis), cost(totals.providerCost), "The declared cost for this workload and period"],
            ["Requests", count(totals.requests), "Includes additional attempts when reported"],
            ["Ready results", count(review.ready), `${review.completed} outcome rows under the declared ready rule`],
            ["Provider cost per ready result", cost(review.providerUnit), "Excludes shared infrastructure and human effort"],
            ["Full operating cost per ready result", review.fullUnit === null ? "Optional" : cost(review.fullUnit), "Available only when relevant human and shared costs are supplied"],
            ["Retries", count(review.retries), "Optional; missing retry records do not block the unit cost"],
            ["Human minutes", count(review.minutes), "Optional; include only active review and correction time"],
            ["Cache-read share", cacheShare === null ? "Not supplied" : pct(cacheShare, 1), "Use only the cache fields reported by the source"],
          ];
    document.getElementById("bill-review-kicker").textContent = stage.kicker;
    document.getElementById("bill-review-title").textContent = stage.title;
    const sourceTitles = {
      invoice_form: "Your invoice details",
      claude_spend_report: "Your Claude Team or Enterprise spend report",
      claude_admin_api: "Your saved Claude Admin API reports",
    };
    document.getElementById("bill-source-title").textContent = sourceTitles[state.data.config.reviewSource] || "Your completed universal template";
    document.getElementById("bill-source-copy").textContent = "Start with the records you already have. Each additional layer deepens the review without replacing the bill.";
    document.getElementById("bill-period-label").textContent = `${period.start} to ${period.end} · supplied date buckets, not proof of service-period coverage`;
    document.getElementById("bill-mode-tag").textContent = stage.tag;
    document.getElementById("bill-finding-title").textContent = headline;
    document.getElementById("bill-finding-limit").textContent = stage.key === "bill"
      ? "This is enough to establish a cost baseline. Add usage when it is available. Human effort and retries are optional."
      : stage.key === "usage"
        ? "This review explains the technical cost drivers supplied in the file. Add outcomes only when you need to test value or compare a change."
        : review.fullUnit === null
          ? "The bill is connected to completed work. Human and shared costs remain optional and are not treated as zero."
          : "The bill, completed work, and supplied operating costs are connected. One bill still establishes a baseline, not savings.";
    document.getElementById("bill-metric-ledger").innerHTML = metrics.map(([label, value, note]) => `<div class="metric-cell"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></div>`).join("");
    document.getElementById("model-mix-title").textContent = "Declared bill drivers and available usage";
    document.getElementById("bill-mix-note").textContent = `Amounts use ${costBasisLabel(review.basis).toLowerCase()}. This is the supplied attribution, not an inferred allocation or savings estimate. Cache values are token counts.`;
    document.getElementById("bill-model-head").innerHTML = "<tr><th>Provider / model / route</th><th>Requests</th><th>Input / output</th><th>Cache read / write</th><th>Cost basis</th><th>Declared cost</th></tr>";
    document.getElementById("bill-model-rows").innerHTML = review.mix.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${count(row.requests)}</td><td>${count(row.processedInput)} / ${count(row.outputTokens)}</td><td>${count(row.cachedInput)} / ${count(row.cacheWriteInput)}</td><td>${escapeHtml(costBasisLabel(review.basis))}</td><td>${cost(row.providerCost)}</td></tr>`).join("");
    document.getElementById("bill-opportunity-ledger").innerHTML = guidance.map(([kind, label, title, value, note]) => `<article class="opportunity-row state-${kind}"><span class="opportunity-state">${escapeHtml(label)}</span><div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(note)}</p></div><em>${escapeHtml(value)}</em></article>`).join("");
    document.getElementById("bill-next-step").textContent = stage.key === "bill"
      ? "Keep this baseline. Add the next piece of data only when it answers a real decision."
      : stage.key === "usage"
        ? "Investigate the largest visible cost driver, then test one bounded change."
        : "Use this as the current benchmark before comparing another model or route.";
    document.getElementById("bill-boundary-copy").textContent = stage.key === "bill"
      ? "A bill can establish cost without proving utilization or savings. That is a useful starting point, not a failed review."
      : stage.key === "usage"
        ? "Cost and usage can reveal where to investigate. They cannot prove that a cheaper model produces equally useful work."
        : "Human effort is optional. Add it only when people review or correct output. Savings still require two comparable routes and the same quality rule.";
    document.getElementById("memo-title").textContent = "AI cost review";
    document.getElementById("memo-meta").textContent = `${review.workload} · ${period.start} to ${period.end} · ${review.currency}`;
    document.getElementById("memo-decision-code").textContent = stage.key === "bill" ? "COST BASELINE" : stage.key === "usage" ? "USAGE REVIEW" : "OUTCOME ECONOMICS";
    document.getElementById("memo-decision-title").textContent = headline;
    document.getElementById("memo-decision-limit").textContent = "This single-bill review does not claim savings. Missing measures remain unavailable rather than becoming zero.";
    document.getElementById("memo-numbers-title").textContent = "What the supplied evidence supports";
    document.getElementById("memo-table-head").innerHTML = "<tr><th>Measure</th><th>Value</th><th>Boundary</th></tr>";
    document.getElementById("memo-table-body").innerHTML = metrics.map((cells) => `<tr>${cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("");
    document.getElementById("memo-rules").innerHTML = memoList([["Ready means", state.data.config.acceptanceRule || "Not supplied"], ["Verified by", state.data.config.verifier || "Not supplied"], ["Cost basis", costBasisLabel(review.basis)]]);
    document.getElementById("memo-evidence").innerHTML = memoList([["Review depth", stage.title], ["Evidence level", review.level], ["Coverage", "Service period and completeness are user declarations, not independently verified"], ["Savings", "Not supported by one bill"]]);
    document.getElementById("memo-planning").hidden = true;
    document.getElementById("memo-next-step").textContent = document.getElementById("bill-next-step").textContent;
    document.getElementById("memo-footer-status").textContent = "Calculated locally from supplied records · no AI API";
  }

  function renderOpenAIBill() {
    document.getElementById("bill-review-kicker").textContent = "WALK · EXPLAIN THE USAGE";
    document.getElementById("bill-review-title").textContent = "Where is the AI cost going?";
    document.getElementById("bill-source-title").textContent = "Saved dashboard exports";
    document.getElementById("bill-source-copy").textContent = "The matching exports create a cost and usage baseline. Outcomes and human effort are optional next layers.";
    document.getElementById("model-mix-title").textContent = "Where the requests and tokens went";
    document.getElementById("bill-mix-note").textContent = "These are observed usage measures. They are not billed dollars by model.";
    document.getElementById("bill-model-head").innerHTML = "<tr><th>Model</th><th>Requests</th><th>Input</th><th>Output</th><th>Cache share</th><th>Billed cost</th></tr>";
    const { bill, usage, period, reconciliation, limitations } = state.data;
    const totalInput = usage.totals.input_tokens;
    const cacheShare = totalInput ? usage.totals.cached_input_tokens / totalInput : 0;
    const costPerRequest = period.aligned && usage.totals.requests ? Number(bill.total) / usage.totals.requests : null;
    const averageInput = usage.totals.requests ? totalInput / usage.totals.requests : null;
    const averageOutput = usage.totals.requests ? usage.totals.output_tokens / usage.totals.requests : null;
    const topModel = usage.by_model[0];
    const topRequestShare = topModel && usage.totals.requests ? topModel.requests / usage.totals.requests : null;
    const costPerRequestLabel = costPerRequest === null ? "Unavailable" : money(costPerRequest, costPerRequest < 1 ? 4 : 2);
    const topRequestShareLabel = topRequestShare === null ? "Unavailable" : pct(topRequestShare, 1);
    document.getElementById("bill-period-label").textContent = `${period.start} to ${period.end} · ${period.timezone}`;
    document.getElementById("bill-mode-tag").textContent = !period.aligned ? "PERIOD MISMATCH" : state.data.mode === "illustrative" ? "ILLUSTRATIVE COST AND USAGE" : "COST AND USAGE · NO SAVINGS CLAIM";
    document.getElementById("bill-finding-title").textContent =
      period.aligned
        ? costPerRequest === null
          ? `OpenAI reported ${money(Number(bill.total), Number(bill.total) < 1 ? 4 : 2)} for the exported period. No nonzero request volume was supplied for a blended unit cost.`
          : `OpenAI reported ${money(Number(bill.total), Number(bill.total) < 1 ? 4 : 2)} across ${compact(usage.totals.requests)} requests, or ${costPerRequestLabel} per observed request.`
        : `OpenAI reported ${money(Number(bill.total), Number(bill.total) < 1 ? 4 : 2)} in the cost export. Usage covers different daily buckets; these totals are not a matched financial review.`;
    document.getElementById("bill-finding-limit").textContent = period.aligned ? `This is a useful cost and usage baseline. ${limitations[0]} Human effort is not required for this review.`
      : "PERIOD MISMATCH: usage and cost exports cover different daily buckets. Export the same date range again before using this review for a financial decision.";
    const metrics = [
      ["Provider reported cost", money(Number(bill.total), Number(bill.total) < 1 ? 4 : 2), `${bill.populated_rows} populated cost row${bill.populated_rows === 1 ? "" : "s"}`],
      ["Requests", compact(usage.totals.requests), `${usage.by_model.length} model${usage.by_model.length === 1 ? "" : "s"} observed`],
      ["Blended cost per request", costPerRequestLabel, "Full exported cost divided by observed requests; not a model price"],
      ["Input tokens", compact(totalInput), `${pct(cacheShare, 1)} read from cache`],
      ["Output tokens", compact(usage.totals.output_tokens), `${usage.days_with_usage} day${usage.days_with_usage === 1 ? "" : "s"} with usage`],
      ["Average input per request", averageInput === null ? "Unavailable" : compact(averageInput), "A prompt-size baseline for this exported period"],
      ["Average output per request", averageOutput === null ? "Unavailable" : compact(averageOutput), "An output-length baseline for this exported period"],
      ["Human effort", "Optional", "Add only when people actively review or correct the output"],
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
    const ledger = period.aligned ? [
      ["save", "START HERE", `Most requests went to ${topModel.model}`, topRequestShareLabel, `${topModel.model} handled ${compact(topModel.requests)} of ${compact(usage.totals.requests)} requests. Start with the busiest visible route before smaller ones.`],
      ["test", "UNIT COST", costPerRequest === null ? "Request unit cost is unavailable" : "Use the blended request cost as a baseline", costPerRequestLabel, costPerRequest === null ? "The export has no nonzero request volume. Keep the unit cost unavailable rather than dividing by zero." : "This is the full exported cost divided by observed requests. Track it over time, but do not treat it as a billed model rate."],
      ["test", "CHECK NEXT", cacheShare ? "Cached input is already visible" : "Check whether repeated context can be cached", pct(cacheShare, 1), cacheShare ? `${pct(cacheShare, 1)} of input tokens were read from cache. Confirm the provider's billed treatment before calling it a saving.` : "If this workload repeatedly sends the same context, test provider-supported caching on one bounded job and compare the actual bill."],
      ["test", "TEST FIRST", "Try a cheaper route on one repeatable job", "Bounded test", "Keep the job and quality rule fixed. Outcomes can be a small sample first; human effort is optional unless people actually review the work."],
      ["leave", "LEAVE ALONE", "Do not spread the total bill across models", "Unsupported", "Token share shows usage. The saved cost export does not support billed dollars by model."],
    ] : [
      ["fix", "FIX FIRST", "Match the usage and cost periods", "Required", "Export the same daily buckets again. A blended unit cost would be misleading until the periods align."],
      ["leave", "LEAVE ALONE", "Do not compare the unmatched totals", "Unsupported", "Keep each export intact and avoid normalizing or allocating the difference by assumption."],
    ];
    document.getElementById("bill-opportunity-ledger").innerHTML = ledger.map(([kind, label, title, value, note]) => `
      <article class="opportunity-row state-${kind}">
        <span class="opportunity-state">${escapeHtml(label)}</span>
        <div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(note)}</p></div>
        <em>${escapeHtml(value)}</em>
      </article>
    `).join("");
    document.getElementById("bill-next-step").textContent = period.aligned
      ? topRequestShare === null
        ? `Start with ${topModel.model}, the busiest visible route in this export.`
        : `Start with ${topModel.model}, the route handling ${topRequestShareLabel} of requests.`
      : "Export matching usage and cost periods before investigating optimization.";
    document.getElementById("bill-boundary-copy").textContent = period.aligned
      ? `${usage.by_model.length} model route${usage.by_model.length === 1 ? "" : "s"} and ${usage.by_project.length} project record${usage.by_project.length === 1 ? "" : "s"} are visible. Check prompt size, output length, caching, and whether a smaller model meets quality on one repeatable job. Human review is optional; add outcomes only when you need to test value or savings.`
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
    if (state.data.schema_version === singleBillSchema) return;
    const isBill = state.data.schema_version === "ai-cost-lens-openai-bill-review/0.1";
    const memoPlanning = document.getElementById("memo-planning");
    if (isBill) {
      const { bill, usage, period, reconciliation, limitations } = state.data;
      const total = Number(bill.total);
      const requests = usage.totals.requests;
      const costPerRequest = period.aligned && requests ? total / requests : null;
      const costPerRequestLabel = costPerRequest === null ? "Unavailable" : money(costPerRequest, costPerRequest < 1 ? 4 : 2);
      const averageInput = requests ? usage.totals.input_tokens / requests : null;
      const averageOutput = requests ? usage.totals.output_tokens / requests : null;
      const cacheShare = usage.totals.input_tokens ? usage.totals.cached_input_tokens / usage.totals.input_tokens : 0;
      const topModel = usage.by_model[0];
      const topRequestShare = topModel && requests ? topModel.requests / requests : null;
      document.getElementById("memo-title").textContent = "OpenAI bill review";
      document.getElementById("memo-meta").textContent = `${period.start} to ${period.end} · ${period.timezone}`;
      document.getElementById("memo-decision-code").textContent = period.aligned ? "COST AND USAGE" : "PERIOD MISMATCH";
      document.getElementById("memo-decision-title").textContent = period.aligned
        ? costPerRequest === null
          ? `${money(total, total < 1 ? 4 : 2)} is the cost baseline for this exported period.`
          : `${money(total, total < 1 ? 4 : 2)} across ${compact(requests)} observed requests creates a ${costPerRequestLabel} blended baseline.`
        : `${money(total, total < 1 ? 4 : 2)} of provider spend and the supplied usage cover different periods.`;
      document.getElementById("memo-decision-limit").textContent = period.aligned ? `${limitations[0]} One bill does not prove savings. Outcomes and human effort are optional next layers.`
        : "Usage and cost exports cover different daily buckets. Export the same date range again before using this review for a financial decision.";
      document.getElementById("memo-numbers-title").textContent = "What the cost and usage exports show";
      document.getElementById("memo-table-head").innerHTML = "<tr><th>Measure</th><th>Observed</th><th>What it proves</th></tr>";
      const billRows = [
        ["Provider reported cost", money(total, total < 1 ? 4 : 2), "The organization total for the exported period"],
        ["Requests", compact(requests), "Observed request volume"],
        ["Blended cost per request", costPerRequestLabel, "Full exported cost divided by observed requests; not a billed model rate"],
        ["Input tokens", compact(usage.totals.input_tokens), "Observed input usage, including cached input"],
        ["Output tokens", compact(usage.totals.output_tokens), "Observed output usage"],
        ["Average input per request", averageInput === null ? "Unavailable" : compact(averageInput), "Prompt-size baseline for the exported period"],
        ["Average output per request", averageOutput === null ? "Unavailable" : compact(averageOutput), "Output-length baseline for the exported period"],
        ["Cache-read share", pct(cacheShare, 1), "Share of input tokens read from cache"],
      ];
      document.getElementById("memo-table-body").innerHTML = billRows.map(([label, value, meaning]) =>
        `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td><td>${escapeHtml(meaning)}</td></tr>`,
      ).join("");
      document.getElementById("memo-rules").innerHTML = memoList([
        ["Cost boundary", "Provider reported organization cost"],
        ["Allocation rule", "Do not allocate billed dollars by token share"],
        ["Outcome rule", "Add outcomes only when the decision needs value or savings evidence"],
        ["Human effort", "Optional; include only active review or correction work"],
      ]);
      document.getElementById("memo-evidence").innerHTML = memoList([
        ["Period", period.aligned ? "Usage and cost periods align" : "Usage and cost periods do not align"],
        ["Cost by model", reconciliation.model_cost_allocation_supported ? "Supported" : "Unavailable from these exports"],
        ["Ready outcomes", "Not included in the provider export"],
        ["Savings claim", reconciliation.savings_claim_allowed ? "Supported" : "Not supported"],
      ]);
      memoPlanning.hidden = true;
      document.getElementById("memo-next-step").textContent = period.aligned
        ? topModel
          ? topRequestShare === null
            ? `Start with ${topModel.model}, the busiest visible route, and test one bounded change.`
            : `Start with ${topModel.model}, which handled ${pct(topRequestShare, 1)} of requests, and test one bounded change.`
          : "Choose one repeatable workload and establish its request and token baseline."
        : "Export matching usage and cost periods before investigating optimization.";
      document.getElementById("memo-footer-status").textContent =
        state.data.mode === "illustrative" ? "Illustrative export" : "Provider reported cost and usage · calculated locally · no AI API";
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
    document.getElementById("lumen-conversation").replaceChildren();
    const isSingle = state.data.schema_version === singleBillSchema;
    const isBill = isSingle || state.data.schema_version === "ai-cost-lens-openai-bill-review/0.1";
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
    if (isSingle) {
      renderSingleBill();
      return;
    }
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
    if ([singleBillSchema, "ai-cost-lens-openai-bill-review/0.1"].includes(state.data?.schema_version)) return;
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
  const builderForm = document.getElementById("review-builder");
  const filenameDefaults = new Map(
    ["spend-file-name", "work-file-name", "openai-usage-file-name", "openai-cost-file-name", "claude-spend-file-name", "claude-usage-file-name", "claude-cost-file-name"]
      .map((id) => [id, document.getElementById(id).textContent]),
  );

  function syncBuilderControls() {
    for (const mode of ["single", "workload", "openai"]) {
      document.getElementById(`${mode}-builder-fields`).querySelectorAll("input, select, textarea").forEach((input) => {
        input.disabled = state.builderMode !== mode;
      });
    }
    document.getElementById("openai-import-fields").querySelectorAll("input").forEach((input) => { input.disabled = state.builderMode !== "openai" || state.importProvider !== "openai"; });
    document.getElementById("claude-import-fields").querySelectorAll("input").forEach((input) => { input.disabled = state.builderMode !== "openai" || state.importProvider !== "claude"; });
    for (const [id, mode] of [["sample-outcome-fields", "sample"], ["detailed-outcome-fields", "detailed"]]) {
      document.getElementById(id).querySelectorAll("input, select, textarea").forEach((input) => {
        input.disabled = state.builderMode !== "workload" || state.outcomeMode !== mode;
      });
    }
  }

  function resetBuilderStart() {
    // Reset only when beginning a new draft, never on submit or its failure.
    // Native reset restores declared defaults and empties every file input.
    builderForm.reset();
    document.getElementById("review-file").value = "";
    filenameDefaults.forEach((text, id) => { document.getElementById(id).textContent = text; });
    const error = document.getElementById("builder-error");
    error.textContent = "";
    error.classList.remove("visible");
    state.builderMode = null;
    state.outcomeMode = "sample";
    state.importProvider = "openai";
    state.pendingClaudeImport = null;
    state.uploadRoute = null;
    state.pendingMappedImport = null;
    state.invoicePdfCandidate = null;
    document.getElementById("smart-upload-file-status").textContent = "Files are inspected only in this browser.";
    document.getElementById("smart-upload-status").textContent = "";
    document.getElementById("smart-upload-status").hidden = true;
    document.getElementById("structured-mapper").hidden = true;
    document.getElementById("mapping-preview").textContent = "";
    document.getElementById("invoice-pdf-status").textContent = "";
    document.getElementById("invoice-pdf-status").hidden = true;
    document.getElementById("invoice-amount-choice-label").hidden = true;
    document.getElementById("invoice-amount-choice").innerHTML = '<option value="">Review the invoice totals</option>';
    document.querySelectorAll(".import-provider").forEach((item) => { const active = item.dataset.importProvider === "openai"; item.classList.toggle("active", active); item.setAttribute("aria-pressed", String(active)); });
    document.getElementById("openai-import-fields").hidden = false;
    document.getElementById("claude-import-fields").hidden = true;
    document.getElementById("claude-confirmation").hidden = true;
    document.querySelectorAll(".outcome-mode").forEach((item) => {
      const active = item.dataset.outcomeMode === "sample";
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    document.getElementById("sample-outcome-fields").hidden = false;
    document.getElementById("detailed-outcome-fields").hidden = true;
    document.querySelectorAll(".builder-mode").forEach((item) => {
      item.classList.remove("active");
      item.setAttribute("aria-pressed", "false");
    });
    document.getElementById("workload-builder-fields").hidden = true;
    document.getElementById("openai-builder-fields").hidden = true;
    document.getElementById("single-builder-fields").hidden = true;
    document.getElementById("builder-actions").hidden = true;
    document.getElementById("builder-path-help").hidden = false;
    document.getElementById("review-dialog-title").textContent = "What would you like to check?";
    syncBuilderControls();
  }

  function activateBuilderMode(mode, button = null) {
    state.builderMode = mode;
    if (mode === "example") {
      if (!state.demoData) { showToast("The worked example is still loading. Try again in a moment."); return; }
      state.data = cloneData(state.demoData);
      state.view = "review";
      state.story = false;
      document.body.classList.remove("story-mode");
      document.getElementById("story-toggle").textContent = "Share view";
      renderAll(); setView("review"); reviewDialog.close(); showToast("Worked example open. No files needed."); return;
    }
    document.querySelectorAll(".builder-mode").forEach((item) => {
      const active = button ? item === button : item.dataset.builderMode === mode;
      item.classList.toggle("active", active); item.setAttribute("aria-pressed", String(active));
    });
    const isOpenAI = mode === "openai";
    const isSingle = mode === "single";
    document.getElementById("single-builder-fields").hidden = !isSingle;
    document.getElementById("workload-builder-fields").hidden = isOpenAI || isSingle;
    document.getElementById("openai-builder-fields").hidden = !isOpenAI;
    document.getElementById("builder-actions").hidden = false;
    document.getElementById("builder-path-help").hidden = true;
    document.getElementById("review-dialog-title").textContent = isSingle ? "Start with the records you already have." : isOpenAI ? "See what is driving the provider bill." : "Test whether the proposed change is actually cheaper.";
    document.getElementById("builder-action-note").textContent = isSingle ? "Cost is enough to start. Usage and outcomes deepen the review when available; human effort and retries are optional." : isOpenAI ? "The result will show a useful cost and usage baseline without requiring outcome or human-review data." : state.outcomeMode === "sample" ? "The quick path produces a sampled estimate. It never becomes booked savings." : "Use the detailed log when you have one row per completed result.";
    document.getElementById("build-review").textContent = isSingle ? "Understand this bill" : isOpenAI ? "Review the provider export" : "Build the finance review";
    document.getElementById("builder-error").classList.remove("visible");
    syncBuilderControls();
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
    button.addEventListener("click", () => activateBuilderMode(button.dataset.builderMode, button));
  });

  function setImportProvider(provider) {
      state.importProvider = provider;
      state.pendingClaudeImport = null;
      document.querySelectorAll(".import-provider").forEach((item) => { const active = item.dataset.importProvider === provider; item.classList.toggle("active", active); item.setAttribute("aria-pressed", String(active)); });
      document.getElementById("openai-import-fields").hidden = state.importProvider !== "openai";
      document.getElementById("claude-import-fields").hidden = state.importProvider !== "claude";
      document.getElementById("claude-confirmation").hidden = true;
      document.getElementById("build-review").textContent = state.importProvider === "openai" ? "Review the OpenAI bill" : "Check the Claude export";
      syncBuilderControls();
  }

  document.querySelectorAll(".import-provider").forEach((button) => {
    button.addEventListener("click", () => setImportProvider(button.dataset.importProvider));
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
      syncBuilderControls();
      document.getElementById("builder-action-note").textContent = sampled
        ? "The quick path produces a sampled estimate. It never becomes booked savings."
        : "Use the detailed log when you have one row per completed result.";
      document.getElementById("builder-error").classList.remove("visible");
    });
  });

  function clearPendingClaudeImport() {
    state.pendingClaudeImport = null;
    const confirmation = document.getElementById("claude-confirmation");
    confirmation.textContent = "";
    confirmation.hidden = true;
    if (state.builderMode === "openai" && state.importProvider === "claude") document.getElementById("build-review").textContent = "Check the Claude export";
  }

  function discardImportedSourceState() {
    state.uploadRoute = null;
    state.pendingMappedImport = null;
    state.pendingClaudeImport = null;
    state.invoicePdfCandidate = null;
  }

  const mappingElementIds = {
    date: "map-date", service_end: "map-service-end", provider: "map-provider", model: "map-model", workload: "map-workload",
    cost: "map-cost", currency: "map-currency", requests: "map-requests", input: "map-input", output: "map-output",
    cache_read: "map-cache-read", cache_write: "map-cache-write",
  };

  function selectedMapping() {
    return {
      ...Object.fromEntries(Object.entries(mappingElementIds).map(([field, id]) => [field, document.getElementById(id).value])),
      currencyConstant: document.getElementById("map-currency-constant").value,
      providerConstant: document.getElementById("map-provider-constant").value,
    };
  }

  async function updateMappingPreview() {
    if (state.uploadRoute?.kind !== "mapping") return;
    state.pendingMappedImport = null;
    const preview = document.getElementById("mapping-preview");
    try {
      const mapped = await buildMappedReview(state.uploadRoute.text, state.uploadRoute.filename, selectedMapping());
      const value = mapped.confirmation;
      preview.textContent = `${value.rows} source rows normalize to ${value.currency} ${value.normalizedTotal.toFixed(2)}. Source and normalized cost totals reconcile. Missing fields stay unavailable. Check the mapping, then continue to confirmation.`;
    } catch (error) {
      preview.textContent = `${error.message} Use manual invoice entry or the universal spend template if the file cannot support a reliable cost review.`;
    }
  }

  Object.values(mappingElementIds).forEach((id) => document.getElementById(id).addEventListener("change", updateMappingPreview));
  ["map-currency-constant", "map-provider-constant"].forEach((id) => document.getElementById(id).addEventListener("input", updateMappingPreview));

  document.getElementById("invoice-amount-choice").addEventListener("change", (event) => {
    const candidate = state.invoicePdfCandidate?.amountCandidates?.[Number(event.target.value)];
    if (!candidate) return;
    document.getElementById("invoice-amount").value = String(candidate.value);
    if (candidate.currency) document.getElementById("invoice-currency").value = candidate.currency;
  });

  document.getElementById("smart-upload-files").addEventListener("change", async (event) => {
    const status = document.getElementById("smart-upload-status");
    const error = document.getElementById("builder-error");
    status.hidden = false; status.textContent = "Inspecting locally…"; error.classList.remove("visible");
    state.uploadRoute = null; state.pendingMappedImport = null; state.invoicePdfCandidate = null;
    document.getElementById("structured-mapper").hidden = true;
    document.getElementById("smart-upload-file-status").textContent = `${event.target.files.length} file${event.target.files.length === 1 ? "" : "s"} selected. Contents stay in this browser.`;
    try {
      const route = await inspectUploadedFiles(event.target.files);
      state.uploadRoute = route;
      if (route.kind === "pdf") {
        const candidate = extractInvoiceCandidate(await extractPdfText(route.file));
        activateBuilderMode("single");
        const pdfStatus = document.getElementById("invoice-pdf-status");
        pdfStatus.hidden = false;
        if (!candidate.supported) { pdfStatus.textContent = candidate.reason; return; }
        state.invoicePdfCandidate = candidate;
        document.getElementById("invoice-provider").value = candidate.provider;
        document.getElementById("invoice-workload").value = `${candidate.provider} invoice`;
        document.getElementById("invoice-date").value = candidate.invoiceDate;
        document.getElementById("invoice-period-start").value = candidate.serviceStart;
        document.getElementById("invoice-period-end").value = candidate.serviceEnd;
        document.getElementById("invoice-currency").value = candidate.currency;
        const choice = document.getElementById("invoice-amount-choice");
        choice.innerHTML = '<option value="">Choose a labeled amount</option>' + candidate.amountCandidates.map((item, index) => `<option value="${index}">${escapeHtml(item.label)}: ${escapeHtml(item.currency || "currency not confirmed")} ${escapeHtml(item.value)}</option>`).join("");
        document.getElementById("invoice-amount-choice-label").hidden = candidate.amountCandidates.length <= 1;
        if (candidate.suggestedAmount) {
          document.getElementById("invoice-amount").value = String(candidate.suggestedAmount.value);
          if (candidate.suggestedAmount.currency) document.getElementById("invoice-currency").value = candidate.suggestedAmount.currency;
        }
        pdfStatus.textContent = candidate.amountCandidates.length > 1 ? "The invoice contains several labeled amounts. Choose the one to review, then confirm every field below." : "Invoice fields were read locally. Confirm every field below before building the review. No usage was inferred.";
        return;
      }
      if (route.kind === "mapping") {
        const options = '<option value="">Not supplied</option>' + route.mappableHeaders.map((header) => `<option value="${escapeHtml(header)}">${escapeHtml(header)}</option>`).join("");
        Object.entries(mappingElementIds).forEach(([field, id]) => { const select = document.getElementById(id); select.innerHTML = options; select.value = route.mapping[field]; });
        document.getElementById("structured-mapper").hidden = false;
        status.textContent = "This schema is not a supported direct export. Match its fields locally; suggestions come only from exact header aliases.";
        await updateMappingPreview(); return;
      }
      if (route.kind === "openai") {
        setImportProvider("openai");
        status.textContent = "Recognized the matching OpenAI Usage Dashboard activity and cost CSV exports. Review the provider steps, then build.";
      } else if (route.kind === "claude_spend") {
        setImportProvider("claude");
        status.textContent = "Recognized a Claude Team/Enterprise spend report. Add its reporting-period dates below, then check the normalized review.";
      } else if (route.kind === "claude_api") {
        setImportProvider("claude");
        const usage = JSON.parse(route.usageText);
        const dates = usage.data.map((bucket) => bucket.starting_at.slice(0, 10)).sort();
        document.getElementById("claude-period-start").value = dates[0] || "";
        document.getElementById("claude-period-end").value = dates.at(-1) || "";
        status.textContent = "Recognized complete Claude Admin Usage and Cost JSON reports. Check the detected reporting period, then confirm the normalized review.";
      } else if (route.kind === "universal") {
        activateBuilderMode("single");
        document.getElementById("invoice-pdf-status").hidden = false;
        document.getElementById("invoice-pdf-status").textContent = "Recognized the universal one-bill spend template. Optional outcome and human-effort evidence can be added below.";
      }
    } catch (caught) {
      state.uploadRoute = null;
      status.textContent = caught.message || "The file could not be inspected. Use manual invoice entry or the universal template.";
      error.textContent = status.textContent; error.classList.add("visible");
      if ([...event.target.files].some((file) => /\.pdf$/i.test(file.name))) {
        activateBuilderMode("single");
        const pdfStatus = document.getElementById("invoice-pdf-status"); pdfStatus.hidden = false; pdfStatus.textContent = status.textContent;
      }
    }
  });

  [["spend-file", "spend-file-name"], ["work-file", "work-file-name"], ["openai-usage-file", "openai-usage-file-name"], ["openai-cost-file", "openai-cost-file-name"], ["claude-spend-file", "claude-spend-file-name"], ["claude-usage-file", "claude-usage-file-name"], ["claude-cost-file", "claude-cost-file-name"]].forEach(
    ([inputId, labelId]) => {
      document.getElementById(inputId).addEventListener("change", (event) => {
        if (inputId.startsWith("claude-")) clearPendingClaudeImport();
        const [file] = event.target.files;
        if (file) document.getElementById(labelId).textContent = file.name;
      });
    },
  );
  ["claude-period-start", "claude-period-end"].forEach((id) => document.getElementById(id).addEventListener("change", clearPendingClaudeImport));

  document.getElementById("review-builder").addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorBox = document.getElementById("builder-error");
    errorBox.classList.remove("visible");
    const submit = document.getElementById("build-review");
    submit.disabled = true;
    submit.textContent = "Checking the evidence…";
    const previousData = state.data;
    try {
      if (state.builderMode === "single") {
        const [spendFile] = document.getElementById("single-spend-file").files;
        const [workFile] = document.getElementById("single-work-file").files;
        const routedUniversal = !spendFile && state.uploadRoute?.kind === "universal";
        let spendText = spendFile ? await readLocalFile(spendFile) : routedUniversal ? state.uploadRoute.text : "";
        if (!spendFile && !routedUniversal) {
          const provider = safeImportedLabel(document.getElementById("invoice-provider").value, "Provider");
          const workload = safeImportedLabel(document.getElementById("invoice-workload").value, "Subscription or workload name");
          const invoiceDate = validDate(document.getElementById("invoice-date").value, "Invoice date");
          const amount = costNumber(document.getElementById("invoice-amount").value, "Billed amount");
          const currency = document.getElementById("invoice-currency").value.trim().toUpperCase();
          if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Currency must be a three-letter code.");
          spendText = rowsToCsv([{ period: "baseline", date: invoiceDate, workload, provider, model: "", route: "Subscription or invoice", requests: "", input_tokens: "", cached_input_tokens: "", cache_write_input_tokens: "", output_tokens: "", provider_cost: String(amount), cost_basis: "provider_reported", currency }]);
        }
        state.data = await buildSingleBillReview(spendText, workFile ? await readLocalFile(workFile) : "", {
          acceptanceRule: document.getElementById("single-ready-rule").value.trim(),
          verifier: document.getElementById("single-verifier").value.trim(),
          complete: document.getElementById("single-complete").checked,
          hourlyRate: document.getElementById("single-hourly-rate").value,
          sharedCost: document.getElementById("single-shared-cost").value,
          serviceStart: spendFile ? "" : document.getElementById("invoice-period-start").value,
          serviceEnd: spendFile ? "" : document.getElementById("invoice-period-end").value,
          reviewSource: spendFile || routedUniversal ? "universal_template" : state.invoicePdfCandidate ? "invoice_pdf" : "invoice_form",
        });
        discardImportedSourceState();
        renderAll();
        reviewDialog.close();
        showToast("Single bill reviewed locally. No savings claimed.");
        return;
      }
      if (state.builderMode === "openai") {
        if (state.uploadRoute?.kind === "mapping") {
          if (state.pendingMappedImport) {
            state.data = state.pendingMappedImport.review;
            validateResult(state.data);
            discardImportedSourceState();
            renderAll(); reviewDialog.close(); showToast("Mapped bill reviewed locally. Only the fields you confirmed were included. Unmapped source fields were discarded."); return;
          }
          state.pendingMappedImport = await buildMappedReview(state.uploadRoute.text, state.uploadRoute.filename, selectedMapping());
          const summary = state.pendingMappedImport.confirmation;
          const box = document.getElementById("mapping-preview");
          box.textContent = `${summary.rows} rows. ${summary.currency} ${summary.normalizedTotal.toFixed(2)} normalized and reconciled to the mapped source cost. Period: ${summary.period.start} to ${summary.period.end}. Only the fields you confirmed were included. Unmapped source fields were discarded. Confirm to build the review.`;
          submit.textContent = "Confirm and build mapped review"; return;
        }
        if (state.importProvider === "claude") {
          if (state.pendingClaudeImport) {
            state.data = state.pendingClaudeImport.review;
            validateResult(state.data);
            discardImportedSourceState();
            renderAll(); reviewDialog.close(); showToast("Claude bill reviewed locally. Personal identifiers were discarded."); return;
          }
          const [spendFile] = document.getElementById("claude-spend-file").files;
          const [usageFile] = document.getElementById("claude-usage-file").files;
          const [costFile] = document.getElementById("claude-cost-file").files;
          const start = document.getElementById("claude-period-start").value;
          const end = document.getElementById("claude-period-end").value;
          if (spendFile && (usageFile || costFile)) throw new Error("Choose the spend CSV or the Admin API JSON pair, not both.");
          if (spendFile || state.uploadRoute?.kind === "claude_spend") state.pendingClaudeImport = await buildClaudeSpendReview(spendFile ? await readLocalFile(spendFile) : state.uploadRoute.text, start, end);
          else {
            if ((!usageFile || !costFile) && state.uploadRoute?.kind !== "claude_api") throw new Error("Add a Claude spend CSV or both complete Admin API JSON files.");
            state.pendingClaudeImport = await buildClaudeApiReview(usageFile ? await readLocalFile(usageFile) : state.uploadRoute.usageText, costFile ? await readLocalFile(costFile) : state.uploadRoute.costText, start, end);
          }
          const summary = state.pendingClaudeImport.confirmation;
          const box = document.getElementById("claude-confirmation");
          box.textContent = `Provider: ${summary.provider}. Period: ${summary.period.start} to ${summary.period.end}. Products: ${summary.products.join(", ")}. Models: ${summary.models.join(", ")}. Provider-reported cost: $${summary.providerCost.toFixed(2)}. Requests: ${summary.requests === null ? "unavailable" : summary.requests}. Input tokens: ${summary.inputTokens === null ? "unavailable" : summary.inputTokens}. Output tokens: ${summary.outputTokens === null ? "unavailable" : summary.outputTokens}. Not included: ${summary.missing.join(", ")}. Source rows: ${summary.sourceRows}. Personal identifiers were discarded.`;
          box.hidden = false; submit.textContent = "Confirm and build Claude review"; return;
        }
        const [usageFile] = document.getElementById("openai-usage-file").files;
        const [costFile] = document.getElementById("openai-cost-file").files;
        if ((!usageFile || !costFile) && state.uploadRoute?.kind !== "openai") throw new Error("Add both OpenAI CSV exports before building the bill review.");
        state.data = await buildOpenAIBillReview(usageFile ? await readLocalFile(usageFile) : state.uploadRoute.usageText, costFile ? await readLocalFile(costFile) : state.uploadRoute.costText);
        validateResult(state.data);
        discardImportedSourceState();
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
        state.data = await buildSampledReview(await readLocalFile(spendFile), samples, config);
      } else {
        const [workFile] = document.getElementById("work-file").files;
        if (!workFile) throw new Error("Add the detailed work log before building this review.");
        state.data = await buildLocalReview(await readLocalFile(spendFile), await readLocalFile(workFile), config);
      }
      validateResult(state.data);
      renderAll();
      setView("review");
      reviewDialog.close();
      showToast("Finance review built locally. Your files never left the browser.");
    } catch (error) {
      state.data = previousData;
      if (previousData) renderAll();
      errorBox.textContent = error instanceof TypeError || error instanceof RangeError ? "The review could not be built. Check the file structure and numeric values." : error.message || "The review could not be built.";
      errorBox.classList.add("visible");
    } finally {
      submit.disabled = false;
      submit.textContent = state.builderMode === "single" ? "Understand this bill" : state.builderMode === "openai"
        ? state.pendingMappedImport ? "Confirm and build mapped review" : state.importProvider === "claude" && state.pendingClaudeImport ? "Confirm and build Claude review" : state.importProvider === "claude" ? "Check the Claude export" : "Review the OpenAI bill"
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
    try {
      window.print();
    } catch (error) {
      document.body.classList.remove("printing-memo");
      showToast("Printing could not start. Try Print finance memo again.");
    }
  });

  window.addEventListener("afterprint", () => {
    document.body.classList.remove("printing-memo");
  });
  // Some browsers signal print-media exit instead of afterprint. Do not clean
  // up merely because non-blocking window.print() has returned.
  const printMedia = window.matchMedia?.("print");
  const onPrintMediaChange = () => {
    if (!printMedia.matches) document.body.classList.remove("printing-memo");
  };
  if (printMedia?.addEventListener) printMedia.addEventListener("change", onPrintMediaChange);
  else printMedia?.addListener(onPrintMediaChange);

  document.getElementById("review-file").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    const previousData = state.data;
    try {
      const text = await readLocalFile(file);
      let data;
      try {
        data = JSON.parse(text);
      } catch (_error) {
        throw new Error("That file isn't valid JSON. Choose a saved AI Cost Lens review.");
      }
      validateResult(data);
      state.data = data;
      renderAll();
      setView("review");
      showToast(`${file.name} is open. Nothing was uploaded.`);
    } catch (error) {
      state.data = previousData;
      if (previousData) renderAll();
      showToast(error instanceof TypeError || error instanceof RangeError ? "That review is incomplete or has invalid values. Rebuild it from the original files." : error.message || "That file could not be opened.");
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
