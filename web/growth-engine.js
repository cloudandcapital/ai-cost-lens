(function attachGrowthEngine(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AICostLensGrowth = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildGrowthEngine() {
  "use strict";

  function growthMargins(review, options) {
    const price = Number(options.revenue_per_ready);
    const fixedShare = Number(options.fixed_infrastructure_share);
    const discount = Number(options.model_discount);
    const reviewShare = Number(options.review_effort_share);
    if (![price, fixedShare, discount, reviewShare].every(Number.isFinite)
      || price < 0 || fixedShare < 0 || fixedShare > 1 || discount < 0 || discount > 1 || reviewShare < 0 || reviewShare > 1) {
      throw new Error("Enter a non-negative price and percentages between 0 and 100.");
    }
    const baseVolume = review.baseline.outcomes.completed_results;
    if (!Number.isSafeInteger(baseVolume) || baseVolume <= 0) throw new Error("A completed-result volume is required.");
    return [1, 2, 5, 10].map((factor) => {
      const volume = baseVolume * factor;
      const routes = [review.baseline, review.proposed].map((route) => {
        const ready = volume * route.measures.usable_result_rate;
        const model = route.costs.model_cost * factor * (1 - discount);
        const infrastructure = route.costs.shared_infrastructure_cost * (fixedShare + (1 - fixedShare) * factor);
        const human = route.costs.human_review_cost * factor * reviewShare;
        const cost = model + infrastructure + human;
        const revenue = price * ready;
        return { ready, revenue, cost, gross_profit: revenue - cost, margin_pct: revenue > 0 ? (revenue - cost) / revenue * 100 : null };
      });
      return { factor, volume, baseline: routes[0], proposed: routes[1], gross_profit_difference: routes[1].gross_profit - routes[0].gross_profit };
    });
  }

  return Object.freeze({ growthMargins });
});
