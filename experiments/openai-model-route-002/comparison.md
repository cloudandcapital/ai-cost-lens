# Pilot 002 locked comparison

Pilot 002 tested Sol and Luna on the same ten bounded AI-finance decisions.
Both runs used the Responses API with strict Structured Outputs,
`reasoning.effort=none`, a 500-token output limit, no tools, no stored
responses, and no automatic retries. The cases, answer key, and system prompt
hashes matched across both evidence archives.

## Decision

Do not replace Sol with Luna as the default finance-review route for this
workload.

Luna reduced the estimated token charge materially, but five of its ten
answers require a change to the decision, evidence state, or primary metric
before they could be used. Sol required one decision-code correction. The
additional correction burden has not yet been timed, so no all-in savings claim
is supported.

## Route summary

| Measure | Sol baseline | Luna proposed |
| --- | ---: | ---: |
| Exact automatic pass | 9/10 | 5/10 |
| Finance-quality acceptance recommendation | 9/10 | 5/10 |
| Requests | 10 | 10 |
| Automatic retries | 0 | 0 |
| Input tokens | 6,852 | 6,852 |
| Output tokens | 1,880 | 1,974 |
| Estimated token charge | `$0.065008` | `$0.0037392` |
| Estimated charge per accepted unchanged answer | `$0.007223` | `$0.000748` |

The estimates use the published September 1, 2026 model rates encoded in the
pilot references: Sol at `$4.00` per million input tokens and `$20.00` per
million output tokens; Luna at `$0.20` and `$1.20`, respectively. Luna's
estimated token charge is about 94.25% lower for the ten calls, a difference of
about `$0.06127`.

These are provider-layer estimates, not reconciled billed cost or all-in route
economics. Project usage and cost exports, human review time, correction time,
and a declared labor rate remain required.

## Case comparison

| Case | Sol | Luna | Finance audit |
| --- | --- | --- | --- |
| rate-vs-tokenizer | Pass | Fail | Luna labels an untested all-in savings claim `CONTRADICTED` and selects `REJECT`; missing output, retry, quality, and correction evidence requires `UNKNOWN` and `INVESTIGATE`. |
| cache-reuse | Fail | Fail | Both select `REJECT` instead of `INVESTIGATE`. Sol otherwise preserves the correct `UNKNOWN` state and asks for all-in costs. Luna also changes the unsupported whole-workflow claim to `CONTRADICTED` and says no further question is needed. |
| action-vs-outcome | Pass | Fail | Luna correctly calculates `$0.30` per historical resolution and contradicts one-action-equals-one-resolution, but selects `INVESTIGATE` instead of rejecting that treatment. |
| commitment-exposure | Pass | Pass | Both identify the current `$2,000` monthly commitment premium. |
| cap-vs-value | Pass | Fail | Luna states that total cost is `$1,400` but returns `$286.67` per accepted result. The correct calculation is `$1,400 / 30 = $46.67`. |
| retention-gate | Pass | Pass | Both apply the policy gate before the lower model rate. |
| benchmark-scope | Pass | Pass | Both keep the target result unresolved and identify the 15x input-size mismatch. |
| human-cost-reversal | Pass | Fail | Luna's memo correctly calculates a `$1,200` premium but its structured primary metric returns `$1,500`. |
| retry-economics | Pass | Pass | Both calculate provider cost per accepted result and leave all-in cost unresolved without human correction data. |
| currency-boundary | Pass | Pass | Both refuse to manufacture a normalized comparison without an approved exchange rate. |

## What the failures show

The two Luna arithmetic failures are more important than a simple wrong-answer
count. In both cases, the response sounds confident and includes enough correct
work to appear review-ready:

- The cap memo names the correct `$1,400` total, then divides it incorrectly in
  the same response.
- The human-cost memo names the correct `$1,200` premium, while the structured
  metric returns `$1,500`.

This is exactly why AI Cost Lens should validate the decision record rather
than trust a polished narrative. Structured output guarantees shape, not
financial consistency.

## What can and cannot be concluded

Supported now:

- Sol is the safer default for this bounded finance-review workload.
- Luna is not a decision-valid drop-in replacement under the locked test.
- Model price alone would materially understate Luna's likely review burden.
- Cross-field arithmetic and decision-taxonomy validation belong in the
  product.

Not supported yet:

- A production-wide Sol-versus-Luna quality claim.
- An all-in route-cost or savings claim.
- A latency comparison; the runs occurred at different times and did not
  capture controlled per-request latency.
- A claim that Luna is unsuitable for extraction, formatting, discovery, or
  another narrower low-risk task.

## Next evidence

Complete the human review rows without changing either source response. Record
actual review minutes and the correction minutes needed to make each answer
usable. Then reconcile both projects' usage and cost exports before calculating
provider cost per accepted result or total recurring cost after human work.
