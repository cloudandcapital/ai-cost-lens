(function attachScenarioEngine(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AICostLensScenarios = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildScenarioEngine() {
  "use strict";

  const round = (value, digits = 8) => Number(Number(value).toFixed(digits));
  const number = (value, label, max = Infinity) => {
    if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
      throw new Error(`${label} is required.`);
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) throw new Error(`${label} must be between 0 and ${Number.isFinite(max) ? max : "a valid number"}.`);
    return parsed;
  };

  function simulateRoute(review, catalog, input) {
    if (!review || review.schema_version !== "ai-cost-lens-review-result/1.0") throw new Error("Open a route comparison before simulating a change.");
    if (!input || !["baseline", "proposed"].includes(input.route)) throw new Error("Choose the current or proposed route.");
    if (!catalog || !Array.isArray(catalog.models) || !catalog.models.length) throw new Error("The pricing catalog is missing or incompatible.");
    if (review.currency !== catalog.currency) throw new Error(`Scenario pricing is in ${catalog.currency}; this review is in ${review.currency || "an unknown currency"}. Supply an explicit FX method before comparing them.`);
    const scenario = input.route === "proposed" ? review.proposed : review.baseline;
    const model = catalog.models.find((item) => item.id === input.model_id);
    if (!model) throw new Error("Choose a model from the current pricing catalog.");
    const processedInput = number(scenario.usage?.processed_input_tokens, "Processed input tokens");
    const output = number(scenario.usage?.output_tokens, "Output tokens");
    const requests = number(scenario.usage?.requests, "Requests");
    const rawRetries = scenario.usage?.retries;
    const retriesKnown = rawRetries !== null && rawRetries !== undefined && !(typeof rawRetries === "string" && rawRetries.trim() === "");
    const retries = retriesKnown ? number(rawRetries, "Retries") : null;
    if (!requests) throw new Error("The selected route does not include request volume.");
    const cacheShare = number(input.cached_input_share, "Cached-input share", 1);
    const outputReduction = number(input.output_reduction, "Output reduction", 1);
    const retryReduction = number(input.retry_reduction, "Retry reduction", 1);
    if (!retriesKnown && retryReduction > 0) throw new Error("Retry reduction requires an observed retry count.");
    if (retriesKnown && retries > requests) throw new Error("Retry count cannot be greater than total request count.");
    const retryCallsRemoved = Math.min((retries || 0) * retryReduction, requests);
    const requestFactor = (requests - retryCallsRemoved) / requests;
    const modeledInput = processedInput * requestFactor;
    const modeledOutput = output * requestFactor * (1 - outputReduction);
    const cachedInput = modeledInput * cacheShare;
    const uncachedInput = modeledInput - cachedInput;
    const baseRates = input.batch ? model.batch : model.standard;
    for (const [name, rate] of Object.entries(baseRates || {})) number(rate, `${model.label} ${name} rate`);
    if (!baseRates || !["input", "cached_input", "output"].every((name) => Object.hasOwn(baseRates, name))) {
      throw new Error(`${model.label} does not have a complete ${input.batch ? "batch" : "standard"} rate card.`);
    }
    const modeledRequests = requests - retryCallsRemoved;
    const averageInput = modeledRequests ? modeledInput / modeledRequests : 0;
    const averageOutput = modeledRequests ? modeledOutput / modeledRequests : 0;
    if (model.context_window_tokens && averageInput + averageOutput > model.context_window_tokens) {
      throw new Error(`${model.label} cannot fit the average modeled request in its published context window.`);
    }
    if (model.input_token_limit && averageInput > model.input_token_limit) {
      throw new Error(`${model.label} cannot fit the average modeled input in its published input limit.`);
    }
    if (model.max_output_tokens && averageOutput > model.max_output_tokens) {
      throw new Error(`${model.label} cannot fit the average modeled output in its published output limit.`);
    }
    const longContext = model.long_context && averageInput > model.long_context.input_threshold_tokens;
    const rates = longContext
      ? {
          input: baseRates.input * model.long_context.input_multiplier,
          cached_input: baseRates.cached_input * model.long_context.cached_input_multiplier,
          output: baseRates.output * model.long_context.output_multiplier,
        }
      : { ...baseRates };
    const estimatedCost = (uncachedInput * rates.input + cachedInput * rates.cached_input + modeledOutput * rates.output) / 1_000_000;
    const currentCost = number(scenario.costs?.model_cost, "Current provider cost");
    const difference = estimatedCost - currentCost;
    const rawRecurringCost = scenario.costs?.recurring_operating_cost;
    const recurringCostKnown = rawRecurringCost !== null && rawRecurringCost !== undefined && !(typeof rawRecurringCost === "string" && rawRecurringCost.trim() === "");
    const currentRecurringCost = recurringCostKnown ? number(rawRecurringCost, "Current recurring operating cost") : null;
    if (currentRecurringCost !== null && currentRecurringCost < currentCost) {
      throw new Error("Current recurring operating cost cannot be lower than its provider-cost component.");
    }
    const nonProviderCost = currentRecurringCost === null ? null : currentRecurringCost - currentCost;
    const estimatedRecurringCost = nonProviderCost === null ? null : estimatedCost + nonProviderCost;
    return {
      schema_version: "ai-cost-lens-scenario/1.0",
      source_route: scenario.id,
      source_label: scenario.label,
      currency: catalog.currency,
      proposed_model: { id: model.id, provider: model.provider, label: model.label },
      pricing: {
        catalog_version: catalog.catalog_version,
        effective_at: catalog.effective_at,
        tier: input.batch ? "batch" : "standard",
        adjustment: longContext ? "long_context" : "standard_context",
        rates_per_1m_tokens: { ...rates },
        source_url: model.source_url,
        verified_at: model.verified_at,
      },
      assumptions: {
        observed_token_shape_held_constant: true,
        observed_requests: requests,
        observed_retries: retries,
        retry_reduction: retryReduction,
        output_reduction: outputReduction,
        cached_input_share: cacheShare,
        batch: Boolean(input.batch),
        removed_retries_use_average_token_shape: retryReduction > 0,
        model_behavior_and_quality_held_constant: true,
      },
      modeled_usage: {
        requests: round(modeledRequests, 3),
        input_tokens: round(modeledInput, 3),
        cached_input_tokens: round(cachedInput, 3),
        output_tokens: round(modeledOutput, 3),
        average_input_tokens_per_request: round(averageInput, 3),
        average_output_tokens_per_request: round(averageOutput, 3),
      },
      economics: {
        current_provider_cost_usd: round(currentCost),
        estimated_provider_cost_usd: round(estimatedCost),
        estimated_difference_usd: round(difference),
        estimated_difference_percent: currentCost ? round((difference / currentCost) * 100, 2) : null,
        current_recurring_operating_cost_usd: currentRecurringCost === null ? null : round(currentRecurringCost),
        non_provider_cost_held_constant_usd: nonProviderCost === null ? null : round(nonProviderCost),
        estimated_recurring_operating_cost_usd: estimatedRecurringCost === null ? null : round(estimatedRecurringCost),
      },
      evidence_gate: {
        decision: "TEST_FIRST",
        savings_claim_allowed: false,
        context_check: "Average token shape only; per-request maxima were not supplied.",
        reason: "Repricing observed token shape does not prove equivalent output quality, latency, tool behavior, per-request compatibility, or billed savings.",
      },
    };
  }

  return Object.freeze({ simulateRoute });
});
