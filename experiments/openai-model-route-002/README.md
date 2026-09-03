# OpenAI model route pilot 002

Pilot 002 is the decision-valid replacement for pilot 001. The first Sol run
showed that an exact grader can look rigorous while mostly measuring wording
choices created by its own ambiguous specification.

## What changed before comparing models

- Every case now asks one explicit decision question.
- Every case names the metric to calculate and its exact semantic unit.
- The response schema constrains the metric label and unit, so formatting is
  not mistaken for finance quality.
- The currency case permits a null value rather than forcing a false numerical
  comparison.
- Evidence states now distinguish unsupported from directly contradicted.
- Claim wording separates whether an outcome is true from whether a particular
  inference proves it.
- Both routes start again from the same new source hashes. Pilot 001 is not
  mixed into the comparison.

## Locked comparison

- Baseline: `gpt-5.6-sol`
- Proposed route: `gpt-5.6-luna`
- Ten identical synthetic AI finance decisions
- `reasoning.effort=none`
- Strict Structured Outputs
- 500-token maximum output per request
- No tools, no stored responses, and no automatic retries
- Exact finance scoring plus separate human acceptance, review time, and
  correction time

Run either route with the default pilot 002 files:

```bash
PYTHONPATH=. python3 scripts/run-openai-model-route-pilot.py baseline \
  --output-dir private-openai-capture/model-route-002-baseline
```

The preserved first baseline run is reviewed in
[`baseline-audit.md`](baseline-audit.md). Its 9/10 score remains unchanged for
the locked comparison.

The completed Sol-versus-Luna result is preserved in
[`comparison.md`](comparison.md). Luna's lower token charge did not pass the
decision-valid replacement gate for this bounded workload.

The timed human review is delivered as a single local file at
[`../../web/model-route-review-preview.html`](../../web/model-route-review-preview.html).
It preserves the original outputs, hides route names until completion, and
exports the measured acceptance and correction evidence.

Pilot 001 remains runnable only when explicitly selected:

```bash
PYTHONPATH=. python3 scripts/run-openai-model-route-pilot.py baseline \
  --experiment openai-model-route-001 \
  --output-dir private-openai-capture/model-route-001-baseline
```
