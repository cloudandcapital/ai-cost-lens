(function attachPricingEngine(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AICostLensPricing = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildPricingEngine() {
  "use strict";

  const round = (value, digits = 8) => Number(Number(value).toFixed(digits));
  const PROCESSING_MODES = Object.freeze(["standard", "batch", "flex", "fast", "priority"]);
  const RATE_FIELDS = Object.freeze([
    "input",
    "cached_input",
    "cache_write",
    "cache_write_5m",
    "cache_write_1h",
    "cache_storage_per_1m_token_hour",
    "output",
  ]);

  function number(value, label, { integer = false, max = Infinity } = {}) {
    if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
      throw new Error(`${label} is required.`);
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > max || (integer && !Number.isSafeInteger(parsed))) {
      throw new Error(`${label} must be a non-negative${integer ? " whole" : ""} number${Number.isFinite(max) ? ` no greater than ${max}` : ""}.`);
    }
    return parsed;
  }

  function requiredText(value, label, max = 160) {
    const result = String(value || "").trim();
    if (!result) throw new Error(`${label} is required.`);
    if (result.length > max) throw new Error(`${label} cannot exceed ${max} characters.`);
    return result;
  }

  function optionalPositiveInteger(value, label) {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const parsed = number(value, label, { integer: true });
    if (parsed < 1) throw new Error(`${label} must be greater than zero or blank.`);
    return parsed;
  }

  function isoDate(value, label) {
    const timestamp = Date.parse(`${value}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "") || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
      throw new Error(`${label} must be a real calendar date in YYYY-MM-DD format.`);
    }
    return value;
  }

  function estimateInputTokens(prompt, manualTokens, provider = null, exactCounter = null) {
    if (manualTokens !== "" && manualTokens !== null && manualTokens !== undefined) {
      return { tokens: number(manualTokens, "Input tokens", { integer: true }), method: "manual" };
    }
    const rawText = String(prompt || "");
    const characters = rawText.length;
    if (!characters) throw new Error("Paste a prompt or enter its input-token count.");
    if (String(provider || "").toLowerCase() === "openai" && typeof exactCounter === "function") {
      const tokens = exactCounter(rawText);
      if (!Number.isSafeInteger(tokens) || tokens < 1) throw new Error("The local OpenAI tokenizer returned an invalid token count.");
      return { tokens, method: "openai_o200k_base_exact_raw_text" };
    }
    return { tokens: Math.max(1, Math.ceil(characters / 4)), method: "character_estimate_4_to_1" };
  }

  function validateRateProfile(profile, label) {
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) throw new Error(`${label} is missing.`);
    for (const field of ["input", "cached_input", "output"]) number(profile[field], `${label} ${field}`);
    for (const field of RATE_FIELDS.slice(2, -1)) {
      if (profile[field] !== null && profile[field] !== undefined) number(profile[field], `${label} ${field}`);
    }
    return profile;
  }

  function validateCatalog(catalog) {
    if (!catalog || catalog.schema_version !== "ai-cost-lens-pricing-catalog/0.5") throw new Error("The pricing catalog is missing or incompatible.");
    isoDate(catalog.catalog_version, "Catalog version");
    isoDate(catalog.effective_at, "Catalog effective date");
    isoDate(catalog.review_by, "Catalog review date");
    if (catalog.review_by < catalog.effective_at) throw new Error("Catalog review date cannot be earlier than its effective date.");
    if (catalog.currency !== "USD" || catalog.unit !== "per_1m_tokens") throw new Error("The pricing catalog must use USD per 1M tokens.");
    if (!Array.isArray(catalog.sources) || !catalog.sources.length) throw new Error("The pricing catalog needs official source records.");
    const providerSourceUrls = new Map();
    const sourceUrls = new Set(catalog.sources.map((source) => {
      if (!source?.provider || !/^https:\/\//.test(source.url || "")) throw new Error("Every catalog source needs a provider and HTTPS URL.");
      isoDate(source.checked_at, `${source.provider} source check date`);
      const provider = String(source.provider).trim().toLowerCase();
      if (!providerSourceUrls.has(provider)) providerSourceUrls.set(provider, new Set());
      providerSourceUrls.get(provider).add(source.url);
      return source.url;
    }));
    if (!Array.isArray(catalog.models) || !catalog.models.length) throw new Error("The pricing catalog has no models.");
    const ids = new Set();
    const workloadTags = new Set(["general", "reasoning", "coding", "high_volume", "long_context", "multimodal"]);
    catalog.models.forEach((model) => {
      if (!model.id || ids.has(model.id)) throw new Error("Every catalog model needs a unique id.");
      ids.add(model.id);
      if (!model.provider || !model.label || !model.model) throw new Error(`${model.id} needs provider, label, and model identifiers.`);
      if (!/^https:\/\//.test(model.source_url || "")) throw new Error(`${model.id} needs an HTTPS pricing source.`);
      if (!sourceUrls.has(model.source_url)) throw new Error(`${model.id} must reference a catalog source URL.`);
      if (!providerSourceUrls.get(String(model.provider).trim().toLowerCase())?.has(model.source_url)) {
        throw new Error(`${model.id} must reference a pricing source registered for ${model.provider}.`);
      }
      if (!/^https:\/\//.test(model.capability_source_url || "")) throw new Error(`${model.id} needs an HTTPS capability source.`);
      if (!Array.isArray(model.workload_tags) || !model.workload_tags.length || model.workload_tags.some((tag) => !workloadTags.has(tag))) {
        throw new Error(`${model.id} has missing or unsupported workload tags.`);
      }
      if (new Set(model.workload_tags).size !== model.workload_tags.length) throw new Error(`${model.id} has duplicate workload tags.`);
      isoDate(model.verified_at, `${model.id} verified date`);
      if (model.verified_at < catalog.effective_at) throw new Error(`${model.id} was not verified on or after the catalog effective date.`);
      for (const field of ["context_window_tokens", "input_token_limit", "max_output_tokens"]) {
        if (model[field] !== null && model[field] !== undefined) {
          number(model[field], `${model.id} ${field}`, { integer: true });
          if (model[field] < 1) throw new Error(`${model.id} ${field} must be greater than zero.`);
        }
      }
      if (!model.context_window_tokens && !model.input_token_limit) throw new Error(`${model.id} needs a published context or input-token limit.`);
      for (const mode of ["standard", "batch"]) validateRateProfile(model[mode], `${model.id} ${mode}`);
      for (const mode of PROCESSING_MODES.slice(2)) {
        if (model[mode] !== null && model[mode] !== undefined) validateRateProfile(model[mode], `${model.id} ${mode}`);
      }
      const geographies = model.geography_multipliers;
      if (!geographies || geographies.global !== 1) throw new Error(`${model.id} needs a global geography multiplier of 1.`);
      Object.entries(geographies).forEach(([key, value]) => {
        if (!/^[a-z][a-z0-9_]*$/.test(key)) throw new Error(`${model.id} has an invalid geography key.`);
        number(value, `${model.id} ${key} geography multiplier`);
        if (value < 1) throw new Error(`${model.id} geography multipliers cannot be below 1.`);
      });
      if (model.long_context) {
        number(model.long_context.input_threshold_tokens, `${model.id} long-context threshold`, { integer: true });
        for (const field of ["input_multiplier", "cached_input_multiplier", "cache_write_multiplier", "output_multiplier"]) {
          if (field === "cache_write_multiplier" && model.long_context[field] === undefined) continue;
          number(model.long_context[field], `${model.id} ${field}`);
          if (model.long_context[field] < 1) throw new Error(`${model.id} ${field} cannot be below 1.`);
        }
      }
      if (model.scheduled_rate_change) {
        isoDate(model.scheduled_rate_change.effective_at, `${model.id} scheduled rate date`);
        number(model.scheduled_rate_change.multiplier, `${model.id} scheduled rate multiplier`);
        if (model.scheduled_rate_change.multiplier <= 0) throw new Error(`${model.id} scheduled rate multiplier must be positive.`);
        if (model.scheduled_rate_change.status !== "published_not_active") throw new Error(`${model.id} scheduled rate status is unsupported.`);
      }
    });
    return catalog;
  }

  function selectCatalog(catalogs, usageDate) {
    const candidates = (Array.isArray(catalogs) ? catalogs : [catalogs]).map(validateCatalog);
    isoDate(usageDate, "Usage date");
    const eligible = candidates
      .filter((catalog) => catalog.effective_at <= usageDate)
      .sort((left, right) => right.effective_at.localeCompare(left.effective_at));
    if (!eligible.length) throw new Error(`No pricing catalog is effective for ${usageDate}.`);
    return eligible[0];
  }

  function requireCatalogDateCoverage(catalog, usageDate) {
    validateCatalog(catalog);
    isoDate(usageDate, "Pricing date");
    if (usageDate < catalog.effective_at) {
      throw new Error(`Pricing catalog ${catalog.catalog_version} is not effective until ${catalog.effective_at}.`);
    }
    if (usageDate > catalog.review_by) {
      throw new Error(`Pricing catalog ${catalog.catalog_version} passed its ${catalog.review_by} review date. Update and re-verify the official rates before calculating a current scenario.`);
    }
    return catalog;
  }

  function normalizeCustomModel(input) {
    const id = requiredText(input?.id || "custom/user-supplied-rate", "Custom rate ID", 120);
    if (!/^custom\/[a-z0-9][a-z0-9._-]*$/i.test(id)) throw new Error("Custom rate ID must start with custom/ and use letters, numbers, dots, underscores, or hyphens.");
    const provider = requiredText(input?.provider, "Custom rate provider", 80);
    const label = requiredText(input?.label, "Custom route name", 120);
    const effectiveAt = isoDate(input?.effective_at, "Custom rate effective date");
    const sourceNote = requiredText(input?.pricing_source_note, "Custom rate source note", 200);
    const customCacheWrite = input?.standard?.cache_write;
    const standard = {
      input: number(input?.standard?.input, "Custom input rate"),
      cached_input: number(input?.standard?.cached_input, "Custom cached-input rate"),
      output: number(input?.standard?.output, "Custom output rate"),
      ...(customCacheWrite === null || customCacheWrite === undefined || String(customCacheWrite).trim() === ""
        ? {}
        : { cache_write: number(customCacheWrite, "Custom cache-write rate") }),
    };
    const batchValues = [input?.batch?.input, input?.batch?.cached_input, input?.batch?.output];
    const batchSupplied = batchValues.filter((value) => value !== null && value !== undefined && String(value).trim() !== "").length;
    if (batchSupplied && batchSupplied !== 3) throw new Error("Supply all three custom batch rates or leave all three blank.");
    if (!batchSupplied && input?.batch?.cache_write !== null && input?.batch?.cache_write !== undefined && String(input.batch.cache_write).trim() !== "") {
      throw new Error("Supply all three custom batch rates before adding a custom batch cache-write rate.");
    }
    const customBatchCacheWrite = input?.batch?.cache_write;
    const batch = batchSupplied ? {
      input: number(batchValues[0], "Custom batch input rate"),
      cached_input: number(batchValues[1], "Custom batch cached-input rate"),
      output: number(batchValues[2], "Custom batch output rate"),
      ...(customBatchCacheWrite === null || customBatchCacheWrite === undefined || String(customBatchCacheWrite).trim() === ""
        ? {}
        : { cache_write: number(customBatchCacheWrite, "Custom batch cache-write rate") }),
    } : null;
    const contextWindow = optionalPositiveInteger(input?.context_window_tokens, "Custom context window");
    const maxOutput = optionalPositiveInteger(input?.max_output_tokens, "Custom maximum output tokens");
    if (contextWindow !== null && maxOutput !== null && maxOutput > contextWindow) {
      throw new Error("Custom maximum output tokens cannot exceed the custom context window.");
    }
    return {
      id,
      provider,
      label,
      model: requiredText(input?.model || label, "Custom model name", 120),
      standard,
      batch,
      flex: null,
      fast: null,
      priority: null,
      geography_multipliers: { global: 1 },
      long_context: null,
      context_window_tokens: contextWindow,
      input_token_limit: null,
      max_output_tokens: maxOutput,
      source_url: null,
      verified_at: null,
      effective_at: effectiveAt,
      pricing_basis: "user_supplied",
      pricing_source_note: sourceNote,
      note: "User-supplied USD rate per 1M tokens. AI Cost Lens did not verify it against a provider or contract.",
    };
  }

  function normalizeScenario(input) {
    const processingMode = String(input.processing_mode || (input.batch ? "batch" : "standard")).trim().toLowerCase();
    if (!PROCESSING_MODES.includes(processingMode)) throw new Error(`Processing mode must be one of: ${PROCESSING_MODES.join(", ")}.`);
    const cacheWriteDuration = String(input.cache_write_duration || "provider_default").trim().toLowerCase();
    if (!["provider_default", "5m", "1h"].includes(cacheWriteDuration)) throw new Error("Cache-write duration must be provider default, 5m, or 1h.");
    const pricingDate = input.pricing_date === null || input.pricing_date === undefined || String(input.pricing_date).trim() === ""
      ? null
      : isoDate(String(input.pricing_date), "Pricing date");
    return {
      input_tokens: number(input.input_tokens, "Input tokens", { integer: true }),
      output_tokens: number(input.output_tokens, "Expected output tokens", { integer: true }),
      calls_per_month: number(input.calls_per_month, "Calls per month", { integer: true }),
      retry_rate: number(input.retry_rate || 0, "Retry rate", { max: 1 }),
      cached_input_share: number(input.cached_input_share || 0, "Cached-input share", { max: 1 }),
      cache_refreshes_per_month: number(input.cache_refreshes_per_month || 0, "Cache refreshes per month", { integer: true }),
      cache_storage_token_hours_per_month: number(input.cache_storage_token_hours_per_month || 0, "Cache storage token-hours per month"),
      cache_write_duration: cacheWriteDuration,
      processing_mode: processingMode,
      geography: String(input.geography || "global").trim().toLowerCase(),
      pricing_date: pricingDate,
      batch: processingMode === "batch",
      usable_rate: input.usable_rate === "" || input.usable_rate === null || input.usable_rate === undefined
        ? null
        : number(input.usable_rate, "Expected usable rate", { max: 1 }),
    };
  }

  function availableProcessingModes(model) {
    return PROCESSING_MODES.filter((mode) => model?.[mode]);
  }

  function resolveRateProfile(model, scenario, routeOptions = {}) {
    const processingMode = String(routeOptions.processing_mode || scenario.processing_mode || (scenario.batch ? "batch" : "standard")).trim().toLowerCase();
    if (!PROCESSING_MODES.includes(processingMode)) throw new Error(`Processing mode must be one of: ${PROCESSING_MODES.join(", ")}.`);
    const baseRates = model[processingMode];
    if (!baseRates) {
      const available = availableProcessingModes(model).map((mode) => mode.replaceAll("_", " ")).join(", ");
      throw new Error(`${model.label} has no published ${processingMode} rate in this catalog. Available modes: ${available}.`);
    }
    const geography = String(routeOptions.geography || scenario.geography || "global").trim().toLowerCase();
    const geographyMultiplier = model.geography_multipliers?.[geography];
    if (geographyMultiplier === null || geographyMultiplier === undefined) {
      const available = Object.keys(model.geography_multipliers || { global: 1 }).join(", ");
      throw new Error(`${model.label} has no published ${geography} geography rate in this catalog. Available locations: ${available}.`);
    }
    const longContext = Boolean(model.long_context && scenario.input_tokens > model.long_context.input_threshold_tokens);
    const contextRates = Object.fromEntries(RATE_FIELDS.flatMap((field) => {
      if (baseRates[field] === null || baseRates[field] === undefined) return [];
      let multiplier = 1;
      if (longContext) {
        if (field === "input") multiplier = model.long_context.input_multiplier;
        else if (field === "cached_input") multiplier = model.long_context.cached_input_multiplier;
        else if (field.startsWith("cache_write")) multiplier = model.long_context.cache_write_multiplier || model.long_context.input_multiplier;
        else if (field === "output") multiplier = model.long_context.output_multiplier;
      }
      return [[field, round(baseRates[field] * multiplier * geographyMultiplier)]];
    }));
    return {
      processing_mode: processingMode,
      geography,
      geography_multiplier: geographyMultiplier,
      pricing_adjustment: longContext ? "long_context" : "standard_context",
      rates: contextRates,
    };
  }

  function cacheWriteRate(rates, duration) {
    if (rates.cache_write !== null && rates.cache_write !== undefined) return { field: "cache_write", rate: rates.cache_write };
    if (duration === "1h" && rates.cache_write_1h !== null && rates.cache_write_1h !== undefined) return { field: "cache_write_1h", rate: rates.cache_write_1h };
    if (rates.cache_write_5m !== null && rates.cache_write_5m !== undefined) return { field: "cache_write_5m", rate: rates.cache_write_5m };
    if (rates.cache_write_1h !== null && rates.cache_write_1h !== undefined) return { field: "cache_write_1h", rate: rates.cache_write_1h };
    return { field: null, rate: null };
  }

  function priceModel(model, rawScenario, routeOptions = {}) {
    const scenario = normalizeScenario(rawScenario);
    if (model.context_window_tokens && scenario.input_tokens + scenario.output_tokens > model.context_window_tokens) {
      throw new Error(`${model.label} cannot fit ${scenario.input_tokens + scenario.output_tokens} total tokens in its ${model.context_window_tokens}-token context window.`);
    }
    if (model.input_token_limit && scenario.input_tokens > model.input_token_limit) {
      throw new Error(`${model.label} cannot accept more than ${model.input_token_limit} input tokens.`);
    }
    if (model.max_output_tokens && scenario.output_tokens > model.max_output_tokens) {
      throw new Error(`${model.label} cannot return more than ${model.max_output_tokens} output tokens.`);
    }
    const profile = resolveRateProfile(model, scenario, routeOptions);
    const rates = profile.rates;
    const billedCalls = scenario.calls_per_month * (1 + scenario.retry_rate);
    if (scenario.cache_refreshes_per_month > billedCalls) throw new Error("Cache refreshes per month cannot exceed billed calls after retries.");
    const cachedTokensPerCall = scenario.input_tokens * scenario.cached_input_share;
    const uncachedTokensPerCall = scenario.input_tokens - cachedTokensPerCall;
    const cacheReadCalls = billedCalls - scenario.cache_refreshes_per_month;
    const writeRate = cacheWriteRate(rates, scenario.cache_write_duration);
    if (scenario.cache_refreshes_per_month && cachedTokensPerCall && writeRate.rate === null) {
      throw new Error(`${model.label} has no separately published cache-write token rate in this catalog. Set cache refreshes to zero or compare a route with a published write rate.`);
    }
    const uncachedInputCost = uncachedTokensPerCall * billedCalls * rates.input / 1_000_000;
    const cacheReadCost = cachedTokensPerCall * cacheReadCalls * rates.cached_input / 1_000_000;
    const cacheWriteCost = cachedTokensPerCall * scenario.cache_refreshes_per_month * (writeRate.rate || 0) / 1_000_000;
    const cacheStorageTokenHours = scenario.cache_storage_token_hours_per_month;
    const cacheStorageCost = cacheStorageTokenHours * (rates.cache_storage_per_1m_token_hour || 0) / 1_000_000;
    const outputCost = scenario.output_tokens * billedCalls * rates.output / 1_000_000;
    const monthly = uncachedInputCost + cacheReadCost + cacheWriteCost + cacheStorageCost + outputCost;
    const perCall = billedCalls ? monthly / billedCalls : 0;
    const expectedUsable = scenario.usable_rate === null ? null : scenario.calls_per_month * scenario.usable_rate;
    return {
      model_id: model.id,
      provider: model.provider,
      label: model.label,
      rate_tier: profile.processing_mode,
      processing_mode: profile.processing_mode,
      geography: profile.geography,
      geography_multiplier: profile.geography_multiplier,
      rates_per_1m_tokens: { ...rates },
      cache_write_rate_field: writeRate.field,
      pricing_adjustment: profile.pricing_adjustment,
      context_compatible: true,
      context_window_tokens: model.context_window_tokens || model.input_token_limit || null,
      max_output_tokens: model.max_output_tokens ?? null,
      pricing_basis: model.pricing_basis || "official_list",
      pricing_source_url: model.source_url || null,
      pricing_source_note: model.pricing_source_note || null,
      pricing_verified_at: model.verified_at || null,
      pricing_effective_at: model.effective_at || null,
      pricing_date: scenario.pricing_date || model.effective_at || null,
      estimated_monthly_cost_breakdown_usd: {
        uncached_input: round(uncachedInputCost),
        cache_read: round(cacheReadCost),
        cache_write: round(cacheWriteCost),
        cache_storage: round(cacheStorageCost),
        output: round(outputCost),
      },
      estimated_cost_per_call_usd: round(perCall),
      estimated_cost_per_1000_calls_usd: round(perCall * 1000),
      estimated_monthly_cost_usd: round(monthly),
      estimated_annual_cost_usd: round(monthly * 12),
      estimated_cost_per_usable_result_usd: expectedUsable === null || expectedUsable === 0 ? null : round(monthly / expectedUsable),
      billed_calls_per_month: round(billedCalls, 4),
      note: model.note,
    };
  }

  function compareModels(catalog, modelIds, scenario, tokenEstimates = {}, customModels = []) {
    validateCatalog(catalog);
    const byId = new Map(catalog.models.map((model) => [model.id, { ...model, effective_at: catalog.effective_at }]));
    customModels.map(normalizeCustomModel).forEach((model) => {
      if (byId.has(model.id)) throw new Error(`Custom rate ID ${model.id} conflicts with another route.`);
      byId.set(model.id, model);
    });
    const selectedRoutes = modelIds.filter((route) => typeof route === "string" ? Boolean(route) : Boolean(route?.model_id || route?.id)).map((route) => (
      typeof route === "string"
        ? { model_id: route }
        : { ...route, model_id: route.model_id || route.id }
    ));
    const uniqueIds = [...new Set(selectedRoutes.map((route) => route.model_id))];
    if (!selectedRoutes.length) throw new Error("Choose a current model.");
    if (uniqueIds.length !== selectedRoutes.length) throw new Error("Choose each comparison model only once. Change its processing mode inside the existing route instead of adding it twice.");
    if (uniqueIds.length > 4) throw new Error("Compare no more than four routes at once.");
    const results = selectedRoutes.map((route) => {
      const id = route.model_id;
      const model = byId.get(id);
      if (!model) throw new Error(`Model ${id} is not in pricing catalog ${catalog.catalog_version}.`);
      const estimate = tokenEstimates[id] || { tokens: scenario.input_tokens, method: "shared_scenario" };
      const inputTokens = number(estimate.tokens, `${model.label} input tokens`, { integer: true });
      return {
        ...priceModel(model, { ...scenario, input_tokens: inputTokens }, route),
        input_tokens: inputTokens,
        input_token_method: estimate.method || "shared_scenario",
      };
    });
    const current = results[0];
    return results.map((result, index) => ({
      ...result,
      role: index === 0 ? "current" : "alternative",
      monthly_difference_from_current_usd: round(result.estimated_monthly_cost_usd - current.estimated_monthly_cost_usd),
      annual_difference_from_current_usd: round(result.estimated_annual_cost_usd - current.estimated_annual_cost_usd),
    }));
  }

  function buildEstimateRecord(catalog, comparison, scenario, tokenEstimate, createdAt) {
    const normalized = normalizeScenario(scenario);
    const inputMethod = tokenEstimate?.method || comparison[0]?.input_token_method || "shared_scenario";
    const userSuppliedRateCount = comparison.filter((result) => result.pricing_basis === "user_supplied").length;
    const officialRateCount = comparison.length - userSuppliedRateCount;
    const rateSourceScope = userSuppliedRateCount && officialRateCount ? "mixed" : userSuppliedRateCount ? "user_supplied_only" : "official_list_only";
    return {
      schema_version: "ai-cost-lens-prompt-price-estimate/0.6",
      application_version: "0.5.0",
      created_at: createdAt || new Date().toISOString(),
      catalog: {
        schema_version: catalog.schema_version,
        version: catalog.catalog_version,
        effective_at: catalog.effective_at,
        review_by: catalog.review_by,
        currency: catalog.currency,
        source_urls: catalog.sources.map((source) => source.url),
      },
      estimate_basis: {
        status: "estimated",
        input_tokens: normalized.input_tokens,
        input_token_method: inputMethod,
        input_token_scope: new Set(comparison.map((result) => result.input_tokens)).size > 1 ? "model_specific" : "shared",
        model_token_estimates: comparison.map((result) => ({
          model_id: result.model_id,
          provider: result.provider,
          input_tokens: result.input_tokens,
          input_token_method: result.input_token_method === "shared_scenario" ? inputMethod : result.input_token_method,
        })),
        output_tokens: normalized.output_tokens,
        calls_per_month: normalized.calls_per_month,
        retry_rate: normalized.retry_rate,
        cached_input_share: normalized.cached_input_share,
        cache_refreshes_per_month: normalized.cache_refreshes_per_month,
        cache_write_duration: normalized.cache_write_duration,
        cache_storage_token_hours_per_month: normalized.cache_storage_token_hours_per_month,
        pricing_date: normalized.pricing_date || catalog.catalog_version,
        routes: comparison.map((result) => ({
          model_id: result.model_id,
          processing_mode: result.processing_mode,
          geography: result.geography,
        })),
        batch: comparison.every((result) => result.processing_mode === "batch"),
        expected_usable_rate: normalized.usable_rate,
        rate_source_scope: rateSourceScope,
        user_supplied_rate_count: userSuppliedRateCount,
        prompt_text_stored: false,
      },
      comparison,
      evidence_gate: {
        decision: "TEST_FIRST",
        savings_claim_allowed: false,
        missing: [
          "Observed provider bill for the same workload and period",
          "Comparable reviewed output sample for each route",
          "Observed human review and correction effort when material",
          ...(userSuppliedRateCount ? ["Independent confirmation that each user-supplied rate matches the applicable contract or rate card"] : []),
        ],
        reason: "Rate arithmetic can identify a route worth testing. It cannot prove equivalent quality, operating cost, or realized savings.",
      },
    };
  }

  return Object.freeze({
    PROCESSING_MODES,
    estimateInputTokens,
    validateCatalog,
    selectCatalog,
    requireCatalogDateCoverage,
    normalizeCustomModel,
    normalizeScenario,
    availableProcessingModes,
    resolveRateProfile,
    priceModel,
    compareModels,
    buildEstimateRecord,
  });
});
