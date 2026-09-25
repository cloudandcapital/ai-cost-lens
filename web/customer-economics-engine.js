(function attachCustomerEconomics(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AICostLensCustomerEconomics = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildCustomerEconomics() {
  "use strict";

  const customerKey = (value, normalize) => normalize ? String(value ?? "").trim().toLocaleLowerCase("en-US") : String(value ?? "").trim();
  const moneyInput = (value) => {
    const raw = String(value ?? "").trim();
    return /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw) ? Number(raw.replaceAll(",", "")) : NaN;
  };

  function analyze(review, rows, options = {}) {
    if (!review?.events?.length || !review.spend?.period) throw new Error("Analyze a request log first.");
    if (!Array.isArray(rows) || !rows.length) throw new Error("Add at least one customer revenue row.");
    const period = review.spend.period;
    const rowCurrencies = [...new Set(rows.map((row) => String(row.currency ?? "").trim().toUpperCase()))];
    if (rowCurrencies.length !== 1 || !/^[A-Z]{3}$/.test(rowCurrencies[0])) throw new Error("Customer revenue needs one three-letter currency per comparison.");
    const currency = rowCurrencies[0];
    const normalizeCustomers = options.normalize_customer_ids === true;
    if (!period.start || !period.end) throw new Error("The request log needs dated rows before customer revenue can be compared.");
    if (review.currency && review.currency !== "MIXED" && review.currency !== currency) throw new Error(`Revenue currency must match the request log: ${review.currency}.`);
    const customers = new Map();
    let coveringPeriod = false;
    for (const [index, row] of rows.entries()) {
      const line = index + 2;
      const customer = String(row.customer ?? "").trim();
      const start = String(row.period_start ?? "").trim();
      const end = String(row.period_end ?? "").trim();
      const rowCurrency = String(row.currency ?? "").trim().toUpperCase();
      const rawRevenue = String(row.revenue ?? "").trim();
      if (!customer) throw new Error(`Revenue row ${line} needs a customer ID matching the request log.`);
      const key = customerKey(customer, normalizeCustomers);
      if (customers.has(key)) throw new Error(`Revenue row ${line} repeats customer ${customer}; supply one total per customer for this period.`);
      if (start > period.start || end < period.end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new Error(`Revenue row ${line} must cover the request log's UTC period, ${period.start} through ${period.end}.`);
      if (start !== period.start || end !== period.end) coveringPeriod = true;
      if (rowCurrency !== currency) throw new Error(`Revenue row ${line} must use ${currency}, the request log currency.`);
      const parsedRevenue = moneyInput(rawRevenue);
      if (!rawRevenue || !Number.isFinite(parsedRevenue) || parsedRevenue < 0 || parsedRevenue > 1e15) throw new Error(`Revenue row ${line} needs a non-negative finite revenue amount.`);
      customers.set(key, { customer, revenue: parsedRevenue, selected_cost: 0, requests: 0, unpriced: 0, cost_basis: new Set() });
    }
    let unallocatedCost = 0;
    let unallocatedRequests = 0;
    let unmatchedCost = 0;
    let unmatchedRequests = 0;
    let unpricedRequests = 0;
    const excludedCurrency = review.events.filter((event) => event.currency !== currency);
    const selectedEvents = review.events.filter((event) => event.currency === currency);
    if (!selectedEvents.length) throw new Error(`No request rows use ${currency}. Check the revenue currency.`);
    const method = options.allocation_method || "none";
    if (!["none", "requests", "cost"].includes(method)) throw new Error("Choose a supported allocation method.");
    const costStack = review.spend.cost_stack;
    const adjacent = costStack?.known_adjacent_cost;
    if (method !== "none" && (review.currency !== currency || adjacent === null || adjacent === undefined)) {
      throw new Error("Enter at least one same-period operating cost and use a single-currency request log before allocating costs to customers.");
    }
    if (method === "cost" && selectedEvents.some((event) => event.selected_cost === null)) {
      throw new Error("Cost-based allocation needs every request priced. Use request-count allocation or complete the cost fields.");
    }
    const denominator = method === "requests" ? selectedEvents.length : method === "cost"
      ? selectedEvents.reduce((sum, event) => sum + event.selected_cost, 0) : null;
    if (method !== "none" && denominator <= 0) throw new Error("No comparable requests are available to allocate the entered operating costs.");
    let unassignedAdjacent = 0;
    for (const event of selectedEvents) {
      const key = customerKey(event.customer, normalizeCustomers);
      const target = customers.get(key);
      const allocated = method === "none" ? 0 : adjacent * (method === "requests" ? 1 : event.selected_cost) / denominator;
      if (event.selected_cost === null || !Number.isFinite(event.selected_cost)) unpricedRequests += 1;
      if (!key) {
        unassignedAdjacent += allocated;
        unallocatedRequests += 1;
        unallocatedCost += event.selected_cost || 0;
      } else if (!target) {
        unassignedAdjacent += allocated;
        unmatchedRequests += 1;
        unmatchedCost += event.selected_cost || 0;
      } else {
        target.requests += 1;
        target.allocated_adjacent = (target.allocated_adjacent || 0) + allocated;
        if (event.selected_cost === null) target.unpriced += 1;
        else target.selected_cost += event.selected_cost;
        if (event.cost_basis) target.cost_basis.add(event.cost_basis);
      }
    }
    const results = [...customers.values()].map((item) => ({
      customer: item.customer, revenue: item.revenue, requests: item.requests,
      unpriced: item.unpriced, selected_cost: Number(item.selected_cost.toFixed(6)),
      cost_basis: [...item.cost_basis].sort(),
      ai_cost_share: item.requests && !item.unpriced && !coveringPeriod && item.revenue > 0 ? item.selected_cost / item.revenue : null,
      known_ai_cost_share_lower_bound: item.requests && (item.unpriced || coveringPeriod) && item.revenue > 0 ? item.selected_cost / item.revenue : null,
      revenue_after_ai_requests: item.requests && !item.unpriced && !coveringPeriod ? Number((item.revenue - item.selected_cost).toFixed(6)) : null,
      allocated_adjacent_cost: method === "none" ? null : Number((item.allocated_adjacent || 0).toFixed(6)),
      known_ai_operating_share: method !== "none" && item.requests && !item.unpriced && !coveringPeriod && item.revenue > 0
        ? (item.selected_cost + (item.allocated_adjacent || 0)) / item.revenue : null,
    }));
    results.sort((a, b) => (b.known_ai_operating_share ?? b.ai_cost_share ?? -1) - (a.known_ai_operating_share ?? a.ai_cost_share ?? -1) || b.selected_cost - a.selected_cost || a.customer.localeCompare(b.customer));
    return {
      period: { start: period.start, end: period.end }, currency, customers: results,
      period_coverage_exact: !coveringPeriod,
      normalized_customer_ids: normalizeCustomers,
      unallocated_cost: Number(unallocatedCost.toFixed(6)), unallocated_requests: unallocatedRequests,
      unmatched_cost: Number(unmatchedCost.toFixed(6)), unmatched_requests: unmatchedRequests,
      unpriced_requests: unpricedRequests,
      excluded_currency_requests: excludedCurrency.length,
      selected_currency_requests: selectedEvents.length,
      allocation_method: method,
      allocated_adjacent_total: method === "none" ? null : adjacent,
      unassigned_adjacent_cost: method === "none" ? null : Number(unassignedAdjacent.toFixed(6)),
      missing_categories: costStack?.missing_categories || [],
      limitations: `${coveringPeriod ? "Revenue covers extra days; ratios are lower bounds because request cost may be missing for those days. " : ""}${normalizeCustomers ? "Customer IDs were joined after trimming and case folding; inspect aliases before relying on the match. " : ""}${method === "none"
        ? "Selected AI request cost only. Shared infrastructure, human work and other service costs are excluded. Revenue is user supplied. This is not gross margin or an invoice audit."
        : "Entered same-period operating costs are spread by the selected proxy, not observed per customer. Missing categories remain excluded; unmatched and unattributed customers retain their share outside the customer table. Revenue is user supplied. This is not verified gross margin or an invoice audit."}`,
    };
  }
  return Object.freeze({ analyze });
});
