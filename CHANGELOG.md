# Changelog

All notable changes to AI Cost Lens are documented here.

## [0.3.1]: release candidate, not yet tagged

- Provider-neutral single-bill reviews, from declared invoice cost through usage and ready-result evidence.
- Clearer provider-to-template transfer guidance, retry accounting and missing-data handling.
- Strict calendar-date and comparable-period checks, plus deep saved-review validation.
- Local file/row limits, duplicate-row warnings, and explicit credit, refund and discount treatment.
- Explicit local, deterministic Lumen boundary: no AI API or external file uploads.
- Branded social metadata and favicon.
- Fresh builder state for every new review, including files, declarations, planning and inactive paths; failed submissions retain editable inputs.
- Print cleanup follows the print lifecycle rather than a timer; OpenAI period mismatches are prominent at the top of the review.

## [0.3.0]: 2026-09-03

### Added
- Explicit `ccac/1.1.0` selection with one canonical direct-AI technology-spend scope.
- Separate versioned usage, pricing, and analysis declarations for billing provenance, net-cost basis, period, and completeness.
- Separate treatment for direct AI vendor billing and cloud provider billing.
- An `ai-cost-lens review` command that joins cost, usage behavior, outcome, human review, policy, and change-cost evidence.
- Cost per usable result, usable-result rate, retry rate, cache-reuse rate, normalized comparison, and modeled payback calculations.
- A savings-claim gate that requires real mode, compatible cost bases, quality, and policy evidence.
- A local, static Workload Review interface with Operator and Story views.
- Product notes and source-backed research for the finance review.
- A local OpenAI Admin API evidence importer for saved organization completions usage and cost responses.
- Separate cache-write token evidence plus pagination, period, attribution, and model-cost reconciliation limits.
- Explicit documented-schema coverage that remains unvalidated against a sanitized real-organization response.
- A versioned outcome log and review-build manifest that join provider evidence to accepted results, retries, review time, and correction time.
- Coverage-aware savings gates plus an Evidence Check that keeps request, period, attribution, and cost-basis gaps visible.
- A local OpenAI response sanitizer and bounded real-evidence pilot that preserve financial fields while replacing private identifiers.
- A clean cost of one ready result view that joins model, shared,
  and human cost to the work that cleared the quality bar.
- Three-state outcome yield (`ready_to_use`, `needs_correction`, and
  `needs_escalation`) with backward compatibility for boolean accepted logs.
- A clear boundary between AI Cost Lens and provider dashboards, gateways,
  observability tools, and price calculators.
- Four synthetic enterprise decision cases covering a false economy, true
  savings, a policy gate, and a weak sample.
- Separate policy approval for the current and proposed routes, plus explicit
  failed-gate and leave-it-alone explanations.
- A synthetic acceptance report and repeatable decision engine tests.

### Compatibility
- Default and explicit `ccac/1.0.0` demo artifacts remain byte-identical to the 0.2.0 baseline.
- CCAC remains a CI and acceptance dependency rather than a production runtime dependency.

## [0.2.0]: 2026-08-04

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

## [0.1.0]: Initial release

### Added
- `analyze` command: reads AI billing CSV, auto-detects provider, outputs FOCUS-style cost breakdown
- `compare` command: side by side cost comparison between two billing periods
- `--group-by model`: aggregate and rank spend by AI model name
- `--group-by day`: aggregate daily AI spend trends
- `--format json/csv/table`: machine readable or human readable output
- Provider auto-detection from CSV column signatures:
  - OpenAI: `model` column and model names starting with `gpt-`, `o1`, `o3`, etc.
  - Anthropic: `model` column and model names starting with `claude-`
  - AWS Bedrock: `model_id` column
- FOCUS 1.0 output columns: `BilledCost`, `ResourceId`, `ServiceName`, `ChargePeriodStart`, `ChargePeriodEnd`, `ChargeType`
- `ServiceName` maps to the model name (e.g. `gpt-4o`, `claude-sonnet-4-6`, `amazon.nova-pro-v1:0`)
- Sample billing exports for all three providers in `examples/`
- GitHub Actions CI on Python 3.10, 3.11, 3.12
