# Pilot 002 baseline audit

The Sol baseline completed ten sequential Responses API requests with zero
automatic retries. The preserved evidence archive matched the locked Pilot 002
cases, answer key, and system prompt byte for byte.

## Result

- Exact automatic pass rate: 9/10 (90%)
- Finance-quality acceptance recommendation: 9/10 (90%)
- Input tokens: 6,852
- Output tokens: 1,880
- Estimated token charge at the published Sol rates: `$0.065008`
- Stored responses: disabled
- API-key pattern in the evidence archive: not found

The token charge is an estimate from token counts and published rates. It is
not a reconciled provider-billed cost. Official route economics remain pending
until project usage and cost exports are available.

## Response audit

| Case | Exact result | Acceptance recommendation | Audit note |
| --- | --- | --- | --- |
| rate-vs-tokenizer | Pass | Accept | Correctly calculates `$2.60` for equivalent input work and does not turn the lower rate into an all-in savings claim. |
| cache-reuse | Fail | Reject pending one correction | Arithmetic, metric, evidence states, memo, and next question are correct. The response selects `REJECT`; the locked taxonomy requires `INVESTIGATE` when a material fact is missing. |
| action-vs-outcome | Pass | Accept | Separates a billed action from a verified resolution and calculates `$0.30` per historical resolution. |
| commitment-exposure | Pass | Accept | Correctly identifies a `$2,000` monthly premium after the workload's on-demand cost falls. |
| cap-vs-value | Pass | Accept | Calculates `$46.67` per accepted result and does not treat staying under a cap as proof of value. |
| retention-gate | Pass | Accept | Applies the policy gate before price and measures the 30-day policy excess. |
| benchmark-scope | Pass | Accept | Keeps the vendor result as a company claim and identifies the 15x input-size mismatch. |
| human-cost-reversal | Pass | Accept | Includes required review labor and calculates Route A's `$1,200` recurring premium per 100 accepted results. |
| retry-economics | Pass | Accept | Calculates `$0.0289` provider cost per accepted result while leaving all-in cost unresolved without human correction data. |
| currency-boundary | Pass | Accept | Refuses to manufacture a cross-currency comparison without an approved exchange rate. |

## The cache-reuse miss

The response says finance should not approve a 32.5% whole-workflow savings
claim. That conclusion is useful. It also correctly labels the bounded
repeated-input reduction `VERIFIED_FACT`, labels the whole-workflow reduction
`UNKNOWN`, and asks for output, tool, retry, and human-correction costs.

The miss is the decision code. Pilot 002 explicitly defines:

- `INVESTIGATE` when a material fact is missing and the proposal is not
  decision-ready.
- `REJECT` when the proposal conflicts with policy or the supplied economics
  directly show it is worse.

No supplied fact proves that the full workflow is worse. The missing cost
boundary makes `INVESTIGATE` the locked answer. Changing `REJECT` to
`INVESTIGATE` is the only material correction required.

This is a real instruction-following miss, not a reason to change the rubric.
The original response and 9/10 score should remain untouched for the Luna
comparison.

## Comparison status

The baseline is valid for the locked Pilot 002 comparison. The proposed Luna
route can now be run against the identical source hashes. Human review time and
correction time must still be recorded by the human reviewer, and no savings
claim may be made until both routes' project usage and cost exports reconcile.
