# Examples

The explicit CCAC 1.1 example keeps three inputs distinct:

- `canonical-usage-v2.1.csv`: usage, model provenance, billing provider, and billing channel.
- `illustrative-price-book-v1.1.json`: synthetic pricing rates and pricing provenance only.
- `illustrative-analysis-v1.json`: reporting period, accounting cost basis, and illustrative completeness.

The original usage and price-book files remain the unchanged CCAC 1.0 compatibility inputs.

## Canonical v0.2 example

```bash
ai-cost-lens ccac --demo --output ai-cost-result.json
```

The usage and price-book files are synthetic and explicitly illustrative. The price book is not a representation of current provider pricing and cannot be used for a real-mode run. Real calculated analysis requires a user-supplied price book with `"mode": "real"`. Provider-reported values remain observed, while price-book-calculated values remain separate estimates.

`outcome-log-template.csv` shows the small human evidence file used by `ai-cost-lens build-review`. Each row represents one completed result and records whether it was accepted, how many model requests and retry requests it required, and the human review and correction time. The included rows are illustrative only.

`review-build-manifest-template.json` shows the explicit join between two OpenAI evidence inventories and their two outcome logs. Copy it beside those four files, replace the project, workload, cost, verifier, and policy declarations, and keep the same evidence mode across all inputs. The template is not runnable until its placeholder paths and project IDs are replaced.

## Legacy samples

`openai-sample.csv`, `anthropic-sample.csv`, and `bedrock-sample.csv` exercise the legacy provider-shape detector:

```bash
ai-cost-lens analyze --input examples/openai-sample.csv --group-by model --format table
```

They are hand-authored examples, not authenticated provider exports or invoice evidence. Do not concatenate provider-shaped legacy files: the legacy detector selects one adapter for the entire file. Use the canonical v0.2 schema for multi-provider analysis.
