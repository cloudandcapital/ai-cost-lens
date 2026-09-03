# OpenAI model route pilot 003

This is the smaller follow-up to Pilot 002. It tests five finance-first AI-spend decisions on the same two model routes. It is not a benchmark of general intelligence and it is not part of the public AI Cost Lens interface.

## What this pilot asks

Can a lower-priced route produce a finance-ready answer when the decision depends on:

1. cost per accepted result;
2. allocated cost versus provider-reported cost;
3. a cache-line reduction versus the whole workflow;
4. break-even quality yield; and
5. migration payback inside a fixed decision horizon?

Each route receives the same five cases, one request per case, with no automatic retry. The answer key is locked before either route runs.

## Human review

The ten model responses are reviewed blind. For each response the reviewer records only one disposition:

- **Ready to use** — the answer is safe and useful without a substantive edit.
- **Needed correction** — the reviewer actually corrected a material error or omission; review and correction time are recorded separately.
- **Needed escalation** — the reviewer could not safely resolve the issue alone.

Automatic schema and answer-key checks are diagnostics. They are not human acceptance.

## Run later

The existing runner supports this experiment with `--experiment openai-model-route-003`. Keep route API keys separate and preserve both output directories unchanged. A blinded review packet should be built only after both five-response runs complete.

```bash
PYTHONPATH=. python3 scripts/run-openai-model-route-pilot.py baseline \
  --experiment openai-model-route-003 \
  --output-dir private-openai-capture/model-route-003-baseline

PYTHONPATH=. python3 scripts/run-openai-model-route-pilot.py proposed \
  --experiment openai-model-route-003 \
  --output-dir private-openai-capture/model-route-003-proposed
```

After both runs, build the ten-response blinded review. Supply the actual or
dated-estimate route charges when available; if omitted, the reviewer leaves
model cost unpriced instead of inventing it.

```bash
node scripts/build-model-route-review.mjs \
  --experiment openai-model-route-003 \
  --baseline private-openai-capture/model-route-003-baseline \
  --proposed private-openai-capture/model-route-003-proposed \
  --baseline-charge 0.00 \
  --proposed-charge 0.00
```

Open `web/model-route-review-preview.html`. It contains ten screens total: five
cases for each route. The model names remain hidden until every response has a
disposition. A zero charge must be used only when the provider reports zero;
otherwise omit the charge flags until the evidence is available.
