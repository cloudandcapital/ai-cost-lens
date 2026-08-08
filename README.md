# AI Cost Lens

AI Cost Lens is an open-source, file-first AI usage cost analyzer. It separates provider-reported cost from independently calculated token cost, preserves pricing provenance, attributes usage to organizational dimensions, and emits a versioned Cloud & Capital Analysis Contract result.

For the complete six-tool demo and roadmap, see [Tech Spend Command Center](https://github.com/cloudandcapital/tech-spend-command-center).

It does not connect to provider APIs, fetch live prices, certify invoices, or identify redundant models from names alone. Its canonical result now feeds the validated illustrative pipeline; Cloud Cost Guard itself remains unchanged.

## What v0.2 supports

- Strict `ai-cost-lens/2.0` canonical CSV input
- Provider, model, project, team, environment, and task allocation
- Uncached-input, cached-input, output, and reasoning token categories
- Explicit request counts and batch multipliers
- Cost per million categorized tokens and cost per request
- Provider-reported cost with `basis: observed`
- Independently priced usage with `basis: calculated`
- User-supplied, dated price books with source provenance
- Fail-closed unsupported models and malformed financial values
- Explicit Bedrock/cloud-billing overlap protection
- Unattributed AI cost findings that are never called savings
- Reconciled `ccac/1.0.0` output by default, with explicit `ccac/1.1.0` direct-AI scope output

The public demo is credential-free and uses entirely illustrative data.

## Install the released CLI

Python 3.10 or newer is required.

```bash
pipx install "git+https://github.com/cloudandcapital/ai-cost-lens.git@v0.2.0"
ai-cost-lens --help
```

For development from a clone:

```bash
python -m pip install -e ".[dev]"
```

## Five-minute public demo

```bash
ai-cost-lens ccac --demo --output ai-cost-result.json
```

The command writes `ai-cost-result.json`; rerunning with the same path
replaces that explicitly named local file.

The acceptance suite validates this artifact against the shared CCAC reference schemas. Contributors may run `ccac validate ai-cost-result.json` after installing the separate CCAC reference package.

**Illustrative sample AI usage and synthetic prices. No customer accounts, credentials, provider APIs, invoices, or production resources are connected. The included prices are not current provider prices.**

The default remains the byte-stable `ccac/1.0.0` compatibility artifact. To emit the canonical direct-AI scope under CCAC 1.1:

```bash
ai-cost-lens ccac --demo --contract-version 1.1.0 --output ai-cost-result-1.1.json
```

The 1.1 public scenario explicitly classifies OpenAI and Anthropic usage as `direct_ai_vendor` and Bedrock as `cloud_provider_billing`. Its canonical `metric.tech-spend.scope.direct_ai` includes only the direct-vendor components. The declared period is 2026-07-01 through 2026-07-22, start-inclusive and end-exclusive, in UTC. The fixture declares absent dates as zero illustrative usage; this completeness statement applies only to the deterministic public scenario.

The deterministic demo uses the same parser, price calculator, reconciliation, and CCAC producer as local user files.

## Analyze local usage

```bash
ai-cost-lens ccac \
  --input your-canonical-usage.csv \
  --price-book your-real-price-book.json \
  --analysis your-analysis-declaration.json \
  --contract-version 1.1.0 \
  --output ai-cost-result.json
```

Rows with `cost_basis=provider_reported` require `billed_cost`. Rows with `cost_basis=calculated` require a matching price-book entry and must leave `billed_cost` blank. Unsupported calculated models fail; they never become zero-cost usage.

Explicit 1.1 local-file runs keep three declarations separate:

1. `ai-cost-lens/2.1` usage rows state what was consumed, the model provider, the charge issuer in `billing_provider`, and the explicit `billing_channel`.
2. `ai-cost-lens-price-book/1.1` states only how calculated token costs were priced and where those rates came from.
3. `ai-cost-lens-analysis/1.0` states the reporting period, timezone, accounting cost basis, coverage status, absent-date treatment, and completeness explanation.

Every 1.1 row requires both billing fields. Neither the model provider nor billing provider is used to infer a missing channel. Known billing issuers must agree with the declared channel: for example, OpenAI model usage billed by Azure is Cloud, while OpenAI model usage billed by OpenAI is direct AI. Real/local runs require an explicit analysis declaration and remain partial and ineligible for an all-in technology-spend total because a local file does not establish complete vendor or billing-period coverage.

The canonical CSV requires all token categories, request count, batch multiplier, currency, and allocation dimensions to be explicit. `uncached_input_tokens` excludes cached tokens, and `output_tokens` excludes separately reported reasoning tokens. All four categories must be mutually exclusive. This prevents ambiguous double-counting. Use the literal value `unattributed` when ownership is unknown. Empty values are invalid.

## Price-book contract

Price books use `ai-cost-lens-price-book/1.0` for the compatibility path or `ai-cost-lens-price-book/1.1` for explicit CCAC 1.1, and declare:

- `mode`, either `illustrative` or `real`
- `effective_at`
- `source`
- model key as `provider/model`
- currency
- per-million input, cached-input, output, and reasoning rates

Prices are supplied by the user because provider rates, model names, regions, tiers, batch discounts, and caching rules change. Real calculated runs require a user-supplied price book explicitly marked `"mode": "real"`. The bundled synthetic book is marked `illustrative`, is not current provider pricing, and is rejected in real mode. Price-book mode must match the analysis mode; missing, invalid, and mismatched modes fail closed.

## Cost interpretation

- `provider_reported` means the cost was present in the imported source. It is observed source data, not independently verified invoice truth.
- `calculated` means AI Cost Lens applied the declared token categories, rates, and batch multiplier.
- Provider-reported and calculated rows remain separate metrics even when all allocation dimensions match. Calculated costs are estimates based on the supplied rates; provider-reported costs remain observed source values.
- The total AI metric is non-additive at the technology-spend boundary.
- Bedrock usage may already exist in FinOps Lite’s AWS cost total. Its dimensions explicitly declare potential overlap so Command Center must reconcile it before aggregation.
- Unattributed project/team cost is an allocation finding, not an optimization opportunity.

AI Cost Lens emits no remediation commands or savings opportunities in v0.2.

## Legacy compatibility

The original commands remain available:

```bash
ai-cost-lens analyze --input examples/openai-sample.csv --group-by model --format json
ai-cost-lens compare --baseline period-a.csv --proposed period-b.csv
```

These commands sum cost values already present in loosely shaped CSV files. They do not independently price tokens and are not the canonical pipeline interface. Their “FOCUS-style” field names are not a claim of official FOCUS conformance.

## Pipeline compatibility

AI Cost Lens `0.3.x` preserves the `ccac/1.0.0` compatibility path and can explicitly emit its canonical direct-AI scope through `ccac/1.1.0`. The existing AI-domain total remains non-additive, and Bedrock remains excluded from the canonical direct-AI scope because provider-billed native AI belongs to Cloud. Cloud Cost Guard and downstream consumers remain unchanged.

## Development

```bash
uv run --extra dev pytest
```

## License

MIT © 2025–2026 Diana Molski, Cloud & Capital
