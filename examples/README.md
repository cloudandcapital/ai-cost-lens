# Examples

`canonical-usage-v2.1.csv` and `illustrative-price-book-v1.1.json` demonstrate the explicit CCAC 1.1 billing-channel, period, net-cost, and illustrative-completeness declarations. The original files remain the unchanged CCAC 1.0 compatibility inputs.

## Canonical v0.2 example

```bash
ai-cost-lens ccac --demo --output ai-cost-result.json
```

The usage and price-book files are synthetic and explicitly illustrative. The price book is not a representation of current provider pricing and cannot be used for a real-mode run. Real calculated analysis requires a user-supplied price book with `"mode": "real"`. Provider-reported values remain observed, while price-book-calculated values remain separate estimates.

## Legacy samples

`openai-sample.csv`, `anthropic-sample.csv`, and `bedrock-sample.csv` exercise the legacy provider-shape detector:

```bash
ai-cost-lens analyze --input examples/openai-sample.csv --group-by model --format table
```

They are hand-authored examples, not authenticated provider exports or invoice evidence. Do not concatenate provider-shaped legacy files: the legacy detector selects one adapter for the entire file. Use the canonical v0.2 schema for multi-provider analysis.
