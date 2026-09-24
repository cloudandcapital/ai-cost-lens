(function attachCustomerEconomics(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AICostLensCustomerEconomics = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildCustomerEconomics() {
  "use strict";

  function analyze(review, rows) {
    if (!review?.events?.length || !review.spend?.period) throw new Error("Analyze a request log first.");
    if (!Array.isArray(rows) || !rows.length) throw new Error("Add at least one customer revenue row.");
    const period = review.spend.period;
    const currency = review.currency;
    if (!period.start || !period.end || !currency || currency === "MIXED") throw new Error("The request log needs dated rows in one currency before customer revenue can be compared.");
    const customers = new Map();
    for (const [index, row] of rows.entries()) {
      const line = index + 2;
      const customer = String(row.customer ?? "").trim();
      const start = String(row.period_start ?? "").trim();
      const end = String(row.period_end ?? "").trim();
      const rowCurrency = String(row.currency ?? "").trim().toUpperCase();
      const rawRevenue = String(row.revenue ?? "").trim();
      if (!customer) throw new Error(`Revenue row ${line} needs a customer ID matching the request log.`);
      if (customers.has(customer)) throw new Error(`Revenue row ${line} repeats customer ${customer}; supply one total per customer for this period.`);
      if (start !== period.start || end !== period.end) throw new Error(`Revenue row ${line} must cover the request log's UTC period, ${period.start} through ${period.end}.`);
      if (rowCurrency !== currency) throw new Error(`Revenue row ${line} must use ${currency}, the request log currency.`);
      if (!rawRevenue || !Number.isFinite(Number(rawRevenue)) || Number(rawRevenue) < 0 || Number(rawRevenue) > 1e15) throw new Error(`Revenue row ${line} needs a non-negative finite revenue amount.`);
      customers.set(customer, { customer, revenue: Number(rawRevenue), selected_cost: 0, requests: 0, unpriced: 0, cost_basis: new Set() });
    }
    let unallocatedCost = 0;
    let unallocatedRequests = 0;
    let unmatchedCost = 0;
    let unmatchedRequests = 0;
    let unpricedRequests = 0;
    for (const event of review.events) {
      const key = String(event.customer ?? "").trim();
      const target = customers.get(key);
      if (event.selected_cost === null || !Number.isFinite(event.selected_cost)) unpricedRequests += 1;
      if (!key) {
        unallocatedRequests += 1;
        unallocatedCost += event.selected_cost || 0;
      } else if (!target) {
        unmatchedRequests += 1;
        unmatchedCost += event.selected_cost || 0;
      } else {
        target.requests += 1;
        if (event.selected_cost === null) target.unpriced += 1;
        else target.selected_cost += event.selected_cost;
        if (event.cost_basis) target.cost_basis.add(event.cost_basis);
      }
    }
    const results = [...customers.values()].map((item) => ({
      customer: item.customer, revenue: item.revenue, requests: item.requests,
      unpriced: item.unpriced, selected_cost: Number(item.selected_cost.toFixed(6)),
      cost_basis: [...item.cost_basis].sort(),
      ai_cost_share: item.requests && !item.unpriced && item.revenue > 0 ? item.selected_cost / item.revenue : null,
      revenue_after_ai_requests: item.requests && !item.unpriced ? Number((item.revenue - item.selected_cost).toFixed(6)) : null,
    }));
    results.sort((a, b) => b.selected_cost - a.selected_cost || a.customer.localeCompare(b.customer));
    return {
      period: { start: period.start, end: period.end }, currency, customers: results,
      unallocated_cost: Number(unallocatedCost.toFixed(6)), unallocated_requests: unallocatedRequests,
      unmatched_cost: Number(unmatchedCost.toFixed(6)), unmatched_requests: unmatchedRequests,
      unpriced_requests: unpricedRequests,
      limitations: "Selected AI request cost only. This excludes shared infrastructure, human work and other cost of service. Revenue is user supplied; request cost can be reported, calculated or allocated. Repeated source IDs remain included until reconciled. This is not gross margin or an invoice audit.",
    };
  }
  return Object.freeze({ analyze });
});
