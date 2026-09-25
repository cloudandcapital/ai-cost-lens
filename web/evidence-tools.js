(function attachEvidenceTools(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AICostLensEvidenceTools = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildEvidenceTools() {
  "use strict";
  const xml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);

  function sampleSize(marginPoints, expectedReadyRate = 0.5) {
    const margin = Number(marginPoints) / 100;
    const rate = Number(expectedReadyRate);
    if (!(margin > 0 && margin < 1) || !(rate > 0 && rate < 1)) throw new Error("Choose a margin between 0 and 100 points and a ready rate between 0% and 100%.");
    return Math.ceil(1.96 ** 2 * rate * (1 - rate) / margin ** 2);
  }

  function evidenceKit(review) {
    if (!review?.baseline || !review?.proposed || !review?.comparison) throw new Error("A two-route review is required.");
    const tasks = [];
    const add = (key, action, why) => { if (!tasks.some((item) => item.key === key)) tasks.push({ key, action, why }); };
    if (review.mode === "illustrative") add("own-records", "Replace the example with your own spend and outcome records for both routes.", "All example costs and outcomes are invented.");
    for (const [route, label] of [[review.baseline, "Current route"], [review.proposed, "Candidate route"]]) {
      if (route.evidence.cost_basis !== "observed") add(`${label}-cost`, `Obtain the ${label.toLowerCase()} provider cost for this workload and period.`, "Calculated or allocated cost is an estimate until checked against provider records.");
      if (route.evidence.coverage_status !== "complete") add(`${label}-coverage`, `Complete the ${label.toLowerCase()} usage and outcome log for the same bounded period.`, `Current coverage: ${route.evidence.coverage_status || "unspecified"}.`);
      if (route.outcomes.basis === "sampled") add(`${label}-sample`, `Score more ${label.toLowerCase()} outputs with the same ready-result rule, then log review time.`, "Sampled outcomes cannot establish a complete-period result.");
      for (const [index, issue] of (route.evidence.reconciliation_issues || []).entries()) add(`${label}-issue-${index}`, `Resolve ${label.toLowerCase()} reconciliation: ${issue}`, "The supplied records do not yet reconcile.");
      if (!route.policy.approved) add(`${label}-policy`, `Record an explicit policy decision for the ${label.toLowerCase()}.`, "Policy approval is required before recommending a route change.");
    }
    if (!review.comparison.same_cost_basis) add("basis", "Compare both routes using the same cost basis.", "Mixed cost bases make the dollar difference unreliable.");
    if (!review.comparison.quality_holds) add("quality", "Test the candidate on the same cases and ready-result rule; meet the declared quality floor.", "A cheaper result that fails quality is not a saving.");
    if (!tasks.length) add("actuals", "Check the changed route against a later provider bill and complete outcome log.", "A comparison is a decision input; realized savings require a post-change period.");
    return tasks;
  }

  function receiptFor(review, route) {
    const scenario = review?.[route];
    const count = scenario?.outcomes?.usable_results;
    if (!Number.isFinite(count) || count <= 0) throw new Error("A positive ready-result count is required.");
    const raw = [scenario.costs.model_cost, scenario.costs.shared_infrastructure_cost, scenario.costs.human_review_cost].map((cost) => {
      if (!Number.isFinite(cost) || cost < 0) throw new Error("Cost components must be non-negative numbers.");
      return (cost / count) * 100;
    });
    const target = Math.round(raw.reduce((a, b) => a + b, 0));
    const cents = raw.map(Math.floor);
    const remainders = raw.map((value, index) => ({ index, remainder: value - cents[index] }));
    remainders.sort((a, b) => b.remainder - a.remainder || a.index - b.index);
    const centsToAllocate = target - cents.reduce((a, b) => a + b, 0);
    for (let i = 0; i < centsToAllocate; i += 1) cents[remainders[i].index] += 1;
    const evidence = scenario.evidence || {};
    const stamp = review.mode === "illustrative"
      ? "ILLUSTRATIVE"
      : review.mode === "sampled" || scenario.outcomes.basis === "sampled"
        ? evidence.cost_basis === "observed" ? "REPORTED COST · SAMPLED OUTCOMES" : "SAMPLED ESTIMATE"
        : evidence.cost_basis === "observed"
          ? evidence.coverage_status === "complete" && evidence.reconciliation_issues?.length === 0 ? "USER-SUPPLIED RECORDS" : "REPORTED COST · PARTIAL"
          : "CALCULATED / PARTIAL";
    return {
      label: scenario.label,
      ready_results: count,
      lines: ["Model usage", "Shared infrastructure", "Human review"].map((label, index) => ({ label, cents: cents[index] })),
      total_cents: target,
      stamp,
      note: review.mode === "illustrative"
        ? "Invented costs and outcomes. No provider bill or work log verified."
        : "Amounts and outcomes are user supplied; provider and quality records are not independently audited.",
    };
  }

  function priceSenseCheck(review, catalog, route = "baseline") {
    const scenario = review?.[route];
    if (!scenario || !catalog || review.currency !== catalog.currency) return { available: false, reason: "No comparable same-currency catalog rate." };
    const model = catalog.models?.find((item) => item.provider?.toLowerCase() === scenario.model?.provider?.toLowerCase()
      && item.label?.toLowerCase() === scenario.model?.name?.toLowerCase());
    if (!model) return { available: false, reason: "A single catalog model was not identified for this route." };
    const { processed_input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: writes, output_tokens: output, requests } = scenario.usage || {};
    if (![input, cached, output, requests].every((value) => Number.isFinite(value) && value >= 0) || !requests || cached > input) {
      return { available: false, reason: "Matching input, cache, output, and request totals are required." };
    }
    if (writes !== 0) return { available: false, reason: "Cache writes need their own price treatment; this check needs zero recorded cache writes." };
    if (!Number.isFinite(scenario.costs.model_cost) || scenario.costs.model_cost < 0) return { available: false, reason: "No comparable model-cost total was supplied." };
    if (review.mode !== "illustrative" && scenario.evidence?.observed_at < catalog.effective_at) {
      return { available: false, reason: "The catalog rate began after the supplied cost period. Use a historical rate for that period." };
    }
    if (model.long_context && input / requests > model.long_context.input_threshold_tokens) {
      return { available: false, reason: "Average input exceeds the long-context threshold. Supply per-request tiers before repricing." };
    }
    const estimate = ((input - cached) * model.standard.input + cached * model.standard.cached_input + output * model.standard.output) / 1_000_000;
    const supplied = scenario.costs.model_cost;
    const gap = supplied - estimate;
    const gapPercent = estimate > 0 ? gap / estimate * 100 : supplied > 0 ? null : 0;
    return {
      available: true, label: model.label, catalog_date: catalog.effective_at,
      estimated_cost: estimate, supplied_cost: supplied, gap, gap_percent: gapPercent,
      flag: gapPercent === null || Math.abs(gapPercent) > 10 ? "INVESTIGATE GAP" : "WITHIN 10% OF LIST RATE",
      basis: review.mode === "illustrative" ? "INVENTED EXAMPLE" : scenario.evidence?.cost_basis === "observed" ? "USER-REPORTED PROVIDER COST" : "CALCULATED OR ALLOCATED COST",
      limitation: "Standard text API list rate only. This is a sense check, not invoice reconciliation. Per-request long context, tiers, negotiated rates, tools, credits, and scope may change the result.",
    };
  }

  function receiptSvg(review, receipts) {
    const format = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: review.currency || "USD" }).format(cents / 100);
    const rows = receipts.flatMap((receipt, index) => {
      const x = index ? 420 : 40;
      return [`<text x="${x}" y="145" class="route">${xml(receipt.label)}</text>`,
        `<text x="${x}" y="173" class="stamp">${xml(receipt.stamp)}</text>`,
        ...receipt.lines.map((line, lineIndex) => `<text x="${x}" y="${239 + lineIndex * 43}" class="item">${xml(line.label)}</text><text x="${x + 332}" y="${239 + lineIndex * 43}" text-anchor="end" class="item">${xml(format(line.cents))}</text>`),
        `<path d="M ${x} 356 h 332" stroke="#b9bdb4"/><text x="${x}" y="393" class="total">One ready result</text><text x="${x + 332}" y="393" text-anchor="end" class="total">${xml(format(receipt.total_cents))}</text>`];
    }).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="510" viewBox="0 0 800 510" role="img" aria-label="Cost per ready result on two routes"><style>text{font-family:Arial,Helvetica,sans-serif;fill:#171816}.title{font-family:Georgia,serif;font-size:29px}.route{font-size:19px;font-weight:bold}.stamp{font-size:12px;letter-spacing:1px;fill:#526b56}.item{font-size:15px}.total{font-size:17px;font-weight:bold}.note{font-size:13px;fill:#414740}</style><rect width="800" height="510" fill="#fcfaf6"/><text x="40" y="58" class="title">What one ready result cost</text><text x="40" y="85" class="note">${xml(review.workload?.name || "AI workload")} · ${xml(review.currency || "USD")}</text><path d="M 400 122 v 300" stroke="#d7d8d1"/>${rows}<text x="40" y="457" class="note">${xml(receipts[0].note)}</text><text x="40" y="481" class="note">Recurring costs only. One-time change cost excluded; lines add to each total.</text></svg>`;
  }

  return Object.freeze({ receiptFor, receiptSvg, priceSenseCheck, evidenceKit, sampleSize });
});
