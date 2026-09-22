# Changelog

All notable changes to AI Cost Lens are documented here.

## [0.5.0]: 2026-09-22

- Added a one-click, unmistakably illustrative request-log walkthrough so a first-time visitor can exercise the local usage analysis without preparing a file.
- Replaced first-screen finance shorthand with clearer definitions while retaining the existing evidence and savings gates.
- Documented the deliberate boundary between request-level browser events and period-level CLI billing ledgers, including the non-lossless field relationships.
- Made the optional full operating-cost categories legible from the collapsed control without forcing six advanced inputs into the default first-run form.

- Direct **Price a prompt** and **Review AI usage** paths in the opening chooser so the two high-frequency workflows are no longer hidden inside the workbench.
- Optional local monthly-budget checks against the evidence-gated 30-day run rate, with configurable warning level and explicit `WITHIN`, `WATCH`, `OVER`, `NOT_SUPPLIED`, or unavailable status.
- Equal-window period comparison for confirmed complete periods of at least 14 days, with an exact volume effect and average-cost effect bridge plus the largest provider and model changes.
- Clear disclosure that the average-cost effect can reflect model mix, token shape, cache, tools, service tier, or rate changes and is not itself evidence of a pricing change.
- Operational request evidence for failure, retry, cache, latency, and joined outcome coverage; missing fields remain unavailable instead of becoming zero.
- Complete team/owner and customer/product breakdowns in the request review, with average selected cost per priced row across every ownership view.
- Downloadable `ai-cost-lens-usage-review/1.1` JSON in addition to formula-safe normalized CSV; neither the budget check nor variance bridge permits a savings claim.
- One local custom/contract route in **Price a prompt**, with required rate date and source label, optional batch and token limits, explicit `user_supplied` provenance, and no contract upload or false verification claim.
- Downloadable `ai-cost-lens-prompt-price-estimate/0.6` JSON for an auditable handoff; user-supplied rates add their own confirmation requirement and remain `TEST_FIRST`.
- A reverified `ai-cost-lens-pricing-catalog/0.5` snapshot with 14 curated OpenAI, Anthropic, and Google routes, effective and review dates, provider-specific Standard, Batch, Flex, Fast, and Priority modes where published, cache-write and cache-storage rates, long-context treatment, and geography multipliers.
- Per-route processing mode and inference geography in prompt estimates, plus explicit cache-refresh duration and cache-storage token-hour assumptions. Refreshes replace cache reads rather than being double counted.
- Labeled model-rate cards replace the ambiguous wide catalog table, keeping input, cached-input, cache-write or storage, and output units visible at narrow widths.
- Request-log analysis now preserves processing mode, inference geography, cache-write tokens, and cache-storage token-hours; supported rows can use those dimensions for automatic catalog pricing, spend breakdowns, and period-variance investigation.
- A visible custom-rate shortcut, one intentionally open comparison slot, and fail-closed add behavior prevent catalog actions from silently replacing an existing route.
- Mobile masthead actions now use one menu, and the seven-section navigation becomes a native section picker at tablet and phone widths.
- Darkened sage and clay interface tokens meet WCAG AA contrast against the primary light surfaces used by labels and status text.
- The production build now uses same-origin assets under a restrictive Content Security Policy and excludes self-contained offline preview files from deployment while retaining them for local use.
- Corrected the TokenCost research source and removed an unverified dead Optimaizr repository link.
- New schema, finance-reconciliation tests, front-door interaction coverage, and competitor-readiness documentation for the expanded local review.
- Removed the old synthetic Pilot 002 links from the public workbench and excluded all internal model-route pilot pages and records from the deployable static build; the single clearly labeled illustrative review remains the only bundled example.

## [0.4.0]: development milestone, not tagged

- A browser-local **Price a prompt** workspace for comparing direct API token prices without an API key.
- A versioned `ai-cost-lens-pricing-catalog/0.4` snapshot with dated official source URLs for OpenAI, Anthropic, and Google.
- Deterministic per-call, per-1,000-call, monthly, annual, and optional per-usable-result calculations.
- Exact local OpenAI `o200k_base` raw-text counting, disclosed Anthropic/Google character estimates, and a manual token override, plus cache share, retry rate, call volume, and published batch pricing controls.
- Up to three alternatives against a current model, with visible price dates, assumptions, and exclusions.
- Prompt text stays in the browser and is deliberately excluded from the generated estimate record.
- **Send estimate to Review** preloads the existing no-file comparison while requiring a fresh same-task quality sample.
- Prompt-price records are always labeled estimated and `TEST_FIRST`, with `savings_claim_allowed: false` enforced at both the record and Review handoff.
- A seven-part decision workspace for Overview, Spend, Opportunities, Simulate, Verify, Evidence, and Actuals, with unavailable enterprise views removed from the simple no-file path.
- Structured opportunity findings that retain evidence basis, dollar confidence, overlap group, operational risk, verification requirement, and limitation; overlapping amounts are never summed.
- Aggregate-route simulation that holds the observed token shape visible, checks published model limits, and keeps repricing separate from quality verification.
- A local realized-savings ledger with explicit identified-to-realized gates, ready-result volume normalization, implementation cost, review currency, and a hard block on non-real source records.
- Missing numeric values in the new engines fail closed instead of becoming JavaScript zero, and retry cost remains unquantified without request-level attribution.
- Calendar dates, pricing provenance, catalog units, token limits, and rate cards receive strict validation before calculations run.
- Spreadsheet-formula prefixes are neutralized in the blinded review CSV export.
- A browser-local request-log review that normalizes up to 20,000 flat CSV or JSON rows into `ai-cost-lens-usage-event/1.0` records without copying prompt text or unknown fields.
- A request-level spend explorer with date, provider, model, project, workload, and status filters, bounded row rendering, import coverage, and complete normalized download.
- Local provider/model/project/team/workload/customer spend breakdowns and a 30-day run rate that requires a confirmed complete 7+ day, fully timestamped, fully priced, single-currency period.
- Deterministic request-level findings for duplicate IDs, failed and retried calls, repeated error loops, evidenced cache candidates, oversized inputs, excessive outputs, reasoning intensity, repeated tool use, model-route candidates, outcome gaps, workload concentration, and cost spikes beyond the change in request volume.
- Reversible duplicate groups, retained unpriced rows, provider-reported-cost precedence, source-file hashes, mixed-currency refusal, and formula-safe normalized CSV export.
- Missing request currency remains unknown unless the user supplies one explicit fallback; it no longer inherits currency from the illustrative review.
- Optional same-scope bill reconciliation shows raw and duplicate-excluded reference differences without deleting or invalidating imported rows.
- A non-additive request-cost boundary that unions affected events across overlapping high-confidence findings and remains explicitly ineligible for a savings claim.
- Flat-field compatibility detection for universal, OpenAI-compatible, Anthropic-compatible, OpenRouter, Langfuse, and Helicone records, with coverage shown instead of claiming arbitrary export support.
- A searchable model catalog inside Price a prompt with provider-sourced workload signals, official source links, verified dates, published context limits, and price-versus-quality disclosure.
- A current-price expiry gate that stops calculator runs after the catalog review date until official rates are reverified.
- Local paired-output verification with deterministic checks, cryptographically randomized blinded A/B scoring, human outcomes, review time, and an output-free `ai-cost-lens-verification/1.0` record.
- Verification-to-Review provenance that carries the output-free record into the finance decision while leaving the existing savings gates in control.
- Strict prompt-estimate and verification schemas, a blank verification template, golden request fixtures, privacy/network assertions, and competitor-challenge acceptance tests.

## [0.3.3]: 2026-09-04

- A simple local invoice form for starting a useful bill review without preparing a CSV.
- Direct local import for the documented Claude Team and Enterprise spend report.
- Direct local import for complete Claude Messages Usage and Cost Admin API JSON responses saved by the user.
- A confirmation step that shows the normalized provider, period, product, model, cost, usage, missing fields, and row count before a Claude review is built.
- Claude Team and Enterprise email and account identifiers are discarded before the review record is created.
- Missing Claude request and token fields remain unavailable, and Admin API usage does not manufacture a request count.
- A single local upload entry routes supported OpenAI and Claude CSV or JSON files before offering guided normalization.
- Text-based OpenAI and Anthropic invoice PDFs can prefill the existing invoice form for review and confirmation; scans, encryption, malformed files, and ambiguous totals fall back safely.
- Unknown flat CSV or JSON files can be mapped through deterministic header aliases with required confirmation and cost reconciliation.
- Raw PDF text, unmapped fields, and personal identifiers do not enter the saved review.
- The existing calculation engine and all savings gates remain unchanged.

## [0.3.2]: 2026-09-04

- A Crawl, Walk, Run evidence ladder that starts with the records a team already has.
- Useful bill-only guidance without requiring usage, outcomes, retries, or human review.
- Blended request cost, prompt-size, output-size, and largest-route signals when usage is available.
- Evidence-based next actions for bill-only, cost-and-usage, and outcome reviews.
- Human effort and retry data are explicitly optional and never inferred as zero.
- OpenAI export reviews now lead with cost and usage findings before deeper outcome evidence.

## [0.3.1]: 2026-09-04

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
