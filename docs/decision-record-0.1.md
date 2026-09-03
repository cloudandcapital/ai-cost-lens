# AI Cost Lens Decision Record 0.1

The AI Cost Lens Decision Record is a portable finance artifact that preserves
the question, evidence, arithmetic, limitations, and supported decision for one
AI workload review.

The record is not an observability trace, provider invoice, or automated
approval. It links those sources without allowing a lower provider charge to
become an unsupported all-in savings claim.

## First supported profile

Version 0.1 supports one profile:

`model_route/0.1`

That profile compares a baseline and proposed model route using provider cost,
locked correctness, human-review evidence, and declared decision gates. Future
profiles may cover FOCUS workload reviews, commitment decisions, or contract
pricing, but they are not supported by this release.

## Required decision gates

An all-in savings claim can be verified only when all four gates pass:

1. The routes performed equivalent work.
2. Their cost bases are compatible.
3. A usable outcome and verifier are declared.
4. Human review and correction cost were measured validly.

The validator rejects a `CHANGE_ROUTE` decision unless the all-in savings claim
is verified. A lower provider bill may remain verified while the all-in claim
stays unknown.

## Evidence states

- `VERIFIED_FACT`: supported by the cited record and not blocked.
- `LIMITED_EVIDENCE`: useful signal with a named limitation.
- `COMPANY_CLAIM`: an official vendor statement that is not independent proof.
- `ESTIMATE`: calculated or modeled rather than observed.
- `UNKNOWN`: required proof is missing.
- `CONTRADICTED`: the supplied evidence conflicts with the claim.

Claims marked `UNKNOWN` or `LIMITED_EVIDENCE` must name the limitation that
blocks them. Every claim must reference evidence included in the record.

## Validate a record

```bash
ai-cost-lens validate-decision \
  --input examples/decision-records/openai-model-route-002.json
```

The validator recomputes:

- Provider cost difference.
- Provider cost reduction percentage.
- Exact-response percentage-point change.
- Provider cost per exact response for each route.

It also checks evidence references, limitation references, required gates, and
decision boundaries.

For model-route records, `consistency_checks` compare narrative calculations
with structured values. A check cannot be marked `PASS` when equal-unit values
conflict, and a material failed check blocks a `CHANGE_ROUTE` decision.

The public JSON Schema is available at
[`schemas/ai-cost-lens-decision-record-0.1.schema.json`](../schemas/ai-cost-lens-decision-record-0.1.schema.json).

## Bundled example

[`openai-model-route-002.json`](../examples/decision-records/openai-model-route-002.json)
contains a controlled synthetic pilot. It is not customer data and does not
establish production performance. Its valid conclusion is narrower:

- Luna's provider charge was 94.25% lower.
- Sol produced nine exact responses; Luna produced five.
- The recorded human review could not support an all-in savings calculation.
- Luna did not earn approval as an unguarded finance default.

The browser operator and Story views are generated from this exact JSON file,
so the screenshot cannot silently drift from the validated record.
