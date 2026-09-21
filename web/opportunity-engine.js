(function attachOpportunityEngine(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AICostLensOpportunities = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildOpportunityEngine() {
  "use strict";

  const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
  const finite = (value) => {
    if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;
    return Number.isFinite(Number(value)) ? Number(value) : null;
  };

  function finding(input) {
    return {
      schema_version: "ai-cost-lens-opportunity/1.0",
      estimated_avoidable_cost: null,
      confidence: "directional",
      evidence_basis: "calculated",
      confidence_in_dollar_estimate: "directional",
      overlap_group: null,
      affected_event_ids: [],
      action: "investigate",
      calculation: "Not quantified from the available aggregate record.",
      quality_or_operational_risk: "Requires review before action.",
      limitations: "Aggregate review data does not identify individual billed events.",
      ...input,
    };
  }

  function reviewFindings(data) {
    const findings = [];
    const current = data.baseline;
    const proposed = data.proposed;
    const comparison = data.comparison;
    const floor = finite(data.workload?.accepted_quality_threshold);
    const proposedYield = finite(proposed.measures?.usable_result_rate);
    const baselineYield = finite(current.measures?.usable_result_rate);
    const proposedHumanCost = finite(proposed.costs?.human_review_cost);
    const baselineHumanCost = finite(current.costs?.human_review_cost);
    const humanIncrease = proposedHumanCost !== null && baselineHumanCost !== null
      ? proposedHumanCost - baselineHumanCost
      : null;
    const proposedUnit = finite(proposed.measures?.cost_per_usable_result);
    const baselineUnit = finite(current.measures?.cost_per_usable_result);
    const retryRate = finite(proposed.measures?.retry_rate);
    const cacheRate = finite(proposed.measures?.cache_reuse_rate);

    if (floor !== null && proposedYield !== null && proposedYield < floor) {
      findings.push(finding({
        id: "quality-floor-erosion",
        kind: "quality_floor_erosion",
        title: "The proposed route misses the quality floor",
        explanation: "A lower provider bill cannot support a route change when fewer outputs clear the agreed quality bar.",
        affected_scope: proposed.label,
        current_cost: finite(proposed.costs?.recurring_operating_cost),
        confidence: "measured",
        confidence_in_dollar_estimate: "not_quantified",
        evidence_basis: proposed.outcomes?.basis || "unknown",
        overlap_group: "proposed-route-economics",
        action: "keep_current_route",
        verification_requirement: "Improve and re-test the route on the same workload before reconsidering it.",
        quality_or_operational_risk: "Changing routes now would accept performance below the declared quality floor.",
        limitations: "The result applies only to the declared workload, acceptance rule, and review period.",
        metrics: { quality_floor: floor, observed_usable_rate: proposedYield },
      }));
    }

    if (humanIncrease !== null && humanIncrease > 0) {
      findings.push(finding({
        id: "human-rework-increase",
        kind: "human_rework_increase",
        title: "Human review absorbs part of the provider-price reduction",
        explanation: "The proposed route needs more review and correction work. That cost belongs in the route economics.",
        affected_scope: proposed.label,
        current_cost: finite(proposed.costs?.human_review_cost),
        estimated_avoidable_cost: round(humanIncrease),
        confidence: proposed.evidence?.coverage_status === "complete" ? "measured" : "directional",
        confidence_in_dollar_estimate: proposed.evidence?.coverage_status === "complete" ? "measured" : "directional",
        evidence_basis: proposed.evidence?.outcome_basis || "unknown",
        overlap_group: "proposed-route-economics",
        action: "verify",
        verification_requirement: "Time the same review and correction work on both routes.",
        calculation: `${round(proposedHumanCost)} minus ${round(baselineHumanCost)} in declared human review cost.`,
        quality_or_operational_risk: "Removing review work without improving output quality can increase downstream errors.",
        limitations: "The amount is a period difference, not a forecast that every additional review dollar is avoidable.",
        metrics: { additional_human_cost: round(humanIncrease) },
      }));
    }

    if (baselineUnit !== null && proposedUnit !== null && proposedUnit > baselineUnit) {
      const comparableVolume = finite(current.outcomes?.usable_results) || 0;
      const reconciledDifference = finite(comparison?.normalized_cost_difference);
      findings.push(finding({
        id: "unit-cost-deterioration",
        kind: "unit_cost_deterioration",
        title: "Cost per ready result is moving the wrong way",
        explanation: "The proposed route costs more for the output that actually clears review, even when its provider charge is lower.",
        affected_scope: `${current.label} versus ${proposed.label}`,
        current_cost: finite(proposed.costs?.recurring_operating_cost),
        estimated_avoidable_cost: reconciledDifference !== null && reconciledDifference > 0
          ? round(reconciledDifference)
          : round((proposedUnit - baselineUnit) * comparableVolume),
        confidence: comparison?.evidence_complete ? "measured" : "directional",
        confidence_in_dollar_estimate: comparison?.evidence_complete ? "measured" : "directional",
        evidence_basis: comparison?.outcome_evidence_basis || "unknown",
        overlap_group: "proposed-route-economics",
        action: "keep_current_route",
        verification_requirement: "Reduce rework or improve usable yield before approving the route.",
        calculation: reconciledDifference !== null && reconciledDifference > 0
          ? "Uses the review engine's normalized cost difference at comparable ready-result volume."
          : "Unit-cost difference multiplied by current ready-result volume.",
        quality_or_operational_risk: "A lower bill can still raise the cost of work that clears review.",
        limitations: "Normalization does not prove that route mix, task difficulty, or demand stayed constant.",
        metrics: { current_unit_cost: baselineUnit, proposed_unit_cost: proposedUnit },
      }));
    }

    if (retryRate !== null && retryRate >= 0.1) {
      findings.push(finding({
        id: "retry-cost-candidate",
        kind: "retry_cost_candidate",
        title: "Retries deserve a closer look",
        explanation: "Repeated calls are consuming a material share of request activity. Some retries may be necessary, so this is an investigation target rather than automatic waste.",
        affected_scope: proposed.label,
        current_cost: finite(proposed.costs?.model_cost),
        estimated_avoidable_cost: null,
        confidence: "directional",
        confidence_in_dollar_estimate: "not_quantified",
        evidence_basis: proposed.evidence?.cost_basis || "unknown",
        overlap_group: "proposed-route-economics",
        action: "investigate",
        verification_requirement: "Separate necessary retries from error loops and avoidable repeat attempts.",
        calculation: "No dollar amount assigned because aggregate retry counts do not identify the tokens or charges attributable to each retry.",
        quality_or_operational_risk: "Some retries preserve reliability; removing them indiscriminately can reduce completion rates.",
        limitations: "Requires request-level retry relationships or directly attributed retry cost.",
        metrics: { retry_rate: retryRate },
      }));
    }

    if (cacheRate !== null && cacheRate < 0.1 && finite(proposed.usage?.processed_input_tokens) > 1_000_000) {
      findings.push(finding({
        id: "cache-use-candidate",
        kind: "cache_use_candidate",
        title: "Repeated context may not be reaching cache",
        explanation: "Cache reuse is low relative to the amount of processed input. Confirm that the workload contains a stable, cache-eligible prefix before modeling an opportunity.",
        affected_scope: proposed.label,
        current_cost: finite(proposed.costs?.model_cost),
        confidence: "inferred",
        confidence_in_dollar_estimate: "not_quantified",
        evidence_basis: "calculated",
        overlap_group: "input-efficiency",
        action: "investigate",
        verification_requirement: "Inspect repeated prefixes and provider cache eligibility; do not assume all input can be cached.",
        quality_or_operational_risk: "Cache behavior and eligibility vary by provider and request structure.",
        limitations: "Low observed cache reuse does not prove that the input contains a stable, cache-eligible prefix.",
        metrics: { cache_reuse_rate: cacheRate },
      }));
    }

    if (!comparison?.savings_claim_allowed) {
      findings.push(finding({
        id: "unverified-financial-difference",
        kind: "unverified_financial_difference",
        title: "The modeled difference is not realized savings",
        explanation: "At least one bill, quality, policy, period, or cost-basis gate is still open.",
        affected_scope: `${current.label} versus ${proposed.label}`,
        current_cost: finite(proposed.costs?.recurring_operating_cost),
        confidence: "measured",
        confidence_in_dollar_estimate: "not_quantified",
        evidence_basis: comparison?.outcome_evidence_basis || "unknown",
        overlap_group: "evidence-gate",
        action: "verify",
        verification_requirement: comparison?.limitation || "Complete the evidence check before making a savings claim.",
        quality_or_operational_risk: "Acting on an unverified difference can shift cost into rework, failures, or an unmatched billing period.",
        limitations: "The finding identifies an open gate; it does not estimate recoverable cost.",
      }));
    }

    if (
      baselineYield !== null
      && proposedYield !== null
      && baselineUnit !== null
      && proposedUnit !== null
      && proposedYield > baselineYield
      && proposedUnit < baselineUnit
    ) {
      findings.push(finding({
        id: "verified-route-candidate",
        kind: "verified_route_candidate",
        title: "The proposed route improves both yield and unit cost",
        explanation: "This is the strongest shape for a route change, subject to the evidence and policy gates shown in the decision record.",
        affected_scope: proposed.label,
        current_cost: finite(proposed.costs?.recurring_operating_cost),
        confidence: comparison?.savings_claim_allowed ? "measured" : "directional",
        confidence_in_dollar_estimate: "not_quantified",
        evidence_basis: comparison?.outcome_evidence_basis || "unknown",
        overlap_group: "proposed-route-economics",
        action: comparison?.savings_claim_allowed ? "consider_approval" : "verify",
        verification_requirement: comparison?.savings_claim_allowed ? "Monitor the same measures after implementation." : "Close the remaining evidence gates.",
        quality_or_operational_risk: "The observed advantage may not persist after implementation or at a different workload mix.",
        limitations: "No avoidable-cost amount is assigned until a bounded change and comparable period are defined.",
      }));
    }
    return findings;
  }

  function summarize(findings) {
    const amounts = findings
      .filter((item) => item.overlap_group !== "evidence-gate" && item.estimated_avoidable_cost !== null && item.estimated_avoidable_cost > 0)
      .map((item) => item.estimated_avoidable_cost);
    return {
      finding_count: findings.length,
      conservative_non_additive_opportunity: amounts.length ? round(Math.max(...amounts)) : null,
      method: "Maximum supported amount across potentially overlapping findings. Finding amounts are never summed.",
      savings_claim_allowed: false,
    };
  }

  function analyzeReview(data) {
    if (!data || data.schema_version !== "ai-cost-lens-review-result/1.0") {
      return { schema_version: "ai-cost-lens-opportunity-set/1.0", supported: false, findings: [], headline: summarize([]) };
    }
    if (!/^[A-Z]{3}$/.test(data.currency || "")) throw new Error("Review currency must be a three-letter code.");
    const findings = reviewFindings(data);
    return {
      schema_version: "ai-cost-lens-opportunity-set/1.0",
      supported: true,
      currency: data.currency,
      generated_from: data.schema_version,
      findings,
      headline: summarize(findings),
    };
  }

  return Object.freeze({ analyzeReview, summarize });
});
