# AI Cost Lens decision record: Pilot 002

## Decision

Keep `gpt-5.6-sol` as the default route for finance-facing decisions. Do not
replace it with `gpt-5.6-luna` as an unguarded drop-in route.

Luna delivered a 94.25% lower provider bill for the same ten-case input
workload. Sol delivered nine exact responses versus five for Luna and produced
substantially fewer accepted answers containing a material error. The lower
model bill is verified. An all-in savings claim is not available because valid
human review and correction time were not measured.

## Evidence ledger

| Measure | Sol baseline | Luna proposed | Evidence state |
| --- | ---: | ---: | --- |
| Requests | 10 | 10 | VERIFIED FACT |
| Input tokens | 6,852 | 6,852 | VERIFIED FACT |
| Output tokens | 1,880 | 1,974 | VERIFIED FACT |
| Cached input tokens | 0 | 0 | VERIFIED FACT |
| Reconciled provider cost | $0.0650080 | $0.0037392 | VERIFIED FACT |
| Exact responses | 9/10 | 5/10 | VERIFIED FACT |
| Blinded rapid-trust acceptance | 7/10 | 4/10 | LIMITED EVIDENCE |
| Accepted and exact | 6 | 1 | LIMITED EVIDENCE |
| Accepted despite material error | 1 | 3 | LIMITED EVIDENCE |
| Valid measured human cost | Unavailable | Unavailable | UNKNOWN |
| All-in cost | Unavailable | Unavailable | UNKNOWN |

`LIMITED EVIDENCE` marks the blinded acceptance result because prior exposure,
interface restarts, and implausibly short recorded review times prevent it from
serving as a controlled human-review measure. The accept/flag choices remain a
useful trust signal.

## Provider economics

- Provider charge difference: `$0.0612688` lower for Luna.
- Provider charge reduction: `94.25%`.
- Provider cost per exact response: Sol `$0.0072231`; Luna `$0.00074784`.

Model-only economics favor Luna even after dividing by exact responses. That
does not make Luna the safer finance route. Three of its four rapidly accepted
answers contained a locked-key failure, including two internal contradictions
between the memo and structured metric.

## Risk finding

Structured output controlled the response shape but did not control internal
financial consistency. In two Luna responses, the narrative calculation and
the structured metric disagreed materially. A reviewer accepted both.

The useful control is therefore not another price comparison. AI Cost Lens
should recompute deterministic arithmetic, compare the memo with structured
fields, block conflicting approvals, and route unresolved cases to expert
review.

## Routing boundary

Luna may be tested later for low-materiality work behind deterministic
validation and explicit escalation. It is not approved here for autonomous or
unguarded finance decisions.

## Missing proof

A stable, fresh, timed review is still required to estimate correction effort,
human cost, and true all-in cost per usable finance decision. Until then:

- `PROVIDER COST SAVINGS`: VERIFIED
- `ALL-IN SAVINGS`: UNKNOWN
- `DROP-IN REPLACEMENT`: REJECTED
