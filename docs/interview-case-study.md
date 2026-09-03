# AI Cost Lens interview case study

## The problem

AI spend reviews often begin and end with the provider bill. That can create a
false saving when a cheaper route needs more retries, more human correction, or
produces fewer ready-to-use results.

I built AI Cost Lens as a local-first financial review layer that joins provider
spend to workload outcomes. It separates what the provider reported from what
was calculated or allocated, then normalizes the comparison to the cost of a
ready result.

## The decision the sample demonstrates

The shipped sample is deliberately synthetic and difficult:

| Measure | Current route | Proposed route | Read |
| --- | ---: | ---: | --- |
| Provider cost | $100,000 | $35,000 | 65.0% lower |
| Total recurring cost | $134,940 | $112,800 | 16.4% lower |
| Ready result rate | 94% | 75% | 19 points lower |
| Cost per ready result | $143.55 | $150.40 | 4.8% higher |

The proposed route lowers the bill but increases the cost of usable work. AI
Cost Lens recommends keeping the current route rather than presenting the lower
provider cost as savings.

## The finance controls

- Provider, infrastructure, human review, and one-time change costs remain visible.
- Reported, calculated, and allocated cost bases are not treated as interchangeable.
- Savings require equivalent work, complete evidence, an accepted outcome rule,
  adequate quality, policy approval, and provider-reported cost on both sides.
- Plan vs Actual separates the approved current-route plan from current
  performance and the proposed change.
- Payback uses expected ready results per month and a declared decision horizon;
  it does not use requests or tokens as a proxy for business output.
- Missing evidence stays visible instead of being filled with a model guess.

## What I tested

- Deterministic arithmetic and reconciliation tests across the Python engine and browser builder.
- Synthetic enterprise cases covering false economy, true savings, policy failure, and weak samples.
- A saved OpenAI organization export path that reconciles total provider cost
  and usage mix without inventing model-level billed cost.
- Independent cold reviews of the complete single-file application source. The
  reviews found interface and evidence-label issues that were fixed and added to
  regression tests.
- A five-case model-route pilot covering accepted-result economics, cost-basis
  boundaries, cache claims, break-even yield, and time-based payback. Real model
  runs remain separate from the public product and are not customer evidence.

## What the project does not claim

AI Cost Lens is not a live observability platform, production router, invoice
certifier, or customer deployment. The public sample is illustrative. Real
savings remain unavailable until the bill, outcome, quality, policy, and cost
boundary all reconcile.

## Why it matters for AI finance

The project demonstrates the work behind an AI investment review: reconciling
technical usage to financial cost, defining the unit of value, explaining
variance, testing a change, and preventing a modeled reduction from becoming a
booked savings claim before the evidence supports it.
