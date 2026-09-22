(function attachUsageEventEngine(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AICostLensUsageEvents = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildUsageEventEngine() {
  "use strict";

  const SCHEMA = "ai-cost-lens-usage-event/1.0";
  const REVIEW_SCHEMA = "ai-cost-lens-usage-review/1.1";
  const MAX_ROWS = 20000;
  const ALLOCATION_DIMENSIONS = Object.freeze([
    ["project", "Project"],
    ["team_owner", "Team or owner"],
    ["feature", "Feature"],
    ["customer", "Customer"],
    ["product", "Product"],
    ["workload", "Workload"],
    ["workflow", "Workflow"],
    ["session_id", "Session"],
    ["environment", "Environment"],
  ]);
  const OPERATING_COST_CATEGORIES = Object.freeze([
    ["compute_cost", "Compute"],
    ["retrieval_data_cost", "Retrieval and data"],
    ["network_cost", "Network and egress"],
    ["tooling_cost", "Tooling and observability"],
    ["pipeline_cost", "Pipeline and orchestration"],
    ["human_review_cost", "Human review and correction"],
  ]);
  const round = (value, digits = 8) => Number(Number(value).toFixed(digits));
  const normalizeKey = (value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const aliases = Object.freeze({
    event_id: ["event_id", "request_id", "message_id", "generation_id", "observation_id", "helicone_id", "id"],
    timestamp: ["timestamp", "created_at", "start_time", "date", "time"],
    provider: ["provider", "provider_name"],
    billing_channel: ["billing_channel", "channel", "api_type"],
    processing_mode: ["processing_mode", "service_tier", "tier", "processing_tier"],
    inference_geography: ["inference_geography", "inference_geo", "data_region", "processing_region"],
    model: ["model", "model_id", "model_name"],
    project: ["project", "project_id", "project_name"],
    team_owner: ["team_owner", "team", "owner"],
    workload: ["workload", "use_case"],
    feature: ["feature", "feature_name"],
    workflow: ["workflow", "workflow_name", "route"],
    session_id: ["session_id", "session", "trace_id", "conversation_id"],
    environment: ["environment", "environment_name", "deployment_environment", "env"],
    customer: ["customer", "customer_id", "tenant", "tenant_id"],
    product: ["product", "product_id", "application", "application_id"],
    customer_product: ["customer_product"],
    input_tokens: ["input_tokens", "prompt_tokens", "usage_details_input", "input_usage"],
    output_tokens: ["output_tokens", "completion_tokens", "usage_details_output", "output_usage"],
    reasoning_tokens: ["reasoning_tokens", "output_reasoning_tokens", "usage_details_reasoning"],
    cached_input_tokens: ["cached_input_tokens", "cache_read_input_tokens", "cached_tokens", "usage_details_cached_tokens"],
    cache_write_tokens: ["cache_write_tokens", "cache_creation_input_tokens", "usage_details_cache_write_tokens"],
    cache_write_duration_seconds: ["cache_write_duration_seconds", "cache_duration_seconds"],
    cache_storage_token_hours: ["cache_storage_token_hours", "cached_token_hours", "context_cache_token_hours"],
    batch: ["batch", "is_batch"],
    tool_charges: ["tool_charges", "tool_cost", "tool_cost_usd"],
    provider_reported_cost: ["provider_reported_cost", "provider_cost", "cost_usd", "total_cost", "cost"],
    calculated_cost: ["calculated_cost", "calculated_cost_usd"],
    currency: ["currency", "currency_code"],
    request_status: ["request_status", "status"],
    retry_parent_event_id: ["retry_parent_event_id", "parent_event_id", "retry_of"],
    latency_ms: ["latency_ms", "duration_ms"],
    evidence_source: ["evidence_source", "source"],
    prefix_fingerprint: ["prefix_fingerprint", "prompt_prefix_hash", "context_fingerprint"],
    tool_call_count: ["tool_call_count", "tool_calls"],
    outcome_status: ["outcome_status", "result_status"],
  });

  function valueMap(row) {
    const result = new Map();
    Object.entries(row).forEach(([key, value]) => {
      const normalized = normalizeKey(key);
      if (!normalized) throw new Error("Every request-log column needs a non-empty name.");
      if (result.has(normalized)) throw new Error(`Multiple request-log columns normalize to ${normalized}. Rename one column before importing.`);
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

  function text(value, label, max = 240) {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const result = String(value).trim();
    if (result.length > max) throw new Error(`${label} exceeds ${max} characters.`);
    return result;
  }

  function number(value, label, { integer = false } = {}) {
    if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;
    const result = Number(value);
    if (!Number.isFinite(result) || result < 0 || (integer && !Number.isSafeInteger(result))) {
      throw new Error(`${label} must be a non-negative${integer ? " whole" : ""} number or blank.`);
    }
    return result;
  }

  function boolean(value, label) {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    if (value === true || value === 1 || /^(true|yes|y|1|batch)$/i.test(String(value).trim())) return true;
    if (value === false || value === 0 || /^(false|no|n|0|standard)$/i.test(String(value).trim())) return false;
    throw new Error(`${label} must be true, false, yes, no, 1, 0, or blank.`);
  }

  function processingMode(value, batch, label) {
    if (value === null || value === undefined || String(value).trim() === "") return batch === null ? null : batch ? "batch" : "standard";
    const raw = text(value, label, 40).toLowerCase().replace(/[-\s]+/g, "_");
    if (!/^[a-z0-9][a-z0-9._]*$/.test(raw)) throw new Error(`${label} contains unsupported characters.`);
    const normalized = raw === "default" ? "standard" : raw;
    const pricedModes = ["standard", "batch", "flex", "fast", "priority"];
    if (batch !== null && pricedModes.includes(normalized) && ((batch && normalized !== "batch") || (!batch && normalized === "batch"))) {
      throw new Error(`${label} conflicts with the batch flag.`);
    }
    return normalized;
  }

  function timestamp(value, label) {
    const result = text(value, label, 80);
    if (result === null) return null;
    const parsed = Date.parse(result);
    if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid date or timestamp.`);
    return new Date(parsed).toISOString();
  }

  function providerFromModel(model) {
    if (!model) return null;
    if (/^(gpt-|o\d|openai\/)/i.test(model)) return "OpenAI";
    if (/^(claude-|anthropic\/)/i.test(model)) return "Anthropic";
    if (/^(gemini-|google\/)/i.test(model)) return "Google";
    return null;
  }

  function findModel(catalog, provider, modelName) {
    if (!catalog || !Array.isArray(catalog.models) || !modelName) return null;
    const target = String(modelName).toLowerCase();
    const matches = catalog.models.filter((item) =>
      [item.id, item.model, item.label].some((candidate) => String(candidate || "").toLowerCase() === target)
      && (!provider || String(item.provider).toLowerCase() === String(provider).toLowerCase()),
    );
    return matches.length === 1 ? matches[0] : null;
  }

  function calculatedTokenCost(event, catalog) {
    const model = findModel(catalog, event.provider, event.model);
    if (!model || event.input_tokens === null || event.output_tokens === null) return null;
    if (event.currency !== catalog.currency || event.processing_mode === null || event.cached_input_tokens === null || event.tool_charges === null || !event.timestamp) return null;
    const eventDate = event.timestamp.slice(0, 10);
    if (eventDate < catalog.effective_at || eventDate > catalog.review_by) return null;
    const pricedMode = event.processing_mode === "priority" && model.provider === "OpenAI" && model.fast ? "fast" : event.processing_mode;
    const base = model[pricedMode];
    if (!base) return null;
    const hasSeparateWriteRate = ["cache_write", "cache_write_5m", "cache_write_1h"].some((field) => base[field] !== null && base[field] !== undefined);
    if (hasSeparateWriteRate && event.cache_write_tokens === null) return null;
    if (base.cache_storage_per_1m_token_hour !== null && base.cache_storage_per_1m_token_hour !== undefined && event.cached_input_tokens > 0 && event.cache_storage_token_hours === null) return null;
    if (event.cached_input_tokens + (event.cache_write_tokens || 0) > event.input_tokens) return null;
    if (model.context_window_tokens && event.input_tokens + event.output_tokens > model.context_window_tokens) return null;
    if (model.input_token_limit && event.input_tokens > model.input_token_limit) return null;
    if (model.max_output_tokens && event.output_tokens > model.max_output_tokens) return null;
    const inputThreshold = model.long_context?.input_threshold_tokens;
    const longContext = inputThreshold && event.input_tokens > inputThreshold;
    const geography = event.inference_geography || "global";
    const geographyMultiplier = model.geography_multipliers?.[geography];
    if (geographyMultiplier === null || geographyMultiplier === undefined) return null;
    const multiplier = (field) => {
      if (!longContext) return geographyMultiplier;
      if (field === "input") return model.long_context.input_multiplier * geographyMultiplier;
      if (field === "cached_input") return model.long_context.cached_input_multiplier * geographyMultiplier;
      if (field.startsWith("cache_write")) return (model.long_context.cache_write_multiplier || model.long_context.input_multiplier) * geographyMultiplier;
      if (field === "output") return model.long_context.output_multiplier * geographyMultiplier;
      return geographyMultiplier;
    };
    const rates = Object.fromEntries(Object.entries(base).map(([field, value]) => [field, value * multiplier(field)]));
    const cached = event.cached_input_tokens;
    const cacheWrite = event.cache_write_tokens || 0;
    let cacheWriteRate = rates.cache_write;
    if (cacheWrite && (cacheWriteRate === null || cacheWriteRate === undefined)) {
      if (event.cache_write_duration_seconds === null || event.cache_write_duration_seconds <= 0) return null;
      cacheWriteRate = event.cache_write_duration_seconds > 300 ? rates.cache_write_1h : rates.cache_write_5m;
      if (cacheWriteRate === null || cacheWriteRate === undefined) return null;
    }
    const uncached = event.input_tokens - cached - cacheWrite;
    const storageCost = event.cache_storage_token_hours === null
      ? 0
      : event.cache_storage_token_hours * (rates.cache_storage_per_1m_token_hour || 0) / 1_000_000;
    const tokenCost = (
      uncached * rates.input
      + cached * rates.cached_input
      + cacheWrite * (cacheWriteRate || 0)
      + event.output_tokens * rates.output
    ) / 1_000_000 + storageCost;
    return round(tokenCost + event.tool_charges);
  }

  function normalizeStatus(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) return null;
    if (/^(ok|success|succeeded|completed|complete)$/.test(raw) || /^2\d\d$/.test(raw)) return "success";
    if (/^(fail|failed|error|errored|timeout|timed_out)$/.test(raw) || /^[45]\d\d$/.test(raw)) return "failed";
    if (/^(cancel|cancelled|canceled)$/.test(raw)) return "cancelled";
    if (/^(retry|retried)$/.test(raw)) return "retried";
    return "unknown";
  }

  function normalizeRow(row, index, options) {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`Row ${index + 1} must be one flat object.`);
    if (Object.values(row).some((value) => value !== null && typeof value === "object")) throw new Error(`Row ${index + 1} must not contain nested data.`);
    const map = valueMap(row);
    const model = text(pick(map, "model"), `Row ${index + 1} model`);
    const provider = text(pick(map, "provider"), `Row ${index + 1} provider`) || providerFromModel(model);
    const reported = number(pick(map, "provider_reported_cost"), `Row ${index + 1} provider-reported cost`);
    const suppliedCalculated = number(pick(map, "calculated_cost"), `Row ${index + 1} calculated cost`);
    const currencyRaw = text(pick(map, "currency"), `Row ${index + 1} currency`, 3);
    const batch = boolean(pick(map, "batch"), `Row ${index + 1} batch flag`);
    const mode = processingMode(pick(map, "processing_mode"), batch, `Row ${index + 1} processing mode`);
    const rawInputTokens = number(pick(map, "input_tokens"), `Row ${index + 1} input tokens`, { integer: true });
    const cachedInputTokens = number(pick(map, "cached_input_tokens"), `Row ${index + 1} cached input tokens`, { integer: true });
    const cacheWriteTokens = number(pick(map, "cache_write_tokens"), `Row ${index + 1} cache-write tokens`, { integer: true });
    const rawAnthropicCacheFields = String(provider || "").toLowerCase() === "anthropic"
      && !map.has("cached_input_tokens")
      && !map.has("cache_write_tokens")
      && (map.has("cache_read_input_tokens") || map.has("cache_creation_input_tokens"));
    const inputTokens = rawAnthropicCacheFields && rawInputTokens !== null
      ? rawInputTokens + (cachedInputTokens || 0) + (cacheWriteTokens || 0)
      : rawInputTokens;
    const event = {
      schema_version: SCHEMA,
      record_id: `row-${String(index + 1).padStart(6, "0")}`,
      event_id: text(pick(map, "event_id"), `Row ${index + 1} event ID`),
      timestamp: timestamp(pick(map, "timestamp"), `Row ${index + 1} timestamp`),
      provider,
      billing_channel: text(pick(map, "billing_channel"), `Row ${index + 1} billing channel`),
      processing_mode: mode,
      inference_geography: text(pick(map, "inference_geography"), `Row ${index + 1} inference geography`, 40)?.toLowerCase() || null,
      model,
      project: text(pick(map, "project"), `Row ${index + 1} project`),
      team_owner: text(pick(map, "team_owner"), `Row ${index + 1} team or owner`),
      workload: text(pick(map, "workload"), `Row ${index + 1} workload`) || "Unassigned workload",
      feature: text(pick(map, "feature"), `Row ${index + 1} feature`),
      workflow: text(pick(map, "workflow"), `Row ${index + 1} workflow`),
      session_id: text(pick(map, "session_id"), `Row ${index + 1} session ID`),
      environment: text(pick(map, "environment"), `Row ${index + 1} environment`),
      customer: text(pick(map, "customer"), `Row ${index + 1} customer`),
      product: text(pick(map, "product"), `Row ${index + 1} product`),
      customer_product: text(pick(map, "customer_product"), `Row ${index + 1} customer or product`),
      input_tokens: inputTokens,
      output_tokens: number(pick(map, "output_tokens"), `Row ${index + 1} output tokens`, { integer: true }),
      reasoning_tokens: number(pick(map, "reasoning_tokens"), `Row ${index + 1} reasoning tokens`, { integer: true }),
      cached_input_tokens: cachedInputTokens,
      cache_write_tokens: cacheWriteTokens,
      cache_write_duration_seconds: number(pick(map, "cache_write_duration_seconds"), `Row ${index + 1} cache duration`),
      cache_storage_token_hours: number(pick(map, "cache_storage_token_hours"), `Row ${index + 1} cache storage token-hours`),
      batch: batch === null ? mode === null ? null : mode === "batch" : batch,
      tool_charges: number(pick(map, "tool_charges"), `Row ${index + 1} tool charges`),
      provider_reported_cost: reported,
      calculated_cost: suppliedCalculated,
      currency: currencyRaw ? currencyRaw.toUpperCase() : options.defaultCurrency,
      request_status: normalizeStatus(pick(map, "request_status")),
      retry_parent_event_id: text(pick(map, "retry_parent_event_id"), `Row ${index + 1} retry parent ID`),
      latency_ms: number(pick(map, "latency_ms"), `Row ${index + 1} latency`),
      evidence_source: text(pick(map, "evidence_source"), `Row ${index + 1} evidence source`) || options.sourceName,
      source_file_hash: options.sourceFileHash || null,
      prefix_fingerprint: text(pick(map, "prefix_fingerprint"), `Row ${index + 1} prefix fingerprint`),
      tool_call_count: number(pick(map, "tool_call_count"), `Row ${index + 1} tool-call count`, { integer: true }),
      outcome_status: text(pick(map, "outcome_status"), `Row ${index + 1} outcome status`),
      duplicate_group: null,
    };
    if (!event.customer_product) event.customer_product = [event.customer, event.product].filter(Boolean).join(" · ") || null;
    if (event.currency && !/^[A-Z]{3}$/.test(event.currency)) throw new Error(`Row ${index + 1} currency must be a three-letter code.`);
    if (event.reasoning_tokens !== null && event.output_tokens !== null && event.reasoning_tokens > event.output_tokens) {
      throw new Error(`Row ${index + 1} reasoning tokens cannot exceed output tokens.`);
    }
    if (event.cached_input_tokens !== null && event.input_tokens !== null && event.cached_input_tokens > event.input_tokens) {
      throw new Error(`Row ${index + 1} cached input tokens cannot exceed input tokens.`);
    }
    if (event.input_tokens !== null && (event.cached_input_tokens || 0) + (event.cache_write_tokens || 0) > event.input_tokens) {
      throw new Error(`Row ${index + 1} cache-read and cache-write tokens cannot exceed input tokens.`);
    }
    if (event.calculated_cost === null) event.calculated_cost = calculatedTokenCost(event, options.catalog);
    event.selected_cost = event.provider_reported_cost !== null ? event.provider_reported_cost : event.calculated_cost;
    event.cost_basis = event.provider_reported_cost !== null ? "provider_reported" : event.calculated_cost !== null ? "calculated" : "unpriced";
    return event;
  }

  function markDuplicates(events) {
    const groups = new Map();
    events.forEach((event) => {
      if (!event.event_id) return;
      const key = `${String(event.provider || "unknown").toLowerCase()}\u0000${event.event_id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(event);
    });
    let groupNumber = 0;
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      groupNumber += 1;
      const group = `duplicate-${String(groupNumber).padStart(3, "0")}`;
      members.forEach((event) => { event.duplicate_group = group; });
    }
  }

  function detectAdapter(rows) {
    const keys = new Set(Object.keys(rows[0] || {}).map(normalizeKey));
    if (["generation_id", "is_byok", "upstream_inference_cost"].some((key) => keys.has(key))) return "OpenRouter flat usage";
    if (["trace_id", "observation_id", "usage_details_input", "cost_details_total"].some((key) => keys.has(key))) return "Langfuse flat observation export";
    if (["helicone_id", "helicone_user", "helicone_property"].some((key) => keys.has(key))) return "Helicone flat request export";
    if (["cache_creation_input_tokens", "cache_read_input_tokens", "message_id"].some((key) => keys.has(key))) return "Anthropic-compatible request log";
    if (["prompt_tokens", "completion_tokens", "request_id"].every((key) => keys.has(key))) return "OpenAI-compatible request log";
    return "Universal flat request log";
  }

  function normalizeRows(rows, rawOptions = {}) {
    if (!Array.isArray(rows) || !rows.length) throw new Error("The request log needs at least one row.");
    if (rows.length > MAX_ROWS) throw new Error(`The request log exceeds ${MAX_ROWS.toLocaleString("en-US")} rows.`);
    const defaultCurrency = rawOptions.default_currency === null || rawOptions.default_currency === undefined || String(rawOptions.default_currency).trim() === ""
      ? null
      : String(rawOptions.default_currency).trim().toUpperCase();
    const options = {
      catalog: rawOptions.catalog || null,
      sourceName: text(rawOptions.source_name, "Source name") || "Local request-log import",
      sourceFileHash: text(rawOptions.source_file_hash, "Source-file hash", 128),
      defaultCurrency,
    };
    if (options.defaultCurrency && !/^[A-Z]{3}$/.test(options.defaultCurrency)) throw new Error("Default currency must be a three-letter code.");
    const events = rows.map((row, index) => normalizeRow(row, index, options));
    markDuplicates(events);
    return events;
  }

  function median(values) {
    const sorted = values.filter((value) => value !== null).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function percentile(values, probability) {
    const sorted = values.filter((value) => value !== null).sort((a, b) => a - b);
    if (!sorted.length) return null;
    if (sorted.length === 1) return sorted[0];
    const position = (sorted.length - 1) * probability;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
  }

  function eventAmountMap(events, selector = (event) => event.selected_cost) {
    return Object.fromEntries(events.flatMap((event) => {
      const amount = selector(event);
      return amount !== null && amount > 0 ? [[event.record_id, round(amount)]] : [];
    }));
  }

  function finding(input) {
    const amounts = input.event_avoidable_costs || {};
    const total = Object.values(amounts).reduce((sum, value) => sum + value, 0);
    return {
      schema_version: "ai-cost-lens-opportunity/1.0",
      category: "Investigation",
      title: "",
      explanation: "",
      affected_scope: "",
      current_cost: null,
      estimated_avoidable_cost: Object.keys(amounts).length ? round(total) : null,
      calculation: "Not quantified from the available request records.",
      evidence_basis: "observed",
      confidence: "directional",
      confidence_in_dollar_estimate: "not_quantified",
      quality_or_operational_risk: "Requires review before action.",
      overlap_group: null,
      affected_event_ids: [],
      event_avoidable_costs: amounts,
      verification_requirement: "Inspect the affected requests before changing behavior.",
      suggested_next_step: "Investigate",
      action: "investigate",
      limitations: "The imported fields bound this finding.",
      headline_eligible: false,
      ...input,
    };
  }

  function analysisWorkload(event) {
    return allocationValuePresent(event.workload)
      ? event.workload
      : event.workflow || event.feature || "Unassigned workload";
  }

  function scope(events) {
    const workloads = [...new Set(events.map(analysisWorkload))];
    return workloads.length === 1 ? workloads[0] : `${workloads.length} workloads`;
  }

  function rateForEvent(event, catalog, kind) {
    if (!catalog || event.currency !== catalog.currency || event.batch === null) return null;
    const model = findModel(catalog, event.provider, event.model);
    if (!model) return null;
    const base = event.batch ? model.batch : model.standard;
    if (!base) return null;
    const longContext = model.long_context && event.input_tokens > model.long_context.input_threshold_tokens;
    if (!longContext) return base[kind];
    const multiplier = kind === "output" ? model.long_context.output_multiplier : kind === "cached_input" ? model.long_context.cached_input_multiplier : model.long_context.input_multiplier;
    return base[kind] * multiplier;
  }

  function priceShapeWithModel(event, model) {
    if (event.batch === null || event.cached_input_tokens === null || event.cache_write_tokens > 0) return null;
    if (!model || event.input_tokens === null || event.output_tokens === null) return null;
    const total = event.input_tokens + event.output_tokens;
    if (model.context_window_tokens && total > model.context_window_tokens) return null;
    if (model.input_token_limit && event.input_tokens > model.input_token_limit) return null;
    if (model.max_output_tokens && event.output_tokens > model.max_output_tokens) return null;
    const base = event.batch ? model.batch : model.standard;
    if (!base) return null;
    const longContext = model.long_context && event.input_tokens > model.long_context.input_threshold_tokens;
    const rates = longContext ? {
      input: base.input * model.long_context.input_multiplier,
      cached_input: base.cached_input * model.long_context.cached_input_multiplier,
      output: base.output * model.long_context.output_multiplier,
    } : base;
    const cached = event.cached_input_tokens || 0;
    if (cached > event.input_tokens) return null;
    return round(((event.input_tokens - cached) * rates.input + cached * rates.cached_input + event.output_tokens * rates.output) / 1_000_000);
  }

  function analyzeEvents(events, catalog) {
    const findings = [];
    const pricedEvents = events.filter((event) => event.selected_cost !== null);
    const pricedCurrencies = [...new Set(pricedEvents.map((event) => event.currency).filter(Boolean))];
    const pricedCurrencyMissing = pricedEvents.some((event) => !event.currency);
    const currencyComparable = pricedCurrencies.length <= 1 && !pricedCurrencyMissing;
    const duplicateGroups = new Map();
    events.filter((event) => event.duplicate_group).forEach((event) => {
      if (!duplicateGroups.has(event.duplicate_group)) duplicateGroups.set(event.duplicate_group, []);
      duplicateGroups.get(event.duplicate_group).push(event);
    });
    if (duplicateGroups.size) {
      const duplicateCopies = [...duplicateGroups.values()].flatMap((members) => members.slice(1));
      findings.push(finding({
        id: "duplicate-billed-event",
        kind: "duplicate_billed_event",
        category: "Billing integrity",
        title: "Repeated event identifiers need reconciliation",
        explanation: "The same provider and event identifier appears more than once. Rows remain intact; the later copies are flagged, not deleted.",
        affected_scope: scope(duplicateCopies),
        current_cost: round(duplicateCopies.reduce((sum, event) => sum + (event.selected_cost || 0), 0)),
        event_avoidable_costs: eventAmountMap(duplicateCopies),
        calculation: "Sum of priced copies after the first row in each repeated provider/event-ID group.",
        evidence_basis: "observed",
        confidence: "high",
        confidence_in_dollar_estimate: duplicateCopies.every((event) => event.selected_cost !== null) ? "high" : "partial",
        overlap_group: "request-waste",
        affected_event_ids: duplicateCopies.map((event) => event.record_id),
        verification_requirement: "Match each flagged row to the provider invoice or source log before reversing a charge.",
        suggested_next_step: "Reconcile duplicate identifiers",
        action: "reconcile",
        limitations: "Repeated identifiers can represent source duplication, rebilling, or a legitimate provider-specific record pattern.",
        headline_eligible: true,
      }));
    }

    const failedOrRetried = events.filter((event) => ["failed", "cancelled", "retried"].includes(event.request_status) || event.retry_parent_event_id);
    if (failedOrRetried.length) {
      findings.push(finding({
        id: "failed-or-retried-request-cost",
        kind: "failed_or_retried_request_cost",
        category: "Reliability",
        title: "Failed and retried calls consumed priced usage",
        explanation: "These calls are linked to a failure, cancellation, or retry. The amount is a review boundary, not proof that every retry was avoidable.",
        affected_scope: scope(failedOrRetried),
        current_cost: round(failedOrRetried.reduce((sum, event) => sum + (event.selected_cost || 0), 0)),
        event_avoidable_costs: eventAmountMap(failedOrRetried),
        calculation: "Sum of selected event cost, using provider-reported cost before calculated token cost.",
        evidence_basis: "observed",
        confidence: "high",
        confidence_in_dollar_estimate: failedOrRetried.every((event) => event.selected_cost !== null) ? "high" : "partial",
        overlap_group: "request-waste",
        affected_event_ids: failedOrRetried.map((event) => event.record_id),
        verification_requirement: "Separate necessary resilience retries from loops caused by configuration, validation, or provider errors.",
        suggested_next_step: "Classify retry causes",
        action: "investigate",
        limitations: "Retries can preserve reliability. The full affected cost is not automatically recoverable.",
        headline_eligible: true,
      }));
    }

    const loopRoots = new Map();
    events.filter((event) => event.retry_parent_event_id).forEach((event) => {
      if (!loopRoots.has(event.retry_parent_event_id)) loopRoots.set(event.retry_parent_event_id, []);
      loopRoots.get(event.retry_parent_event_id).push(event);
    });
    const loopEvents = [...loopRoots.values()].filter((members) => members.length >= 2).flat();
    if (loopEvents.length) findings.push(finding({
      id: "repeated-error-loop",
      kind: "repeated_error_loop",
      category: "Reliability",
      title: "Some requests entered repeated retry chains",
      explanation: "At least two retries point to the same parent event. Fixing the cause may be safer than increasing retry limits.",
      affected_scope: scope(loopEvents),
      current_cost: round(loopEvents.reduce((sum, event) => sum + (event.selected_cost || 0), 0)),
      event_avoidable_costs: eventAmountMap(loopEvents),
      calculation: "Cost of retry rows in parent-event groups containing at least two retries.",
      evidence_basis: "observed",
      confidence: "high",
      confidence_in_dollar_estimate: loopEvents.every((event) => event.selected_cost !== null) ? "high" : "partial",
      overlap_group: "request-waste",
      affected_event_ids: loopEvents.map((event) => event.record_id),
      verification_requirement: "Review error codes and stop conditions for each retry chain.",
      suggested_next_step: "Fix the repeated failure cause",
      action: "investigate",
      limitations: "This overlaps the failed-and-retried finding and is not added again in the headline.",
      headline_eligible: true,
    }));

    const prefixGroups = new Map();
    events.filter((event) => event.prefix_fingerprint && event.input_tokens !== null).forEach((event) => {
      const key = `${analysisWorkload(event)}\u0000${event.prefix_fingerprint}`;
      if (!prefixGroups.has(key)) prefixGroups.set(key, []);
      prefixGroups.get(key).push(event);
    });
    const cacheCandidates = [...prefixGroups.values()].filter((members) => members.length >= 3).flatMap((members) => members.filter((event) => event.cached_input_tokens === 0));
    if (cacheCandidates.length) {
      const amounts = eventAmountMap(cacheCandidates, (event) => {
        const input = rateForEvent(event, catalog, "input");
        const cached = rateForEvent(event, catalog, "cached_input");
        return input === null || cached === null ? null : event.input_tokens * Math.max(0, input - cached) / 1_000_000;
      });
      findings.push(finding({
        id: "low-cache-use-with-repeated-prefix",
        kind: "low_cache_use_with_repeated_prefix",
        category: "Caching",
        title: "Repeated prefixes show little or no cache reuse",
        explanation: "A supplied prefix fingerprint repeats at least three times, while the affected rows report no cached input.",
        affected_scope: scope(cacheCandidates),
        current_cost: round(cacheCandidates.reduce((sum, event) => sum + (event.selected_cost || 0), 0)),
        event_avoidable_costs: amounts,
        calculation: Object.keys(amounts).length ? "Upper-bound difference between published uncached-input and cached-input rates for affected tokens." : "No amount because an exact catalog model or token count was unavailable.",
        evidence_basis: "inferred",
        confidence: "medium",
        confidence_in_dollar_estimate: Object.keys(amounts).length ? "estimated" : "not_quantified",
        overlap_group: "input-efficiency",
        affected_event_ids: cacheCandidates.map((event) => event.record_id),
        verification_requirement: "Confirm provider cache eligibility, prefix stability, minimum token thresholds, writes, TTL, and storage charges.",
        suggested_next_step: "Test one stable cacheable prefix",
        action: "verify",
        limitations: "The amount is an upper bound. A fingerprint does not prove every token qualifies for cache pricing.",
        headline_eligible: false,
      }));
    }

    const byWorkload = new Map();
    events.forEach((event) => {
      const workload = analysisWorkload(event);
      if (!byWorkload.has(workload)) byWorkload.set(workload, []);
      byWorkload.get(workload).push(event);
    });
    const oversizedInput = [];
    const excessiveOutput = [];
    const reasoning = [];
    const repeatedTools = [];
    for (const members of byWorkload.values()) {
      const inputMedian = median(members.map((event) => event.input_tokens));
      const outputMedian = median(members.map((event) => event.output_tokens));
      const toolMedian = median(members.map((event) => event.tool_call_count));
      members.forEach((event) => {
        if (members.length >= 5 && inputMedian !== null && inputMedian >= 100 && event.input_tokens > inputMedian * 2) oversizedInput.push({ event, median: inputMedian });
        if (members.length >= 5 && outputMedian !== null && outputMedian >= 20 && event.output_tokens > outputMedian * 2) excessiveOutput.push({ event, median: outputMedian });
        if (event.reasoning_tokens !== null && event.output_tokens > 0 && event.reasoning_tokens / event.output_tokens >= 0.6 && (outputMedian === null || event.output_tokens <= outputMedian * 1.25)) reasoning.push(event);
        if (event.tool_call_count !== null && event.tool_call_count >= Math.max(4, (toolMedian || 0) * 2)) repeatedTools.push(event);
      });
    }
    if (oversizedInput.length) {
      const amounts = eventAmountMap(oversizedInput.map((item) => item.event), (event) => {
        const item = oversizedInput.find((candidate) => candidate.event === event);
        const rate = rateForEvent(event, catalog, "input");
        return rate === null ? null : (event.input_tokens - item.median) * rate / 1_000_000;
      });
      findings.push(finding({
        id: "oversized-input-candidate", kind: "oversized_input_candidate", category: "Context reduction", title: "Some inputs are more than twice their workload median",
        explanation: "These calls carry substantially more input than comparable calls in the same imported workload.", affected_scope: scope(oversizedInput.map((item) => item.event)),
        current_cost: round(oversizedInput.reduce((sum, item) => sum + (item.event.selected_cost || 0), 0)), event_avoidable_costs: amounts,
        calculation: "Estimated token-rate difference between each affected input and its workload median.", evidence_basis: "inferred", confidence: "medium",
        confidence_in_dollar_estimate: Object.keys(amounts).length ? "estimated" : "not_quantified", overlap_group: "input-efficiency",
        affected_event_ids: oversizedInput.map((item) => item.event.record_id), verification_requirement: "Inspect context requirements and output quality before trimming input.",
        suggested_next_step: "Compare the affected context with typical calls", action: "verify",
        limitations: "Larger inputs may reflect legitimately harder tasks. The workload median is not an optimal prompt length.", headline_eligible: false,
      }));
    }
    if (excessiveOutput.length) {
      const amounts = eventAmountMap(excessiveOutput.map((item) => item.event), (event) => {
        const item = excessiveOutput.find((candidate) => candidate.event === event);
        const rate = rateForEvent(event, catalog, "output");
        return rate === null ? null : (event.output_tokens - item.median) * rate / 1_000_000;
      });
      findings.push(finding({
        id: "excessive-output-candidate", kind: "excessive_output_candidate", category: "Output control", title: "Some outputs are more than twice their workload median",
        explanation: "These calls produced materially more output than comparable calls in the same workload.", affected_scope: scope(excessiveOutput.map((item) => item.event)),
        current_cost: round(excessiveOutput.reduce((sum, item) => sum + (item.event.selected_cost || 0), 0)), event_avoidable_costs: amounts,
        calculation: "Estimated output-token-rate difference between each affected output and its workload median.", evidence_basis: "inferred", confidence: "medium",
        confidence_in_dollar_estimate: Object.keys(amounts).length ? "estimated" : "not_quantified", overlap_group: "output-efficiency",
        affected_event_ids: excessiveOutput.map((item) => item.event.record_id), verification_requirement: "Confirm the required response length and test a bounded output limit.",
        suggested_next_step: "Test a shorter output contract", action: "verify",
        limitations: "The median is not a quality requirement; longer outputs can be necessary.", headline_eligible: false,
      }));
    }
    if (reasoning.length) findings.push(finding({
      id: "reasoning-intensity-candidate", kind: "reasoning_intensity_candidate", category: "Reasoning control", title: "Reasoning tokens dominate some short-output calls",
      explanation: "Reasoning represents at least 60% of output tokens on affected calls whose total output is near the workload median.", affected_scope: scope(reasoning),
      current_cost: round(reasoning.reduce((sum, event) => sum + (event.selected_cost || 0), 0)), evidence_basis: "observed", confidence: "medium",
      overlap_group: "output-efficiency", affected_event_ids: reasoning.map((event) => event.record_id), verification_requirement: "Test a lower reasoning setting on the same tasks and score quality.",
      suggested_next_step: "Run a controlled reasoning-level test", action: "verify",
      limitations: "Token shape does not reveal task difficulty or prove that reasoning was unnecessary.", headline_eligible: false,
    }));
    if (repeatedTools.length) findings.push(finding({
      id: "repeated-tool-call-candidate", kind: "repeated_tool_call_candidate", category: "Tooling", title: "Tool-call counts are unusually high for their workload",
      explanation: "Affected calls use at least four tools and at least twice their workload median.", affected_scope: scope(repeatedTools),
      current_cost: round(repeatedTools.reduce((sum, event) => sum + (event.selected_cost || 0), 0)), evidence_basis: "observed", confidence: "medium",
      overlap_group: "request-waste", affected_event_ids: repeatedTools.map((event) => event.record_id), verification_requirement: "Inspect tool-selection traces for loops, invalid arguments, and redundant reads.",
      suggested_next_step: "Review repeated tool sequences", action: "investigate",
      limitations: "A high count can be necessary for multi-step work; no avoidable amount is assigned without per-tool evidence.", headline_eligible: false,
    }));

    const mismatchEvents = [];
    const mismatchAmounts = {};
    const mismatchAlternatives = new Map();
    for (const [workload, members] of byWorkload.entries()) {
      const models = [...new Map(members.map((event) => {
        const model = findModel(catalog, event.provider, event.model);
        return model ? [model.id, model] : null;
      }).filter(Boolean)).values()];
      if (models.length < 2) continue;
      members.forEach((event) => {
        if (!catalog || event.currency !== catalog.currency) return;
        const currentModel = findModel(catalog, event.provider, event.model);
        const current = priceShapeWithModel(event, currentModel);
        if (current === null || current <= 0) return;
        const candidates = models
          .filter((model) => model.id !== currentModel.id)
          .map((model) => ({ model, cost: priceShapeWithModel(event, model) }))
          .filter((item) => item.cost !== null)
          .sort((left, right) => left.cost - right.cost);
        const cheapest = candidates[0];
        if (!cheapest || current < cheapest.cost * 1.5) return;
        mismatchEvents.push(event);
        mismatchAmounts[event.record_id] = round(current - cheapest.cost);
        mismatchAlternatives.set(workload, cheapest.model.label);
      });
    }
    if (mismatchEvents.length) findings.push(finding({
      id: "model-mismatch-candidate", kind: "model_mismatch_candidate", category: "Routing and downsizing", title: "A lower-priced model already appears in the same workload",
      explanation: "Affected calls use a catalog model whose token-shape price is at least 50% above another model observed in that workload. This nominates a route test; it does not prove the tasks or quality are equivalent.",
      affected_scope: scope(mismatchEvents), current_cost: round(mismatchEvents.reduce((sum, event) => sum + (event.selected_cost || 0), 0)), event_avoidable_costs: mismatchAmounts,
      calculation: "Reprice each affected call's observed input, cached-input, output, and batch shape with the lowest-priced catalog model already present in that workload.",
      evidence_basis: "estimated", confidence: "medium", confidence_in_dollar_estimate: "estimated", overlap_group: "model-route",
      affected_event_ids: mismatchEvents.map((event) => event.record_id), verification_requirement: "Run the same representative tasks through the candidate route and apply the same quality, policy, latency, and human-review gates.",
      suggested_next_step: `Test the observed lower-priced route${mismatchAlternatives.size === 1 ? ` (${[...mismatchAlternatives.values()][0]})` : ""}`,
      action: "verify", limitations: "Shared workload labels do not establish equal task difficulty, capabilities, output length, or usable-result yield.", headline_eligible: false,
    }));

    const noOutcome = pricedEvents.filter((event) => !event.outcome_status);
    const noOutcomeHasCost = noOutcome.some((event) => event.selected_cost > 0);
    const pricedTotal = currencyComparable ? pricedEvents.reduce((sum, event) => sum + event.selected_cost, 0) : null;
    const noOutcomeCost = currencyComparable ? noOutcome.reduce((sum, event) => sum + event.selected_cost, 0) : null;
    if (noOutcome.length && noOutcomeHasCost) findings.push(finding({
      id: "spend-without-outcome-evidence", kind: "spend_without_outcome_evidence", category: "Evidence", title: "Some priced usage has no outcome evidence",
      explanation: currencyComparable
        ? `${round(noOutcomeCost / pricedTotal * 100, 1)}% of selected request cost cannot be connected to a supplied result status.`
        : `${noOutcome.length} of ${pricedEvents.length} priced requests cannot be connected to a supplied result status. A cost share is not calculated because the request currency boundary is not comparable.`,
      affected_scope: scope(noOutcome),
      current_cost: currencyComparable ? round(noOutcomeCost) : null,
      calculation: currencyComparable
        ? "Selected cost on priced events with a blank outcome status divided by all selected request cost."
        : "Count of priced events with a blank outcome status. No cross-currency cost ratio is calculated.",
      evidence_basis: "calculated", confidence: "high", confidence_in_dollar_estimate: "not_quantified", overlap_group: "outcome-evidence",
      affected_event_ids: noOutcome.map((event) => event.record_id), verification_requirement: "Join a non-sensitive result identifier or outcome status before comparing cost per usable result.",
      suggested_next_step: "Join outcome status to request records", action: "improve_evidence",
      limitations: "Missing outcome data is an evidence gap, not proof that the spend produced no value.", headline_eligible: false,
    }));

    const pricedByWorkload = currencyComparable
      ? [...byWorkload.entries()].map(([name, members]) => ({ name, cost: members.reduce((sum, event) => sum + (event.selected_cost || 0), 0), events: members }))
      : [];
    const totalCost = pricedByWorkload.reduce((sum, item) => sum + item.cost, 0);
    const largest = pricedByWorkload.sort((left, right) => right.cost - left.cost)[0];
    if (largest && totalCost > 0 && pricedByWorkload.length > 1 && largest.cost / totalCost >= 0.5) findings.push(finding({
      id: "spend-concentration", kind: "spend_concentration", category: "Allocation", title: "One workload drives most observed request cost",
      explanation: `${largest.name} accounts for ${round(largest.cost / totalCost * 100, 1)}% of priced request cost in this import.`, affected_scope: largest.name,
      current_cost: round(largest.cost), calculation: "Largest workload selected cost divided by total selected cost.", evidence_basis: "calculated", confidence: "high",
      overlap_group: "spend-concentration", affected_event_ids: largest.events.map((event) => event.record_id), verification_requirement: "Confirm workload ownership and unit economics before prioritizing changes.",
      suggested_next_step: "Review the dominant workload first", action: "investigate",
      limitations: "Concentration is a prioritization signal, not waste.", headline_eligible: false,
    }));

    const dayMap = new Map();
    if (currencyComparable) {
      events.filter((event) => event.timestamp && event.selected_cost !== null).forEach((event) => {
        const day = event.timestamp.slice(0, 10);
        if (!dayMap.has(day)) dayMap.set(day, { day, cost: 0, events: [] });
        const bucket = dayMap.get(day);
        bucket.cost += event.selected_cost;
        bucket.events.push(event);
      });
    }
    const days = [...dayMap.values()].sort((left, right) => left.day.localeCompare(right.day));
    const spikeDays = [];
    for (let index = 7; index < days.length; index += 1) {
      const current = days[index];
      const prior = days.slice(index - 7, index);
      const priorCost = prior.reduce((sum, day) => sum + day.cost, 0);
      const priorEvents = prior.reduce((sum, day) => sum + day.events.length, 0);
      const referencePerEvent = priorEvents ? priorCost / priorEvents : null;
      const expectedAtVolume = referencePerEvent === null ? null : referencePerEvent * current.events.length;
      const medianDailyCost = median(prior.map((day) => day.cost));
      if (expectedAtVolume === null || medianDailyCost === null || expectedAtVolume <= 0) continue;
      const excess = current.cost - expectedAtVolume;
      if (current.cost >= medianDailyCost * 2 && current.cost >= expectedAtVolume * 1.5 && excess > 0.01) {
        spikeDays.push({ ...current, expected_at_volume: expectedAtVolume, excess, reference_per_event: referencePerEvent });
      }
    }
    if (spikeDays.length) {
      const affected = spikeDays.flatMap((day) => day.events);
      const observed = spikeDays.reduce((sum, day) => sum + day.cost, 0);
      const expected = spikeDays.reduce((sum, day) => sum + day.expected_at_volume, 0);
      findings.push(finding({
        id: "cost-spike-unexplained-by-volume",
        kind: "cost_spike_unexplained_by_volume",
        category: "Variance",
        title: "Request cost spiked beyond what call volume explains",
        explanation: `${spikeDays.length} UTC day${spikeDays.length === 1 ? "" : "s"} cost at least twice the preceding seven active-day median and at least 50% above the preceding per-request cost applied to that day's volume. Observed cost was ${round(observed, 4)} versus a volume-adjusted reference of ${round(expected, 4)} ${pricedCurrencies[0] || "currency units"}.`,
        affected_scope: scope(affected),
        current_cost: round(observed),
        calculation: "For each day after seven prior active days: prior-seven-day selected cost ÷ prior request count × current request count. Flag only when observed daily cost is at least 2× the prior active-day median and 1.5× the volume-adjusted reference.",
        evidence_basis: "calculated",
        confidence: "medium",
        confidence_in_dollar_estimate: "not_quantified",
        overlap_group: "cost-variance",
        affected_event_ids: affected.map((event) => event.record_id),
        verification_requirement: "Compare model mix, token shape, cache share, tool charges, service tier, and provider rate changes on the flagged UTC days.",
        suggested_next_step: "Explain the unit-cost change before calling it waste",
        action: "investigate",
        limitations: "The reference uses active days present in the import, not a complete billing calendar. Mix, task difficulty, or missing rows can explain the change. No avoidable amount or savings claim is assigned.",
        headline_eligible: false,
      }));
    }
    findings.forEach((item) => {
      const affectedIds = new Set(item.affected_event_ids);
      const affected = events.filter((event) => affectedIds.has(event.record_id));
      if (affected.length && affected.every((event) => event.selected_cost === null)) item.current_cost = null;
    });
    return findings.sort((left, right) => {
      const tier = (item) => item.headline_eligible ? 0 : item.estimated_avoidable_cost !== null ? 1 : 2;
      const tierDifference = tier(left) - tier(right);
      if (tierDifference) return tierDifference;
      const amountDifference = (right.estimated_avoidable_cost || 0) - (left.estimated_avoidable_cost || 0);
      return amountDifference || left.id.localeCompare(right.id);
    });
  }

  function headline(findings) {
    const union = new Map();
    findings.filter((item) => item.headline_eligible).forEach((item) => {
      Object.entries(item.event_avoidable_costs || {}).forEach(([id, amount]) => union.set(id, Math.max(union.get(id) || 0, amount)));
    });
    return {
      conservative_non_additive_opportunity: union.size ? round([...union.values()].reduce((sum, amount) => sum + amount, 0)) : null,
      priced_affected_event_count: union.size,
      method: "Union of priced event records across high-confidence duplicate, failed, retry, and error-loop findings. Overlapping event cost is counted once.",
      savings_claim_allowed: false,
    };
  }

  function spendBreakdown(events, field, currencyComparable, selectedTotal) {
    const groups = new Map();
    events.forEach((event) => {
      const label = event[field] || "Not supplied";
      if (!groups.has(label)) groups.set(label, { label, event_count: 0, priced_rows: 0, selected_cost: 0 });
      const item = groups.get(label);
      item.event_count += 1;
      if (event.selected_cost !== null) {
        item.priced_rows += 1;
        item.selected_cost += event.selected_cost;
      }
    });
    return [...groups.values()].map((item) => ({
      ...item,
      selected_cost: currencyComparable && item.priced_rows ? round(item.selected_cost) : null,
      average_selected_cost_per_priced_row: currencyComparable && item.priced_rows
        ? round(item.selected_cost / item.priced_rows)
        : null,
      share_of_selected_cost: currencyComparable && selectedTotal > 0 && item.priced_rows
        ? round(item.selected_cost / selectedTotal, 6)
        : null,
    })).sort((left, right) => {
      const costDifference = (right.selected_cost || 0) - (left.selected_cost || 0);
      return costDifference || right.event_count - left.event_count || left.label.localeCompare(right.label);
    });
  }

  function sourceHasField(rows, field) {
    const names = new Set(aliases[field]);
    return rows.some((row) => Object.keys(row).some((key) => names.has(normalizeKey(key))));
  }

  function operationalSummary(events, sourceRows = []) {
    const recognizedStatuses = new Set(["success", "failed", "cancelled", "retried"]);
    const statusRows = events.filter((event) => recognizedStatuses.has(event.request_status));
    const failedRows = statusRows.filter((event) => ["failed", "cancelled"].includes(event.request_status));
    const retryRows = events.filter((event) => event.request_status === "retried" || event.retry_parent_event_id);
    // A success/failure status says nothing about whether a call was a retry.
    // An explicitly present parent column (blank means no link) covers only its own row.
    const retryCoverageRows = events.filter((event, index) =>
      event.request_status === "retried" || event.retry_parent_event_id
      || sourceHasField([sourceRows[index] || {}], "retry_parent_event_id"),
    ).length;
    const cacheRows = events.filter((event) => event.input_tokens !== null && event.cached_input_tokens !== null);
    const cacheInputTokens = cacheRows.reduce((sum, event) => sum + event.input_tokens, 0);
    const cachedInputTokens = cacheRows.reduce((sum, event) => sum + event.cached_input_tokens, 0);
    const latencies = events.map((event) => event.latency_ms).filter((value) => value !== null);
    const outcomes = events.filter((event) => event.outcome_status);
    return {
      status_coverage_rows: statusRows.length,
      failed_or_cancelled_rows: failedRows.length,
      failed_or_cancelled_rate: statusRows.length ? round(failedRows.length / statusRows.length, 6) : null,
      retry_coverage_rows: retryCoverageRows,
      retry_linked_rows: retryRows.length,
      retry_linked_rate: retryCoverageRows ? round(retryRows.length / retryCoverageRows, 6) : null,
      cache_coverage_rows: cacheRows.length,
      cache_input_tokens: cacheInputTokens || (cacheRows.length ? 0 : null),
      cached_input_tokens: cachedInputTokens || (cacheRows.length ? 0 : null),
      cache_share: cacheRows.length && cacheInputTokens > 0 ? round(cachedInputTokens / cacheInputTokens, 6) : null,
      latency_coverage_rows: latencies.length,
      median_latency_ms: latencies.length ? round(percentile(latencies, 0.5), 4) : null,
      p95_latency_ms: latencies.length ? round(percentile(latencies, 0.95), 4) : null,
      outcome_coverage_rows: outcomes.length,
    };
  }

  function addUtcDays(date, days) {
    const timestamp = Date.parse(`${date}T00:00:00Z`) + days * 86400000;
    return new Date(timestamp).toISOString().slice(0, 10);
  }

  function periodVariance(events, period, currency, currencyComparable) {
    const limitations = [];
    if (!period.complete_period_confirmed) limitations.push("Complete continuous period not confirmed");
    if (period.timestamped_rows !== events.length) limitations.push("Some rows have no timestamp");
    if (events.some((event) => event.selected_cost === null)) limitations.push("Some rows are unpriced");
    if (!currencyComparable || !currency) limitations.push("Request currency is missing or mixed");
    if (period.calendar_days === null || period.calendar_days < 14) limitations.push("Fewer than 14 calendar days supplied");
    const windowDays = period.calendar_days === null || period.calendar_days < 2
      ? null
      : Math.floor(period.calendar_days / 2);
    let priorStart = null;
    let priorEnd = null;
    let currentStart = null;
    let currentEnd = null;
    let priorEvents = [];
    let currentEvents = [];
    if (!limitations.length) {
      currentEnd = period.end;
      currentStart = addUtcDays(currentEnd, -(windowDays - 1));
      priorEnd = addUtcDays(currentStart, -1);
      priorStart = addUtcDays(priorEnd, -(windowDays - 1));
      priorEvents = events.filter((event) => event.timestamp.slice(0, 10) >= priorStart && event.timestamp.slice(0, 10) <= priorEnd);
      currentEvents = events.filter((event) => event.timestamp.slice(0, 10) >= currentStart && event.timestamp.slice(0, 10) <= currentEnd);
      if (!priorEvents.length || !currentEvents.length) limitations.push("One comparison window has no requests");
    }
    if (limitations.length) {
      return {
        status: "NOT_SUPPORTED",
        currency,
        window_days: windowDays,
        excluded_leading_days: period.calendar_days && windowDays ? period.calendar_days - windowDays * 2 : null,
        prior_period: { start: priorStart, end: priorEnd, requests: priorEvents.length, selected_cost: null, cost_per_request: null },
        current_period: { start: currentStart, end: currentEnd, requests: currentEvents.length, selected_cost: null, cost_per_request: null },
        total_cost_change: null,
        total_cost_change_rate: null,
        request_volume_effect: null,
        average_cost_per_request_effect: null,
        top_provider_cost_changes: [],
        top_model_cost_changes: [],
        top_processing_mode_cost_changes: [],
        top_geography_cost_changes: [],
        limitations,
        method: "Two equal consecutive UTC windows. Total cost change equals request-volume effect plus average-cost-per-request effect; the latter can reflect model mix, token shape, cache, tools, service tier, or price and is not treated as a rate-card change.",
        savings_claim_allowed: false,
      };
    }
    const cost = (members) => members.reduce((sum, event) => sum + event.selected_cost, 0);
    const priorCost = cost(priorEvents);
    const currentCost = cost(currentEvents);
    const priorUnitCost = priorCost / priorEvents.length;
    const currentUnitCost = currentCost / currentEvents.length;
    const totalChange = round(currentCost - priorCost);
    const volumeEffect = round((currentEvents.length - priorEvents.length) * priorUnitCost);
    const unitCostEffect = round(totalChange - volumeEffect);
    const dimensionCosts = (members, labelFor) => {
      const result = new Map();
      members.forEach((event) => {
        const label = labelFor(event);
        result.set(label, (result.get(label) || 0) + event.selected_cost);
      });
      return result;
    };
    const topChanges = (priorMembers, currentMembers, labelFor) => {
      const priorValues = dimensionCosts(priorMembers, labelFor);
      const currentValues = dimensionCosts(currentMembers, labelFor);
      const labels = [...new Set([...priorValues.keys(), ...currentValues.keys()])];
      return labels.map((label) => {
        const prior = priorValues.get(label) || 0;
        const current = currentValues.get(label) || 0;
        return { label, prior_cost: round(prior), current_cost: round(current), change: round(current - prior) };
      }).sort((left, right) => Math.abs(right.change) - Math.abs(left.change) || left.label.localeCompare(right.label)).slice(0, 5);
    };
    return {
      status: "AVAILABLE",
      currency,
      window_days: windowDays,
      excluded_leading_days: period.calendar_days - windowDays * 2,
      prior_period: { start: priorStart, end: priorEnd, requests: priorEvents.length, selected_cost: round(priorCost), cost_per_request: round(priorUnitCost) },
      current_period: { start: currentStart, end: currentEnd, requests: currentEvents.length, selected_cost: round(currentCost), cost_per_request: round(currentUnitCost) },
      total_cost_change: totalChange,
      total_cost_change_rate: priorCost > 0 ? round((currentCost - priorCost) / priorCost, 6) : null,
      request_volume_effect: volumeEffect,
      average_cost_per_request_effect: unitCostEffect,
      top_provider_cost_changes: topChanges(
        priorEvents,
        currentEvents,
        (event) => event.provider || "Provider not supplied",
      ),
      top_model_cost_changes: topChanges(
        priorEvents,
        currentEvents,
        (event) => `${event.provider || "Provider not supplied"} · ${event.model || "Model not supplied"}`,
      ),
      top_processing_mode_cost_changes: topChanges(
        priorEvents,
        currentEvents,
        (event) => event.processing_mode || "Processing mode not supplied",
      ),
      top_geography_cost_changes: topChanges(
        priorEvents,
        currentEvents,
        (event) => event.inference_geography || "Geography not supplied",
      ),
      limitations: [],
      method: "Two equal consecutive UTC windows. Total cost change equals request-volume effect plus average-cost-per-request effect; the latter can reflect model mix, token shape, cache, tools, service tier, or price and is not treated as a rate-card change.",
      savings_claim_allowed: false,
    };
  }

  function budgetSummary(rawOptions, runRateStatus, projected30DayCost, currency) {
    const amount = number(rawOptions.monthly_budget, "Monthly budget");
    const thresholdRaw = rawOptions.budget_warning_threshold;
    const threshold = thresholdRaw === null || thresholdRaw === undefined || String(thresholdRaw).trim() === ""
      ? 0.8
      : number(thresholdRaw, "Budget warning threshold");
    if (amount !== null && amount <= 0) throw new Error("Monthly budget must be greater than zero or blank.");
    if (threshold <= 0 || threshold > 1) throw new Error("Budget warning threshold must be greater than 0% and no greater than 100%.");
    if (amount === null) {
      return {
        status: "NOT_SUPPLIED", monthly_budget: null, warning_threshold: threshold, projected_30_day_cost: projected30DayCost,
        projected_utilization: null, projected_variance_to_budget: null, projected_budget_remaining: null, currency,
        method: "Optional user-supplied monthly budget compared with the evidence-gated 30-day straight-line run rate. This is a local threshold check, not a live alert or forecast.",
        savings_claim_allowed: false,
      };
    }
    if (runRateStatus !== "AVAILABLE" || projected30DayCost === null) {
      return {
        status: "RUN_RATE_UNAVAILABLE", monthly_budget: round(amount), warning_threshold: threshold, projected_30_day_cost: null,
        projected_utilization: null, projected_variance_to_budget: null, projected_budget_remaining: null, currency,
        method: "Optional user-supplied monthly budget compared with the evidence-gated 30-day straight-line run rate. This is a local threshold check, not a live alert or forecast.",
        savings_claim_allowed: false,
      };
    }
    const utilization = projected30DayCost / amount;
    const status = utilization > 1 ? "OVER" : utilization >= threshold ? "WATCH" : "WITHIN";
    return {
      status,
      monthly_budget: round(amount),
      warning_threshold: threshold,
      projected_30_day_cost: projected30DayCost,
      projected_utilization: round(utilization, 6),
      projected_variance_to_budget: round(projected30DayCost - amount),
      projected_budget_remaining: round(amount - projected30DayCost),
      currency,
      method: "Optional user-supplied monthly budget compared with the evidence-gated 30-day straight-line run rate. This is a local threshold check, not a live alert or forecast.",
      savings_claim_allowed: false,
    };
  }

  function operatingCostStack(rawOptions, selectedObservedCost, currency, currencyComparable, allRequestsPriced = true) {
    const categories = OPERATING_COST_CATEGORIES.map(([key, label]) => {
      const amount = number(rawOptions[key], label);
      return { key, label, amount: amount === null ? null : round(amount), supplied: amount !== null };
    });
    const supplied = categories.filter((item) => item.supplied);
    const knownAdjacentCost = supplied.length
      ? round(supplied.reduce((sum, item) => sum + item.amount, 0))
      : null;
    const comparableProviderCost = currencyComparable && selectedObservedCost !== null
      ? round(selectedObservedCost)
      : null;
    const knownOperatingCost = comparableProviderCost === null
      ? null
      : round(comparableProviderCost + (knownAdjacentCost || 0));
    const complete = allRequestsPriced && categories.every((item) => item.supplied);
    const status = comparableProviderCost === null
      ? "NOT_COMPARABLE"
      : complete
        ? "FULLY_LOADED"
        : supplied.length || !allRequestsPriced
          ? "PARTIAL"
          : "PROVIDER_ONLY";
    return {
      status,
      currency,
      provider_request_cost: comparableProviderCost,
      categories,
      known_adjacent_cost: knownAdjacentCost,
      known_operating_cost: knownOperatingCost,
      fully_loaded_cost: complete ? knownOperatingCost : null,
      missing_categories: categories.filter((item) => !item.supplied).map((item) => item.key),
      method: "Known operating cost equals selected provider request cost plus only the period-level cost categories explicitly supplied. Additional categories must exclude charges already included in provider request cost or another category. Fully loaded cost appears only when every request is priced and compute, retrieval/data, network, tooling, pipeline, and human review are each supplied; enter zero only when confirmed none. These totals are not spread across requests or allocation dimensions.",
      savings_claim_allowed: false,
    };
  }

  function allocationValuePresent(value) {
    if (value === null || value === undefined || String(value).trim() === "") return false;
    return !/^(unattributed|unassigned|unassigned workload|not supplied|unknown|n\/a)$/i.test(String(value).trim());
  }

  function allocationSummary(events, rawOptions, costStack, currencyComparable) {
    const basis = normalizeKey(rawOptions.allocation_basis || "workload");
    if (!ALLOCATION_DIMENSIONS.some(([key]) => key === basis)) {
      throw new Error(`Allocation basis must be one of: ${ALLOCATION_DIMENSIONS.map(([key]) => key).join(", ")}.`);
    }
    const rawThreshold = rawOptions.allocation_warning_threshold;
    const threshold = rawThreshold === null || rawThreshold === undefined || String(rawThreshold).trim() === ""
      ? 0.1
      : number(rawThreshold, "Allocation warning threshold");
    if (threshold > 1) throw new Error("Allocation warning threshold cannot exceed 100%.");
    const total = currencyComparable ? costStack.known_operating_cost : null;
    const adjacentUnallocated = costStack.known_adjacent_cost || 0;
    const priced = events.filter((event) => event.selected_cost !== null);
    const unpricedRows = events.length - priced.length;
    const dimensions = Object.fromEntries(ALLOCATION_DIMENSIONS.map(([key, label]) => {
      const allocated = currencyComparable
        ? priced.filter((event) => allocationValuePresent(event[key])).reduce((sum, event) => sum + event.selected_cost, 0)
        : null;
      const allocatedRows = priced.filter((event) => allocationValuePresent(event[key])).length;
      const unallocated = total === null || allocated === null ? null : Math.max(0, total - allocated);
      return [key, {
        label,
        allocated_priced_rows: allocatedRows,
        unallocated_priced_rows: priced.length - allocatedRows,
        allocated_cost: allocated === null ? null : round(allocated),
        unallocated_cost: unallocated === null ? null : round(unallocated),
        unallocated_cost_pct: total && unallocated !== null ? round(unallocated / total, 6) : null,
      }];
    }));
    const selected = dimensions[basis];
    let status = "NOT_SUPPORTED";
    let reason = "Comparable positive cost is required before allocation coverage can support a decision.";
    if (currencyComparable && unpricedRows) {
      reason = `${unpricedRows} request row${unpricedRows === 1 ? " is" : "s are"} unpriced. Price every row before using allocation coverage to support a decision.`;
    } else if (total > 0 && selected.unallocated_cost_pct !== null) {
      status = selected.unallocated_cost_pct > threshold ? "WARN" : "PASS";
      reason = status === "PASS"
        ? `${selected.label} leaves ${(selected.unallocated_cost_pct * 100).toFixed(1)}% of known operating cost unallocated, within the ${(threshold * 100).toFixed(1)}% review limit.`
        : `${selected.label} leaves ${(selected.unallocated_cost_pct * 100).toFixed(1)}% of known operating cost unallocated, above the ${(threshold * 100).toFixed(1)}% review limit. Improve attribution or narrow the decision scope before relying on this dimension.`;
    }
    return {
      cost_basis: "known_operating_cost",
      total_known_operating_cost: total,
      period_level_cost_kept_unallocated: currencyComparable && costStack.known_adjacent_cost !== null
        ? round(adjacentUnallocated)
        : null,
      dimensions,
      decision_support: {
        basis,
        warning_threshold: threshold,
        status,
        decision_ready: status === "PASS",
        reason,
        policy_note: "The threshold is a user-set AI Cost Lens review policy, not an industry standard. A pass clears only this allocation check, not the other evidence or savings gates.",
        savings_claim_allowed: false,
      },
      method: "Allocation percentages use known operating cost. Request-level provider cost is allocated only when the selected field is present. Period-level compute, retrieval/data, network, tooling, pipeline, and human costs remain unallocated; AI Cost Lens never spreads them automatically.",
    };
  }

  function evidenceLayers(events, bill) {
    const usageRows = events.filter((event) => [
      event.input_tokens,
      event.output_tokens,
      event.cached_input_tokens,
      event.cache_write_tokens,
      event.processing_mode,
      event.inference_geography,
      event.request_status,
      event.latency_ms,
      event.tool_call_count,
      event.outcome_status,
    ].some((value) => value !== null && value !== undefined));
    const reportedRows = events.filter((event) => event.provider_reported_cost !== null).length;
    const calculatedRows = events.filter((event) => event.provider_reported_cost === null && event.calculated_cost !== null).length;
    const requestCostStatus = reportedRows && calculatedRows
      ? "MIXED"
      : reportedRows
        ? "PROVIDER_REPORTED"
        : calculatedRows
          ? "CALCULATED"
          : "UNPRICED";
    let billingStatus = bill.status === "NOT_SUPPLIED" ? "NOT_SUPPLIED" : "NOT_COMPARABLE";
    if (bill.status === "COMPARABLE") {
      billingStatus = bill.raw_selected_cost_difference === 0 ? "RECONCILED" : "VARIANCE";
    }
    return {
      usage_telemetry: {
        status: usageRows.length === events.length ? "AVAILABLE" : usageRows.length ? "PARTIAL" : "NOT_SUPPLIED",
        rows_with_usage_signals: usageRows.length,
        total_rows: events.length,
        purpose: "Fast operational evidence for request shape, reliability, cache, latency, routing, and outcome coverage. It is not an invoice.",
      },
      request_cost: {
        status: requestCostStatus,
        provider_reported_rows: reportedRows,
        calculated_rows: calculatedRows,
        unpriced_rows: events.length - reportedRows - calculatedRows,
        purpose: "Request-level cost supports diagnosis. Provider-reported values take precedence over catalog calculations for the same row.",
      },
      billing_evidence: {
        status: billingStatus,
        source_status: bill.status,
        supplied_total: bill.supplied_total,
        raw_request_cost_difference: bill.raw_selected_cost_difference,
        purpose: "Billing evidence confirms finance actuals for a matching provider, account, currency, and period. A reconciled bill still does not prove business value or savings.",
      },
      precedence_rule: "Use telemetry to investigate quickly, then use comparable billing evidence to confirm the financial boundary. Keep calculated cost, request cost, and billed cost visibly separate.",
    };
  }

  function spendSummary(events, rawOptions, currency, selectedObservedCost, currencyComparable) {
    const dated = events.filter((event) => event.timestamp);
    const dates = dated.map((event) => event.timestamp.slice(0, 10)).sort();
    const periodStart = dates[0] || null;
    const periodEnd = dates.at(-1) || null;
    const calendarDays = periodStart && periodEnd
      ? Math.round((Date.parse(`${periodEnd}T00:00:00Z`) - Date.parse(`${periodStart}T00:00:00Z`)) / 86400000) + 1
      : null;
    const activeDays = new Set(dates).size;
    const pricedRows = events.filter((event) => event.selected_cost !== null).length;
    const completePeriodConfirmed = Boolean(rawOptions.period_complete_confirmed);
    const runRateLimitations = [];
    if (!completePeriodConfirmed) runRateLimitations.push("Complete continuous period not confirmed");
    if (dated.length !== events.length) runRateLimitations.push("Some rows have no timestamp");
    if (calendarDays === null || calendarDays < 7) runRateLimitations.push("Fewer than 7 calendar days supplied");
    if (pricedRows !== events.length) runRateLimitations.push("Some rows are unpriced");
    if (!currencyComparable || !currency) runRateLimitations.push("Request currency is missing or mixed");
    if (selectedObservedCost === null) runRateLimitations.push("Selected request cost is unavailable");
    const runRateAvailable = runRateLimitations.length === 0;
    const period = {
      start: periodStart,
      end: periodEnd,
      calendar_days: calendarDays,
      active_days: activeDays,
      timestamped_rows: dated.length,
      complete_period_confirmed: completePeriodConfirmed,
    };
    const projected30DayCost = runRateAvailable ? round(selectedObservedCost / calendarDays * 30) : null;
    const costStack = operatingCostStack(rawOptions, selectedObservedCost, currency, currencyComparable, pricedRows === events.length);
    return {
      currency,
      period,
      selected_cost: currencyComparable ? selectedObservedCost : null,
      cost_per_priced_request: currencyComparable && selectedObservedCost !== null && pricedRows
        ? round(selectedObservedCost / pricedRows)
        : null,
      average_cost_per_calendar_day: runRateAvailable ? round(selectedObservedCost / calendarDays) : null,
      projected_30_day_cost: projected30DayCost,
      run_rate_status: runRateAvailable ? "AVAILABLE" : "NOT_SUPPORTED",
      run_rate_method: "Selected request cost divided by the inclusive UTC calendar span, multiplied by 30. Requires a user-confirmed complete period of at least seven days with every row timestamped, priced, and in one comparable currency.",
      run_rate_limitations: runRateLimitations,
      cost_stack: costStack,
      allocation: allocationSummary(events, rawOptions, costStack, currencyComparable),
      budget: budgetSummary(rawOptions, runRateAvailable ? "AVAILABLE" : "NOT_SUPPORTED", projected30DayCost, currency),
      period_variance: periodVariance(events, period, currency, currencyComparable),
      operational_metrics: operationalSummary(events, rawOptions.source_rows || []),
      breakdowns: {
        provider: spendBreakdown(events, "provider", currencyComparable, selectedObservedCost),
        model: spendBreakdown(events, "model", currencyComparable, selectedObservedCost),
        processing_mode: spendBreakdown(events, "processing_mode", currencyComparable, selectedObservedCost),
        inference_geography: spendBreakdown(events, "inference_geography", currencyComparable, selectedObservedCost),
        project: spendBreakdown(events, "project", currencyComparable, selectedObservedCost),
        team_owner: spendBreakdown(events, "team_owner", currencyComparable, selectedObservedCost),
        feature: spendBreakdown(events, "feature", currencyComparable, selectedObservedCost),
        customer: spendBreakdown(events, "customer", currencyComparable, selectedObservedCost),
        product: spendBreakdown(events, "product", currencyComparable, selectedObservedCost),
        workload: spendBreakdown(events, "workload", currencyComparable, selectedObservedCost),
        workflow: spendBreakdown(events, "workflow", currencyComparable, selectedObservedCost),
        session_id: spendBreakdown(events, "session_id", currencyComparable, selectedObservedCost),
        environment: spendBreakdown(events, "environment", currencyComparable, selectedObservedCost),
        customer_product: spendBreakdown(events, "customer_product", currencyComparable, selectedObservedCost),
      },
    };
  }

  function buildReview(rows, rawOptions = {}) {
    const events = normalizeRows(rows, rawOptions);
    const reviewOptions = { ...rawOptions, source_rows: rows };
    const priced = events.filter((event) => event.selected_cost !== null);
    const pricedCurrencies = [...new Set(priced.map((event) => event.currency).filter(Boolean))];
    const pricedCurrencyMissing = priced.some((event) => !event.currency);
    let findings = analyzeEvents(events, rawOptions.catalog || null);
    const reportedEvents = events.filter((event) => event.provider_reported_cost !== null);
    const calculatedOnlyEvents = events.filter((event) => event.provider_reported_cost === null && event.calculated_cost !== null);
    const reportedCost = reportedEvents.length
      ? reportedEvents.reduce((sum, event) => sum + event.provider_reported_cost, 0)
      : null;
    const calculatedOnlyCost = calculatedOnlyEvents.length
      ? calculatedOnlyEvents.reduce((sum, event) => sum + event.calculated_cost, 0)
      : null;
    const seenDuplicateGroups = new Set();
    const duplicateExcludedEvents = events.filter((event) => {
      if (!event.duplicate_group) return true;
      if (seenDuplicateGroups.has(event.duplicate_group)) return false;
      seenDuplicateGroups.add(event.duplicate_group);
      return true;
    });
    const pricedDuplicateExcludedEvents = duplicateExcludedEvents.filter((event) => event.selected_cost !== null);
    const duplicateExcludedCost = pricedDuplicateExcludedEvents.length
      ? pricedDuplicateExcludedEvents.reduce((sum, event) => sum + event.selected_cost, 0)
      : null;
    let reviewHeadline = headline(findings);
    const mixedCurrency = pricedCurrencies.length > 1;
    const currencyNotComparable = mixedCurrency || pricedCurrencyMissing;
    const billTotal = number(rawOptions.billed_total, "Billed total");
    const billCurrency = rawOptions.billed_currency === null || rawOptions.billed_currency === undefined || String(rawOptions.billed_currency).trim() === ""
      ? null
      : String(rawOptions.billed_currency).trim().toUpperCase();
    if (billCurrency && !/^[A-Z]{3}$/.test(billCurrency)) throw new Error("Billed currency must be a three-letter code.");
    const billScopeConfirmed = Boolean(rawOptions.bill_scope_confirmed);
    const selectedObservedCost = priced.length
      ? priced.reduce((sum, event) => sum + event.selected_cost, 0)
      : null;
    const reviewCurrency = mixedCurrency ? "MIXED" : pricedCurrencyMissing ? null : pricedCurrencies[0] || null;
    let billStatus = "NOT_SUPPLIED";
    let billDifference = null;
    let billDuplicateExcludedDifference = null;
    if (billTotal !== null) {
      if (!billScopeConfirmed) billStatus = "SCOPE_NOT_CONFIRMED";
      else if (priced.length !== events.length) billStatus = "REQUEST_COST_MISSING";
      else if (mixedCurrency) billStatus = "MIXED_CURRENCY";
      else if (pricedCurrencyMissing) billStatus = "REQUEST_CURRENCY_MISSING";
      else if (!billCurrency) billStatus = "BILL_CURRENCY_MISSING";
      else if (pricedCurrencies.length !== 1 || billCurrency !== pricedCurrencies[0]) billStatus = "CURRENCY_MISMATCH";
      else {
        billStatus = "COMPARABLE";
        billDifference = round(billTotal - selectedObservedCost);
        billDuplicateExcludedDifference = round(billTotal - duplicateExcludedCost);
      }
    }
    if (currencyNotComparable) {
      findings = findings.map((item) => ({
        ...item,
        current_cost: null,
        estimated_avoidable_cost: null,
        event_avoidable_costs: {},
        confidence_in_dollar_estimate: "not_quantified",
      }));
      reviewHeadline = {
        ...reviewHeadline,
        conservative_non_additive_opportunity: null,
        priced_affected_event_count: 0,
        method: pricedCurrencyMissing
          ? "No combined amount is calculated while a priced row has no currency. Supply the currency in the file or declare an explicit fallback."
          : "No cross-currency amount is calculated. Filter or split the import by currency, or supply an explicit FX method outside this local review.",
      };
    }
    const bill = {
      status: billStatus,
      supplied_total: billTotal,
      supplied_currency: billCurrency,
      same_scope_confirmed: billScopeConfirmed,
      raw_selected_cost_difference: billDifference,
      duplicate_excluded_reference_difference: billDuplicateExcludedDifference,
      method: "Billed total minus selected request cost. The duplicate-excluded difference retains the first source row in each repeated-ID group as a review reference only; no row is deleted or presumed invalid.",
    };
    const spend = spendSummary(events, reviewOptions, reviewCurrency, selectedObservedCost, !currencyNotComparable);
    return {
      schema_version: REVIEW_SCHEMA,
      generated_at: rawOptions.generated_at || new Date().toISOString(),
      application_version: "1.0.0",
      pricing_catalog_version: rawOptions.catalog?.catalog_version || null,
      source: { name: rawOptions.source_name || "Local request-log import", adapter: detectAdapter(rows), sha256: rawOptions.source_file_hash || null, uploaded: false },
      currency: reviewCurrency,
      event_count: events.length,
      events,
      reconciliation: {
        provider_reported_cost: currencyNotComparable || reportedCost === null ? null : round(reportedCost),
        calculated_cost_used_when_reported_missing: currencyNotComparable || calculatedOnlyCost === null ? null : round(calculatedOnlyCost),
        selected_observed_cost: currencyNotComparable || selectedObservedCost === null ? null : round(selectedObservedCost),
        selected_cost_excluding_later_duplicate_rows: currencyNotComparable || duplicateExcludedCost === null ? null : round(duplicateExcludedCost),
        priced_rows: priced.length,
        unpriced_rows: events.length - priced.length,
        duplicate_rows_flagged: events.filter((event) => event.duplicate_group).length,
        provider_reported_cost_precedence: true,
        bill,
      },
      spend,
      evidence_layers: evidenceLayers(events, bill),
      findings,
      headline: reviewHeadline,
      evidence_gate: {
        status: "OBSERVED_REQUEST_REVIEW",
        savings_claim_allowed: false,
        reason: "Request-level findings identify investigation and verification targets. They do not prove realized savings.",
      },
      privacy: { parsed_locally: true, prompt_text_required: false, prompt_text_stored: false, source_file_uploaded: false },
    };
  }

  function csvCell(value) {
    if (value === null || value === undefined) return "";
    let string = String(value);
    if (/^[=+\-@]/.test(string)) string = `'${string}`;
    return /[",\n\r]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
  }

  function normalizedCsv(review) {
    if (!review || review.schema_version !== REVIEW_SCHEMA || !Array.isArray(review.events)) throw new Error("A normalized usage review is required.");
    const fields = ["record_id", "event_id", "timestamp", "provider", "billing_channel", "processing_mode", "inference_geography", "model", "project", "team_owner", "feature", "customer", "product", "workload", "workflow", "session_id", "environment", "customer_product", "input_tokens", "output_tokens", "reasoning_tokens", "cached_input_tokens", "cache_write_tokens", "cache_write_duration_seconds", "cache_storage_token_hours", "batch", "tool_charges", "provider_reported_cost", "calculated_cost", "selected_cost", "cost_basis", "currency", "request_status", "retry_parent_event_id", "latency_ms", "evidence_source", "source_file_hash", "prefix_fingerprint", "tool_call_count", "outcome_status", "duplicate_group"];
    return `${fields.join(",")}\n${review.events.map((event) => fields.map((field) => csvCell(event[field])).join(",")).join("\n")}\n`;
  }

  return Object.freeze({ SCHEMA, REVIEW_SCHEMA, aliases, normalizeRows, analyzeEvents, buildReview, normalizedCsv, detectAdapter, spendSummary, operationalSummary, periodVariance, budgetSummary, operatingCostStack, allocationSummary, evidenceLayers });
});
