# Request-level usage review

AI Cost Lens can analyze a flat CSV or JSON request log entirely in the browser. The import creates versioned `ai-cost-lens-usage-event/1.0` records and an `ai-cost-lens-usage-review/1.1` review. It does not call a provider, ask for an API key, upload the source file, or require prompt text.

## Supported local inputs

Use the browser template at `web/templates/ai-cost-lens-request-log-template.csv`, or a flat export whose headings match the deterministic aliases in `web/usage-event-engine.js`.

The adapter detector recognizes common flat field names from:

- OpenAI-compatible request logs
- Anthropic-compatible request logs
- OpenRouter usage records
- Langfuse observation exports
- Helicone request exports
- A provider-neutral universal request log

This is field compatibility, not a claim that every current export from those products has been production validated. Nested trace payloads must be flattened before import. Source formats can change, and the import coverage panel shows what was actually recognized.

The local spend explorer filters the normalized events by date, provider, model, project, workload, and request status. The canonical record also preserves optional team, feature, customer, product, workflow, session, and environment allocation fields without copying unknown source columns. It shows the first 100 matching rows in the browser and keeps the complete set in the normalized download, avoiding an unbounded DOM render for the 20,000-row import limit. The complete prompt-free analysis record can also be downloaded as JSON for review or audit.

OpenRouter documents native-tokenizer counts, cached and reasoning token details, cost, and server-tool cost in its normalized response usage. Langfuse documents ingested versus inferred usage and cost, with ingested values taking priority. AI Cost Lens follows the same conservative precedence rule: provider-reported row cost wins over calculated token cost for that row.

Sources checked September 21, 2026:

- <https://openrouter.ai/docs/api_reference/overview>
- <https://langfuse.com/docs/observability/features/token-and-cost-tracking>
- <https://developers.openai.com/api/docs/pricing>
- <https://platform.claude.com/docs/en/about-claude/pricing>
- <https://ai.google.dev/gemini-api/docs/pricing>

## Canonical event behavior

- Blank values remain `null`; they do not become zero.
- Rows that cannot be priced remain in the review with `cost_basis: unpriced`.
- Automatic catalog pricing requires an event timestamp inside the catalog's effective/review window, the catalog currency, and explicit batch, cached-input, and tool-charge values. Missing fields are not assumed to be standard tier, zero cache, or zero tool cost.
- Provider-reported cost takes precedence over calculated cost on the same event.
- Repeated provider/event-ID pairs are assigned a reversible `duplicate_group`; no row is deleted.
- An optional billed total is compared only after the user confirms that bill and request records cover the same provider, account, currency, and period. The review shows both the raw difference and a duplicate-excluded reference without changing the imported rows. Missing request cost, request currency, or bill currency is reported as missing evidence rather than zero or a generic mismatch.
- Provider, model, project, team, feature, customer, product, workload, workflow, session, and environment breakdowns retain request counts, priced-row counts, selected cost, and cost share. Dollar fields remain unavailable when currency is missing or mixed.
- Allocation coverage is cost-weighted. The user chooses the dimension that must support the decision and a maximum unallocated share. The default 10% warning is an explicit AI Cost Lens review policy, not an industry standard. The result is `PASS`, `WARN`, or `NOT_SUPPORTED`; it never authorizes a savings claim, and it remains unsupported while any request row is unpriced.
- Optional same-period compute, retrieval/data, network, tooling/observability, pipeline/orchestration, and human-review totals extend the cost boundary beyond the provider charge. Users must exclude charges already included in provider request cost or another category. Blank stays unknown, zero means confirmed none, and `fully_loaded_cost` remains unavailable until every category is supplied.
- Period-level operating costs remain unallocated to project, team, feature, customer, product, workload, workflow, session, and environment. AI Cost Lens never spreads shared cost across requests without an allocation method supplied outside this static review.
- Usage telemetry, request cost, and billing evidence are separate exported layers. Telemetry supports faster operational diagnosis; comparable billed evidence confirms the financial boundary; neither proves business value or savings.
- A straight-line 30-day run rate is available only after the user confirms a complete continuous period of at least seven calendar days and every row is timestamped, priced, and in one comparable currency. It is labeled as a local run rate, not a forecast or live monitor.
- An optional monthly budget is compared only with that eligible run rate. The configured warning threshold produces a static `WITHIN`, `WATCH`, or `OVER` result; it is not a live alert, enforcement control, forecast, or savings claim.
- A period-over-period bridge is available only for a confirmed complete period of at least 14 days with every row timestamped, priced, and in one comparable currency. It compares the two most recent equal UTC windows and reconciles total cost change exactly into request-volume effect and average-cost-per-request effect. The latter is not labeled a rate-card change because model mix, token shape, cache, tools, tier, and price can all contribute.
- Operational evidence reports status, retry-link, cache-token, latency, and outcome-join coverage. Failure rate, retry-linked share, cache share, median latency, and p95 latency appear only when their underlying fields have coverage. Retry linkage is explicitly not an attempt-count rate.
- The source file receives a local SHA-256 hash when the browser supports Web Crypto.
- Unknown columns are discarded. Prompt text and personal fields are not copied into the canonical event.
- A missing request currency remains unknown. The tool does not silently inherit USD; the user may enter one explicit fallback only when it applies to every row that omits currency.
- Mixed currencies remain visible, but AI Cost Lens refuses to add them or produce one cross-currency opportunity amount. Per-event dollar opportunity maps are also removed from the exported review until the currency boundary is comparable.
- The normalized CSV neutralizes leading spreadsheet-formula characters.

## Deterministic findings

The first request-level library covers:

1. Duplicate billed-event identifiers
2. Failed, cancelled, and retried request cost
3. Repeated retry chains
4. Repeated prefixes with little or no reported cache use
5. Inputs above twice their workload median
6. Outputs above twice their workload median
7. High reasoning-token share on relatively short outputs
8. Tool-call counts above the workload pattern
9. A higher-priced catalog model used alongside a lower-priced model in the same workload
10. Priced requests without joined outcome evidence
11. Spend concentration by workload
12. Daily request cost at least twice the preceding seven active-day median and at least 50% above the prior per-request cost applied to current volume

Only duplicate, failed, retry, and error-loop event cost enters the high-confidence headline boundary. The engine unions affected event records, so one event is counted once even when several findings overlap. That boundary is still not a savings claim: retries can be necessary, duplicate identifiers can be legitimate, and the provider bill may require reconciliation.

Every finding carries a plain optimization category: billing integrity, reliability, caching, context reduction, output control, reasoning control, tooling, routing and downsizing, evidence, allocation, or variance. Cache, prompt-size, output-size, reasoning, tool, and model-route findings remain candidates. They require a controlled workload test because request shape does not prove task difficulty, quality, latency, policy compatibility, or human rework.

The cost-spike finding is also an investigation signal. It names the affected rows and reports observed versus volume-adjusted reference cost, but assigns no avoidable amount. Model mix, token shape, cache behavior, tools, service tier, pricing changes, task difficulty, or incomplete days can all explain the difference.

## Local test checklist

1. Serve `web/` from localhost or open the generated `web/preview.html`.
2. Open **Opportunities** and import a copy of `tests/fixtures/request-events-multi-provider.csv`.
3. Confirm that seven rows remain present, two rows share a duplicate group, and four failed/retry rows contribute $0.0256 to the non-additive boundary.
4. Download normalized usage and confirm the original file was not modified.
5. Repeat with a row containing an unknown model and no cost. It must remain unpriced.
6. Repeat with USD and EUR rows. No combined cost or opportunity amount may appear.
7. Use a browser network panel while importing. No request should leave the page.
8. Repeat with a priced row that omits currency. Confirm that totals and bill reconciliation remain unavailable until an explicit fallback is entered.
9. Supply a same-scope billed total and confirm that repeated event IDs remain in the file while the raw and duplicate-excluded differences are shown separately.
10. Confirm a complete seven-day-or-longer period and verify the 30-day run-rate arithmetic. Then remove one price or timestamp and confirm that the run rate becomes unavailable rather than partial.
11. Enter a monthly budget and warning level. Confirm that the threshold status uses only the eligible run rate and becomes unavailable with it.
12. Use a complete 14-day-or-longer period and confirm that prior plus volume effect plus average-cost effect equals current cost. Confirm that the record keeps `savings_claim_allowed: false`.
13. Confirm that missing latency, status, cache, retry, or outcome fields reduce the corresponding coverage instead of appearing as observed zeroes.
14. Choose a decision allocation dimension, omit it from enough priced rows to exceed the selected warning level, and confirm that the review warns rather than inventing attribution.
15. Supply all six additional operating-cost categories and confirm that fully loaded cost appears. Blank any one category and confirm that fully loaded cost becomes unavailable while known partial cost remains visible.
16. Reconcile a same-scope bill and confirm that usage telemetry, request cost, and billing evidence remain three separate layers in the exported review.

The automated equivalents live in `tests/test_usage_event_engine.py` and `tests/test_local_privacy.py`.
