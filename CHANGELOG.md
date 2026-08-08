# Changelog

All notable changes to AI Cost Lens are documented here.

## [0.3.0] — unreleased

### Added
- Explicit `ccac/1.1.0` selection with one canonical direct-AI technology-spend scope.
- Separate versioned usage, pricing, and analysis declarations for billing provenance, net-cost basis, period, and completeness.
- Fail-closed separation of direct AI-vendor billing from provider-billed native AI.

### Compatibility
- Default and explicit `ccac/1.0.0` demo artifacts remain byte-identical to the 0.2.0 baseline.
- CCAC remains a CI and acceptance dependency rather than a production runtime dependency.

## [0.2.0] — 2026-08-04

### Added
- A standard `ai-cost-lens --version` installation smoke check.
- Strict canonical `ai-cost-lens/2.0` CSV ingestion.
- Separate provider-reported and calculated cost bases.
- Cached-input, output, and reasoning token pricing with explicit batch multipliers.
- Versioned, dated, source-declared user price books.
- Project, team, environment, and task attribution.
- Deterministic illustrative CCAC output with source hashes, pricing evidence, reconciliation, and Bedrock overlap metadata.

### Corrected
- Unsupported models, missing values, NaN, infinity, fractional token counts, duplicates, and mixed currencies now fail closed in the canonical path.
- Removed claims of provider API integrations, live pricing, official FOCUS conformance, redundant-model detection, and an active Cloud Cost Guard feed.
- Untagged ownership is reported as unattributed cost rather than savings.
- Legacy adapters now reject empty, mixed-provider, malformed, non-finite, and negative usage rows instead of silently dropping values or emitting zero.

## [0.1.0] — Initial release

### Added
- `analyze` command: reads AI billing CSV, auto-detects provider, outputs FOCUS-style cost breakdown
- `compare` command: side-by-side cost comparison between two billing periods
- `--group-by model` — aggregate and rank spend by AI model name
- `--group-by day` — aggregate daily AI spend trends
- `--format json/csv/table` — machine-readable or human-readable output
- Provider auto-detection from CSV column signatures:
  - OpenAI — `model` column + model names starting with `gpt-`, `o1`, `o3`, etc.
  - Anthropic — `model` column + model names starting with `claude-`
  - AWS Bedrock — `model_id` column
- FOCUS 1.0 output columns: `BilledCost`, `ResourceId`, `ServiceName`, `ChargePeriodStart`, `ChargePeriodEnd`, `ChargeType`
- `ServiceName` maps to the model name (e.g. `gpt-4o`, `claude-sonnet-4-6`, `amazon.nova-pro-v1:0`)
- Sample billing exports for all three providers in `examples/`
- GitHub Actions CI on Python 3.10, 3.11, 3.12
