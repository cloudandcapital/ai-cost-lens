# AI Cost Lens synthetic acceptance test

Date: 2026-09-02  
Status: automated and independent browser validation passed; the tool is not
customer-validated, invoice-certified, or production-proven

## Buyer being simulated

A finance or FinOps analyst at a large financial institution is comparing a current AI route with a cheaper proposed route for customer due diligence case summaries. The analyst must be able to defend the recommendation to finance, engineering, operations quality, and policy stakeholders.

All figures and records in this test are synthetic. They are not bank, investor, provider, or customer evidence.

## Decision standard

The test follows the finance logic described in OpenAI's [A scorecard for the AI age](https://openai.com/index/a-scorecard-for-the-ai-age/): full task cost includes employee time, human review, retries, and rework, then divides that cost by work that met the quality bar. It also follows the FinOps Foundation's point that token cost is only one layer of the AI cost stack in [Token Economics: The Atomic Unit of AI Value](https://www.finops.org/insights/token-economics-the-atomic-unit-of-ai-value/).

AI Cost Lens must answer one bounded question:

> Can finance change the route and defend the savings after provider cost, shared infrastructure, human work, outcome quality, evidence coverage, and policy approval are included?

## Acceptance cases

| Case | What a weak tool might say | AI Cost Lens result | Pass condition |
|---|---|---|---|
| False economy | The provider bill fell from $100,000 to $35,000, so switch | Current route: $143.55 per ready result. Proposed route: $150.40. The proposed route is 4.8% higher after human work and outcome yield. | Leave the proposed route alone and make the false economy explicit. |
| True savings | The smaller model is cheaper | Current route: $143.55 per ready result. Proposed route: $84.53, 41.1% lower. Quality and policy gates pass. A $150,000 change cost earns back after about 2,542 ready results. | Permit a savings claim only because the complete outcome log, cost boundary, quality floor, and policy approval reconcile. |
| Policy gate | The economics look good, so switch | The cost difference looks favorable, but the proposed route is not approved for the workload. | Block the savings claim and name policy approval as the failed gate. |
| Weak sample | A handpicked sample looks 42.7% cheaper | Label the result sampled, show the sample size and interval, and keep savings_claim_allowed false. | Describe it as a test result, never booked or proven savings. |

## Product defects found and fixed

1. **Policy approval was shared across both routes.** The review now records current-route and proposed-route approval separately. A cheaper route cannot inherit the current route's approval.
2. **The “leave it alone” row hid the most important negative result.** It now says plainly when the proposed route costs more per ready result, even if the provider bill is lower.
3. **The default example was too small and generic.** The opening review now uses the synthetic false economy case and labels it as illustrative, not customer data.
4. **Failed decision gates were vague.** The test-first explanation now names the blocking gate: quality floor, policy approval, complete outcome evidence, or matching cost boundary.

## What passed

- Provider price alone never determines the recommendation.
- Human review and correction are included in the recurring cost boundary.
- Outcome yield changes the denominator instead of being buried in a quality footnote.
- A complete, reconciled, policy-approved case can support a savings claim.
- Sampled or policy-incomplete evidence fails closed.
- The decision record stays local and can be downloaded as JSON.
- The synthetic demo is visibly labeled and cannot be mistaken for customer work.

## What this does not prove yet

- No bank, investor, employer, or customer has validated the workflow.
- The universal template still requires a spend export plus an outcome log or sample. Provider adapters beyond the current OpenAI export path are not finished.
- The tool does not yet enforce a user-defined non-inferiority margin when quality falls but remains above the declared floor.
- Policy approval is a declared control, not an integration with a model registry, security system, or governance platform.
- The test establishes decision behavior, not a claim that AI Cost Lens will save a specific organization money.

## Release decision

The finance review is worth continuing. It catches a costly mistake: treating a lower model bill as a lower cost of useful work.

Automated checks and an independent browser walkthrough passed. Do not publish
the tool as customer-validated, bank-validated, invoice-certified, or
production-proven. The next proof should be a customer walkthrough using a
sanitized export or a buyer's description of the fields they can actually
obtain. The goal is to test the workflow and vocabulary, not collect sensitive
data.
