# OpenAI model route pilot 001

## Decision under test

Can a much cheaper model route handle bounded AI finance decisions without
losing evidence discipline, calculation accuracy, or decision usefulness?

The baseline route uses `gpt-5.6-sol`. The proposed route uses
`gpt-5.6-luna`. This is not a general model benchmark and it does not assume
that the cheaper route wins. It tests ten fixed decisions that AI Cost Lens
needs to explain correctly.

## Locked design

- Ten public synthetic cases.
- The same system prompt, case order, JSON schema, and 500-token output ceiling
  for both routes.
- `reasoning.effort=none`, `store=false`, no tools, and no automatic retries.
- One project-scoped API key per route.
- A private organization hard spend limit outside the runner.
- Request, raw response, parsed response, token usage, source hashes, and
  response IDs preserved locally.
- Automatic scoring against the answer key, followed by human review.
- No result is considered accepted merely because it passed the automatic
  checks.

The automatic checks cover the decision, primary metric value and unit, exact
evidence labels, memo length, and presence of the next decision question. The
metric label itself is intentionally not exact-matched because clear human
wording can vary without changing the finance answer.

## Cases

The cases test rate versus equivalent workload cost, cache boundaries, action
versus outcome pricing, commitment exposure, caps versus value, data retention
policy, benchmark scope, required human work, retry economics, and currency
reconciliation.

## Cash boundary

OpenAI's published rates on September 1, 2026 are `$4.00` input and `$20.00`
output per million tokens for Sol, and `$0.20` input and `$1.20` output for
Luna. Each route is capped at ten requests and 500 output tokens per request.

The fixed prompt, case, and response schema total fewer than 25,000 characters
per route before protocol overhead. Even treating every character as a token,
Sol's bounded input and output would be below `$0.20`, and Luna's below `$0.02`.
The operational experiment ceiling is `$0.50`; the organization hard limit is
a separate final backstop, not the expected cost. Actual provider usage and
cost exports decide the observed cost.

OpenAI notes that hard-limit enforcement is not instantaneous, so recorded
spend can slightly exceed a configured limit. The local runner therefore
provides the first control: exactly ten sequential requests, no retries, then
stop.

## Run protocol

Do not put keys in source files, chat, screenshots, or shell history. Set each
key in a hidden terminal prompt:

```bash
read -s AI_COST_LENS_BASELINE_KEY
export AI_COST_LENS_BASELINE_KEY
```

Run the baseline once into a new evidence directory:

```bash
uv run python scripts/run-openai-model-route-pilot.py baseline \
  --experiment openai-model-route-001 \
  --output-dir private-openai-capture/model-route-001-baseline
```

Remove the key immediately:

```bash
unset AI_COST_LENS_BASELINE_KEY
```

Repeat for the proposed route using `AI_COST_LENS_PROPOSED_KEY` and a different
output directory. The runner refuses to overwrite an existing directory. If a
request fails, it writes `failure.json`, marks the manifest failed, and stops
without retrying.

## Human acceptance

Complete each route's `human-review-template.csv` without changing the source
responses. For each case:

1. Mark `accepted=true` only if the answer could be used in a finance review
   without changing its decision, number, unit, or evidence states.
2. Record actual review minutes.
3. Record correction minutes only when work would be needed before use.
4. Explain any rejection or material correction in `review_notes`.

Keep these measures separate:

- Exact automatic pass rate.
- Human acceptance rate.
- Provider cost per accepted result.
- Requests and retries per accepted result.
- Human review and correction minutes per accepted result.
- Recurring cost per accepted result after valuing required human time.

Do not claim savings until both project usage and cost exports reconcile, all
human rows are complete, the routes are declared equivalent for this bounded
workload, and policy eligibility passes.

## Official references

- [GPT-5.6 Sol model and pricing](https://developers.openai.com/api/docs/models/gpt-5.6-sol)
- [GPT-5.6 Luna model and pricing](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Spend limits](https://developers.openai.com/api/docs/guides/spend-limits)
