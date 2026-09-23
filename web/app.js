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
    priceEstimate: null,
    usageReview: null,
    usageReviewIllustrative: false,
    verificationRecord: null,
    verificationSession: null,
    verificationScores: [],
    verificationCaseIndex: 0,
    verificationSessionSource: null,
    pendingVerification: null,
    pendingScenario: null,
    actualsLedger: null,
    breakEvenReady: false,
  };

  const opportunityEngine = globalThis.AICostLensOpportunities;
  const usageEventEngine = globalThis.AICostLensUsageEvents;
  const verificationEngine = globalThis.AICostLensVerification;
  const scenarioEngine = globalThis.AICostLensScenarios;
  const actualsEngine = globalThis.AICostLensActuals;

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
  const unitMoney = (value) => (value < 1 && (!state.data?.currency || state.data.currency === "USD") ? cents(value) : money(value, 2));
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

  function parseCsv(text, label, { preserveColumns = [] } = {}) {
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
        row.push(field);
        field = "";
      } else if (character === "\n") {
        row.push(field);
        if (row.some((value) => value.trim() !== "")) rows.push(row);
        row = [];
        field = "";
      } else if (character !== "\r") {
        field += character;
      }
    }
    if (quoted) throw new Error(`${label} has an unclosed quoted field.`);
    row.push(field);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
    if (rows.length < 2) throw new Error(`${label} needs a header and at least one data row.`);
    if (rows.length > 20001) throw new Error(`${label} exceeds 20,000 data rows. Split it into smaller, matching review periods.`);
    const headers = rows[0].map((value) => value.trim());
    const preserveKey = (value) => String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const preserved = new Set(preserveColumns.map(preserveKey));
    const normalizedRows = rows.slice(1).map((values, rowIndex) => {
      if (values.length !== headers.length) {
        throw new Error(`${label} row ${rowIndex + 2} has ${values.length} fields; expected ${headers.length}.`);
      }
      return values.map((value, index) => preserved.has(preserveKey(headers[index])) ? value : value.trim());
    });
    if (/spend|cost export|usage export/i.test(label)) {
      const seen = new Set();
      normalizedRows.forEach((values, index) => {
        const key = JSON.stringify(values);
        if (seen.has(key)) throw new Error(`${label} row ${index + 2} duplicates an earlier row. Check the source and consolidate genuinely separate identical charges before retrying; no rows were removed automatically.`);
        seen.add(key);
      });
    }
    if (new Set(headers).size !== headers.length) throw new Error(`${label} has a duplicate column name.`);
    return normalizedRows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]])));
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
      input_tokens: { total: 0, supplied: 0, label: "input_tokens", result: "processedInput" },
      cached_input_tokens: { total: 0, supplied: 0, label: "cached_input_tokens", result: "cachedInput" },
      cache_write_input_tokens: { total: 0, supplied: 0, label: "cache_write_input_tokens", result: "cacheWriteInput" },
      output_tokens: { total: 0, supplied: 0, label: "output_tokens", result: "outputTokens" },
    };
    let requests = 0;
    let requestsSupplied = 0;
    let providerCost = 0;

    spend.forEach((row, index) => {
      const rowNumber = index + 2;
      const rowRequests = optionalNumber(row.requests, `Spend ${period} row ${rowNumber} requests`, { integer: true });
      if (rowRequests !== null) { requests += rowRequests; requestsSupplied++; }
      providerCost += costNumber(row.provider_cost, `Spend ${period} row ${rowNumber} provider_cost`);

      const supplied = {};
      Object.entries(tokenFields).forEach(([field, aggregate]) => {
        const value = optionalNumber(row[field], `Spend ${period} row ${rowNumber} ${aggregate.label}`, { integer: true });
        supplied[field] = value;
        if (value !== null) { aggregate.total += value; aggregate.supplied++; }
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

    if (!allowZeroRequests && requestsSupplied === spend.length && requests === 0) {
      throw new Error(`Spend ${period} requests must be greater than zero when supplied.`);
    }
    const coverageEntry = (suppliedRows, reportedSubtotal) => ({
      suppliedRows,
      totalRows: spend.length,
      status: suppliedRows === spend.length ? "complete" : suppliedRows ? "partial" : "missing",
      reportedSubtotal: suppliedRows ? reportedSubtotal : null,
    });
    const coverage = { requests: coverageEntry(requestsSupplied, requests) };
    const reported = { requests: requestsSupplied ? requests : null };
    Object.values(tokenFields).forEach((aggregate) => {
      coverage[aggregate.result] = coverageEntry(aggregate.supplied, aggregate.total);
      reported[aggregate.result] = aggregate.supplied ? aggregate.total : null;
    });
    const totalOrMissing = (field) => tokenFields[field].supplied === spend.length ? tokenFields[field].total : null;
    return {
      requests: requestsSupplied === spend.length ? requests : null,
      providerCost,
      processedInput: totalOrMissing("input_tokens"),
      cachedInput: totalOrMissing("cached_input_tokens"),
      cacheWriteInput: totalOrMissing("cache_write_input_tokens"),
      outputTokens: totalOrMissing("output_tokens"),
      reported,
      coverage,
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
    if (config.grossNet) {
      const { gross, net, adjustment, classification } = config.grossNet;
      if (config.reviewSource !== "claude_spend_report" || classification !== "unclassified_gross_to_net" ||
          ![gross, net, adjustment].every((value) => typeof value === "number" && Number.isFinite(value)) ||
          gross < 0 || net < 0 || Math.abs(round(gross - net) - adjustment) > 0.000001 ||
          Math.abs(net - totals.providerCost) > 0.000001) {
        throw new Error("Claude gross and net spend must reconcile to the imported provider cost; the adjustment is not automatically a credit.");
      }
    }
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

  function reportedCoverageValue(totals, field) {
    const coverage = totals.coverage[field];
    if (coverage.status === "missing") return "Not supplied";
    const value = compact(totals.reported[field]);
    return coverage.status === "partial" ? `${value} reported` : value;
  }

  function reportedCoverageNote(totals, field, completeNote) {
    const coverage = totals.coverage[field];
    if (coverage.status === "partial") return `${coverage.suppliedRows} of ${coverage.totalRows} rows supplied this field; the full total is unavailable.`;
    if (coverage.status === "missing") return "No rows supplied this field; missing values were not treated as zero.";
    return completeNote;
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
      const cacheCoverage = totals.coverage.cachedInput;
      const cacheTitle = cacheCoverage.status === "partial"
        ? "Cache-read coverage is incomplete"
        : cacheShare === null
          ? "Caching is a question, not a saving"
        : cacheShare
          ? "Cached input is already visible"
          : "No cached input is visible";
      const cacheValue = cacheCoverage.status === "partial" ? `${compact(totals.reported.cachedInput)} reported` : cacheShare === null ? "Not supplied" : pct(cacheShare, 1);
      const cacheNote = cacheCoverage.status === "partial"
        ? `${cacheCoverage.suppliedRows} of ${cacheCoverage.totalRows} rows supplied cache-read tokens. The known subtotal is preserved, but cache share is unavailable.`
        : cacheShare === null
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
    const totals = {};
    const reportedSubtotals = {};
    const coverage = {};
    fields.forEach((field) => {
      const supplied = rows.filter((row) => row[field] !== null);
      const subtotal = supplied.length ? supplied.reduce((total, row) => total + row[field], 0) : null;
      totals[field] = supplied.length === rows.length ? subtotal : null;
      reportedSubtotals[field] = subtotal;
      coverage[field] = {
        supplied_rows: supplied.length,
        total_rows: rows.length,
        status: supplied.length === rows.length ? "complete" : supplied.length ? "partial" : "missing",
      };
    });
    return { totals, reportedSubtotals, coverage };
  }

  function groupOpenAIUsage(rows, field) {
    const groups = new Map();
    rows.forEach((row) => {
      if (!groups.has(row[field])) groups.set(row[field], []);
      groups.get(row[field]).push(row);
    });
    return [...groups.entries()]
      .map(([name, values]) => {
        const aggregate = openAIUsageTotals(values);
        return { [field]: name, ...aggregate.totals, reported_subtotals: aggregate.reportedSubtotals, field_coverage: aggregate.coverage };
      })
      .sort((a, b) => (b.reported_subtotals.requests || 0) - (a.reported_subtotals.requests || 0) || String(a[field]).localeCompare(String(b[field])));
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
      const optionalUsageNumber = (value, field) => value === "" ? null : finiteNumber(value, `${label} ${field}`, { integer: true });
      const input = optionalUsageNumber(row.input_tokens, "input_tokens");
      const cached = optionalUsageNumber(row.input_cached_tokens, "input_cached_tokens");
      const cacheWrite = optionalUsageNumber(row.input_cache_write_tokens, "input_cache_write_tokens");
      const suppliedUncached = optionalUsageNumber(row.input_uncached_tokens, "input_uncached_tokens");
      const uncached = suppliedUncached === null && input !== null && cached !== null && cacheWrite !== null
        ? input - cached - cacheWrite
        : suppliedUncached;
      if (input !== null && cached !== null && cacheWrite !== null && uncached !== null && (uncached < 0 || uncached + cached + cacheWrite !== input)) {
        throw new Error(`${label} input token categories do not reconcile to input_tokens.`);
      }
      return [{
        date: openAIBucketDay(row, label),
        model: row.model || "unattributed",
        project: row.project_id || "unattributed",
        api_key: row.api_key_id || "unattributed",
        service_tier: row.service_tier || "unattributed",
        requests: optionalUsageNumber(row.num_model_requests, "num_model_requests"),
        input_tokens: input,
        uncached_input_tokens: uncached,
        cached_input_tokens: cached,
        cache_write_input_tokens: cacheWrite,
        output_tokens: optionalUsageNumber(row.output_tokens, "output_tokens"),
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
    const bucketRanges = (rows) => [...new Set(rows.map((row) => `${Number(row.start_time)}:${Number(row.end_time)}`))].sort();
    const aligned = JSON.stringify(usageDates) === JSON.stringify(costDates)
      && JSON.stringify(bucketRanges(rawUsage)) === JSON.stringify(bucketRanges(rawCosts));
    const costProject = rowCoverage(costRows, "project");
    const projectJoin = costProject.row_coverage_pct === 100;
    const limitations = [
      "The saved cost export does not attribute billed dollars to models, so AI Cost Lens does not allocate cost using token share.",
      "The provider exports do not establish whether a result was usable, how much human correction it required, or what business outcome it produced.",
    ];
    if (!projectJoin) limitations.splice(1, 0, "The saved cost export does not fully attribute cost to projects, so project-level billed cost is unavailable.");
    if (!aligned) limitations.unshift("The usage and cost exports do not cover the same UTC time buckets.");
    const usageAggregate = openAIUsageTotals(usageRows);
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
        totals: usageAggregate.totals,
        reported_subtotals: usageAggregate.reportedSubtotals,
        field_coverage: usageAggregate.coverage,
        populated_rows: usageRows.length,
        days_with_usage: new Set(usageRows.map((row) => row.date)).size,
        by_model: groupOpenAIUsage(usageRows, "model"),
        by_project: groupOpenAIUsage(usageRows, "project"),
        by_service_tier: groupOpenAIUsage(usageRows, "service_tier"),
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
    let grossTotal = 0;
    let netTotal = 0;
    const rows = raw.map((row, index) => {
      const label = `Claude spend row ${index + 2}`;
      const product = safeImportedLabel(row.product, `${label} product`);
      const model = safeImportedLabel(row.model || row.model_family, `${label} model`);
      const net = costNumber(row.total_net_spend_usd, `${label} total_net_spend_usd`);
      const gross = costNumber(row.total_gross_spend_usd, `${label} total_gross_spend_usd`);
      grossTotal += gross;
      netTotal += net;
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
    const review = await buildSingleBillReview(rowsToCsv(rows), "", { acceptanceRule: "", verifier: "", complete: false, hourlyRate: "", sharedCost: "", serviceStart: period.start, serviceEnd: period.end, reviewSource: "claude_spend_report",
      grossNet: { gross: round(grossTotal), net: round(netTotal), adjustment: round(grossTotal - netTotal), classification: "unclassified_gross_to_net" } });
    const summary = summarizeSingleBill(review);
    return { review, confirmation: {
      provider: "Anthropic", period, products: [...new Set(rows.map((row) => row.route))], models: [...new Set(rows.map((row) => row.model))],
      providerCost: summary.totals.providerCost, requests: summary.totals.reported.requests, inputTokens: summary.totals.reported.processedInput,
      outputTokens: summary.totals.reported.outputTokens, coverage: summary.totals.coverage, missing: ["Cache values", "Retries", "Human effort", "Outcomes"],
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
    const lineList = String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lineList.some((line) => /^(?:usage\s+)?credits?\s+qty\s*\d+\b/i.test(line)) && lineList.some((line) => /\b(?:amount\s+paid|total\s+due)\b/i.test(line))) {
      return { supported: false, reason: "This is a prepaid usage-credit purchase receipt. The amount paid cannot be treated as the cost of work completed. Review the purchase and credit-use history separately; this PDF cannot be converted into a workload bill." };
    }
    const providerSignals = [
      { provider: "OpenAI", matches: /\b(?:openai|chatgpt)\b/i.test(text) },
      { provider: "Anthropic", matches: /\b(?:anthropic|claude)\b/i.test(text) },
    ].filter((item) => item.matches);
    if (providerSignals.length !== 1) return { supported: false, reason: "The invoice provider could not be confirmed as OpenAI or Anthropic. Enter the invoice fields manually." };
    const dateFromLabel = (labels) => {
      for (const line of lineList) {
        const match = line.match(new RegExp(`^(?:${labels})\\s*:?\\s*(.+)$`, "i"));
        if (match) { const date = invoiceDate(match[1]); if (date) return date; }
      }
      return "";
    };
    const periodLine = lineList.find((line) => /(?:service|billing)\s+period/i.test(line)) || "";
    const periodDates = [...periodLine.matchAll(/(?:\d{4}-\d{2}-\d{2}|\d{1,2}[\/-]\d{1,2}[\/-]\d{4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4})/gi)].map((match) => invoiceDate(match[0])).filter(Boolean);
    const amountPattern = /\b(subtotal|tax|credit|amount\s+due|amount\s+paid|prior\s+balance|invoice\s+total|total\s+due|total)\b\s*:?\s*(?:(USD|EUR|GBP|CAD|AUD|US\$)\s*)?([\$€£])?\s*(-?\d[\d,]*(?:\.\d{1,2})?)/i;
    const amountCandidates = lineList.flatMap((line) => {
      const match = line.match(amountPattern);
      if (!match) return [];
      const currencyToken = (match[2] || match[3] || "").toUpperCase();
      const currency = currencyToken === "US$" || currencyToken === "USD" ? "USD" : currencyToken === "EUR" || currencyToken === "€" ? "EUR" : currencyToken === "GBP" || currencyToken === "£" ? "GBP" : ["CAD", "AUD"].includes(currencyToken) ? currencyToken : "";
      const value = Number(match[4].replaceAll(",", ""));
      if (!Number.isFinite(value)) return [];
      return [{ label: match[1].replace(/\s+/g, " ").toLowerCase(), value, currency, dollarSymbolNeedsConfirmation: match[3] === "$" && !match[2] }];
    });
    const currencies = new Set(amountCandidates.map((item) => item.currency).filter(Boolean));
    return {
      supported: true, provider: providerSignals[0].provider,
      invoiceDate: dateFromLabel("invoice date|date issued|date of issue|issued on|billing date"),
      serviceStart: periodDates[0] || "", serviceEnd: periodDates[1] || "",
      currency: currencies.size === 1 ? [...currencies][0] : "",
      dollarSymbolNeedsConfirmation: amountCandidates.some((item) => item.dollarSymbolNeedsConfirmation),
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

  function buildSimpleScenario(period, spendRows, sample, config, hashes) {
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
    const humanTimeSupplied = sample.humanMinutes !== null && sample.humanMinutes !== undefined;
    const sampleMinutes = humanTimeSupplied ? finiteNumber(sample.humanMinutes, `${period} sample human minutes`) : 0;
    const sampleSize = ready + correction + escalation;
    if (!sampleSize) throw new Error(`The ${period} sample is empty.`);
    if (!ready) throw new Error(`The ${period === "baseline" ? "current" : "other"} option has zero usable outputs. Cost per usable result is undefined, so no cost comparison can be made. Keep this as a failed quality test and collect a sample with usable outputs before comparing unit costs.`);
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
          coverage: humanTimeSupplied
            ? `${sampleSize} of ${population.toLocaleString()} results reviewed; outcome yield and human time extrapolated`
            : `${sampleSize} of ${population.toLocaleString()} results reviewed; outcome yield extrapolated; human time not supplied`,
          coverage_status: "sampled",
          reconciliation_issues: humanTimeSupplied ? [] : ["Human review and correction time was not supplied."],
          cost_boundary: humanTimeSupplied
            ? "provider cost + declared shared infrastructure + sampled human review and correction"
            : "provider cost + declared shared infrastructure; human review and correction not included",
          human_time_supplied: humanTimeSupplied,
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

  async function buildSimpleReview(spendText, samples, config) {
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
    const baselineBuild = buildSimpleScenario("baseline", spendRows, samples.baseline, config, hashes);
    const proposedBuild = buildSimpleScenario("proposed", spendRows, samples.proposed, config, hashes);
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
    const unitChangePct = baselineUnit ? (unitDifference / baselineUnit) * 100 : null;
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
    const humanCostIncluded = [baseline, proposed].every(
      (scenario) => scenario.evidence.human_time_supplied !== false,
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
        limitation: `${providerCostReported ? "Provider spend is reported" : `${costBasisLabel(proposed.evidence.cost_basis)} is used`}. Outcome yield${humanCostIncluded ? " and human time are" : " is"} extrapolated from samples of ${baseline.outcomes.sample_size} and ${proposed.outcomes.sample_size}${humanCostIncluded ? "" : "; human work is not included"}. This is not booked savings.`,
        recommendation: !humanCostIncluded
          ? "Use this as a quality and bill comparison. Add rough human review time before deciding whether either route is truly cheaper."
          : lower
            ? "The proposed route looks lower per ready result in this sample. Repeat or expand the sample before treating the difference as savings."
            : "The proposed route does not improve cost per ready result in this sample. Do not change routes on the provider rate alone.",
        savings_claim_allowed: false,
        same_cost_basis: sameCostBasis,
        provider_cost_reported: providerCostReported,
        quality_holds: qualityHolds,
        both_policy_approved: baseline.policy.approved && proposed.policy.approved,
        evidence_complete: false,
        outcome_evidence_basis: "sampled",
        human_cost_included: humanCostIncluded,
        recurring_cost_difference: round(recurringDifference),
        cost_per_usable_result_difference: round(unitDifference),
        cost_per_usable_result_change_pct: unitChangePct === null ? null : round(unitChangePct, 1),
        usable_result_rate_change_points: round((proposed.measures.usable_result_rate - baseline.measures.usable_result_rate) * 100, 1),
        normalized_proposed_cost_at_baseline_volume: round(normalizedProposed),
        normalized_cost_difference: round(normalizedDifference),
        payback_usable_results: payback,
      },
      ...(planning ? { planning } : {}),
    };
  }

  function validateComparison(data) {
    if (!data || data.schema_version !== "ai-cost-lens-review-result/1.0") {
      throw new Error("That file is not an AI Cost Lens review result.");
    }
    if (!data.baseline || !data.proposed || !data.comparison || !data.workload) {
      throw new Error("The review result is missing required sections.");
    }
    const fail = () => { throw new Error("This review has missing or inconsistent numbers. Rebuild it from the original inputs."); };
    const nonnegative = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
    const close = (a, b) => Math.abs(a - b) <= Math.max(0.00001, Math.abs(b) * 0.000001);
    if (!/^[A-Z]{3}$/.test(data.currency) || !["real", "sampled", "illustrative"].includes(data.mode) || !data.period) fail();
    if (!nonnegative(data.workload.accepted_quality_threshold) || data.workload.accepted_quality_threshold > 1) fail();
    for (const scenario of [data.baseline, data.proposed]) {
      for (const key of ["model", "costs", "usage", "outcomes", "policy", "evidence", "measures"]) if (!scenario[key] || typeof scenario[key] !== "object") fail();
      const c = scenario.costs, o = scenario.outcomes, m = scenario.measures;
      for (const key of ["model_cost", "shared_infrastructure_cost", "human_review_cost", "one_time_change_cost", "recurring_operating_cost", "all_in_pilot_cost"]) if (!nonnegative(c[key])) fail();
      if (!nonnegative(o.completed_results) || !nonnegative(o.usable_results) || !o.usable_results || o.usable_results > o.completed_results) fail();
      if (!close(c.recurring_operating_cost, c.model_cost + c.shared_infrastructure_cost + c.human_review_cost) || !close(c.all_in_pilot_cost, c.recurring_operating_cost + c.one_time_change_cost)) fail();
      for (const [key, expected] of [["cost_per_usable_result", c.recurring_operating_cost / o.usable_results], ["all_in_cost_per_usable_result", c.all_in_pilot_cost / o.usable_results], ["usable_result_rate", o.usable_results / o.completed_results]]) if (!nonnegative(m[key]) || !close(m[key], expected)) fail();
      if (typeof scenario.policy.approved !== "boolean" || !Array.isArray(scenario.evidence.reconciliation_issues)) fail();
      if (o.sample_counts) {
        if (!Number.isSafeInteger(o.sample_size) || !o.sample_size || o.sample_size > o.completed_results) fail();
        const counts = ["ready_to_use", "needs_correction", "needs_escalation"].map(key => o.sample_counts[key]);
        if (counts.some(n => !Number.isSafeInteger(n) || n < 0) || counts.reduce((a,b) => a+b,0) !== o.sample_size || !close(m.usable_result_rate, counts[0] / o.sample_size)) fail();
      }
    }
    if (data.experience === "simple") {
      for (const scenario of [data.baseline, data.proposed]) {
        if (typeof scenario.model.name === "string" && scenario.model.name.trim()) scenario.label = scenario.model.name.trim();
      }
    }
    const { baseline: a, proposed: b, comparison: c } = data;
    c.quality_holds = b.measures.usable_result_rate >= data.workload.accepted_quality_threshold;
    c.both_policy_approved = a.policy.approved && b.policy.approved;
    c.same_cost_basis = a.evidence.cost_basis === b.evidence.cost_basis;
    c.provider_cost_reported = [a,b].every(s => s.evidence.cost_basis === "observed");
    c.evidence_complete = data.mode === "real" && [a,b].every(s => s.outcomes.basis !== "sampled" && s.evidence.coverage_status === "complete" && !s.evidence.reconciliation_issues.length);
    c.human_cost_included = [a,b].every(s => s.evidence.human_time_supplied !== false);
    c.cost_per_usable_result_difference = round(b.measures.cost_per_usable_result - a.measures.cost_per_usable_result);
    c.cost_per_usable_result_change_pct = a.measures.cost_per_usable_result > 0 ? round(c.cost_per_usable_result_difference / a.measures.cost_per_usable_result * 100, 1) : null;
    c.savings_claim_allowed = c.cost_per_usable_result_difference < 0 && c.quality_holds && c.both_policy_approved && c.same_cost_basis && c.provider_cost_reported && c.evidence_complete && c.human_cost_included;
    c.recurring_cost_difference = round(b.costs.recurring_operating_cost - a.costs.recurring_operating_cost);
    c.usable_result_rate_change_points = round((b.measures.usable_result_rate - a.measures.usable_result_rate) * 100, 1);
    c.normalized_proposed_cost_at_baseline_volume = round(b.measures.cost_per_usable_result * a.outcomes.usable_results);
    c.normalized_cost_difference = round(c.normalized_proposed_cost_at_baseline_volume - a.costs.recurring_operating_cost);
    c.payback_usable_results = c.cost_per_usable_result_difference < 0 && b.costs.one_time_change_cost > 0 ? Math.ceil(b.costs.one_time_change_cost / -c.cost_per_usable_result_difference) : null;
    const decision = decisionFor(data);
    c.recommendation = decision.reason;
    c.decision_code = decision.code;
    c.finance_posture = decision.posture;
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
    if (data?.experience === "simple") { validateComparison(data); return data; }
    shape(data, { schema_version: "string", mode: "string", period: { start: "string", end: "string", timezone: "string" } });
    validDate(data.period.start, "Review period start");
    validDate(data.period.end, "Review period end");
    if (data.period.start > data.period.end || data.period.timezone !== "UTC") fail("period");
    const currency = (value) => { if (!/^[A-Z]{3}$/.test(value)) fail("currency"); };
    if (data.schema_version === singleBillSchema) {
      shape(data, { currency: "string", source: {
        spend: [fields(singleSpendColumns.join(" "), "string")], work: [fields(singleWorkColumns.join(" "), "string")],
      }, config: { acceptanceRule: "string", verifier: "string", complete: "boolean", hourlyRate: "string", sharedCost: "string" } });
      if (data.config.grossNet !== undefined) shape(data.config.grossNet, {
        gross: "number", net: "number", adjustment: "number", classification: "string",
      }, "config.grossNet");
      for (const row of [...data.source.spend, ...data.source.work]) {
        Object.values(row).forEach((value) => shape(value, "string", "source row"));
      }
      const summary = summarizeSingleBill(data);
      if (data.mode !== "real" || data.currency !== summary.currency || data.period.start !== summary.period.start || data.period.end !== summary.period.end) fail("single bill metadata");
      return data;
    }
    if (data?.schema_version === "ai-cost-lens-openai-bill-review/0.1") {
      const usageFieldNames = "requests input_tokens uncached_input_tokens cached_input_tokens cache_write_input_tokens output_tokens".split(" ");
      const usage = fields(usageFieldNames.join(" "), "number?");
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
      const validateUsageCoverage = (totals, reportedSubtotals, coverage, path) => {
        if (coverage === undefined) return;
        usageFieldNames.forEach((field) => {
          shape(coverage[field], { supplied_rows: "number", total_rows: "number", status: "string" }, `${path}.${field}`);
          const item = coverage[field];
          if (!Number.isInteger(item.supplied_rows) || !Number.isInteger(item.total_rows) || item.total_rows < 1 || item.supplied_rows < 0 || item.supplied_rows > item.total_rows) fail(`${path}.${field}`);
          const expected = item.supplied_rows === item.total_rows ? "complete" : item.supplied_rows ? "partial" : "missing";
          const reported = reportedSubtotals?.[field];
          if (item.status !== expected || (item.status === "complete") !== (totals[field] !== null) || (item.status === "missing") !== (reported === null)) fail(`${path}.${field}`);
          if (reported !== null && (typeof reported !== "number" || !Number.isFinite(reported))) fail(`${path}.${field}`);
        });
      };
      validateUsageCoverage(data.usage.totals, data.usage.reported_subtotals, data.usage.field_coverage, "usage.field_coverage");
      data.usage.by_model.forEach((row, index) => validateUsageCoverage(row, row.reported_subtotals, row.field_coverage, `usage.by_model[${index}].field_coverage`));
      data.usage.by_project.forEach((row, index) => validateUsageCoverage(row, row.reported_subtotals, row.field_coverage, `usage.by_project[${index}].field_coverage`));
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
        ...fields("recurring_cost_difference cost_per_usable_result_difference usable_result_rate_change_points normalized_proposed_cost_at_baseline_volume normalized_cost_difference"),
        cost_per_usable_result_change_pct: "number?",
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
      if (Object.values(scenario.costs).some((n) => n < 0) || scenario.costs.recurring_operating_cost < 0 || scenario.outcomes.usable_results < 0.000001 || scenario.outcomes.completed_results < scenario.outcomes.usable_results || scenario.measures.cost_per_usable_result < 0) fail(`${key} costs or outcomes`);
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
    validateComparison(data);
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
        <div class="yield-bar" role="img" aria-label="${perHundred[0]} ready to use, ${perHundred[1]} need correction, and ${perHundred[2]} need escalation for every 100 ${counts.sampled ? "sampled results" : "attempts"}">
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

  function renderSimpleTruthSection() {
    const { baseline, proposed, comparison } = state.data;
    const simple = state.data.experience === "simple";
    const baselineUnit = baseline.measures.cost_per_usable_result;
    const proposedUnit = proposed.measures.cost_per_usable_result;
    const lower = proposedUnit < baselineUnit;
    const change = baselineUnit ? ((proposedUnit - baselineUnit) / baselineUnit) * 100 : 0;
    const sampled = baseline.outcomes.basis === "sampled" || proposed.outcomes.basis === "sampled";
    const humanIncluded = comparison.human_cost_included !== false;
    const providerTerm = providerCostTerm(baseline, proposed);
    const costBasisEvidence = comparison.same_cost_basis
      ? costBasisLabel(proposed.evidence.cost_basis).toUpperCase()
      : "MIXED COST BASIS";
    const evidenceLabel = simple
      ? `SAMPLED n=${baseline.outcomes.sample_size} / ${proposed.outcomes.sample_size} · USER-ENTERED COST AND TIME`
      : sampled
      ? `SAMPLED n=${baseline.outcomes.sample_size} / ${proposed.outcomes.sample_size} · ${baseline.outcomes.sample_method === "declared random or systematic" && proposed.outcomes.sample_method === "declared random or systematic" ? "RANDOM / SYSTEMATIC" : "USER-SELECTED"} · ${costBasisEvidence}`
      : state.data.mode === "illustrative"
        ? costBasisEvidence
        : `OBSERVED OUTCOMES · ${costBasisEvidence}`;
    const metricRows = [
      {
        label: simple ? "Monthly tool cost" : sentenceCase(providerTerm),
        current: money(baseline.costs.model_cost),
        proposed: money(proposed.costs.model_cost),
        change: baseline.costs.model_cost
          ? `${proposed.costs.model_cost <= baseline.costs.model_cost ? "↓" : "↑"} ${Math.abs(((proposed.costs.model_cost - baseline.costs.model_cost) / baseline.costs.model_cost) * 100).toFixed(1)}%`
          : "Not comparable",
        meaning: simple ? "The subscription or plan cost you entered" : providerCostsReported(baseline, proposed, comparison)
          ? "Provider-reported model and API charges"
          : "Model and API cost using the declared basis",
      },
      {
        label: simple ? "Monthly cost including your time" : humanIncluded ? "Total recurring cost" : "Measured recurring cost",
        current: money(baseline.costs.recurring_operating_cost),
        proposed: money(proposed.costs.recurring_operating_cost),
        change: baseline.costs.recurring_operating_cost
          ? `${proposed.costs.recurring_operating_cost <= baseline.costs.recurring_operating_cost ? "↓" : "↑"} ${Math.abs(((proposed.costs.recurring_operating_cost - baseline.costs.recurring_operating_cost) / baseline.costs.recurring_operating_cost) * 100).toFixed(1)}%`
          : "Not comparable",
        meaning: simple ? "Tool cost + your review and fixing time" : humanIncluded ? "Provider + shared + human work" : "Provider + shared; human work not supplied",
      },
      {
        label: simple ? "Usable results" : "Ready results",
        current: compact(baseline.outcomes.usable_results),
        proposed: compact(proposed.outcomes.usable_results),
        change: `${proposed.outcomes.usable_results >= baseline.outcomes.usable_results ? "+" : "−"}${compact(Math.abs(proposed.outcomes.usable_results - baseline.outcomes.usable_results))}`,
        meaning: simple ? "Work usable without a significant fix" : "Outputs that cleared the same rule",
      },
      {
        label: simple ? "Cost per usable result" : humanIncluded ? "Cost per ready result" : "Measured cost per ready result",
        current: unitMoney(baselineUnit),
        proposed: unitMoney(proposedUnit),
        change: `${lower ? "↓" : "↑"} ${Math.abs(change).toFixed(1)}%`,
        meaning: simple ? "The fairest way to compare the two" : humanIncluded ? "The decision metric" : "Directional until human work is added",
        emphasis: true,
      },
    ];
    document.getElementById("truth-summary").textContent = simple
      ? "A cheaper subscription can cost more when it creates extra reviewing and fixing work."
      : humanIncluded
      ? `A ready result is finished work that cleared the stated quality rule. ${sentenceCase(providerTerm)} can fall while the cost of usable work rises.`
      : `This first pass connects the bill to usable work. Human review time was not supplied, so the unit cost remains directional.`;
    document.getElementById("unit-economics-card").innerHTML = `
      <div class="decision-table-heading">
        <div><span>${simple ? "COST COMPARISON" : "DECISION CHECK"}</span><strong>${simple ? lower ? "The other option costs less per usable result in this sample." : "The cheaper subscription did not produce cheaper usable work." : lower ? humanIncluded ? "The proposed route is cheaper per ready result." : "The proposed route is lower on the costs supplied." : humanIncluded ? "The cheaper bill did not produce cheaper work." : "The proposed route is not cheaper on the costs supplied."}</strong></div>
        <span class="evidence-pill ${state.data.mode === "illustrative" ? "is-illustrative" : sampled ? "is-sampled" : "is-observed"}">${escapeHtml(evidenceLabel)}</span>
      </div>
      <div class="decision-table-wrap" role="region" aria-label="Route decision comparison" tabindex="0">
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
            ? humanIncluded
              ? simple
                ? "This estimate uses the monthly costs, usable outputs, and time you entered. Treat it as a first comparison and repeat the sample before making a bigger decision."
                : "The spend is observed. Outcome yield and human work are extrapolated from the reviewed samples, so the difference remains a test result, not booked savings."
              : "The spend is observed and outcome yield is estimated from the reviewed samples. Human work was not supplied, so the unit cost is incomplete and cannot become a savings claim."
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

  function renderTruthSection() {
    if (state.data.experience === "simple") return renderSimpleTruthSection();
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
        ? costBasisEvidence
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
      `A ready result is finished work that cleared the stated quality rule. ${sentenceCase(providerTerm)} can fall while the cost of usable work rises.`;
    document.getElementById("unit-economics-card").innerHTML = `
      <div class="decision-table-heading">
        <div><span>DECISION CHECK</span><strong>${lower ? "The proposed route is cheaper per ready result." : "The cheaper bill did not produce cheaper work."}</strong></div>
        <span class="evidence-pill ${state.data.mode === "illustrative" ? "is-illustrative" : sampled ? "is-sampled" : "is-observed"}">${escapeHtml(evidenceLabel)}</span>
      </div>
      <div class="decision-table-wrap" role="region" aria-label="Route decision comparison" tabindex="0">
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
      : Math.abs(modeledUnit - currentUnit) < 0.000001
        ? "NO COST ADVANTAGE"
        : modeledUnit < currentUnit ? "LOWER MODELED COST" : "CURRENT ROUTE STILL WINS";
    document.getElementById("break-even-verdict").classList.toggle("wins", hasReadyResults && modeledUnit < currentUnit);
    document.getElementById("break-even-copy").textContent = currentUnit === 0
      ? "The current option has zero cost on the supplied inputs. A percentage saving is undefined; the other option can only match zero or cost more. Quality and approval requirements still apply."
      : !hasReadyResults
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

  function renderSimpleLumenPanel() {
    const facts = lumenFacts();
    const simple = state.data.experience === "simple";
    const unitChange = facts.comparison.cost_per_usable_result_change_pct;
    const providerTerm = providerCostTerm(facts.baseline, facts.proposed);
    const humanIncluded = facts.comparison.human_cost_included !== false;
    document.getElementById("lumen-panel-title").textContent = unitChange > 0
      ? "Don't switch yet."
      : facts.comparison.savings_claim_allowed
        ? "The proposed route earned approval."
        : "The proposed route earned another test.";
    document.getElementById("lumen-panel-copy").textContent = simple
      ? unitChange > 0
        ? `The other option costs less each month, but it created more reviewing and fixing work. Cost per usable result is ${Math.abs(unitChange).toFixed(1)}% higher.`
        : `Cost per usable result is ${Math.abs(unitChange).toFixed(1)}% lower in your sample. Test it again before making a bigger decision.`
      : !humanIncluded
      ? `The bill and sampled ready result rate are connected. Human work is still missing, so this is a directional comparison, not a full cost or savings claim.`
      : unitChange > 0
        ? `${sentenceCase(providerTerm)} is lower, but fewer results are ready and human work is higher. Full cost per ready result is ${Math.abs(unitChange).toFixed(1)}% worse.`
        : `The cost per ready result is ${Math.abs(unitChange).toFixed(1)}% lower. The evidence check decides whether that is a real saving or still only an estimate.`;
    document.getElementById("lumen-signals").innerHTML = `
      <div><span>${simple ? "Monthly tool cost" : escapeHtml(sentenceCase(providerTerm))}</span><strong>${facts.providerChange <= 0 ? "↓" : "↑"} ${Math.abs(facts.providerChange).toFixed(1)}%</strong></div>
      <div><span>${simple ? "Usable result rate" : "Ready result rate"}</span><strong>${pct(facts.baseline.measures.usable_result_rate)} → ${pct(facts.proposed.measures.usable_result_rate)}</strong></div>
      <div><span>${simple ? "Cost per usable result" : "Full unit cost"}</span><strong>${unitMoney(facts.baseline.measures.cost_per_usable_result)} → ${unitMoney(facts.proposed.measures.cost_per_usable_result)}</strong></div>`;
    document.getElementById("lumen-conversation").innerHTML = "";
    configureLumenPrompts(false);
  }

  function renderLumenPanel() {
    if (state.data.experience === "simple") return renderSimpleLumenPanel();
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

  function configureLumenPrompts(forBill) {
    const billLabels = {
      why: "Where did the money go?",
      changed: "What stands out?",
      improve: "Where would you look first?",
      evidence: "What is missing?",
      cfo: "Explain this for finance.",
      plan: "How well is this attributed?",
      payback: "Can this prove savings?",
      challenge: "Challenge the recommendation.",
    };
    const workloadLabels = {
      why: "How do these costs compare?",
      changed: "What changed?",
      improve: "What has to improve?",
      evidence: "What evidence is missing?",
      cfo: "Explain it for a CFO.",
      plan: "What happened versus plan?",
      payback: "Does the change pay back?",
      challenge: "Challenge the conclusion.",
    };
    const labels = forBill ? billLabels : workloadLabels;
    document.querySelectorAll("[data-lumen-question]").forEach((button) => {
      button.textContent = labels[button.dataset.lumenQuestion];
    });
  }

  function lumenResponse(kind) {
    if (state.data?.experience === "simple") {
      const { baseline, proposed, comparison } = state.data;
      const decision = decisionFor(state.data);
      if (["evidence", "challenge"].includes(kind)) return `${decision.reason} ${comparison.limitation}`;
      if (kind === "plan" || kind === "payback") return "No budget plan or switching cost was supplied. A monthly scenario alone does not establish payback or realized savings.";
      return `${decision.reason} Current cost per qualifying result: ${unitMoney(baseline.measures.cost_per_usable_result)}. Other option: ${unitMoney(proposed.measures.cost_per_usable_result)}. Tool charges and estimated time value are included; qualifying means usable without a significant fix.`;
    }


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
      why: `${decisionFor(state.data).reason} Current unit cost: ${unitMoney(baseline.measures.cost_per_usable_result)}. Proposed unit cost: ${unitMoney(proposed.measures.cost_per_usable_result)}.`,
      changed: `${decisionFor(state.data).reason} Provider cost: ${money(baseline.costs.model_cost)} → ${money(proposed.costs.model_cost)}. Human work: ${money(baseline.costs.human_review_cost)} → ${money(proposed.costs.human_review_cost)}.`,
      improve: facts.requiredRate === null
        ? "The review does not contain enough volume data to calculate a break-even yield."
        : `At the current proposed cost, at least ${compact(facts.requiredReady)} of ${compact(proposed.outcomes.completed_results)} attempts must be ready to match the current ${unitMoney(baseline.measures.cost_per_usable_result)} unit cost. That is a ${facts.requiredRate.toFixed(1)}% ready result rate, compared with ${pct(proposed.measures.usable_result_rate)} now. The break-even explorer lets you test a different yield, provider bill, or human work cost.`,
      evidence: mode === "illustrative"
        ? `The math is complete for these inputs. Before finance relies on it, use the provider bill and outcome log for one specific workload. Apply the same definition of "ready" to both routes, measure the human correction time, and enter the cost of making the change. ${issueCount ? `${issueCount} file or math issue${issueCount === 1 ? " is" : "s are"} also open.` : "The records reconcile."}`
        : comparison.savings_claim_allowed
          ? "The bill, work volume, quality rule, policy approval, and included costs all match for this review. That supports this decision for this workload and period, not a claim about the model everywhere."
          : issueCount
            ? `${failedGateSentence} still ${failedGateVerb} a savings claim. Open The evidence for the ${issueCount} reconciliation issue${issueCount === 1 ? "" : "s"}.`
            : `The files match, but ${failedGateText} still ${failedGateVerb} a savings claim.`,
      cfo: decisionFor(state.data).reason,
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
      challenge: `The answer depends on four things: both routes did the same work, "ready" meant the same thing on both sides, all human work was counted, and no important cost was left out. This review uses ${money(proposed.costs.one_time_change_cost)} for the change itself and ${money(proposed.costs.shared_infrastructure_cost)} for shared infrastructure. Change any of those inputs and the decision could change too.`,
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

  function renderSimpleReview() {
    const { baseline, proposed, comparison, workload, period, mode } = state.data;
    const simple = state.data.experience === "simple";
    document.getElementById("review-kicker").textContent = simple ? "AI TOOL COST COMPARISON" : "FINANCE FIRST AI SPEND REVIEW";
    document.getElementById("review-title").textContent = simple ? "What did one usable result really cost?" : "What did one ready result really cost?";
    document.getElementById("truth-kicker").textContent = simple ? "THE NUMBER THAT MATTERS" : "THE NUMBER FINANCE NEEDS";
    document.getElementById("truth-title").textContent = simple ? "The cost of one usable result" : "The cost of one ready result";
    const humanIncluded = comparison.human_cost_included !== false;
    document.getElementById("period-label").textContent = `${period.start} to ${period.end} · ${period.timezone}`;
    document.getElementById("mode-tag").textContent =
      mode === "illustrative"
        ? "ILLUSTRATIVE DATA"
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
    if (!humanIncluded) {
      document.getElementById("finding-title").textContent =
        `The sampled ready result rate is visible. Human review time is not, so the displayed unit cost includes only the costs supplied.`;
    } else if (comparison.savings_claim_allowed) {
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
        note: humanIncluded ? "Recurring cost per ready result" : "Cost per ready result; human work not supplied",
        value: baseline.measures.cost_per_usable_result,
      },
      {
        className: "proposed",
        label: proposed.label,
        note: humanIncluded ? "Recurring cost per ready result" : "Cost per ready result; human work not supplied",
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
    const maxValue = Math.max(...values) * 1.06 || 1;

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
        label: humanIncluded ? "Recurring cost" : "Measured recurring cost",
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
            ? "Use your own records before acting"
            : mode === "sampled" ? "Sample assumptions need confirmation" : "No file or math mismatch found",
        value: evidenceIssues.length
          ? `${evidenceIssues.length} issue${evidenceIssues.length === 1 ? "" : "s"}`
          : illustrative
            ? "Records match"
            : mode === "sampled" ? "Estimate" : "Files match",
        note: evidenceIssues[0] || (illustrative
          ? "The supplied inputs reconcile. They do not predict another workload or vendor."
          : mode === "sampled" ? "Sample arithmetic is consistent. This does not verify an invoice or a complete work log." : "The bill and work log match for this review. Quality, policy, and approval checks still apply."),
      },
      {
        state: "leave",
        label: !lowerUnitCost ? "KEEP CURRENT ROUTE" : "HOLD SEPARATE",
        title: !lowerUnitCost ? sentenceCase(decisionFor(state.data).code.toLowerCase()) : proposed.costs.one_time_change_cost ? "One time change cost" : "No separate cost to protect",
        value: !lowerUnitCost
          ? (comparison.cost_per_usable_result_change_pct === null ? "Zero-cost baseline" : comparison.cost_per_usable_result_difference === 0 ? "No change" : `${Math.abs(comparison.cost_per_usable_result_change_pct).toFixed(1)}% higher`)
          : proposed.costs.one_time_change_cost ? money(proposed.costs.one_time_change_cost) : "—",
        note: !lowerUnitCost
          ? decisionFor(state.data).reason
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

  function renderReview() {
    if (state.data.experience === "simple") return renderSimpleReview();
    document.getElementById("review-kicker").textContent = "FINANCE FIRST AI SPEND REVIEW";
    document.getElementById("review-title").textContent = "What did one ready result really cost?";
    document.getElementById("truth-kicker").textContent = "THE NUMBER FINANCE NEEDS";
    document.getElementById("truth-title").textContent = "The cost of one ready result";
    const { baseline, proposed, comparison, workload, period, mode } = state.data;
    document.getElementById("period-label").textContent = `${period.start} to ${period.end} · ${period.timezone}`;
    document.getElementById("mode-tag").textContent =
      mode === "illustrative"
        ? "ILLUSTRATIVE DATA"
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
        note: "Recurring cost per ready result",
        value: baseline.measures.cost_per_usable_result,
      },
      {
        className: "proposed",
        label: proposed.label,
        note: "Recurring cost per ready result",
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
            ? "Use your own records before acting"
            : "No file or math mismatch found",
        value: evidenceIssues.length
          ? `${evidenceIssues.length} issue${evidenceIssues.length === 1 ? "" : "s"}`
          : illustrative
            ? "Records match"
            : "Files match",
        note: evidenceIssues[0] || (illustrative
          ? "The supplied inputs reconcile. They do not predict another workload or vendor."
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
    const humanKnown = scenario.evidence.human_time_supplied !== false;
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
        <div class="stacked-bar" role="img" aria-label="Recurring cost composition">
          ${parts
            .map(
              ([, value, key]) =>
                `<div class="stack-${key}" style="width:${(recurring ? (value / recurring) * 100 : 0).toFixed(2)}%"></div>`,
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
                  <strong>${key === "human" && !humanKnown ? "Not supplied" : `${money(value)} · ${recurring ? ((value / recurring) * 100).toFixed(0) + "%" : "No cost"}`}</strong>
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
        ? `<div><dt>Outcome evidence</dt><dd>Complete outcome log</dd></div>`
        : `<div><dt>Outcome evidence</dt><dd>One row per completed result</dd></div>`;
    return `
      <article class="evidence-card">
        <header>
          <h2>${escapeHtml(scenario.label)}</h2>
          <div class="evidence-chips">
            <span class="basis-chip">${escapeHtml(costBasisText)}</span>
            <span class="evidence-status status-${escapeHtml(status)}">${escapeHtml(status === "illustrative" ? "complete record" : `${status} coverage`)}</span>
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
                ? "<p>The spend, cost, and outcome rows reconcile.</p>"
                : status === "sampled"
                ? "<p>The entered numbers reconcile. Outcome yield and human time remain sampled estimates.</p>"
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
      ? "The numbers match. The conclusion remains bounded to these inputs."
      : comparison.evidence_complete
      ? "The evidence reconciles for this comparison."
      : comparison.outcome_evidence_basis === "sampled"
        ? "The sample is useful. It is not the whole population."
      : "The missing proof stays visible.";
    boundaryCopy.textContent = illustrative
      ? "Use one bounded workload, a matching provider bill, and the same ready-result rule before relying on the conclusion."
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

  function renderOpportunities() {
    const summary = document.getElementById("opportunity-summary");
    const list = document.getElementById("opportunity-workbench-list");
    if (!opportunityEngine) {
      summary.innerHTML = "";
      list.innerHTML = '<p class="workbench-empty">Opportunity analysis is unavailable in this build.</p>';
      return;
    }
    const result = opportunityEngine.analyzeReview(state.data);
    const amount = result.headline.conservative_non_additive_opportunity;
    const actions = new Set(result.findings.map((item) => item.action));
    const posture = !result.findings.length
      ? "No supported finding"
      : actions.has("keep_current_route")
        ? "Keep current route"
        : actions.has("verify")
          ? "Test first"
          : actions.has("consider_approval")
            ? "Consider approval"
            : "Investigate";
    summary.innerHTML = `
      <article><span>Open findings</span><strong>${result.headline.finding_count}</strong><p>Each finding retains its own evidence and next step.</p></article>
      <article><span>Largest supported amount</span><strong>${amount === null ? "Not quantified" : money(amount)}</strong><p>Conservative boundary only. Overlapping amounts are not added together.</p></article>
      <article><span>Current posture</span><strong>${posture}</strong><p>No opportunity becomes savings until the decision and actuals gates pass.</p></article>`;
    list.innerHTML = result.findings.length ? result.findings.map((item, index) => `
      <article class="workbench-finding">
        <span>${String(index + 1).padStart(2, "0")}</span>
        <div><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.explanation)}</p></div>
        <dl class="finding-meta">
          <div><dt>Affected scope</dt><dd>${escapeHtml(item.affected_scope)}</dd></div>
          <div><dt>Potential amount</dt><dd>${item.estimated_avoidable_cost === null ? "Not quantified" : money(item.estimated_avoidable_cost)}</dd></div>
          <div><dt>Evidence · confidence</dt><dd>${escapeHtml(item.evidence_basis)} · ${escapeHtml(item.confidence)}</dd></div>
          <div><dt>Overlap group</dt><dd>${escapeHtml(item.overlap_group || "None")}</dd></div>
        </dl>
        <div class="finding-action"><strong>${escapeHtml(item.action.replaceAll("_", " "))}</strong><p>${escapeHtml(item.verification_requirement)}</p></div>
      </article>`).join("") : '<p class="workbench-empty">No supported finding is available for this record.</p>';
  }

  function parseRequestLog(text, filename) {
    if (/\.json$/i.test(filename) || /^\s*[\[{]/.test(text)) {
      let parsed;
      try { parsed = JSON.parse(text); } catch { throw new Error("The request log is not valid JSON."); }
      const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.data) ? parsed.data : null;
      if (!rows?.length) throw new Error("The request-log JSON needs a top-level array or a data array with at least one flat object.");
      if (rows.length > 20000) throw new Error("The request log exceeds 20,000 data rows.");
      rows.forEach((row, index) => {
        if (!row || typeof row !== "object" || Array.isArray(row) || Object.values(row).some((value) => value !== null && typeof value === "object")) {
          throw new Error(`Request-log JSON row ${index + 1} must be one flat object.`);
        }
      });
      return rows;
    }
    return parseCsv(text, "Request log");
  }

  function requestReviewMoney(value, currency) {
    if (value === null || value === undefined) return "Not quantified";
    if (!/^[A-Z]{3}$/.test(currency || "") || currency === "MIXED") return "Not combined";
    const absolute = Math.abs(value);
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: absolute > 0 && absolute < 0.01 ? 4 : 2,
      maximumFractionDigits: absolute > 0 && absolute < 0.01 ? 6 : 2,
    }).format(value);
  }

  const requestFilterIds = ["request-filter-from", "request-filter-through", "request-filter-provider", "request-filter-model", "request-filter-project", "request-filter-workload", "request-filter-status"];

  function requestFilterOptions(events, field, label) {
    const values = [...new Set(events.map((event) => event[field]).filter((value) => value !== null && value !== undefined && value !== ""))].sort((left, right) => String(left).localeCompare(String(right)));
    const missing = events.some((event) => event[field] === null || event[field] === undefined || event[field] === "");
    return `<option value="">All ${escapeHtml(label)}</option>`
      + values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")
      + (missing ? '<option value="__missing__">Not supplied</option>' : "");
  }

  function populateRequestExplorer(review) {
    document.getElementById("request-filter-provider").innerHTML = requestFilterOptions(review.events, "provider", "providers");
    document.getElementById("request-filter-model").innerHTML = requestFilterOptions(review.events, "model", "models");
    document.getElementById("request-filter-project").innerHTML = requestFilterOptions(review.events, "project", "projects");
    document.getElementById("request-filter-workload").innerHTML = requestFilterOptions(review.events, "workload", "workloads");
    document.getElementById("request-filter-status").innerHTML = requestFilterOptions(review.events, "request_status", "statuses");
    const dates = review.events.map((event) => event.timestamp?.slice(0, 10)).filter(Boolean).sort();
    for (const id of ["request-filter-from", "request-filter-through"]) {
      const input = document.getElementById(id);
      input.value = "";
      input.min = dates[0] || "";
      input.max = dates.at(-1) || "";
    }
  }

  function renderRequestEventExplorer() {
    const review = state.usageReview;
    if (!review) return;
    const from = document.getElementById("request-filter-from").value;
    const through = document.getElementById("request-filter-through").value;
    const matches = (event, field, id) => {
      const selected = document.getElementById(id).value;
      if (!selected) return true;
      if (selected === "__missing__") return event[field] === null || event[field] === undefined || event[field] === "";
      return String(event[field]) === selected;
    };
    const events = review.events.filter((event) => {
      const date = event.timestamp?.slice(0, 10) || null;
      if (from && (!date || date < from)) return false;
      if (through && (!date || date > through)) return false;
      return matches(event, "provider", "request-filter-provider")
        && matches(event, "model", "request-filter-model")
        && matches(event, "project", "request-filter-project")
        && matches(event, "workload", "request-filter-workload")
        && matches(event, "request_status", "request-filter-status");
    });
    const priced = events.filter((event) => event.selected_cost !== null);
    const currencies = [...new Set(priced.map((event) => event.currency).filter(Boolean))];
    const currency = currencies.length === 1 ? currencies[0] : currencies.length > 1 ? "MIXED" : review.currency;
    const selectedCost = currency === "MIXED" || !priced.length
      ? null
      : priced.reduce((sum, event) => sum + event.selected_cost, 0);
    const cacheKnown = events.filter((event) => event.input_tokens !== null && event.cached_input_tokens !== null);
    const cacheInput = cacheKnown.reduce((sum, event) => sum + event.input_tokens, 0);
    const cacheTokens = cacheKnown.reduce((sum, event) => sum + event.cached_input_tokens, 0);
    const cacheShare = cacheInput ? `${(cacheTokens / cacheInput * 100).toFixed(1)}% cache share` : "cache share unavailable";
    document.getElementById("request-explorer-status").textContent = `${wholeNumber(events.length)} of ${wholeNumber(review.event_count)} events · ${wholeNumber(priced.length)} priced · ${requestReviewMoney(selectedCost, currency)} · ${cacheShare}`;
    const visible = events.slice(0, 100);
    document.getElementById("request-event-rows").innerHTML = visible.map((event) => `<tr>
      <th>${escapeHtml(event.event_id || event.record_id)}${event.duplicate_group ? `<span>${escapeHtml(event.duplicate_group)}</span>` : ""}</th>
      <td>${escapeHtml(event.timestamp ? event.timestamp.replace("T", " ").replace(".000Z", "Z") : "Not supplied")}</td>
      <td>${escapeHtml(event.provider || "Not supplied")}<span>${escapeHtml(event.model || "Not supplied")}</span></td>
      <td>${escapeHtml(event.project || "Not supplied")}<span>${escapeHtml(event.workload)}</span></td>
      <td>${escapeHtml(event.request_status || "Not supplied")}</td>
      <td>${event.input_tokens === null ? "Not supplied" : wholeNumber(event.input_tokens)}</td>
      <td>${event.output_tokens === null ? "Not supplied" : wholeNumber(event.output_tokens)}</td>
      <td>${event.cached_input_tokens === null ? "Not supplied" : wholeNumber(event.cached_input_tokens)}</td>
      <td>${event.selected_cost === null ? "Unpriced" : requestReviewMoney(event.selected_cost, event.currency)}<span>${escapeHtml(event.cost_basis.replaceAll("_", " "))}</span></td>
    </tr>`).join("") || '<tr><td colspan="9">No request records match these filters.</td></tr>';
    document.getElementById("request-row-limit").textContent = events.length > visible.length
      ? `Showing the first ${wholeNumber(visible.length)} matching rows of ${wholeNumber(events.length)}. Download normalized usage for the complete local record.`
      : `Showing all ${wholeNumber(events.length)} matching row${events.length === 1 ? "" : "s"}.`;
  }

  function renderRequestSpendOverview(review) {
    const spend = review.spend;
    const period = spend.period;
    const periodLabel = period.start && period.end
      ? period.start === period.end ? period.start : `${period.start} to ${period.end}`
      : "Not supplied";
    const runRateCopy = spend.run_rate_status === "AVAILABLE"
      ? `${requestReviewMoney(spend.average_cost_per_calendar_day, spend.currency)} per calendar day across a confirmed complete ${wholeNumber(period.calendar_days)}-day period. This is a straight-line run rate, not a forecast.`
      : `Unavailable: ${spend.run_rate_limitations.join("; ").toLowerCase()}.`;
    document.getElementById("request-spend-context").innerHTML = `
      <article><span>Imported UTC period</span><strong>${escapeHtml(periodLabel)}</strong><p>${wholeNumber(period.active_days)} active day${period.active_days === 1 ? "" : "s"}; ${wholeNumber(period.timestamped_rows)} of ${wholeNumber(review.event_count)} rows timestamped.</p></article>
      <article><span>Cost per priced request</span><strong>${requestReviewMoney(spend.cost_per_priced_request, spend.currency)}</strong><p>Selected comparable cost divided by ${wholeNumber(review.reconciliation.priced_rows)} priced row${review.reconciliation.priced_rows === 1 ? "" : "s"}; unpriced rows stay excluded.</p></article>
      <article><span>30-day run rate</span><strong>${requestReviewMoney(spend.projected_30_day_cost, spend.currency)}</strong><p>${escapeHtml(runRateCopy)}</p></article>`;
    const evidence = review.evidence_layers;
    document.getElementById("request-evidence-layers").innerHTML = `
      <div class="request-explorer-head"><div><p class="kicker">EVIDENCE LAYERS</p><h4>Fast signals and finance proof stay separate</h4></div><p>Telemetry diagnoses · billing confirms</p></div>
      <div class="request-spend-context">
        <article><span>Usage telemetry</span><strong>${escapeHtml(evidence.usage_telemetry.status.replaceAll("_", " "))}</strong><p>${wholeNumber(evidence.usage_telemetry.rows_with_usage_signals)} of ${wholeNumber(evidence.usage_telemetry.total_rows)} rows carry usage or operating signals. This is not an invoice.</p></article>
        <article><span>Request cost</span><strong>${escapeHtml(evidence.request_cost.status.replaceAll("_", " "))}</strong><p>${wholeNumber(evidence.request_cost.provider_reported_rows)} provider-reported, ${wholeNumber(evidence.request_cost.calculated_rows)} calculated, ${wholeNumber(evidence.request_cost.unpriced_rows)} unpriced.</p></article>
        <article><span>Billing evidence</span><strong>${escapeHtml(evidence.billing_evidence.status.replaceAll("_", " "))}</strong><p>${escapeHtml(evidence.billing_evidence.purpose)}</p></article>
      </div>
      <p class="request-variance-note">${escapeHtml(evidence.precedence_rule)}</p>`;
    const costStack = spend.cost_stack;
    const categoryRows = costStack.categories.map((item) => `<tr><th>${escapeHtml(item.label)}</th><td>${item.supplied ? requestReviewMoney(item.amount, costStack.currency) : "Unknown"}</td></tr>`).join("");
    const fullyLoadedCopy = costStack.status === "FULLY_LOADED"
      ? "Every declared category was supplied, including confirmed zeros."
      : costStack.status === "NOT_COMPARABLE"
        ? "Request cost is missing or not in one comparable currency, so no fully loaded claim is shown."
        : review.reconciliation.unpriced_rows
          ? `${wholeNumber(review.reconciliation.unpriced_rows)} request rows remain unpriced, so no fully loaded claim is shown.`
          : `${wholeNumber(costStack.missing_categories.length)} categories remain unknown, so no fully loaded claim is shown.`;
    document.getElementById("request-cost-stack").innerHTML = `
      <div class="request-explorer-head"><div><p class="kicker">FULL COST BOUNDARY</p><h4>What sits beyond the model or provider charge?</h4></div><p>${escapeHtml(costStack.status.replaceAll("_", " "))}</p></div>
      <div class="request-spend-context">
        <article><span>Provider request cost</span><strong>${requestReviewMoney(costStack.provider_request_cost, costStack.currency)}</strong><p>The selected row-level provider or calculated cost.</p></article>
        <article><span>Known operating cost</span><strong>${requestReviewMoney(costStack.known_operating_cost, costStack.currency)}</strong><p>Provider request cost plus only the additional period costs supplied below.</p></article>
        <article><span>Fully loaded cost</span><strong>${requestReviewMoney(costStack.fully_loaded_cost, costStack.currency)}</strong><p>${fullyLoadedCopy}</p></article>
      </div>
      <div class="request-variance-table-wrap" role="region" aria-label="Additional cost categories" tabindex="0"><table><thead><tr><th>Additional category</th><th>Same-period amount</th></tr></thead><tbody>${categoryRows}</tbody></table></div>
      <p class="request-variance-note">${escapeHtml(costStack.method)}</p>`;
    const allocation = spend.allocation;
    const allocationDecision = allocation.decision_support;
    const allocationRows = Object.entries(allocation.dimensions).map(([key, item]) => `<tr${key === allocationDecision.basis ? ' class="is-selected"' : ""}><th>${escapeHtml(item.label)}</th><td>${wholeNumber(item.allocated_priced_rows)}</td><td>${requestReviewMoney(item.unallocated_cost, spend.currency)}</td><td>${item.unallocated_cost_pct === null ? "Not available" : `${(item.unallocated_cost_pct * 100).toFixed(1)}%`}</td></tr>`).join("");
    document.getElementById("request-allocation-status").innerHTML = `
      <div class="request-explorer-head"><div><p class="kicker">ALLOCATION COVERAGE</p><h4>Does known cost clear the allocation check?</h4></div><p>${escapeHtml(allocationDecision.status.replaceAll("_", " "))}</p></div>
      <article class="allocation-${allocationDecision.status.toLowerCase().replaceAll("_", "-")}"><strong>${escapeHtml(allocationDecision.reason)}</strong><p>${escapeHtml(allocationDecision.policy_note)}</p></article>
      <div class="request-variance-table-wrap" role="region" aria-label="Allocation coverage by dimension" tabindex="0"><table><thead><tr><th>Dimension</th><th>Allocated priced rows</th><th>Unallocated cost</th><th>Unallocated share</th></tr></thead><tbody>${allocationRows}</tbody></table></div>
      <p class="request-variance-note">${escapeHtml(allocation.method)}</p>`;
    const budget = spend.budget;
    const budgetPresentation = {
      NOT_SUPPLIED: ["No budget supplied", "Add an optional monthly budget before analyzing to check the supported run rate against a local threshold."],
      RUN_RATE_UNAVAILABLE: [requestReviewMoney(budget.monthly_budget, budget.currency), "The budget is recorded, but the imported evidence does not support a 30-day run rate. Resolve the run-rate limitations before comparing them."],
      WITHIN: [`${(budget.projected_utilization * 100).toFixed(1)}% of budget`, `${requestReviewMoney(budget.projected_budget_remaining, budget.currency)} remains against the straight-line 30-day run rate.`],
      WATCH: [`${(budget.projected_utilization * 100).toFixed(1)}% of budget`, `The run rate reached the ${(budget.warning_threshold * 100).toFixed(1)}% warning threshold. ${requestReviewMoney(budget.projected_budget_remaining, budget.currency)} remains.`],
      OVER: [`${(budget.projected_utilization * 100).toFixed(1)}% of budget`, `The 30-day run rate is ${requestReviewMoney(Math.abs(budget.projected_variance_to_budget), budget.currency)} above the supplied budget.`],
    };
    const [budgetTitle, budgetCopy] = budgetPresentation[budget.status];
    document.getElementById("request-budget-status").innerHTML = `<article class="budget-${budget.status.toLowerCase().replaceAll("_", "-")}">
      <div><span>LOCAL BUDGET CHECK</span><strong>${escapeHtml(budget.status.replaceAll("_", " "))}</strong></div>
      <div><strong>${escapeHtml(budgetTitle)}</strong><p>${escapeHtml(budgetCopy)}</p></div>
      <small>Static threshold check · not a forecast, live alert, or savings claim</small>
    </article>`;
    const operating = spend.operational_metrics;
    const metricPercent = (value) => value === null ? "Not available" : `${(value * 100).toFixed(1)}%`;
    const latency = operating.median_latency_ms === null
      ? "Not available"
      : `${wholeNumber(Math.round(operating.median_latency_ms))} ms median · ${wholeNumber(Math.round(operating.p95_latency_ms))} ms p95`;
    document.getElementById("request-operational-metrics").innerHTML = `
      <article><span>Failed or cancelled</span><strong>${metricPercent(operating.failed_or_cancelled_rate)}</strong><p>${wholeNumber(operating.status_coverage_rows)} of ${wholeNumber(review.event_count)} rows have a recognized status.</p></article>
      <article><span>Retry linked</span><strong>${metricPercent(operating.retry_linked_rate)}</strong><p>${wholeNumber(operating.retry_linked_rows)} rows are marked retried or reference a parent event; ${wholeNumber(operating.retry_coverage_rows)} rows have classifiable retry evidence. This is not an attempt-count rate.</p></article>
      <article><span>Cache share</span><strong>${metricPercent(operating.cache_share)}</strong><p>${wholeNumber(operating.cache_coverage_rows)} of ${wholeNumber(review.event_count)} rows supply input and cached-input tokens.</p></article>
      <article><span>Latency</span><strong>${escapeHtml(latency)}</strong><p>${wholeNumber(operating.latency_coverage_rows)} of ${wholeNumber(review.event_count)} rows supply latency.</p></article>
      <article><span>Outcome coverage</span><strong>${wholeNumber(operating.outcome_coverage_rows)} of ${wholeNumber(review.event_count)}</strong><p>Coverage only. Request rows are not assumed to equal finished business results.</p></article>`;
    const variance = spend.period_variance;
    const signedCost = (value) => value === null ? "Not available" : `${value > 0 ? "+" : ""}${requestReviewMoney(value, variance.currency)}`;
    if (variance.status !== "AVAILABLE") {
      document.getElementById("request-variance").innerHTML = `<p class="request-variance-unavailable"><strong>Variance decomposition unavailable.</strong> ${escapeHtml(variance.limitations.join("; "))}. It requires a confirmed complete period of at least 14 days with every row timestamped, priced, and in one currency.</p>`;
    } else {
      const changeRate = variance.total_cost_change_rate === null ? "Not available" : `${variance.total_cost_change_rate > 0 ? "+" : ""}${(variance.total_cost_change_rate * 100).toFixed(1)}%`;
      const leading = variance.excluded_leading_days ? ` ${wholeNumber(variance.excluded_leading_days)} leading day${variance.excluded_leading_days === 1 ? " was" : "s were"} excluded so the windows are equal.` : "";
      const costChangeTable = (title, rows) => rows?.length ? `<div class="request-variance-table-wrap" role="region" aria-label="${escapeHtml(title)} cost changes" tabindex="0"><h4>${escapeHtml(title)}</h4><table><thead><tr><th>${escapeHtml(title)}</th><th>Prior</th><th>Recent</th><th>Change</th></tr></thead><tbody>${rows.map((item) => `<tr><th>${escapeHtml(item.label)}</th><td>${requestReviewMoney(item.prior_cost, variance.currency)}</td><td>${requestReviewMoney(item.current_cost, variance.currency)}</td><td>${escapeHtml(signedCost(item.change))}</td></tr>`).join("")}</tbody></table></div>` : "";
      document.getElementById("request-variance").innerHTML = `
        <div class="request-variance-cards">
          <article><span>Prior ${wholeNumber(variance.window_days)} days</span><strong>${requestReviewMoney(variance.prior_period.selected_cost, variance.currency)}</strong><p>${wholeNumber(variance.prior_period.requests)} requests · ${requestReviewMoney(variance.prior_period.cost_per_request, variance.currency)} each</p></article>
          <article><span>Recent ${wholeNumber(variance.window_days)} days</span><strong>${requestReviewMoney(variance.current_period.selected_cost, variance.currency)}</strong><p>${wholeNumber(variance.current_period.requests)} requests · ${requestReviewMoney(variance.current_period.cost_per_request, variance.currency)} each</p></article>
          <article><span>Total cost change</span><strong>${escapeHtml(signedCost(variance.total_cost_change))}</strong><p>${escapeHtml(changeRate)} between equal windows.</p></article>
          <article><span>Request-volume effect</span><strong>${escapeHtml(signedCost(variance.request_volume_effect))}</strong><p>Change in request count at the prior window's average cost per request.</p></article>
          <article><span>Average-cost effect</span><strong>${escapeHtml(signedCost(variance.average_cost_per_request_effect))}</strong><p>Can reflect mix, token shape, cache, tools, service tier, or price. It is not labeled a rate change.</p></article>
        </div>
        <p class="request-variance-note">${escapeHtml(variance.prior_period.start)} to ${escapeHtml(variance.prior_period.end)} versus ${escapeHtml(variance.current_period.start)} to ${escapeHtml(variance.current_period.end)}.${escapeHtml(leading)} The two effects reconcile to total cost change; neither is automatically avoidable.</p>
        ${costChangeTable("Provider", variance.top_provider_cost_changes)}
        ${costChangeTable("Provider · model", variance.top_model_cost_changes)}
        ${costChangeTable("Processing mode", variance.top_processing_mode_cost_changes || [])}
        ${costChangeTable("Inference geography", variance.top_geography_cost_changes || [])}`;
    }
    const dimensions = [
      ["provider", "Provider"],
      ["model", "Model"],
      ["processing_mode", "Processing mode"],
      ["inference_geography", "Inference geography"],
      ["project", "Project"],
      ["team_owner", "Team or owner"],
      ["feature", "Feature"],
      ["customer", "Customer"],
      ["product", "Product"],
      ["workload", "Workload"],
      ["workflow", "Workflow"],
      ["session_id", "Session"],
      ["environment", "Environment"],
    ];
    document.getElementById("request-spend-breakdowns").innerHTML = dimensions.filter(([key]) => spend.breakdowns[key] || !["processing_mode", "inference_geography"].includes(key)).map(([key, label]) => {
      const rows = spend.breakdowns[key] || [];
      const visible = rows.slice(0, 6);
      return `<article>
        <h4>By ${escapeHtml(label.toLowerCase())}</h4>
        <div role="region" aria-label="Spend by ${escapeHtml(label.toLowerCase())}" tabindex="0"><table><thead><tr><th>${escapeHtml(label)}</th><th>Requests</th><th>Selected cost</th><th>Average</th><th>Share</th></tr></thead>
        <tbody>${visible.map((item) => `<tr><th>${escapeHtml(item.label)}</th><td>${wholeNumber(item.event_count)}<span>${wholeNumber(item.priced_rows)} priced</span></td><td>${requestReviewMoney(item.selected_cost, spend.currency)}</td><td>${requestReviewMoney(item.average_selected_cost_per_priced_row, spend.currency)}</td><td>${item.share_of_selected_cost === null ? "Not available" : `${(item.share_of_selected_cost * 100).toFixed(1)}%`}</td></tr>`).join("")}</tbody></table></div>
        ${rows.length > visible.length ? `<p>Showing the top ${visible.length} of ${rows.length} values. Use the local filters below for row-level review.</p>` : ""}
      </article>`;
    }).join("");
  }

  function renderRequestAnalysis(review) {
    const result = document.getElementById("request-analysis-results");
    const summary = document.getElementById("request-analysis-summary");
    const list = document.getElementById("request-finding-list");
    document.getElementById("request-analysis-mode").textContent = state.usageReviewIllustrative
      ? "ILLUSTRATIVE DATA"
      : "OBSERVED REQUEST REVIEW";
    document.getElementById("request-analysis-title").textContent = state.usageReviewIllustrative
      ? "What the example calls show"
      : "What the imported calls support";
    const currency = review.currency;
    const headline = currency === "MIXED" ? null : review.headline.conservative_non_additive_opportunity;
    const bill = review.reconciliation.bill;
    const billPresentation = {
      NOT_SUPPLIED: {
        title: "Not supplied",
        copy: "Add an optional billed total to compare the selected request cost with a real bill.",
      },
      SCOPE_NOT_CONFIRMED: {
        title: "Scope not confirmed",
        copy: "Confirm the same provider, account, currency, and period before comparing these totals.",
      },
      REQUEST_COST_MISSING: {
        title: "Request cost unavailable",
        copy: "Some imported rows have no provider-reported or safely calculated cost. Price every row before reconciling the bill to request evidence.",
      },
      MIXED_CURRENCY: {
        title: "Mixed currencies",
        copy: "Split the request log by currency or apply an explicit FX method before reconciliation.",
      },
      REQUEST_CURRENCY_MISSING: {
        title: "Request currency missing",
        copy: "Supply a currency column or an explicit request-currency fallback before combining priced rows.",
      },
      BILL_CURRENCY_MISSING: {
        title: "Bill currency missing",
        copy: "Supply the billed currency before comparing the bill with the priced request rows.",
      },
      CURRENCY_MISMATCH: {
        title: "Currency mismatch",
        copy: "The bill currency must match the single currency represented by the priced request rows.",
      },
    };
    const billCard = bill.status === "COMPARABLE"
      ? {
          title: requestReviewMoney(bill.supplied_total, bill.supplied_currency),
          copy: `Bill minus raw selected request cost: ${requestReviewMoney(bill.raw_selected_cost_difference, bill.supplied_currency)}. Bill minus the duplicate-excluded review reference: ${requestReviewMoney(bill.duplicate_excluded_reference_difference, bill.supplied_currency)}.`,
        }
      : billPresentation[bill.status] || { title: "Not comparable", copy: "The imported evidence cannot be reconciled to this bill." };
    summary.innerHTML = `
      <article><span>Imported events</span><strong>${wholeNumber(review.event_count)}</strong><p>${wholeNumber(review.reconciliation.priced_rows)} priced; ${wholeNumber(review.reconciliation.unpriced_rows)} retained as unpriced.</p></article>
      <article><span>Observed request cost</span><strong>${requestReviewMoney(review.reconciliation.selected_observed_cost, currency)}</strong><p>Provider-reported cost wins for the same row. Calculated cost fills only missing reported cost.</p></article>
      <article><span>High-confidence boundary</span><strong>${requestReviewMoney(headline, currency)}</strong><p>Duplicate, failed, retry, and error-loop event cost, with overlapping events counted once. This is not savings.</p></article>
      <article><span>Bill reconciliation</span><strong>${escapeHtml(billCard.title)}</strong><p>${escapeHtml(billCard.copy)}</p></article>`;
    document.getElementById("request-analysis-boundary").textContent = review.evidence_gate.reason;
    renderRequestSpendOverview(review);
    populateRequestExplorer(review);
    renderRequestEventExplorer();
    list.innerHTML = review.findings.length ? review.findings.map((item, index) => {
      const amount = currency === "MIXED" ? null : item.estimated_avoidable_cost;
      const ids = item.affected_event_ids || [];
      const idCopy = ids.length ? `${wholeNumber(ids.length)} row${ids.length === 1 ? "" : "s"}: ${ids.slice(0, 3).join(", ")}${ids.length > 3 ? ` + ${ids.length - 3} more` : ""}` : "No individual row IDs";
      return `<article class="workbench-finding request-finding">
        <span>${String(index + 1).padStart(2, "0")}</span>
        <div><p class="kicker">${escapeHtml(item.category || "Investigation")}</p><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.explanation)}</p><details><summary>Calculation and limitation</summary><p><strong>Calculation:</strong> ${escapeHtml(item.calculation)}</p><p><strong>Limitation:</strong> ${escapeHtml(item.limitations)}</p></details></div>
        <dl class="finding-meta">
          <div><dt>Affected requests</dt><dd>${escapeHtml(idCopy)}</dd></div>
          <div><dt>Potential amount</dt><dd>${requestReviewMoney(amount, currency)}</dd></div>
          <div><dt>Evidence · dollar confidence</dt><dd>${escapeHtml(item.evidence_basis)} · ${escapeHtml(item.confidence_in_dollar_estimate)}</dd></div>
          <div><dt>Overlap group</dt><dd>${escapeHtml(item.overlap_group || "None")}</dd></div>
        </dl>
        <div class="finding-action"><strong>${escapeHtml(item.action.replaceAll("_", " "))}</strong><p>${escapeHtml(item.verification_requirement)}</p></div>
      </article>`;
    }).join("") : '<p class="workbench-empty">No supported request-level finding was detected. That does not prove the workload is optimized; it means the imported fields did not trigger a deterministic rule.</p>';
    const fields = ["event_id", "timestamp", "provider", "model", "processing_mode", "inference_geography", "project", "team_owner", "feature", "customer", "product", "workload", "workflow", "session_id", "environment", "input_tokens", "output_tokens", "reasoning_tokens", "cached_input_tokens", "cache_write_tokens", "cache_storage_token_hours", "provider_reported_cost", "currency", "request_status", "retry_parent_event_id", "prefix_fingerprint", "tool_call_count", "outcome_status"];
    const coverage = fields.map((field) => {
      const supplied = review.events.filter((event) => event[field] !== null && event[field] !== undefined).length;
      return `<div><dt>${escapeHtml(field.replaceAll("_", " "))}</dt><dd>${wholeNumber(supplied)} of ${wholeNumber(review.event_count)}</dd></div>`;
    }).join("");
    document.getElementById("request-import-coverage").innerHTML = `<p><strong>Detected adapter:</strong> ${escapeHtml(review.source.adapter)}. AI Cost Lens accepts universal flat files plus flat OpenAI-compatible, Anthropic-compatible, OpenRouter, Langfuse, and Helicone field names; it does not send credentials or query those services.</p><dl>${coverage}</dl><p>Source SHA-256: ${escapeHtml(review.source.sha256 || "Unavailable in this browser")}. Prompt contents and unknown source fields were not copied. Automatic catalog pricing requires a timestamp inside the catalog validity window, matching USD currency, a supported processing mode or batch flag, cached-input tokens, and tool charges. Routes with separate cache-write or storage charges also require explicit write tokens, duration where applicable, and storage token-hours. Missing inputs leave the row unpriced. ${review.reconciliation.duplicate_rows_flagged ? `${wholeNumber(review.reconciliation.duplicate_rows_flagged)} rows share a repeated event ID and remain in the export with a duplicate-group flag. The duplicate-excluded total is a reconciliation reference only: AI Cost Lens does not delete, allocate, or presume any row is invalid.` : "No repeated provider/event-ID group was detected."}</p>`;
    result.hidden = false;
  }

  function initializeRequestLogAnalysis() {
  async function runRequestLogAnalysis(button, idleText, loadInput) {
    const error = document.getElementById("request-log-error");
    error.classList.remove("visible");
    try {
      if (!usageEventEngine) throw new Error("Request-level analysis is unavailable in this build.");
      button.disabled = true;
      button.textContent = "Analyzing…";
      const { text, filename, illustrative } = await loadInput();
      const rows = parseRequestLog(text, filename);
      const review = usageEventEngine.buildReview(rows, {
        catalog: globalThis.AI_COST_LENS_PRICING_CATALOG,
        source_name: illustrative ? "Illustrative request log bundled with AI Cost Lens" : filename,
        source_file_hash: await sha256(text),
        default_currency: document.getElementById("request-default-currency").value.trim() || null,
        billed_total: document.getElementById("request-billed-total").value.trim() || null,
        billed_currency: document.getElementById("request-billed-currency").value.trim() || null,
        bill_scope_confirmed: document.getElementById("request-bill-scope-confirmed").checked,
        period_complete_confirmed: document.getElementById("request-period-complete").checked,
        monthly_budget: document.getElementById("request-monthly-budget").value.trim() || null,
        budget_warning_threshold: document.getElementById("request-budget-warning").value.trim() === ""
          ? null
          : finiteNumber(document.getElementById("request-budget-warning").value, "Budget warning threshold") / 100,
        allocation_basis: document.getElementById("request-allocation-basis").value,
        allocation_warning_threshold: document.getElementById("request-allocation-warning").value.trim() === ""
          ? null
          : finiteNumber(document.getElementById("request-allocation-warning").value, "Allocation warning threshold") / 100,
        compute_cost: document.getElementById("request-compute-cost").value.trim() || null,
        retrieval_data_cost: document.getElementById("request-retrieval-data-cost").value.trim() || null,
        network_cost: document.getElementById("request-network-cost").value.trim() || null,
        tooling_cost: document.getElementById("request-tooling-cost").value.trim() || null,
        pipeline_cost: document.getElementById("request-pipeline-cost").value.trim() || null,
        human_review_cost: document.getElementById("request-human-review-cost").value.trim() || null,
      });
      state.usageReview = review;
      state.usageReviewIllustrative = illustrative;
      renderRequestAnalysis(review);
      document.getElementById("request-analysis-results").scrollIntoView({ behavior: "smooth", block: "start" });
      showToast(illustrative
        ? `${wholeNumber(review.event_count)} illustrative request records analyzed locally.`
        : `${wholeNumber(review.event_count)} request records analyzed locally. Nothing was uploaded.`);
    } catch (caught) {
      state.usageReview = null;
      state.usageReviewIllustrative = false;
      document.getElementById("request-analysis-results").hidden = true;
      error.textContent = caught instanceof TypeError || caught instanceof RangeError ? "The request log could not be analyzed. Check the flat file structure and numeric fields." : caught.message || "The request log could not be analyzed.";
      error.classList.add("visible");
    } finally {
      button.disabled = false;
      button.textContent = idleText;
    }
  }

  // A result belongs to the options used to calculate it, not subsequent edits.
  document.querySelectorAll(".request-review-panel input:not([type=file]), .request-review-panel select").forEach((input) => {
    if (input.id.startsWith("request-filter-")) return;
    input.addEventListener("input", () => {
      if (!state.usageReview) return;
      state.usageReview = null;
      state.usageReviewIllustrative = false;
      document.getElementById("request-analysis-results").hidden = true;
      showToast("Review inputs changed. Choose Analyze locally to update the results.");
    });
  });
  document.getElementById("request-log-file").addEventListener("change", (event) => {
    const [file] = event.target.files;
    document.getElementById("request-log-file-status").textContent = file
      ? `${file.name} selected. It will be read only when you choose Analyze locally.`
      : "Up to 20,000 flat rows or 5 MiB. Unknown fields, including prompt text, are not copied into the normalized record.";
    document.getElementById("request-analysis-results").hidden = true;
    document.getElementById("request-log-error").classList.remove("visible");
    state.usageReview = null;
    state.usageReviewIllustrative = false;
  });

  document.getElementById("analyze-request-log").addEventListener("click", async () => {
    const button = document.getElementById("analyze-request-log");
    await runRequestLogAnalysis(button, "Analyze locally", async () => {
      const [file] = document.getElementById("request-log-file").files;
      if (!file) throw new Error("Choose a request-log CSV or JSON file first.");
      const text = await readLocalFile(file);
      return { text, filename: file.name, illustrative: false };
    });
  });

  document.getElementById("try-illustrative-request-log").addEventListener("click", async () => {
    const button = document.getElementById("try-illustrative-request-log");
    await runRequestLogAnalysis(button, "Try illustrative data", async () => {
      const template = document.getElementById("illustrative-request-log-data");
      const text = template.content.textContent.trim();
      document.getElementById("request-log-file").value = "";
      document.getElementById("request-log-file-status").textContent = "Using the bundled illustrative request log. Choose a local file at any time to replace it.";
      return { text, filename: "illustrative-request-log.json", illustrative: true };
    });
  });

  document.getElementById("download-normalized-usage").addEventListener("click", () => {
    if (!state.usageReview || !usageEventEngine) return;
    const blob = new Blob([usageEventEngine.normalizedCsv(state.usageReview)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ai-cost-lens-normalized-usage.csv";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  document.getElementById("download-usage-review").addEventListener("click", () => {
    if (!state.usageReview) return;
    const blob = new Blob([`${JSON.stringify(state.usageReview, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ai-cost-lens-usage-review.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  requestFilterIds.forEach((id) => document.getElementById(id).addEventListener("change", renderRequestEventExplorer));
  document.getElementById("reset-request-filters").addEventListener("click", () => {
    requestFilterIds.forEach((id) => { document.getElementById(id).value = ""; });
    renderRequestEventExplorer();
  });
  }

  function scenarioModelOptions() {
    const catalog = globalThis.AI_COST_LENS_PRICING_CATALOG;
    if (!catalog) return "";
    const providers = new Map();
    catalog.models.forEach((model) => {
      if (!providers.has(model.provider)) providers.set(model.provider, []);
      providers.get(model.provider).push(model);
    });
    return [...providers.entries()].map(([provider, models]) => `<optgroup label="${escapeHtml(provider)}">${models.map((model) => `<option value="${escapeHtml(model.id)}">${escapeHtml(model.label)}</option>`).join("")}</optgroup>`).join("");
  }

  function syncScenarioRoute() {
    const route = document.getElementById("scenario-route").value === "proposed" ? state.data.proposed : state.data.baseline;
    const cache = route.measures?.cache_reuse_rate;
    document.getElementById("scenario-cache").value = cache === null || cache === undefined ? "0" : (cache * 100).toFixed(1);
  }

  function renderScenarioSetup() {
    const route = document.getElementById("scenario-route");
    const routeOptions = route.options ? [...route.options] : route.querySelectorAll("option");
    if (routeOptions[0]) routeOptions[0].textContent = state.data.baseline.label;
    if (routeOptions[1]) routeOptions[1].textContent = state.data.proposed.label;
    const model = document.getElementById("scenario-model");
    const modelOptions = model.options ? [...model.options] : model.querySelectorAll("option");
    if (!modelOptions.length) {
      model.innerHTML = scenarioModelOptions();
      if (model.options && [...model.options].some((option) => option.value === "openai/gpt-5.6-luna")) model.value = "openai/gpt-5.6-luna";
    }
    syncScenarioRoute();
    state.pendingScenario = null;
    document.getElementById("scenario-result").hidden = true;
    document.getElementById("scenario-error").classList.remove("visible");
  }

  function renderVerification() {
    const { baseline, proposed, comparison, workload } = state.data;
    const status = document.getElementById("verification-status");
    const basis = comparison.outcome_evidence_basis === "sampled" ? "Sampled" : comparison.evidence_complete ? "Complete" : "Needs evidence";
    const pricedAlternatives = state.data.pricing_estimate?.comparison?.filter((item) => item.role === "alternative") || [];
    const pricedCandidate = pricedAlternatives.find((item) => item.label === proposed.label)
      || [...pricedAlternatives].sort((left, right) => left.estimated_monthly_cost_usd - right.estimated_monthly_cost_usd)[0];
    const candidateLabel = state.pendingScenario?.proposed_model?.label || pricedCandidate?.label || proposed.label;
    const candidateBasis = state.pendingScenario
      ? "Modeled from observed shape · test first"
      : pricedCandidate
        ? `${pricedCandidate.pricing_basis === "user_supplied" ? "User-supplied rate" : "Official list-price"} estimate · test first`
        : "Route in the current decision record";
    status.innerHTML = `
      <article><span>Quality floor</span><strong>${pct(workload.accepted_quality_threshold, 1)}</strong></article>
      <article><span>Current → proposed yield</span><strong>${pct(baseline.measures.usable_result_rate, 1)} → ${pct(proposed.measures.usable_result_rate, 1)}</strong></article>
      <article><span>Verification status</span><strong>${escapeHtml(basis)} · ${comparison.quality_holds ? "floor met" : "below floor"}</strong></article>
      <article><span>Candidate to test</span><strong>${escapeHtml(candidateLabel)}</strong><p>${escapeHtml(candidateBasis)}</p></article>`;
  }

  function verificationOutcomeLabel(value) {
    if (value === "ready_to_use") return "Ready to use";
    if (value === "needs_correction") return "Needs correction";
    if (value === "needs_escalation") return "Needs escalation";
    return "Not supplied";
  }

  function renderPairedVerification(record) {
    const result = document.getElementById("paired-verification-result");
    const ready = (route) => route.ready_rate === null ? "Not supplied" : pct(route.ready_rate, 1);
    const interval = (route) => route.ready_rate_interval_95
      ? `${pct(route.ready_rate_interval_95[0], 1)}–${pct(route.ready_rate_interval_95[1], 1)} interval`
      : route.outcomes_complete ? "No interval · sample not declared random/systematic" : "Human outcomes incomplete";
    const humanDifference = record.comparison.human_minutes_difference;
    const statusLabels = {
      QUALITY_FAIL: "Quality failed",
      INCOMPLETE: "More evidence needed",
      DIRECTIONAL_PASS: "Directional pass",
      VERIFIED_PASS: "Verification passed",
    };
    document.getElementById("verification-result-summary").innerHTML = `
      <article><span>Decision</span><strong>${escapeHtml(statusLabels[record.comparison.status] || record.comparison.status)}</strong><small>${record.evidence_gate.decision.replaceAll("_", " ")}</small></article>
      <article><span>Deterministic checks</span><strong>${pct(record.baseline.deterministic_pass_rate, 1)} → ${pct(record.candidate.deterministic_pass_rate, 1)}</strong><small>${record.candidate.deterministic_cases_passed} of ${record.candidate.cases} candidate cases passed every rule</small></article>
      <article><span>Ready-result rate</span><strong>${ready(record.baseline)} → ${ready(record.candidate)}</strong><small>${escapeHtml(interval(record.candidate))}</small></article>
      <article><span>Human review time</span><strong>${humanDifference === null ? "Not supplied" : `${humanDifference > 0 ? "+" : humanDifference < 0 ? "−" : ""}${Math.abs(humanDifference).toFixed(1)} min`}</strong><small>Candidate minus baseline across the paired sample</small></article>`;
    const conclusions = {
      QUALITY_FAIL: "The candidate failed the declared quality rule on this paired sample. Keep the baseline for this route until the failed cases are corrected and retested.",
      INCOMPLETE: "The deterministic checks ran, but comparable human outcome labels are missing. This cannot establish that the candidate still produces usable work.",
      DIRECTIONAL_PASS: "The candidate cleared the declared gates in this sample. The method or sample size is still directional, so expand or strengthen the test before making a larger route decision.",
      VERIFIED_PASS: "The candidate cleared the declared deterministic and human-outcome gates on at least 30 blinded, randomized, randomly or systematically selected pairs. This supports the quality gate only; billed savings still require the finance review and post-change actuals.",
    };
    document.getElementById("verification-result-conclusion").textContent = conclusions[record.comparison.status] || record.evidence_gate.reason;
    const displayed = record.cases.slice(0, 100);
    document.getElementById("verification-case-rows").innerHTML = displayed.map((item) => {
      const checks = (route) => {
        const passed = route.checks.filter((check) => check.passed).length;
        const failed = route.checks.filter((check) => !check.passed).map((check) => check.label).join("; ");
        return `<span class="${route.passed ? "is-pass" : "is-fail"}"${failed ? ` title="${escapeHtml(failed)}"` : ""}>${passed}/${route.checks.length} ${route.passed ? "passed" : "passed · review"}</span>`;
      };
      return `<tr>
        <th>${escapeHtml(item.case_id)}</th>
        <td>${checks(item.baseline)}</td>
        <td>${checks(item.candidate)}</td>
        <td>${escapeHtml(verificationOutcomeLabel(item.baseline.outcome_status))}</td>
        <td>${escapeHtml(verificationOutcomeLabel(item.candidate.outcome_status))}</td>
      </tr>`;
    }).join("") + (record.cases.length > displayed.length ? `<tr><td colspan="5">Showing the first ${displayed.length} of ${record.cases.length} pairs. The downloaded record contains every result.</td></tr>` : "");
    const useButton = document.getElementById("send-verification-to-review");
    useButton.disabled = !record.baseline.outcomes_complete || !record.candidate.outcomes_complete;
    useButton.title = useButton.disabled ? "Add human outcome status to every baseline and candidate row first." : "Carry these outcome counts into the finance review.";
    result.hidden = false;
    result.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function verificationBuildOptions() {
    const percentValue = (id, label) => {
      const value = finiteNumber(document.getElementById(id).value, label);
      if (value > 100) throw new Error(`${label} cannot be greater than 100%.`);
      return value / 100;
    };
    return {
      sample_method: document.getElementById("verification-random-sample").checked ? "random_or_systematic" : "user_selected",
      blinded: document.getElementById("verification-blinded").checked,
      randomized_order: document.getElementById("verification-randomized-order").checked,
      minimum_deterministic_pass_rate: percentValue("verification-check-floor", "Minimum deterministic pass rate"),
      minimum_ready_rate: percentValue("verification-ready-floor", "Minimum ready-result rate"),
      maximum_ready_rate_regression: percentValue("verification-regression", "Maximum ready-rate regression"),
    };
  }

  function verificationRuleCopy(rule) {
    const parts = [`${rule.expected_format === "json" ? "Valid JSON" : "Non-empty text"}`];
    if (rule.required_terms.length) parts.push(`must contain: ${rule.required_terms.join(", ")}`);
    if (rule.forbidden_terms.length) parts.push(`must omit: ${rule.forbidden_terms.join(", ")}`);
    if (rule.required_json_fields.length) parts.push(`required JSON fields: ${rule.required_json_fields.join(", ")}`);
    if (rule.exact_label !== null) parts.push(`exact label: ${rule.exact_label}`);
    if (rule.max_characters !== null) parts.push(`maximum ${wholeNumber(rule.max_characters)} characters`);
    return parts.join(" · ");
  }

  function renderBlindReviewCase() {
    const session = state.verificationSession;
    const item = session?.cases[state.verificationCaseIndex];
    if (!session || !item) return;
    document.getElementById("verification-blind-progress").textContent = `PAIR ${state.verificationCaseIndex + 1} OF ${session.case_count} · CASE ${item.case_id}`;
    document.getElementById("verification-blind-rule").textContent = verificationRuleCopy(item.rule);
    document.getElementById("verification-blind-cards").innerHTML = item.presentations.map((presentation) => `<article class="blind-output-card">
      <strong id="blind-output-label-${presentation.slot}">Output ${presentation.slot}</strong>
      <pre role="region" tabindex="0" aria-labelledby="blind-output-label-${presentation.slot}">${escapeHtml(presentation.output_text)}</pre>
      <div class="blind-score-fields">
        <label><span>Human outcome · Output ${presentation.slot}</span><select id="blind-outcome-${presentation.slot}"><option value="">Choose one</option><option value="ready_to_use">Ready to use</option><option value="needs_correction">Needs correction</option><option value="needs_escalation">Needs escalation</option></select></label>
        <label><span>Review minutes · Output ${presentation.slot} · optional</span><input id="blind-minutes-${presentation.slot}" type="number" min="0" step="0.1" placeholder="Unknown" /></label>
      </div>
    </article>`).join("");
    document.getElementById("save-blind-case").textContent = state.verificationCaseIndex === session.case_count - 1 ? "Finish blind review" : "Save and continue";
    const workspace = document.getElementById("verification-blind-review");
    workspace.hidden = false;
    workspace.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function clearBlindReviewSession({ clearFile = false } = {}) {
    state.verificationSession = null;
    state.verificationScores = [];
    state.verificationCaseIndex = 0;
    state.verificationSessionSource = null;
    document.getElementById("verification-blind-cards").textContent = "";
    document.getElementById("verification-blind-rule").textContent = "";
    document.getElementById("verification-blind-review").hidden = true;
    if (clearFile) document.getElementById("verification-file").value = "";
  }

  function resetVerificationMethodDeclarations() {
    for (const id of ["verification-random-sample", "verification-blinded", "verification-randomized-order"]) {
      document.getElementById(id).checked = false;
    }
  }

  function prefillActuals() {
    const { baseline, proposed, workload, period } = state.data;
    const values = {
      "actuals-baseline-period": period.start || "",
      "actuals-post-period": period.end || "",
      "actuals-baseline-cost": baseline.costs.recurring_operating_cost,
      "actuals-post-cost": proposed.costs.recurring_operating_cost,
      "actuals-baseline-volume": baseline.outcomes.completed_results,
      "actuals-post-volume": proposed.outcomes.completed_results,
      "actuals-baseline-rate": round(baseline.measures.usable_result_rate * 100, 2),
      "actuals-post-rate": round(proposed.measures.usable_result_rate * 100, 2),
      "actuals-change-cost": proposed.costs.one_time_change_cost,
      "actuals-quality-floor": round(workload.accepted_quality_threshold * 100, 2),
    };
    Object.entries(values).forEach(([id, value]) => { document.getElementById(id).value = value ?? ""; });
    for (const id of ["actuals-quality-verified", "actuals-policy-approved", "actuals-provider-reported", "actuals-periods-comparable", "actuals-outcomes-complete"]) {
      document.getElementById(id).checked = false;
    }
    document.getElementById("actuals-implemented-at").value = "";
    document.getElementById("actuals-result").hidden = true;
    document.getElementById("actuals-error").classList.remove("visible");
    state.actualsLedger = null;
  }

  function renderSingleBill() {
    const review = summarizeSingleBill(state.data);
    const { totals, period } = review;
    const stage = singleBillStage(review);
    const guidance = singleBillGuidance(review);
    const count = (value) => value === null ? "Not supplied" : compact(value);
    const reported = (field) => reportedCoverageValue(totals, field);
    const coverageNote = (field, completeNote) => reportedCoverageNote(totals, field, completeNote);
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
            ["Requests", reported("requests"), coverageNote("requests", "Includes additional attempts when reported")],
            ["Blended cost per request", cost(costPerRequest), "Provider cost divided by supplied requests; not a model price"],
            ["Input tokens", reported("processedInput"), coverageNote("processedInput", `Cache read: ${reported("cachedInput")} · Cache write: ${reported("cacheWriteInput")}`)],
            ["Output tokens", reported("outputTokens"), coverageNote("outputTokens", "Unknown fields are not zero")],
            ["Cache-read share", cacheShare === null ? "Not supplied" : pct(cacheShare, 1), "Use only the cache fields reported by the source"],
            ["Outcome economics", "Optional", "Add results only when you need to test value or a route change"],
            ["Human effort", "Optional", "Add only when people actively review or correct the output"],
          ]
        : [
            [costBasisLabel(review.basis), cost(totals.providerCost), "The declared cost for this workload and period"],
            ["Requests", reported("requests"), coverageNote("requests", "Includes additional attempts when reported")],
            ["Ready results", count(review.ready), `${review.completed} outcome rows under the declared ready rule`],
            ["Provider cost per ready result", cost(review.providerUnit), "Excludes shared infrastructure and human effort"],
            ["Full operating cost per ready result", review.fullUnit === null ? "Optional" : cost(review.fullUnit), "Available only when relevant human and shared costs are supplied"],
            ["Retries", count(review.retries), "Optional; missing retry records do not block the unit cost"],
            ["Human minutes", count(review.minutes), "Optional; include only active review and correction time"],
            ["Cache-read share", cacheShare === null ? "Not supplied" : pct(cacheShare, 1), cacheShare === null && ["partial", "missing"].includes(totals.coverage.cachedInput.status) ? reportedCoverageNote(totals, "cachedInput", "Use only the cache fields reported by the source") : "Use only the cache fields reported by the source"],
          ];
    document.getElementById("bill-review-kicker").textContent = stage.kicker;
    document.getElementById("bill-review-title").textContent = stage.title;
    const sourceTitles = {
      invoice_form: "Your invoice details",
      claude_spend_report: "Your Claude Team or Enterprise spend report",
      claude_admin_api: "Your saved Claude Admin API reports",
    };
    document.getElementById("bill-source-title").textContent = sourceTitles[state.data.config.reviewSource] || "Your completed universal template";
    const grossNet = state.data.config.grossNet;
    document.getElementById("bill-source-copy").textContent = grossNet
      ? `Provider gross ${cost(grossNet.gross)}, reported net ${cost(grossNet.net)}, gross-to-net adjustment ${cost(grossNet.adjustment)}. The export does not identify that difference as a credit; reconcile credits, discounts, and taxes with the actual invoice. List-price estimates remain separate.`
      : "Start with the records you already have. Each additional layer deepens the review without replacing the bill.";
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
    document.getElementById("bill-model-rows").innerHTML = review.mix.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${escapeHtml(reportedCoverageValue(row, "requests"))}</td><td>${escapeHtml(reportedCoverageValue(row, "processedInput"))} / ${escapeHtml(reportedCoverageValue(row, "outputTokens"))}</td><td>${escapeHtml(reportedCoverageValue(row, "cachedInput"))} / ${escapeHtml(reportedCoverageValue(row, "cacheWriteInput"))}</td><td>${escapeHtml(costBasisLabel(review.basis))}</td><td>${cost(row.providerCost)}</td></tr>`).join("");
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

  function openAIFieldCoverage(usage, field) {
    return usage.field_coverage?.[field] || {
      supplied_rows: usage.totals[field] === null ? 0 : usage.populated_rows,
      total_rows: usage.populated_rows,
      status: usage.totals[field] === null ? "missing" : "complete",
    };
  }

  function openAIReportedValue(usage, field) {
    const coverage = openAIFieldCoverage(usage, field);
    if (coverage.status === "missing") return "Not supplied";
    const value = compact(usage.reported_subtotals?.[field] ?? usage.totals[field]);
    return coverage.status === "partial" ? `${value} reported` : value;
  }

  function openAICoverageNote(usage, field, completeNote) {
    const coverage = openAIFieldCoverage(usage, field);
    if (coverage.status === "partial") return `${coverage.supplied_rows} of ${coverage.total_rows} rows supplied this field; the full total is unavailable.`;
    if (coverage.status === "missing") return "No rows supplied this field; missing values were not treated as zero.";
    return completeNote;
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
    const serviceTiers = usage.by_service_tier || [];
    const completeValue = (field) => openAIFieldCoverage(usage, field).status === "complete" ? usage.totals[field] : null;
    const requests = completeValue("requests");
    const totalInput = completeValue("input_tokens");
    const cachedInput = completeValue("cached_input_tokens");
    const outputTokens = completeValue("output_tokens");
    const cacheShare = totalInput && cachedInput !== null ? cachedInput / totalInput : null;
    const costPerRequest = period.aligned && requests ? Number(bill.total) / requests : null;
    const averageInput = requests && totalInput !== null ? totalInput / requests : null;
    const averageOutput = requests && outputTokens !== null ? outputTokens / requests : null;
    const topModel = usage.by_model[0];
    const topRequestShare = topModel && requests ? topModel.requests / requests : null;
    const costPerRequestLabel = costPerRequest === null ? "Unavailable" : money(costPerRequest, costPerRequest < 1 ? 4 : 2);
    const topRequestShareLabel = topRequestShare === null ? "Unavailable" : pct(topRequestShare, 1);
    document.getElementById("bill-period-label").textContent = `${period.start} to ${period.end} · ${period.timezone}`;
    document.getElementById("bill-mode-tag").textContent = !period.aligned ? "PERIOD MISMATCH" : state.data.mode === "illustrative" ? "ILLUSTRATIVE COST AND USAGE" : "COST AND USAGE · NO SAVINGS CLAIM";
    document.getElementById("bill-finding-title").textContent =
      period.aligned
        ? costPerRequest === null
          ? openAIFieldCoverage(usage, "requests").status === "partial"
            ? `OpenAI reported ${money(Number(bill.total), Number(bill.total) < 1 ? 4 : 2)} for the exported period. ${openAIReportedValue(usage, "requests")} are visible, but the complete request total is unavailable.`
            : openAIFieldCoverage(usage, "requests").status === "missing"
              ? `OpenAI reported ${money(Number(bill.total), Number(bill.total) < 1 ? 4 : 2)} for the exported period. Request volume was not supplied.`
              : `OpenAI reported ${money(Number(bill.total), Number(bill.total) < 1 ? 4 : 2)} for the exported period. No requests were recorded, so blended cost per request is unavailable.`
          : `OpenAI reported ${money(Number(bill.total), Number(bill.total) < 1 ? 4 : 2)} across ${compact(requests)} requests, or ${costPerRequestLabel} per observed request.`
        : `OpenAI reported ${money(Number(bill.total), Number(bill.total) < 1 ? 4 : 2)} in the cost export. Usage covers different daily buckets; these totals are not a matched financial review.`;
    document.getElementById("bill-finding-limit").textContent = period.aligned ? `This is a useful cost and usage baseline. ${limitations[0]} Human effort is not required for this review.`
      : "PERIOD MISMATCH: usage and cost exports cover different daily buckets. Export the same date range again before using this review for a financial decision.";
    const metrics = [
      ["Provider reported cost", money(Number(bill.total), Number(bill.total) < 1 ? 4 : 2), `${bill.populated_rows} populated cost row${bill.populated_rows === 1 ? "" : "s"}`],
      ["Requests", openAIReportedValue(usage, "requests"), openAICoverageNote(usage, "requests", `${usage.by_model.length} model${usage.by_model.length === 1 ? "" : "s"} observed`)],
      ["Blended cost per request", costPerRequestLabel, costPerRequest === null ? "Available only when every usage row supplies requests and the total is greater than zero" : "Full exported cost divided by observed requests; not a model price"],
      ["Input tokens", openAIReportedValue(usage, "input_tokens"), openAICoverageNote(usage, "input_tokens", cacheShare === null ? "Cache share is unavailable" : `${pct(cacheShare, 1)} read from cache`)],
      ["Output tokens", openAIReportedValue(usage, "output_tokens"), openAICoverageNote(usage, "output_tokens", `${usage.days_with_usage} day${usage.days_with_usage === 1 ? "" : "s"} with usage`)],
      ["Processing tiers", serviceTiers.length ? compact(serviceTiers.length) : "Unavailable", serviceTiers.length ? serviceTiers.map((row) => row.service_tier).join(", ") : "This saved review predates processing-tier grouping or the export did not provide it"],
      ["Average input per request", averageInput === null ? "Unavailable" : compact(averageInput), "A prompt-size baseline for this exported period"],
      ["Average output per request", averageOutput === null ? "Unavailable" : compact(averageOutput), "An output-length baseline for this exported period"],
      ["Human effort", "Optional", "Add only when people actively review or correct the output"],
    ];
    document.getElementById("bill-metric-ledger").innerHTML = metrics.map(([label, value, note]) => `
      <div class="metric-cell"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></div>
    `).join("");
    document.getElementById("bill-model-rows").innerHTML = usage.by_model.map((row) => {
      const rowUsage = { totals: row, reported_subtotals: row.reported_subtotals, populated_rows: row.field_coverage?.input_tokens?.total_rows || 1, field_coverage: row.field_coverage };
      const rowInput = openAIFieldCoverage(rowUsage, "input_tokens").status === "complete" ? row.input_tokens : null;
      const rowCached = openAIFieldCoverage(rowUsage, "cached_input_tokens").status === "complete" ? row.cached_input_tokens : null;
      const share = rowInput && rowCached !== null ? rowCached / rowInput : null;
      return `<tr>
        <td>${escapeHtml(row.model)}</td>
        <td>${escapeHtml(openAIReportedValue(rowUsage, "requests"))}</td>
        <td>${escapeHtml(openAIReportedValue(rowUsage, "input_tokens"))}</td>
        <td>${escapeHtml(openAIReportedValue(rowUsage, "output_tokens"))}</td>
        <td>${share === null ? "Unavailable" : pct(share, 1)}</td>
        <td class="unavailable">Unavailable</td>
      </tr>`;
    }).join("");
    const requestCoverage = openAIFieldCoverage(usage, "requests");
    const requestStart = requestCoverage.status === "complete" && requests
      ? ["save", "START HERE", `Most requests went to ${topModel.model}`, topRequestShareLabel, `${topModel.model} handled ${compact(topModel.requests)} of ${compact(requests)} requests. Start with the busiest visible route before smaller ones.`]
      : ["test", "CHECK FIRST", "Complete the request count", openAIReportedValue(usage, "requests"), openAICoverageNote(usage, "requests", "No requests were recorded for this period; request-based metrics remain unavailable.")];
    const ledger = period.aligned ? [
      requestStart,
      ["test", "UNIT COST", costPerRequest === null ? "Request unit cost is unavailable" : "Use the blended request cost as a baseline", costPerRequestLabel, costPerRequest === null ? "The export has no nonzero request volume. Keep the unit cost unavailable rather than dividing by zero." : "This is the full exported cost divided by observed requests. Track it over time, but do not treat it as a billed model rate."],
      ["test", "CHECK NEXT", cacheShare ? "Cached input is already visible" : "Check whether repeated context can be cached", cacheShare === null ? "Unavailable" : pct(cacheShare, 1), cacheShare ? `${pct(cacheShare, 1)} of input tokens were read from cache. Confirm the provider's billed treatment before calling it a saving.` : cacheShare === null ? "Cache share needs complete input and cache-read coverage. Known partial values remain visible above." : "If this workload repeatedly sends the same long context, test provider-supported caching on one bounded job and compare the actual bill."],
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
        ? requestCoverage.status === "complete" ? `Start with ${topModel.model}, the busiest visible route in this export.` : "Complete the request coverage before using request volume to prioritize a route."
        : `Start with ${topModel.model}, the route handling ${topRequestShareLabel} of requests.`
      : "Export matching usage and cost periods before investigating optimization.";
    document.getElementById("bill-boundary-copy").textContent = period.aligned
      ? `${usage.by_model.length} model route${usage.by_model.length === 1 ? "" : "s"}, ${usage.by_project.length} project record${usage.by_project.length === 1 ? "" : "s"}, and ${serviceTiers.length} processing tier${serviceTiers.length === 1 ? "" : "s"} are visible. Check prompt size, output length, caching, tier mix, and whether a smaller model meets quality on one repeatable job. Human review is optional; add outcomes only when you need to test value or savings.`
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
      const completeValue = (field) => openAIFieldCoverage(usage, field).status === "complete" ? usage.totals[field] : null;
      const requests = completeValue("requests");
      const costPerRequest = period.aligned && requests ? total / requests : null;
      const costPerRequestLabel = costPerRequest === null ? "Unavailable" : money(costPerRequest, costPerRequest < 1 ? 4 : 2);
      const inputTokens = completeValue("input_tokens");
      const outputTokens = completeValue("output_tokens");
      const cachedInput = completeValue("cached_input_tokens");
      const averageInput = requests && inputTokens !== null ? inputTokens / requests : null;
      const averageOutput = requests && outputTokens !== null ? outputTokens / requests : null;
      const cacheShare = inputTokens && cachedInput !== null ? cachedInput / inputTokens : null;
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
        ["Requests", openAIReportedValue(usage, "requests"), openAICoverageNote(usage, "requests", "Observed request volume")],
        ["Blended cost per request", costPerRequestLabel, costPerRequest === null ? "Unavailable until request coverage is complete and greater than zero" : "Full exported cost divided by observed requests; not a billed model rate"],
        ["Input tokens", openAIReportedValue(usage, "input_tokens"), openAICoverageNote(usage, "input_tokens", "Observed input usage, including cached input")],
        ["Output tokens", openAIReportedValue(usage, "output_tokens"), openAICoverageNote(usage, "output_tokens", "Observed output usage")],
        ["Average input per request", averageInput === null ? "Unavailable" : compact(averageInput), "Prompt-size baseline for the exported period"],
        ["Average output per request", averageOutput === null ? "Unavailable" : compact(averageOutput), "Output-length baseline for the exported period"],
        ["Cache-read share", cacheShare === null ? "Unavailable" : pct(cacheShare, 1), cacheShare === null ? "Requires complete input and cache-read coverage" : "Share of input tokens read from cache"],
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
            ? openAIFieldCoverage(usage, "requests").status === "complete" ? `Start with ${topModel.model}, the busiest visible route, and test one bounded change.` : "Complete request coverage before using request volume to prioritize a route."
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
      ? "Use one bounded workload from your own records before relying on the conclusion."
      : proposedIsLower && !comparison.savings_claim_allowed
        ? "Repeat the same workload with complete cost and outcome evidence before approving the change."
        : proposedIsLower
          ? "Document the approval and monitor the same cost and quality measures after the change."
          : "Keep the current route. Test whether the proposed route can improve ready results or reduce human correction before changing the default.";
    document.getElementById("memo-next-step").textContent = nextStep;
    document.getElementById("memo-footer-status").textContent = mode === "illustrative"
      ? "Conclusion bounded to the supplied inputs"
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
    const mobileNav = document.querySelector(".mobile-section-picker");
    reviewNav.hidden = isBill;
    mobileNav.hidden = isBill;
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
    const simpleViews = new Set(["review", "opportunities", "verify", "evidence"]);
    const availableViews = state.data.experience === "simple"
      ? simpleViews
      : new Set([...document.querySelectorAll(".nav-item")].map((item) => item.dataset.view));
    reviewNav.querySelectorAll("button").forEach((button) => {
      button.hidden = !availableViews.has(button.dataset.view);
    });
    document.getElementById("mobile-section-nav").querySelectorAll("option").forEach((option) => {
      option.hidden = !availableViews.has(option.value);
      option.disabled = !availableViews.has(option.value);
    });
    if (!availableViews.has(state.view)) state.view = "review";
    document.getElementById("story-toggle").hidden = false;
    renderReview();
    renderAnatomy();
    renderOpportunities();
    renderScenarioSetup();
    renderVerification();
    renderEvidence();
    prefillActuals();
    renderDecisionConsistency();
    setView(state.view);
  }

  function decisionFor(data) {
    const { baseline, proposed, comparison } = data;
    const a = baseline.measures.cost_per_usable_result;
    const b = proposed.measures.cost_per_usable_result;
    const delta = b - a;
    let code, reason;
    let posture;
    if (!comparison.both_policy_approved) {
      code = "CHECK APPROVAL";
      posture = "INSUFFICIENT EVIDENCE";
      reason = "Policy approval for both options has not been established. Resolve approval before testing or switching.";
    } else if (!comparison.quality_holds) {
      code = "QUALITY BELOW MINIMUM";
      posture = "STOP CHANGE";
      reason = "The other option does not meet your minimum usable-result rate. A lower cost does not override that requirement.";
    } else if (comparison.human_cost_included === false) {
      code = "ADD MISSING TIME";
      posture = "INSUFFICIENT EVIDENCE";
      reason = "Review and fixing time is missing. Add it before deciding which option costs less overall.";
    } else if (Math.abs(delta) < 0.000001) {
      code = "NO COST ADVANTAGE";
      posture = "STOP CHANGE";
      reason = "The options have the same cost per qualifying result at the precision shown. This comparison establishes no cost advantage.";
    } else if (delta > 0) {
      code = "KEEP CURRENT ROUTE";
      posture = "STOP CHANGE";
      reason = "The other option costs more per qualifying result on the inputs supplied. This comparison does not support switching to save money.";
    } else {
      code = comparison.savings_claim_allowed ? "SAVE NOW" : "TEST FIRST";
      posture = comparison.savings_claim_allowed ? "FUND CHANGE" : "FIX EVIDENCE";
      reason = comparison.savings_claim_allowed ? "The supplied evidence supports a lower cost per qualifying result for this workload and period." : "The other option costs less per qualifying result in this estimate. Repeat the comparison before treating the difference as savings.";
    }
    if (data.experience !== "simple" && !comparison.savings_claim_allowed) {
      const gates = failedSavingsGateText(comparison, baseline, proposed);
      reason += ` ${sentenceCase(gates)} still ${/,| and /.test(gates) ? "block" : "blocks"} a savings claim.`;
    }
    return { code, posture, reason, delta, percent: a > 0 ? delta / a * 100 : null };
  }

  function renderDecisionConsistency() {
    if ([singleBillSchema, "ai-cost-lens-openai-bill-review/0.1"].includes(state.data?.schema_version)) return;
    const decision = decisionFor(state.data);
    state.data.comparison.finance_posture = decision.posture;
    for (const id of ["decision-code", "memo-decision-code"]) document.getElementById(id).textContent = decision.code;
    document.getElementById("finance-posture").textContent = `Finance recommendation: ${decision.posture}`;
    for (const id of ["decision-title", "memo-decision-title", "memo-next-step", "lumen-panel-copy"]) document.getElementById(id).textContent = decision.reason;
    document.getElementById("lumen-panel-title").textContent = sentenceCase(decision.code.toLowerCase());
    const decisionHeading = document.querySelector(".decision-table-heading strong");
    if (decisionHeading) decisionHeading.textContent = sentenceCase(decision.code.toLowerCase());
    const changeCell = document.querySelector(".decision-row td:nth-child(4)");
    if (changeCell) changeCell.textContent = decision.percent === null ? "Not comparable from zero" : Math.abs(decision.delta) < 0.000001 ? "No change" : `${decision.percent > 0 ? "↑" : "↓"} ${Math.abs(decision.percent).toFixed(1)}%`;
    if (state.data.mode !== "illustrative") {
      document.getElementById("finding-title").textContent = decision.reason;
      document.getElementById("finding-limit").textContent = state.data.comparison.limitation;
    }
    if (state.data.experience === "simple") {
      document.getElementById("period-label").textContent = "Monthly scenario · billing dates not supplied";
      document.getElementById("memo-meta").textContent = "Monthly scenario · billing dates not supplied";
      document.getElementById("finding-title").textContent = decision.reason;
      document.getElementById("finding-limit").textContent = state.data.comparison.limitation;
      document.getElementById("lumen-signals").innerHTML = `<div><span>Current cost per qualifying result</span><strong>${escapeHtml(unitMoney(state.data.baseline.measures.cost_per_usable_result))}</strong></div><div><span>Other option</span><strong>${escapeHtml(unitMoney(state.data.proposed.measures.cost_per_usable_result))}</strong></div>`;
    }
  }

  function setView(view) {
    if ([singleBillSchema, "ai-cost-lens-openai-bill-review/0.1"].includes(state.data?.schema_version)) return;
    const target = [...document.querySelectorAll(".nav-item")].find((item) => item.dataset.view === view && !item.hidden);
    if (!target) return;
    state.view = view;
    document.getElementById("mobile-section-nav").value = view;
    document.querySelectorAll(".nav-item").forEach((item) => {
      item.classList.toggle("active", item.dataset.view === view);
      item.setAttribute("aria-current", item.dataset.view === view ? "page" : "false");
    });
    document.querySelectorAll(".view").forEach((section) => {
      section.classList.toggle("active", section.id === `view-${view}`);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  document.getElementById("mobile-section-nav").addEventListener("change", (event) => setView(event.currentTarget.value));

  function showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.add("visible");
    window.setTimeout(() => toast.classList.remove("visible"), 2600);
  }

  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", () => setView(item.dataset.view));
  });

  initializeRequestLogAnalysis();

  document.getElementById("scenario-route").addEventListener("change", syncScenarioRoute);

  document.getElementById("scenario-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const error = document.getElementById("scenario-error");
    error.classList.remove("visible");
    try {
      if (!scenarioEngine || !globalThis.AI_COST_LENS_PRICING_CATALOG) throw new Error("The scenario engine is unavailable in this build.");
      const percent = (id, label) => {
        const value = finiteNumber(document.getElementById(id).value, label);
        if (value > 100) throw new Error(`${label} cannot be greater than 100%.`);
        return value / 100;
      };
      state.pendingScenario = scenarioEngine.simulateRoute(state.data, globalThis.AI_COST_LENS_PRICING_CATALOG, {
        route: document.getElementById("scenario-route").value,
        model_id: document.getElementById("scenario-model").value,
        cached_input_share: percent("scenario-cache", "Cached-input share"),
        output_reduction: percent("scenario-output", "Output reduction"),
        retry_reduction: percent("scenario-retries", "Retry reduction"),
        batch: document.getElementById("scenario-batch").checked,
      });
      const result = state.pendingScenario;
      document.getElementById("scenario-result-title").textContent = `${result.source_label} repriced with ${result.proposed_model.label}`;
      document.getElementById("scenario-current-cost").textContent = money(result.economics.current_provider_cost_usd, 2);
      document.getElementById("scenario-modeled-cost").textContent = money(result.economics.estimated_provider_cost_usd, result.economics.estimated_provider_cost_usd < 1 ? 4 : 2);
      document.getElementById("scenario-difference").textContent = signedMoney(result.economics.estimated_difference_usd);
      const assumptions = [
        `Observed request and token shape from ${result.source_label}.`,
        `${(result.assumptions.cached_input_share * 100).toFixed(1)}% cached input and ${result.assumptions.batch ? "published batch" : "standard"} list pricing.`,
        result.pricing.adjustment === "long_context" ? "Published long-context rate multipliers apply to the average request shape." : "The average request shape stays below any published long-context pricing threshold.",
        `${(result.assumptions.output_reduction * 100).toFixed(1)}% output reduction and ${(result.assumptions.retry_reduction * 100).toFixed(1)}% retry reduction.`,
        result.economics.non_provider_cost_held_constant_usd === null
          ? "Non-provider operating cost was unavailable and is excluded from the scenario."
          : `${money(result.economics.non_provider_cost_held_constant_usd, 2)} of non-provider operating cost is held constant; the verification setup carries the full modeled recurring cost forward.`,
        result.evidence_gate.context_check,
        "Model behavior, output quality, latency, tool compatibility, and provider-billed cost are not verified.",
        result.evidence_gate.reason,
      ];
      document.getElementById("scenario-assumption-list").innerHTML = assumptions.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
      document.getElementById("scenario-result").hidden = false;
      document.getElementById("scenario-result").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (caught) {
      state.pendingScenario = null;
      error.textContent = caught.message || "The scenario could not be calculated.";
      error.classList.add("visible");
    }
  });

  document.getElementById("send-scenario-to-verify").addEventListener("click", () => {
    if (!state.pendingScenario) return;
    renderVerification();
    setView("verify");
    showToast("Scenario saved for this session. Verify it with the same tasks and quality rule.");
  });

  document.getElementById("open-verification-builder").addEventListener("click", () => {
    const sourceData = state.data;
    const scenario = state.pendingScenario;
    const pricedAlternatives = sourceData.pricing_estimate?.comparison?.filter((item) => item.role === "alternative") || [];
    const pricedCandidate = pricedAlternatives.find((item) => item.label === sourceData.proposed.label)
      || [...pricedAlternatives].sort((left, right) => left.estimated_monthly_cost_usd - right.estimated_monthly_cost_usd)[0];
    resetBuilderStart();
    reviewDialog.showModal();
    activateBuilderMode("simple");
    document.getElementById("simple-current-name").value = scenario?.source_label || sourceData.baseline.label;
    document.getElementById("simple-other-name").value = scenario?.proposed_model?.label || pricedCandidate?.label || sourceData.proposed.label;
    document.getElementById("simple-current-cost").value = scenario?.economics.current_recurring_operating_cost_usd ?? sourceData.baseline.costs.recurring_operating_cost;
    document.getElementById("simple-other-cost").value = scenario?.economics.estimated_recurring_operating_cost_usd ?? sourceData.proposed.costs.recurring_operating_cost;
    document.getElementById("simple-monthly-tasks").value = scenario
      ? (scenario.source_route === "proposed" ? sourceData.proposed : sourceData.baseline).outcomes.completed_results
      : sourceData.baseline.outcomes.completed_results;
    for (const id of ["simple-current-checked", "simple-current-usable", "simple-current-minutes", "simple-other-checked", "simple-other-usable", "simple-other-minutes"]) {
      document.getElementById(id).value = "";
    }
    document.getElementById("simple-hourly-rate").value = "0";
    document.getElementById("review-dialog-title").textContent = "Verify the same tasks on both routes";
    document.getElementById("builder-action-note").textContent = "Use the same task type and acceptance rule. A small sample remains test evidence, not realized savings.";
  });

  document.getElementById("verification-file").addEventListener("change", (event) => {
    const [file] = event.target.files;
    clearBlindReviewSession();
    resetVerificationMethodDeclarations();
    state.verificationRecord = null;
    document.getElementById("paired-verification-result").hidden = true;
    document.getElementById("verification-error").classList.remove("visible");
    document.getElementById("verification-file-status").textContent = file
      ? `${file.name} selected · ${Math.max(1, Math.ceil(file.size / 1024)).toLocaleString("en-US")} KiB · not uploaded`
      : "The file is read only in this browser. Raw output text is discarded from the saved verification record.";
  });

  document.getElementById("start-blind-verification").addEventListener("click", async () => {
    const error = document.getElementById("verification-error");
    const button = document.getElementById("start-blind-verification");
    error.classList.remove("visible");
    button.disabled = true;
    button.textContent = "Preparing…";
    try {
      if (!verificationEngine) throw new Error("The verification engine is unavailable in this build.");
      if (!globalThis.crypto?.getRandomValues) throw new Error("This browser cannot provide local randomization for a blind review.");
      const [file] = document.getElementById("verification-file").files;
      if (!file) throw new Error("Choose a paired verification CSV first.");
      const text = await readLocalFile(file);
      const rows = parseCsv(text, "Paired verification CSV", { preserveColumns: verificationEngine.aliases.output_text });
      const randomBuffer = new Uint32Array(Math.ceil(rows.length / 2));
      globalThis.crypto.getRandomValues(randomBuffer);
      const randomValues = Array.from(randomBuffer, (value) => value / 4294967296);
      state.verificationSession = verificationEngine.prepareBlindReview(rows, { random_values: randomValues });
      state.verificationSessionSource = { source_name: file.name, source_file_hash: await sha256(text) };
      state.verificationScores = [];
      state.verificationCaseIndex = 0;
      state.verificationRecord = null;
      document.getElementById("paired-verification-result").hidden = true;
      document.getElementById("verification-blinded").checked = true;
      document.getElementById("verification-randomized-order").checked = true;
      renderBlindReviewCase();
      showToast(`${wholeNumber(state.verificationSession.case_count)} pairs randomized locally. Route names are hidden.`);
    } catch (caught) {
      clearBlindReviewSession();
      error.textContent = caught instanceof TypeError || caught instanceof RangeError
        ? "The blind review could not be prepared. Check the CSV structure and paired rows."
        : caught.message || "The blind review could not be prepared.";
      error.classList.add("visible");
    } finally {
      button.disabled = false;
      button.textContent = "Start blind review";
    }
  });

  document.getElementById("cancel-blind-review").addEventListener("click", () => {
    clearBlindReviewSession({ clearFile: true });
    resetVerificationMethodDeclarations();
    state.verificationRecord = null;
    document.getElementById("paired-verification-result").hidden = true;
    document.getElementById("verification-file-status").textContent = "Blind review cleared. Choose the file again to restart; nothing was uploaded.";
    showToast("Blind-review outputs cleared from this page.");
  });

  document.getElementById("save-blind-case").addEventListener("click", () => {
    const error = document.getElementById("verification-error");
    error.classList.remove("visible");
    try {
      const session = state.verificationSession;
      const item = session?.cases[state.verificationCaseIndex];
      if (!session || !item) throw new Error("Start a blind review first.");
      const scores = item.presentations.map((presentation) => {
        const outcome = document.getElementById(`blind-outcome-${presentation.slot}`).value;
        if (!outcome) throw new Error(`Choose a human outcome for output ${presentation.slot}.`);
        const minutes = document.getElementById(`blind-minutes-${presentation.slot}`).value.trim();
        return { case_id: item.case_id, slot: presentation.slot, outcome_status: outcome, human_minutes: minutes || null };
      });
      const accumulatedScores = state.verificationScores.filter((score) => score.case_id !== item.case_id);
      const completedScores = [...accumulatedScores, ...scores];
      if (state.verificationCaseIndex < session.case_count - 1) {
        state.verificationScores = completedScores;
        state.verificationCaseIndex += 1;
        renderBlindReviewCase();
        return;
      }
      state.verificationRecord = verificationEngine.completeBlindReview(
        session,
        completedScores,
        { ...verificationBuildOptions(), ...state.verificationSessionSource },
      );
      clearBlindReviewSession({ clearFile: true });
      document.getElementById("verification-file-status").textContent = "Blind review complete. Raw outputs were cleared and are not in the verification record.";
      renderPairedVerification(state.verificationRecord);
      showToast("Blind review complete. The saved record contains checks and outcomes, not raw outputs.");
    } catch (caught) {
      error.textContent = caught instanceof TypeError || caught instanceof RangeError
        ? "This pair could not be scored. Check both outcomes and any review-minute values."
        : caught.message || "This pair could not be scored.";
      error.classList.add("visible");
    }
  });

  document.getElementById("run-paired-verification").addEventListener("click", async () => {
    const error = document.getElementById("verification-error");
    const button = document.getElementById("run-paired-verification");
    error.classList.remove("visible");
    button.disabled = true;
    button.textContent = "Checking pairs…";
    try {
      if (!verificationEngine) throw new Error("The verification engine is unavailable in this build.");
      const [file] = document.getElementById("verification-file").files;
      if (!file) throw new Error("Choose a paired verification CSV first.");
      const text = await readLocalFile(file);
      const rows = parseCsv(text, "Paired verification CSV", { preserveColumns: verificationEngine.aliases.output_text });
      clearBlindReviewSession();
      state.verificationRecord = verificationEngine.buildVerification(rows, {
        source_name: file.name,
        source_file_hash: await sha256(text),
        ...verificationBuildOptions(),
      });
      renderPairedVerification(state.verificationRecord);
    } catch (caught) {
      state.verificationRecord = null;
      document.getElementById("paired-verification-result").hidden = true;
      error.textContent = caught instanceof TypeError || caught instanceof RangeError
        ? "The paired verification could not be built. Check the CSV structure and numeric values."
        : caught.message || "The paired verification could not be built.";
      error.classList.add("visible");
    } finally {
      button.disabled = false;
      button.textContent = "Check supplied scores";
    }
  });

  document.getElementById("download-verification").addEventListener("click", () => {
    if (!state.verificationRecord) return;
    const blob = new Blob([JSON.stringify(state.verificationRecord, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ai-cost-lens-verification-record.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  document.getElementById("send-verification-to-review").addEventListener("click", () => {
    const record = state.verificationRecord;
    if (!record || !record.baseline.outcomes_complete || !record.candidate.outcomes_complete) return;
    resetBuilderStart();
    state.pendingVerification = cloneData(record);
    reviewDialog.showModal();
    activateBuilderMode("workload");
    const fill = (prefix, summary) => {
      document.getElementById(`${prefix}-population`).value = "";
      document.getElementById(`${prefix}-ready`).value = summary.outcome_counts.ready_to_use;
      document.getElementById(`${prefix}-correction`).value = summary.outcome_counts.needs_correction;
      document.getElementById(`${prefix}-escalation`).value = summary.outcome_counts.needs_escalation;
      document.getElementById(`${prefix}-human-minutes`).value = summary.human_minutes === null ? "" : summary.human_minutes;
    };
    fill("baseline", record.baseline);
    fill("proposed", record.candidate);
    document.getElementById("sample-random").checked = record.method.sample_method === "random_or_systematic";
    document.getElementById("quality-floor").value = round(record.thresholds.minimum_ready_rate * 100, 2);
    document.getElementById("acceptance-rule").value = "The paired deterministic rules and human outcome definition recorded in the local verification record";
    document.getElementById("verifier").value = record.method.blinded ? "Blinded paired human review" : "Paired human review";
    document.getElementById("review-dialog-title").textContent = "Connect verified outcomes to the finance evidence";
    document.getElementById("builder-action-note").textContent = "Outcome counts are loaded. Add the full-period result counts and matching spend evidence; verification alone cannot produce a savings claim.";
  });

  document.getElementById("actuals-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const error = document.getElementById("actuals-error");
    error.classList.remove("visible");
    try {
      if (!actualsEngine) throw new Error("The actuals engine is unavailable in this build.");
      const value = (id, label) => finiteNumber(document.getElementById(id).value, label);
      const baselinePeriod = document.getElementById("actuals-baseline-period").value.trim();
      const actualPeriod = document.getElementById("actuals-post-period").value.trim();
      if (!baselinePeriod || !actualPeriod) throw new Error("Give both periods a clear label.");
      state.actualsLedger = actualsEngine.buildLedger({
        source_mode: state.data.mode,
        currency: state.data.currency,
        baseline_period: baselinePeriod,
        actual_period: actualPeriod,
        baseline_cost: value("actuals-baseline-cost", "Baseline cost"),
        actual_cost: value("actuals-post-cost", "Post-change cost"),
        baseline_volume: value("actuals-baseline-volume", "Baseline completed results"),
        actual_volume: value("actuals-post-volume", "Post-change completed results"),
        baseline_usable_rate: value("actuals-baseline-rate", "Baseline usable rate") / 100,
        actual_usable_rate: value("actuals-post-rate", "Post-change usable rate") / 100,
        implementation_cost: value("actuals-change-cost", "Implementation cost"),
        quality_floor: value("actuals-quality-floor", "Quality floor") / 100,
        implemented_at: document.getElementById("actuals-implemented-at").value,
        quality_verified: document.getElementById("actuals-quality-verified").checked,
        policy_approved: document.getElementById("actuals-policy-approved").checked,
        provider_reported: document.getElementById("actuals-provider-reported").checked,
        periods_comparable: document.getElementById("actuals-periods-comparable").checked,
        outcomes_complete: document.getElementById("actuals-outcomes-complete").checked,
      });
      const ledger = state.actualsLedger;
      document.getElementById("actuals-status").textContent = ledger.status.replaceAll("_", " ");
      document.getElementById("savings-stages").innerHTML = ledger.stages.map((stage) => `<div class="savings-stage ${stage.complete ? "complete" : ""}">${escapeHtml(stage.stage)}</div>`).join("");
      const waterfall = [
        ["Normalized baseline", ledger.waterfall.normalized_baseline_cost],
        ["Actual billed cost", -ledger.waterfall.less_actual_billed_cost],
        ["Billed difference", ledger.waterfall.billed_difference],
        ["Implementation cost", -ledger.waterfall.less_implementation_cost],
        ["Net difference", ledger.waterfall.realized_net_difference],
      ];
      document.getElementById("savings-waterfall").innerHTML = waterfall.map(([label, amount]) => `<article><span>${escapeHtml(label)}</span><strong>${signedMoney(amount)}</strong></article>`).join("");
      document.getElementById("actuals-conclusion").textContent = ledger.gates.realized_savings_claim_allowed
        ? `The post-change bill and outcome-adjusted economics support ${money(ledger.waterfall.realized_net_difference)} in realized net savings for the declared periods.`
        : `The arithmetic shows ${signedMoney(ledger.waterfall.realized_net_difference)}, but one or more evidence gates remain open. Keep the result in ${ledger.status.replaceAll("_", " ").toLowerCase()} status.`;
      document.getElementById("actuals-result").hidden = false;
      document.getElementById("actuals-result").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (caught) {
      state.actualsLedger = null;
      error.textContent = caught.message || "The actuals could not be reconciled.";
      error.classList.add("visible");
    }
  });

  document.getElementById("download-actuals").addEventListener("click", () => {
    if (!state.actualsLedger) return;
    const blob = new Blob([`${JSON.stringify(state.actualsLedger, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ai-cost-lens-realized-savings-ledger.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  document.getElementById("story-toggle").addEventListener("click", (event) => {
    state.story = !state.story;
    document.body.classList.toggle("story-mode", state.story);
    event.currentTarget.textContent = state.story ? "Full review" : "Presentation view";
    if (state.story) setView("review");
    showToast(state.story ? "Presentation view on. Interface controls are hidden." : "Full review restored.");
  });

  const headerMenuToggle = document.getElementById("header-menu-toggle");
  const headerActions = document.getElementById("header-actions");
  headerMenuToggle.addEventListener("click", () => {
    const open = !headerActions.classList.contains("open");
    headerActions.classList.toggle("open", open);
    headerMenuToggle.setAttribute("aria-expanded", String(open));
    headerMenuToggle.textContent = open ? "Close" : "Menu";
  });
  headerActions.addEventListener("click", (event) => {
    if (!event.target.closest("button, label")) return;
    headerActions.classList.remove("open");
    headerMenuToggle.setAttribute("aria-expanded", "false");
    headerMenuToggle.textContent = "Menu";
  });

  const reviewDialog = document.getElementById("review-dialog");
  const builderForm = document.getElementById("review-builder");
  const filenameDefaults = new Map(
    ["spend-file-name", "work-file-name", "openai-usage-file-name", "openai-cost-file-name", "claude-spend-file-name", "claude-usage-file-name", "claude-cost-file-name"]
      .map((id) => [id, document.getElementById(id).textContent]),
  );

  function syncBuilderControls() {
    for (const mode of ["single", "workload", "openai", "simple"]) {
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
    state.priceEstimate = null;
    state.pendingVerification = null;
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
    document.querySelectorAll("[data-outcome-mode]").forEach((item) => {
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
    document.getElementById("simple-builder-fields").hidden = true;
    document.getElementById("builder-actions").hidden = true;
    document.getElementById("builder-path-help").hidden = false;
    document.getElementById("review-dialog-title").textContent = "What would you like to check?";
    syncBuilderControls();
  }

  function activateBuilderMode(mode, button = null) {
    state.builderMode = mode;
    if (mode === "price") {
      state.builderMode = null;
      reviewDialog.close();
      document.getElementById("price-prompt").click();
      return;
    }
    if (mode === "usage") {
      state.builderMode = null;
      state.view = "opportunities";
      state.story = false;
      document.body.classList.remove("story-mode");
      document.getElementById("story-toggle").textContent = "Presentation view";
      const navigation = document.querySelector(".question-nav");
      navigation.hidden = false;
      navigation.setAttribute("aria-hidden", "false");
      navigation.querySelectorAll("button").forEach((item) => { item.disabled = false; item.tabIndex = 0; item.hidden = false; });
      document.getElementById("bill-review-screen").classList.remove("active");
      reviewDialog.close();
      setView("opportunities");
      const requestPanel = document.querySelector(".request-review-panel");
      requestPanel.scrollIntoView({ behavior: "smooth", block: "start" });
      document.getElementById("request-log-file").focus();
      showToast("Usage review ready. Your file will stay in this browser.");
      return;
    }
    if (mode === "example") {
      if (!state.demoData) { showToast("The worked example is still loading. Try again in a moment."); return; }
      state.data = cloneData(state.demoData);
      state.view = "review";
      state.story = false;
      document.body.classList.remove("story-mode");
      document.getElementById("story-toggle").textContent = "Presentation view";
      renderAll(); setView("review"); reviewDialog.close(); showToast("Worked example open. No files needed."); return;
    }
    document.querySelectorAll(".builder-mode").forEach((item) => {
      const active = button ? item === button : item.dataset.builderMode === mode;
      item.classList.toggle("active", active); item.setAttribute("aria-pressed", String(active));
    });
    const isOpenAI = mode === "openai";
    const isSingle = mode === "single";
    const isSimple = mode === "simple";
    document.getElementById("simple-builder-fields").hidden = !isSimple;
    document.getElementById("single-builder-fields").hidden = !isSingle;
    document.getElementById("workload-builder-fields").hidden = isOpenAI || isSingle || isSimple;
    document.getElementById("openai-builder-fields").hidden = !isOpenAI;
    document.getElementById("builder-actions").hidden = false;
    document.getElementById("builder-path-help").hidden = true;
    document.getElementById("review-dialog-title").textContent = isSingle ? "Start with the records you already have." : isOpenAI ? "See what is driving the provider bill." : "Test whether the proposed change is actually cheaper.";
    document.getElementById("builder-action-note").textContent = isSingle ? "Cost is enough to start. Usage and outcomes deepen the review when available; human effort and retries are optional." : isOpenAI ? "The result will show a useful cost and usage baseline without requiring outcome or human-review data." : state.outcomeMode === "sample" ? "The quick path produces a sampled estimate. It never becomes booked savings." : "Use the detailed log when you have one row per completed result.";
    document.getElementById("build-review").textContent = isSingle ? "Understand this bill" : isOpenAI ? "Review the provider export" : "Build the finance review";
    document.getElementById("builder-error").classList.remove("visible");
    if (isSimple) {
      document.getElementById("review-dialog-title").textContent = "Compare two AI tools or plans";
      document.getElementById("builder-action-note").textContent = "A monthly estimate including the value of your time. No files needed.";
      document.getElementById("build-review").textContent = "Compare my options";
    }
    syncBuilderControls();
  }

  document.getElementById("open-review").addEventListener("click", () => document.getElementById("review-file").click());

  document.getElementById("review-usage").addEventListener("click", () => activateBuilderMode("usage"));

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

  document.getElementById("simple-change-path").addEventListener("click", resetBuilderStart);

  const pricePromptDialog = document.getElementById("price-prompt-dialog");
  const pricePromptForm = document.getElementById("price-prompt-form");
  const pricingCatalog = globalThis.AI_COST_LENS_PRICING_CATALOG;
  const pricingEngine = globalThis.AICostLensPricing;
  let openAITokenizer = globalThis.AICostLensOpenAITokenizer;
  let openAITokenizerLoad = null;
  let pendingPriceRecord = null;
  const customPromptRateId = "custom/user-supplied-rate";
  const promptRouteControls = Object.freeze([
    { model: "prompt-current-model", mode: "prompt-current-mode", geography: "prompt-current-geography", wrapper: "prompt-current-rate-controls" },
    { model: "prompt-alt-1", mode: "prompt-alt-1-mode", geography: "prompt-alt-1-geography", wrapper: "prompt-alt-1-rate-controls" },
    { model: "prompt-alt-2", mode: "prompt-alt-2-mode", geography: "prompt-alt-2-geography", wrapper: "prompt-alt-2-rate-controls" },
    { model: "prompt-alt-3", mode: "prompt-alt-3-mode", geography: "prompt-alt-3-geography", wrapper: "prompt-alt-3-rate-controls" },
  ]);

  if (pricingCatalog && pricingEngine) {

  function promptPriceMoney(value) {
    const absolute = Math.abs(value);
    const digits = absolute > 0 && absolute < 0.01 ? 6 : absolute < 1 ? 4 : 2;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  }

  function promptModelOptions(blankLabel = "") {
    const groups = new Map();
    pricingCatalog.models.forEach((model) => {
      if (!groups.has(model.provider)) groups.set(model.provider, []);
      groups.get(model.provider).push(model);
    });
    const blank = blankLabel ? `<option value="">${escapeHtml(blankLabel)}</option>` : "";
    return blank + [...groups.entries()].map(([provider, models]) =>
      `<optgroup label="${escapeHtml(provider)}">${models.map((model) => `<option value="${escapeHtml(model.id)}">${escapeHtml(model.label)}</option>`).join("")}</optgroup>`,
    ).join("") + `<optgroup label="Your local rate"><option value="${customPromptRateId}">Custom or contract rate</option></optgroup>`;
  }

  function selectedPromptModelIds() {
    return promptRouteControls.map((route) => document.getElementById(route.model).value);
  }

  function promptModel(modelId) {
    if (modelId === customPromptRateId) return {
      id: customPromptRateId,
      standard: {},
      batch: {},
      geography_multipliers: { global: 1 },
    };
    return pricingCatalog.models.find((model) => model.id === modelId) || null;
  }

  function modeLabel(mode) {
    return ({ standard: "Standard", batch: "Batch", flex: "Flex", fast: "Fast", priority: "Priority" })[mode] || mode;
  }

  function geographyLabel(geography, multiplier) {
    const base = ({ global: "Global / default", regional: "Regional processing", us: "US-only inference" })[geography] || geography;
    return multiplier > 1 ? `${base} (+${((multiplier - 1) * 100).toFixed(0)}%)` : base;
  }

  function updatePromptRouteControl(route) {
    const modelId = document.getElementById(route.model).value;
    const wrapper = document.getElementById(route.wrapper);
    wrapper.hidden = !modelId;
    if (!modelId) return;
    const model = promptModel(modelId);
    if (!model) return;
    const modeSelect = document.getElementById(route.mode);
    const geographySelect = document.getElementById(route.geography);
    const previousMode = modeSelect.value;
    const previousGeography = geographySelect.value;
    const modes = pricingEngine.availableProcessingModes(model);
    modeSelect.innerHTML = modes.map((mode) => `<option value="${escapeHtml(mode)}">${escapeHtml(modeLabel(mode))}</option>`).join("");
    modeSelect.value = modes.includes(previousMode) ? previousMode : "standard";
    const geographies = Object.entries(model.geography_multipliers || { global: 1 });
    geographySelect.innerHTML = geographies.map(([geography, multiplier]) => `<option value="${escapeHtml(geography)}">${escapeHtml(geographyLabel(geography, multiplier))}</option>`).join("");
    geographySelect.value = geographies.some(([geography]) => geography === previousGeography) ? previousGeography : "global";
  }

  function selectedPromptRoutes() {
    return promptRouteControls.map((route) => ({
      model_id: document.getElementById(route.model).value,
      processing_mode: document.getElementById(route.mode).value || "standard",
      geography: document.getElementById(route.geography).value || "global",
    })).filter((route) => route.model_id);
  }

  function revealSelectedCustomRate() {
    const selected = selectedPromptModelIds().includes(customPromptRateId);
    if (selected) document.getElementById("prompt-custom-rate").open = true;
  }

  function readPromptCustomModel(pricingDate) {
    const value = (id) => document.getElementById(id).value;
    const effectiveAt = value("prompt-custom-effective");
    if (effectiveAt > pricingDate) throw new Error("The custom rate effective date cannot be later than the pricing date.");
    return pricingEngine.normalizeCustomModel({
      id: customPromptRateId,
      label: value("prompt-custom-label"),
      model: value("prompt-custom-label"),
      provider: value("prompt-custom-provider"),
      effective_at: effectiveAt,
      pricing_source_note: value("prompt-custom-source"),
      standard: {
        input: value("prompt-custom-input"),
        cached_input: value("prompt-custom-cached"),
        cache_write: value("prompt-custom-cache-write"),
        output: value("prompt-custom-output"),
      },
      batch: {
        input: value("prompt-custom-batch-input"),
        cached_input: value("prompt-custom-batch-cached"),
        cache_write: value("prompt-custom-batch-cache-write"),
        output: value("prompt-custom-batch-output"),
      },
      context_window_tokens: value("prompt-custom-context"),
      max_output_tokens: value("prompt-custom-max-output"),
    });
  }

  function ensureOpenAITokenizer() {
    if (openAITokenizer?.countTokens) return Promise.resolve(openAITokenizer);
    if (openAITokenizerLoad) return openAITokenizerLoad;
    openAITokenizerLoad = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = new URL("vendor/openai-tokenizer.js", document.baseURI).href;
      script.async = true;
      script.addEventListener("load", () => {
        openAITokenizer = globalThis.AICostLensOpenAITokenizer;
        if (openAITokenizer?.countTokens) {
          script.remove();
          resolve(openAITokenizer);
        }
        else {
          openAITokenizerLoad = null;
          script.remove();
          reject(new Error("The local OpenAI tokenizer loaded without its counting function."));
        }
      }, { once: true });
      script.addEventListener("error", () => {
        openAITokenizerLoad = null;
        script.remove();
        reject(new Error("The local OpenAI tokenizer could not be loaded. Rebuild the local vendor assets before pricing an OpenAI prompt."));
      }, { once: true });
      document.head.appendChild(script);
    });
    return openAITokenizerLoad;
  }

  function modelRate(value) {
    return `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: value < 1 ? 2 : 0, maximumFractionDigits: 5 })}`;
  }

  function renderModelCatalog() {
    const query = document.getElementById("model-catalog-search").value.trim().toLowerCase();
    const provider = document.getElementById("model-catalog-provider").value;
    const task = document.getElementById("model-catalog-task").value;
    const tagLabels = { general: "General", reasoning: "Reasoning", coding: "Coding", high_volume: "High-volume", long_context: "Long context", multimodal: "Multimodal" };
    const models = pricingCatalog.models.filter((model) => {
      const matchesProvider = !provider || model.provider === provider;
      const matchesTask = !task || model.workload_tags.includes(task);
      const haystack = `${model.label} ${model.model} ${model.provider} ${model.workload_tags.map((tag) => tagLabels[tag]).join(" ")}`.toLowerCase();
      return matchesProvider && matchesTask && (!query || haystack.includes(query));
    });
    document.getElementById("model-catalog-rows").innerHTML = models.map((model) => {
      const context = model.context_window_tokens || model.input_token_limit;
      const cacheSupplement = model.standard.cache_write !== undefined
        ? ["Cache write", model.standard.cache_write]
        : model.standard.cache_write_5m !== undefined
          ? ["Cache write · 5m", model.standard.cache_write_5m]
          : model.standard.cache_storage_per_1m_token_hour !== undefined
            ? ["Cache storage / hr", model.standard.cache_storage_per_1m_token_hour]
            : ["Cache extra", null];
      const rates = [["Input", model.standard.input], ["Cached input", model.standard.cached_input], cacheSupplement, ["Output", model.standard.output]];
      const modes = pricingEngine.availableProcessingModes(model).map(modeLabel).join(" · ");
      return `<article class="model-catalog-card" role="listitem">
        <div class="model-catalog-card-head"><div><a href="${escapeHtml(model.source_url)}" target="_blank" rel="noreferrer">${escapeHtml(model.label)}</a><span>${escapeHtml(model.provider)} · checked ${escapeHtml(model.verified_at)}${model.effective_at ? ` · catalog use from ${escapeHtml(model.effective_at)}` : ""}</span></div><button class="text-button catalog-add-model" type="button" data-model-id="${escapeHtml(model.id)}">Add</button></div>
        <div class="model-catalog-rates" role="group" aria-label="Standard USD rates. Token rates are per 1 million tokens; cache storage is per 1 million token-hours.">${rates.map(([label, value]) => `<div class="model-catalog-rate"><span>${escapeHtml(label)}</span><strong>${value === null ? "Not listed" : modelRate(value)}</strong></div>`).join("")}</div>
        <div class="model-catalog-card-foot"><div><span class="model-catalog-context">${compact(context)} token context · ${escapeHtml(modes)}</span><div class="model-workload-signals">${model.workload_tags.map((tag) => `<span>${escapeHtml(tagLabels[tag])}</span>`).join("")}</div></div><a class="model-catalog-provider-notes" href="${escapeHtml(model.capability_source_url)}" target="_blank" rel="noreferrer">Provider notes</a></div>
      </article>`;
    }).join("") || '<p class="model-catalog-empty">No model matches this filter.</p>';
    document.getElementById("model-catalog-count").textContent = `${models.length} of ${pricingCatalog.models.length} models · token rates per 1M tokens; storage per 1M token-hours · provider-described workload signals are reference only`;
    document.querySelectorAll(".catalog-add-model").forEach((button) => {
      button.addEventListener("click", () => {
        const modelId = button.dataset.modelId;
        const selects = ["prompt-current-model", "prompt-alt-1", "prompt-alt-2", "prompt-alt-3"].map((id) => document.getElementById(id));
        if (selects.some((select) => select.value === modelId)) {
          showToast("That model is already in the comparison.");
          return;
        }
        const target = selects.slice(1).find((select) => !select.value);
        if (!target) {
          showToast("All four comparison routes are in use. Clear an alternative before adding another model.");
          return;
        }
        target.value = modelId;
        updatePromptRouteControl(promptRouteControls.find((route) => route.model === target.id));
        showToast(`${pricingCatalog.models.find((model) => model.id === modelId).label} added to the comparison.`);
      });
    });
  }

  function initializePromptPricing() {
    pricingEngine.validateCatalog(pricingCatalog);
    document.getElementById("prompt-current-model").innerHTML = promptModelOptions();
    for (const id of ["prompt-alt-1", "prompt-alt-2", "prompt-alt-3"]) {
      document.getElementById(id).innerHTML = promptModelOptions("No additional model");
    }
    document.getElementById("prompt-current-model").value = "openai/gpt-5.6-sol";
    document.getElementById("prompt-alt-1").value = "anthropic/claude-sonnet-5";
    document.getElementById("prompt-alt-2").value = "google/gemini-3.8-flash";
    document.getElementById("prompt-alt-3").value = "";
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById("prompt-custom-effective").value = today;
    const pricingDateInput = document.getElementById("prompt-pricing-date");
    pricingDateInput.min = pricingCatalog.effective_at;
    pricingDateInput.max = pricingCatalog.review_by;
    pricingDateInput.value = today < pricingCatalog.effective_at ? pricingCatalog.effective_at : today > pricingCatalog.review_by ? pricingCatalog.review_by : today;
    promptRouteControls.forEach((route) => {
      updatePromptRouteControl(route);
      document.getElementById(route.model).addEventListener("change", () => {
        revealSelectedCustomRate();
        updatePromptRouteControl(route);
      });
    });
    const sources = pricingCatalog.sources.map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.provider)} (checked ${escapeHtml(source.checked_at)})</a>`).join(", ");
    document.getElementById("prompt-catalog-stamp").innerHTML = `Catalog ${escapeHtml(pricingCatalog.catalog_version)}. Direct API list-price sources: ${sources}. Model-specific start dates are shown below; review again by ${escapeHtml(pricingCatalog.review_by)}. Earlier pricing snapshots remain in the repository. Processing mode, cache-write treatment, and geography are recorded per route.`;
    const providers = [...new Set(pricingCatalog.models.map((model) => model.provider))];
    document.getElementById("model-catalog-provider").innerHTML = '<option value="">All providers</option>' + providers.map((provider) => `<option value="${escapeHtml(provider)}">${escapeHtml(provider)}</option>`).join("");
    document.getElementById("model-catalog-search").addEventListener("input", renderModelCatalog);
    document.getElementById("model-catalog-provider").addEventListener("change", renderModelCatalog);
    document.getElementById("model-catalog-task").addEventListener("change", renderModelCatalog);
    document.getElementById("add-custom-prompt-rate").addEventListener("click", () => {
      const selects = promptRouteControls.slice(1).map((route) => document.getElementById(route.model));
      let target = selects.find((select) => select.value === customPromptRateId);
      if (!target) target = selects.find((select) => !select.value);
      if (!target) {
        showToast("All four comparison routes are in use. Clear an alternative before adding a custom rate.");
        return;
      }
      target.value = customPromptRateId;
      updatePromptRouteControl(promptRouteControls.find((route) => route.model === target.id));
      const customCard = document.getElementById("prompt-custom-rate");
      customCard.open = true;
      customCard.scrollIntoView({ behavior: "smooth", block: "start" });
      window.setTimeout(() => document.getElementById("prompt-custom-label").focus(), 250);
    });
    renderModelCatalog();
  }

  function promptPriceScenario(tokenEstimate) {
    const percent = (id, label, optional = false) => {
      const raw = document.getElementById(id).value;
      if (optional && raw === "") return null;
      return finiteNumber(raw || 0, label) / 100;
    };
    return {
      input_tokens: tokenEstimate.tokens,
      output_tokens: finiteNumber(document.getElementById("prompt-output-tokens").value, "Expected output tokens", { integer: true }),
      calls_per_month: finiteNumber(document.getElementById("prompt-calls").value, "Calls per month", { integer: true }),
      retry_rate: percent("prompt-retry-rate", "Retry rate"),
      cached_input_share: percent("prompt-cache-share", "Cached-input share"),
      cache_refreshes_per_month: finiteNumber(document.getElementById("prompt-cache-refreshes").value || 0, "Cache refreshes per month", { integer: true }),
      cache_write_duration: document.getElementById("prompt-cache-duration").value,
      cache_storage_token_hours_per_month: finiteNumber(document.getElementById("prompt-cache-storage-token-hours").value || 0, "Cache storage token-hours per month"),
      pricing_date: document.getElementById("prompt-pricing-date").value,
      processing_mode: "standard",
      geography: "global",
      usable_rate: percent("prompt-usable-rate", "Expected usable rate", true),
    };
  }

  function renderPromptPrice(record) {
    const current = record.comparison[0];
    const alternatives = record.comparison.slice(1);
    const lowest = [...record.comparison].sort((a, b) => a.estimated_monthly_cost_usd - b.estimated_monthly_cost_usd)[0];
    document.getElementById("price-result-rows").innerHTML = record.comparison.map((result) => {
      const difference = result.monthly_difference_from_current_usd;
      const differenceClass = difference < 0 ? "price-difference-lower" : difference > 0 ? "price-difference-higher" : "";
      const usable = result.estimated_cost_per_usable_result_usd === null ? "Not modeled" : promptPriceMoney(result.estimated_cost_per_usable_result_usd);
      const priceBasis = result.pricing_basis === "user_supplied" ? `user-supplied · effective ${result.pricing_effective_at}` : `official list · checked ${result.pricing_verified_at}`;
      return `<tr>
        <td class="price-route-name"><strong>${escapeHtml(result.label)}</strong><span>${escapeHtml(result.provider)} · ${escapeHtml(modeLabel(result.processing_mode))} · ${escapeHtml(geographyLabel(result.geography, result.geography_multiplier))}${result.pricing_adjustment === "long_context" ? " · long-context rates" : ""}${result.role === "current" ? " · current" : ""}</span><small>${wholeNumber(result.input_tokens)} input · ${result.input_token_method === "openai_o200k_base_exact_raw_text" ? "exact raw-text count" : result.input_token_method === "manual" ? "entered count" : "estimated count"} · ${escapeHtml(priceBasis)}</small></td>
        <td>${promptPriceMoney(result.estimated_cost_per_call_usd)}</td>
        <td>${promptPriceMoney(result.estimated_cost_per_1000_calls_usd)}</td>
        <td>${promptPriceMoney(result.estimated_monthly_cost_usd)}</td>
        <td>${promptPriceMoney(result.estimated_annual_cost_usd)}</td>
        <td class="${differenceClass}">${result.role === "current" ? "Reference" : `${difference < 0 ? "−" : difference > 0 ? "+" : ""}${promptPriceMoney(Math.abs(difference))}`}</td>
        <td>${usable}</td>
      </tr>`;
    }).join("");
    const basis = record.estimate_basis;
    const tokenMethods = new Set(basis.model_token_estimates.map((item) => item.input_token_method));
    const tokenMethod = tokenMethods.size === 1 && tokenMethods.has("manual")
      ? "entered token count"
      : tokenMethods.size === 1 && tokenMethods.has("openai_o200k_base_exact_raw_text")
        ? "exact OpenAI raw-text count"
        : "provider-aware input counts";
    document.getElementById("price-token-summary").textContent = `${wholeNumber(basis.output_tokens)} expected output tokens · ${tokenMethod}`;
    document.getElementById("price-result-read").textContent = !alternatives.length
      ? `${current.label} is priced at ${promptPriceMoney(current.estimated_monthly_cost_usd)} per month under these assumptions. Add an alternative to compare routes.`
      : lowest.role === "current"
        ? `${current.label} remains the lowest modeled token-cost route in this set at ${promptPriceMoney(current.estimated_monthly_cost_usd)} per month. A higher-priced route may still be worth testing for quality, speed, or less human rework.`
        : `${lowest.label} has the lowest modeled token cost in this set at ${promptPriceMoney(lowest.estimated_monthly_cost_usd)} per month, ${promptPriceMoney(Math.abs(lowest.monthly_difference_from_current_usd))} below the current route. That makes it worth testing, not a proven switch.`;
    const retryCopy = basis.retry_rate ? `Calls are increased by ${(basis.retry_rate * 100).toFixed(1)}% for retries.` : "No retry calls are included.";
    const usableCopy = basis.expected_usable_rate === null
      ? "Cost per usable result is not modeled because no usable rate was entered."
      : `Cost per usable result assumes ${(basis.expected_usable_rate * 100).toFixed(1)}% of original calls produce a usable result.`;
    const longContextRoutes = record.comparison.filter((result) => result.pricing_adjustment === "long_context");
    const customRoutes = record.comparison.filter((result) => result.pricing_basis === "user_supplied");
    const tokenLimitCopy = customRoutes.length
      ? "Official routes pass their published token limits, and custom routes pass any limits you supplied."
      : "Every selected route passes its published input, output, and context limits where the provider publishes them.";
    const contextCopy = longContextRoutes.length
      ? `Published long-context multipliers apply to ${longContextRoutes.map((result) => result.label).join(", ")}. ${tokenLimitCopy}`
      : tokenLimitCopy;
    const routeRateCopy = record.comparison.map((result) => `${result.label}: ${modeLabel(result.processing_mode)}, ${geographyLabel(result.geography, result.geography_multiplier)}`).join("; ");
    const cacheCopy = basis.cache_refreshes_per_month
      ? `${(basis.cached_input_share * 100).toFixed(1)}% of input is treated as a repeated prefix, with ${wholeNumber(basis.cache_refreshes_per_month)} ${basis.cache_write_duration === "1h" ? "one-hour" : basis.cache_write_duration === "5m" ? "five-minute" : "provider-default"} cache refreshes per month. Each refresh replaces one cache-read call.`
      : `${(basis.cached_input_share * 100).toFixed(1)}% of input uses published cache-read rates. No cache refresh is included.`;
    const storageCopy = basis.cache_storage_token_hours_per_month
      ? `${wholeNumber(basis.cache_storage_token_hours_per_month)} cache token-hours per month are priced only on routes with a separately published storage rate; routes without a separate storage line add zero for this component.`
      : "No separate cache-storage token-hours are included.";
    document.getElementById("price-assumptions").innerHTML = [
      tokenMethods.has("manual")
        ? "The entered input-token count is applied to every route; provider tokenizers can differ."
        : `${tokenMethods.has("openai_o200k_base_exact_raw_text") ? "OpenAI raw text is counted locally with o200k_base; chat, tool, image, audio, and provider wrapper tokens are excluded. " : ""}${tokenMethods.has("character_estimate_4_to_1") ? "Non-OpenAI input tokens use a disclosed 4-characters-per-token approximation; provider tokenizers can differ." : ""}`,
      `Route rate controls: ${routeRateCopy}.`,
      cacheCopy,
      storageCopy,
      contextCopy,
      retryCopy,
      usableCopy,
      customRoutes.length
        ? `${customRoutes.map((result) => result.label).join(", ")} uses a user-supplied rate. AI Cost Lens did not verify it; confirm the applicable contract or rate card before relying on the estimate.`
        : "Every route uses a provider list price from the dated local catalog.",
      record.comparison.some((result) => result.pricing_basis === "official_list")
        ? `Official catalog routes: ${pricingCatalog.scope}`
        : "The custom rate covers only the token categories entered. Taxes and unentered charges remain excluded.",
      "Model quality, latency, tool calls, reasoning-token behavior, and human review effort are not inferred.",
    ].map((item) => `<li>${escapeHtml(item)}</li>`).join("");
    document.getElementById("price-results").hidden = false;
    document.getElementById("price-results").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  document.getElementById("price-prompt").addEventListener("click", () => {
    pendingPriceRecord = null;
    document.getElementById("price-results").hidden = true;
    document.getElementById("price-prompt-error").classList.remove("visible");
    pricePromptDialog.showModal();
  });
  document.getElementById("close-price-prompt").addEventListener("click", () => pricePromptDialog.close());
  pricePromptDialog.addEventListener("click", (event) => {
    if (event.target === pricePromptDialog) pricePromptDialog.close();
  });

  pricePromptForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = document.getElementById("price-prompt-error");
    const button = document.getElementById("calculate-prompt-price");
    error.classList.remove("visible");
    button.disabled = true;
    button.textContent = "Calculating…";
    try {
      const pricingDate = document.getElementById("prompt-pricing-date").value;
      const routes = selectedPromptRoutes();
      const modelIds = routes.map((route) => route.model_id);
      const customModels = modelIds.includes(customPromptRateId) ? [readPromptCustomModel(pricingDate)] : [];
      if (modelIds.some((id) => id && id !== customPromptRateId)) pricingEngine.requireCatalogDateCoverage(pricingCatalog, pricingDate);
      const promptText = document.getElementById("prompt-text").value;
      const manualTokens = document.getElementById("prompt-input-tokens").value;
      const catalogById = new Map(pricingCatalog.models.map((model) => [model.id, model]));
      customModels.forEach((model) => catalogById.set(model.id, model));
      const selectedModels = [...new Set(modelIds.filter(Boolean))].map((id) => {
        const model = catalogById.get(id);
        if (!model) throw new Error(`Route ${id} is not in the current pricing inputs.`);
        return model;
      });
      if (String(manualTokens).trim() === "" && selectedModels.some((model) => model.provider === "OpenAI")) {
        await ensureOpenAITokenizer();
      }
      const modelTokenEstimates = Object.fromEntries(selectedModels.map((model) => [
        model.id,
        pricingEngine.estimateInputTokens(promptText, manualTokens, model.provider, openAITokenizer?.countTokens),
      ]));
      const tokenEstimate = modelTokenEstimates[routes[0].model_id];
      const scenario = promptPriceScenario(tokenEstimate);
      if (scenario.calls_per_month < 1) throw new Error("Calls per month must be at least 1.");
      if (scenario.retry_rate > 1 || scenario.cached_input_share > 1 || (scenario.usable_rate !== null && scenario.usable_rate > 1)) {
        throw new Error("Retry, cache, and usable rates cannot be greater than 100%.");
      }
      const comparison = pricingEngine.compareModels(pricingCatalog, routes, scenario, modelTokenEstimates, customModels);
      pendingPriceRecord = pricingEngine.buildEstimateRecord(pricingCatalog, comparison, scenario, tokenEstimate);
      renderPromptPrice(pendingPriceRecord);
    } catch (caught) {
      error.textContent = caught.message || "The prompt scenario could not be calculated.";
      error.classList.add("visible");
    } finally {
      button.disabled = false;
      button.textContent = "Calculate the scenario";
    }
  });

  document.getElementById("download-price-estimate").addEventListener("click", () => {
    if (!pendingPriceRecord) return;
    const blob = new Blob([`${JSON.stringify(pendingPriceRecord, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ai-cost-lens-prompt-price-estimate.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  document.getElementById("send-price-to-review").addEventListener("click", () => {
    if (!pendingPriceRecord) return;
    const current = pendingPriceRecord.comparison[0];
    const alternative = [...pendingPriceRecord.comparison.slice(1)].sort((a, b) => a.estimated_monthly_cost_usd - b.estimated_monthly_cost_usd)[0];
    if (!alternative) {
      const error = document.getElementById("price-prompt-error");
      error.textContent = "Choose at least one alternative before sending the estimate to Review.";
      error.classList.add("visible");
      return;
    }
    pricePromptDialog.close();
    resetBuilderStart();
    state.priceEstimate = cloneData(pendingPriceRecord);
    reviewDialog.showModal();
    activateBuilderMode("simple");
    document.getElementById("simple-current-name").value = current.label;
    document.getElementById("simple-other-name").value = alternative.label;
    document.getElementById("simple-current-cost").value = current.estimated_monthly_cost_usd;
    document.getElementById("simple-other-cost").value = alternative.estimated_monthly_cost_usd;
    document.getElementById("simple-monthly-tasks").value = pendingPriceRecord.estimate_basis.calls_per_month;
    for (const id of ["simple-current-checked", "simple-current-usable", "simple-current-minutes", "simple-other-checked", "simple-other-usable", "simple-other-minutes"]) {
      document.getElementById(id).value = "";
    }
    document.getElementById("simple-hourly-rate").value = "0";
    document.getElementById("review-dialog-title").textContent = "Add quality evidence to the price estimate";
    document.getElementById("builder-action-note").textContent = pendingPriceRecord.estimate_basis.rate_source_scope === "official_list_only"
      ? "Official list-price estimates are loaded. Review the same task sample on both routes before making a decision."
      : "Rate estimates are loaded, including a user-supplied rate that AI Cost Lens did not verify. Review the same task sample on both routes before making a decision.";
    showToast("Estimate loaded. Add comparable output evidence before judging the route.");
  });

  initializePromptPricing();
  }

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

  document.querySelectorAll("[data-outcome-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.outcomeMode = button.dataset.outcomeMode;
      document.querySelectorAll("[data-outcome-mode]").forEach((item) => {
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
        const currencyPrompt = candidate.dollarSymbolNeedsConfirmation ? " This invoice uses $. Confirm whether it is USD, CAD, AUD, or another dollar currency." : "";
        pdfStatus.textContent = candidate.amountCandidates.length > 1 ? `The invoice contains several labeled amounts. Choose the one to review, then confirm every field below.${currencyPrompt}` : `Invoice fields were read locally. Confirm every field below before building the review. No usage was inferred.${currencyPrompt}`;
        return;
      }
      if (route.kind === "mapping") {
        const options = '<option value="">Not supplied</option>' + route.mappableHeaders.map((header) => `<option value="${escapeHtml(header)}">${escapeHtml(header)}</option>`).join("");
        Object.entries(mappingElementIds).forEach(([field, id]) => { const select = document.getElementById(id); select.innerHTML = options; select.value = route.mapping[field]; });
        document.getElementById("structured-mapper").hidden = false;
        status.textContent = "We don’t recognize this file automatically yet. Match the columns you know below. Your file stays in this browser.";
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
      if (state.builderMode === "simple") {
        const value = (id, label, options) => finiteNumber(document.getElementById(id).value, label, options);
        const currentName = document.getElementById("simple-current-name").value.trim();
        const otherName = document.getElementById("simple-other-name").value.trim();
        if (!currentName || !otherName) throw new Error("Give both tools or plans a name.");
        const monthlyTasks = value("simple-monthly-tasks", "Monthly tasks", { integer: true });
        const currentChecked = value("simple-current-checked", "Current outputs checked", { integer: true });
        const otherChecked = value("simple-other-checked", "Other outputs checked", { integer: true });
        const currentUsable = value("simple-current-usable", "Current usable outputs", { integer: true });
        const otherUsable = value("simple-other-usable", "Other usable outputs", { integer: true });
        if (!monthlyTasks || !currentChecked || !otherChecked) throw new Error("Enter at least one monthly task and one checked output for each option.");
        if (currentUsable > currentChecked || otherUsable > otherChecked) throw new Error("Usable outputs cannot be greater than the number you checked.");
        if (currentChecked > monthlyTasks || otherChecked > monthlyTasks) throw new Error("The number checked cannot be greater than your monthly tasks.");
        const csvCell = (input) => `"${String(input).replaceAll('"', '""')}"`;
        const header = "period,date,workload,provider,model,route,requests,input_tokens,cached_input_tokens,cache_write_input_tokens,output_tokens,provider_cost,cost_basis,currency";
        const today = new Date().toISOString().slice(0, 10);
        const row = (period, name, cost, route) => [period, today, "My monthly AI-assisted work", name, name, route, monthlyTasks, 0, 0, 0, 0, cost, "calculated", "USD"].map(csvCell).join(",");
        const spendText = [
          header,
          row("baseline", currentName, value("simple-current-cost", "Current monthly cost"), "What you use now"),
          row("proposed", otherName, value("simple-other-cost", "Other monthly cost"), "The other option"),
        ].join("\n");
        const approved = document.getElementById("simple-approved").checked;
        const config = {
          acceptanceRule: "Usable without a significant fix",
          verifier: "User review",
          qualityFloor: value("simple-quality-floor", "Minimum usable rate") / 100,
          hourlyRate: value("simple-hourly-rate", "Hourly value"),
          baselinePolicyApproved: approved,
          proposedPolicyApproved: approved,
          baselineShared: 0,
          proposedShared: 0,
          changeCost: 0,
          sampleRandom: false,
          outcomeLogComplete: false,
          planning: null,
        };
        if (config.qualityFloor <= 0 || config.qualityFloor > 1) throw new Error("Minimum usable rate must be between 1% and 100%.");
        state.data = await buildSimpleReview(spendText, {
          baseline: { population: monthlyTasks, ready: currentUsable, correction: currentChecked - currentUsable, escalation: 0, humanMinutes: value("simple-current-minutes", "Current review and fixing minutes") },
          proposed: { population: monthlyTasks, ready: otherUsable, correction: otherChecked - otherUsable, escalation: 0, humanMinutes: value("simple-other-minutes", "Other review and fixing minutes") },
        }, config);
        state.data.experience = "simple";
        state.data.workload.name = "My monthly AI-assisted work";
        state.data.workload.description = "A plain-language comparison of two AI options using monthly cost, usable work, and the user's review and fixing time.";
        state.data.workload.outcome_unit = "usable result";
        state.data.baseline.label = currentName;
        state.data.proposed.label = otherName;
        state.data.period = { start: null, end: null, timezone: "Not supplied" };
        for (const scenario of [state.data.baseline, state.data.proposed]) {
          scenario.evidence.source = "User-entered monthly cost and sample; no provider export supplied";
          scenario.evidence.observed_at = "Not supplied";
          scenario.evidence.cost_boundary = "Entered tool cost plus estimated value of review and fixing time; time value is not necessarily a cash expense";
          scenario.evidence.provider_usage_sha256 = null;
          scenario.evidence.provider_cost_sha256 = null;
          for (const key of Object.keys(scenario.usage)) scenario.usage[key] = null;
          scenario.measures.cache_reuse_rate = null;
          scenario.measures.cache_write_rate = null;
        }
        state.data.comparison.limitation = "User-entered monthly scenario, not a verified invoice. The denominator counts results usable without a significant fix, not all final completed tasks. Time value is an estimate, not necessarily cash paid.";
        if (state.priceEstimate) {
          state.data.pricing_estimate = cloneData(state.priceEstimate);
          state.data.comparison.savings_claim_allowed = false;
          const customRateCopy = state.priceEstimate.estimate_basis.rate_source_scope === "official_list_only"
            ? ""
            : " One or more rates were supplied by the user and were not independently verified.";
          state.data.comparison.limitation += ` The provider charges came from an AI Cost Lens rate estimate.${customRateCopy} Estimated calculator data cannot support a savings claim.`;
        }
        state.data.comparison.recommendation = decisionFor(state.data).reason;
        validateResult(state.data);
        renderAll();
        setView("review");
        reviewDialog.close();
        showToast("Comparison built. Your answers stayed in this browser.");
        return;
      }
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
          const confirmationMeasure = (field, value) => {
            const coverage = summary.coverage?.[field];
            if (!coverage || coverage.status === "complete") return value === null ? "unavailable" : String(value);
            if (coverage.status === "missing") return "unavailable";
            return `${value} reported (${coverage.suppliedRows} of ${coverage.totalRows} rows)`;
          };
          box.textContent = `Provider: ${summary.provider}. Period: ${summary.period.start} to ${summary.period.end}. Products: ${summary.products.join(", ")}. Models: ${summary.models.join(", ")}. Provider-reported cost: $${summary.providerCost.toFixed(2)}. Requests: ${confirmationMeasure("requests", summary.requests)}. Input tokens: ${confirmationMeasure("processedInput", summary.inputTokens)}. Output tokens: ${confirmationMeasure("outputTokens", summary.outputTokens)}. Not included: ${summary.missing.join(", ")}. Source rows: ${summary.sourceRows}. Personal identifiers were discarded.`;
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
      if (state.pendingVerification) {
        state.data.verification_evidence = cloneData(state.pendingVerification);
        state.data.comparison.limitation += " The paired verification record supports the quality sample only; it does not establish billed or realized savings.";
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
      submit.textContent = state.builderMode === "simple" ? "Compare my options" : state.builderMode === "single" ? "Understand this bill" : state.builderMode === "openai"
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
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  document.getElementById("print-memo").addEventListener("click", () => {
    if (!state.data) return;
    renderFinanceMemo();
    renderDecisionConsistency();
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
      throw new Error("The example review could not be loaded.");
    }
    state.data = await response.json();
    state.demoData = cloneData(state.data);
    renderAll();
  }

  loadDemo().catch((error) => showToast(error.message));
  /* AI_COST_LENS_DEMO_LOADER_END */
})();
