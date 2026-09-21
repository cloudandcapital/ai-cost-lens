(function attachActualsEngine(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AICostLensActuals = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildActualsEngine() {
  "use strict";

  const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
  function number(value, label, { min = 0, max = Infinity, integer = false } = {}) {
    if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
      throw new Error(`${label} is required.`);
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isSafeInteger(parsed))) {
      throw new Error(`${label} must be ${integer ? "a whole number " : ""}between ${min} and ${Number.isFinite(max) ? max : "a valid number"}.`);
    }
    return parsed;
  }

  function isoDate(value, label) {
    const timestamp = Date.parse(`${value}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
      throw new Error(`${label} must be a real calendar date in YYYY-MM-DD format.`);
    }
    return value;
  }

  function buildLedger(input, createdAt) {
    const baselinePeriod = String(input.baseline_period || "").trim();
    const actualPeriod = String(input.actual_period || "").trim();
    if (!baselinePeriod || !actualPeriod) throw new Error("Baseline and post-change periods are required.");
    const implementedAt = String(input.implemented_at || "").trim();
    if (implementedAt) isoDate(implementedAt, "Implementation date");
    if (!["real", "sampled", "illustrative"].includes(input.source_mode)) throw new Error("Source mode must be real, sampled, or illustrative.");
    const currency = String(input.currency || "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Currency must be a three-letter code.");
    const baselineCost = number(input.baseline_cost, "Baseline cost");
    const actualCost = number(input.actual_cost, "Post-change cost");
    const baselineVolume = number(input.baseline_volume, "Baseline result volume", { min: 1, integer: true });
    const actualVolume = number(input.actual_volume, "Post-change result volume", { min: 1, integer: true });
    const baselineUsableRate = number(input.baseline_usable_rate, "Baseline usable rate", { min: 0.000001, max: 1 });
    const actualUsableRate = number(input.actual_usable_rate, "Post-change usable rate", { min: 0.000001, max: 1 });
    const implementationCost = number(input.implementation_cost || 0, "Implementation cost");
    const baselineReady = baselineVolume * baselineUsableRate;
    const actualReady = actualVolume * actualUsableRate;
    const baselineUnitCost = baselineCost / baselineReady;
    const actualUnitCost = actualCost / actualReady;
    const normalizedBaselineCost = baselineUnitCost * actualReady;
    const billedDifference = normalizedBaselineCost - actualCost;
    const netDifference = billedDifference - implementationCost;
    const verified = Boolean(input.quality_verified) && actualUsableRate >= number(input.quality_floor, "Quality floor", { min: 0.000001, max: 1 });
    const approved = Boolean(input.policy_approved);
    const implemented = Boolean(implementedAt);
    const sourceReal = input.source_mode === "real";
    const observed = implemented && sourceReal && Boolean(input.provider_reported) && Boolean(input.periods_comparable) && Boolean(input.outcomes_complete);
    const realized = verified && approved && observed && netDifference > 0;
    const stages = [
      { stage: "identified", complete: true },
      { stage: "proposed", complete: true },
      { stage: "verified", complete: verified },
      { stage: "approved", complete: approved },
      { stage: "implemented", complete: implemented },
      { stage: "observed", complete: observed },
      { stage: "realized", complete: realized },
    ];
    return {
      schema_version: "ai-cost-lens-realized-savings/1.0",
      created_at: createdAt || new Date().toISOString(),
      currency,
      periods: { baseline: baselinePeriod, actual: actualPeriod },
      implementation: { effective_at: implementedAt || null, cost: round(implementationCost) },
      baseline: { cost: round(baselineCost), volume: baselineVolume, usable_rate: baselineUsableRate, ready_results: round(baselineReady), cost_per_ready_result: round(baselineUnitCost) },
      actual: { cost: round(actualCost), volume: actualVolume, usable_rate: actualUsableRate, ready_results: round(actualReady), cost_per_ready_result: round(actualUnitCost) },
      normalization: { method: "baseline_cost_per_ready_result_at_actual_ready_volume", normalized_baseline_cost: round(normalizedBaselineCost) },
      waterfall: {
        normalized_baseline_cost: round(normalizedBaselineCost),
        less_actual_billed_cost: round(actualCost),
        billed_difference: round(billedDifference),
        less_implementation_cost: round(implementationCost),
        realized_net_difference: round(netDifference),
      },
      gates: {
        quality_verified: verified,
        policy_approved: approved,
        implementation_recorded: implemented,
        provider_cost_reported: Boolean(input.provider_reported),
        periods_comparable: Boolean(input.periods_comparable),
        outcomes_complete: Boolean(input.outcomes_complete),
        source_record_is_real: sourceReal,
        realized_savings_claim_allowed: realized,
      },
      stages,
      status: realized ? "REALIZED" : observed ? "OBSERVED_NOT_REALIZED" : implemented ? "IMPLEMENTED_AWAITING_ACTUALS" : verified ? "VERIFIED_NOT_IMPLEMENTED" : "PROPOSED",
    };
  }

  return Object.freeze({ buildLedger });
});
