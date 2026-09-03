# Pilot 002 blinded human review audit

## Status

The blinded reviewer export is structurally valid for `openai-model-route-002`.
The packet ID, experiment ID, source hashes, route counts, and labor-rate field
match the locked Pilot 002 evidence.

The review produced a useful rapid-trust signal. It did **not** produce a valid
measurement of human review cost. Recorded review times ranged from roughly 1.1
to 2.4 seconds per response after prior exposure to the material and interface
restarts. Those times are not long enough to represent a fresh finance review.
No correction time was measured because uncertain responses were routed to
expert review instead of being corrected by the reviewer.

Do not use this run to claim measured all-in savings or a valid hourly review
cost. Preserve the $60-per-hour assumption, but wait for a controlled timed
review before applying it.

## Blinded trust result

| Measure | Sol baseline | Luna proposed |
| --- | ---: | ---: |
| Locked-key exact responses | 9 of 10 | 5 of 10 |
| Reviewer accepted unchanged | 7 of 10 | 4 of 10 |
| Accepted and exact | 6 | 1 |
| Accepted despite a locked-key failure | 1 | 3 |
| Exact but sent to expert review | 3 | 4 |
| Incorrect and sent to expert review | 0 | 2 |
| Exact share of accepted responses | 85.7% | 25.0% |

The reviewer did not know which model produced each response. Sol earned more
unchanged approvals and its accepted answers were substantially more reliable.
Luna's accepted set contained three material failures. The proposed route was
therefore more likely to create false confidence, not merely more review work.

## Material false-confidence cases

### Sol baseline

- `cache-reuse`: accepted unchanged even though the route selected `REJECT`
  where the locked decision was `INVESTIGATE`.

### Luna proposed

- `cache-reuse`: accepted unchanged despite the same material decision and
  evidence-taxonomy failure.
- `cap-vs-value`: accepted unchanged even though the memo described $1,400 of
  total cost while the structured primary metric reported $286.67 per accepted
  result. The locked value was $46.67.
- `human-cost-reversal`: accepted unchanged even though the memo calculated a
  $1,200 recurring premium while the structured metric reported $1,500.

The two internal-consistency failures are especially important. Structured
output guaranteed the response shape, but it did not guarantee agreement
between the memo and the decision record. A polished explanation can make the
wrong structured number easier to trust.

## Recorded-cost view is diagnostic only

Using the invalid short timings mechanically would produce the following:

| Measure | Sol baseline | Luna proposed |
| --- | ---: | ---: |
| Estimated model charge | $0.065008 | $0.003739 |
| Recorded review time | 0.2375 min | 0.2421 min |
| Mechanical human cost at $60/hour | $0.2375 | $0.2421 |
| Mechanical model plus review cost | $0.3025 | $0.2458 |
| Mechanical cost per accepted answer | $0.0432 | $0.0615 |

These figures must not be published as measured economics. They are retained
only to show that even the unusably short timing record reverses the apparent
unit-cost story when divided by accepted answers: Luna's cheaper provider bill
did not yield the lower cost per accepted response.

## Product requirements created by this run

1. Recalculate deterministic financial arithmetic outside the model.
2. Compare memo statements with structured metric labels, values, and units.
3. Block an approval when those fields conflict.
4. Render sentinels such as `UNAVAILABLE` and `NONE - evidence sufficient` as
   plain human language.
5. Provide a real expert-review queue without forcing the first reviewer to
   invent a correction.
6. Distinguish objective correctness, reviewer trust, and correction effort.

## Decision

Keep Sol as the safer default route for finance-facing decisions. Do not adopt
Luna as a drop-in replacement based on its lower token charge. The next useful
step is to reconcile actual provider billing and build the consistency controls
surfaced by the false-confidence cases. A new timed human review should happen
only after the interface and review protocol are stable.
