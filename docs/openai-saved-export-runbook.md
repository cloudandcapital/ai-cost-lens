# OpenAI saved-export bill review

This is a provider-specific entry path inside AI Cost Lens. It is a bill
review, not a model-routing recommendation and not a savings calculator.

## What to export

From the OpenAI Usage dashboard, save two CSV reports for the same date range:

1. Completions usage
2. Cost

The files are read locally. API credentials are not required.

An [older public repository](https://github.com/sabah-naveed/njc-cost-analysis)
contains paired, dashboard-shaped usage and cost CSVs.
They exercise the importer without copying the repository's account identifiers
into AI Cost Lens. The older usage file omits `input_cache_write_tokens`; the
completions importer accepts the file and reports that measure as unavailable. These
third-party files have no provider attestation or matching invoice, so current
dashboard compatibility and invoice reconciliation still need a consenting
user's unmodified exports. If the importer rejects a file, keep it local and
inspect the missing fields before adapting the contract.

## What the review can establish

- Provider-reported total cost and currency
- Requests, input tokens, output tokens, and cache-token fields
- Observed usage mix by model and project
- Whether usage and cost reports cover the same UTC time buckets, including start and end boundaries
- Which attribution fields are populated

## What remains unavailable unless the evidence supports it

- Billed cost by model
- Billed cost by project when the cost export has no project attribution
- Cost per usable result
- Savings from a routing, caching, model, or commitment change

AI Cost Lens never spreads the provider total across models using token share.
Token share is usage evidence, not a defensible allocation of billed dollars.

## Deterministic command

```bash
ai-cost-lens review-openai-csv \
  --usage completions_usage.csv \
  --costs cost.csv \
  --mode real \
  --output openai-bill-review.json
```

The browser and command-line paths use the same financial boundary. The command
produces `ai-cost-lens-openai-bill-review/0.1` JSON for audit, reopening, or a
future workload-outcome join.

## The next evidence layer

To compare routes or claim savings, add a workload outcome log with the accepted
result definition, verifier, quality floor, retries, review time, and correction
time. The bill review remains the provider-evidence layer; it does not become a
savings claim on its own.
