# AI Cost Lens

AI Cost Lens is a free, open source tool that starts with a simple question: where is the AI cost going?

Start with one provider bill. Add requests, tokens, models, routes, or cache usage when those records exist. Add outcomes when the decision needs cost per ready result. Human effort and retries are optional; missing fields stay unavailable rather than becoming zero.

This supports the same progression FinOps teams make from Crawl to Walk to Run: understand the bill, explain the usage, then connect cost to business outcomes. The labels describe the depth of the review, not a formal maturity assessment.

The calculations are deterministic. Costs reported by a provider stay separate from costs calculated from a price book, and the tool shows when missing or mismatched evidence prevents a savings claim.

It does not connect to provider APIs, fetch live prices, certify invoices, enforce production budgets, or identify redundant models from names alone. Review files stay local. The browser interface does not upload them. The OpenAI importer reads response files that the user saved locally; it never receives an Admin API key.

## What it does

- Strict `ai-cost-lens/2.0` canonical CSV input
- Provider, model, project, team, environment, and task allocation
- Uncached-input, cached-input, output, and reasoning token categories
- Explicit request counts and batch multipliers
- Cost per million categorized tokens and cost per request
- Provider reported cost with `basis: observed`
- Independently priced usage with `basis: calculated`
- User-supplied, dated price books with source provenance
- Rejects unsupported models and malformed financial values instead of treating them as zero cost
- Explicit Bedrock/cloud-billing overlap protection
- Unattributed AI cost findings that are never called savings
- Reconciled `ccac/1.0.0` output by default, with explicit `ccac/1.1.0` direct-AI scope output
- Workload reviews with clearly labeled evidence for current and proposed routes
- Progressive bill, usage, and outcome reviews for different levels of available evidence
- Optional model, shared infrastructure, human review, and one-time change cost
- Usable-result, retry, cache-reuse, and human-review measures when supplied
- Optional Plan vs Actual for provider cost, shared cost, human work, output, yield, and unit cost
- Time-based payback against an explicit monthly ready result volume and decision horizon
- A savings gate that requires real evidence, equivalent work, and compatible cost bases
- A local browser interface with four starting paths, Review, Bill, Evidence, and Share views
- A printable finance memo generated from the same decision record as the on-screen review
- A portable `ai-cost-lens-decision-record/0.1` contract with a strict first
  `model_route/0.1` profile
- Deterministic decision validation that recomputes route arithmetic, checks
  evidence references, and blocks unsupported all-in savings or route changes
- A strict OpenAI evidence importer for saved organization completions usage and cost API responses
- Visible pagination, period, attribution, and model-cost join limitations

The public demo needs no credentials and uses entirely illustrative data.

## Install the CLI

Python 3.10 or newer is required.

The latest tagged release is v0.3.1. This branch prepares the v0.3.2 review-depth update.

```bash
pipx install "git+https://github.com/cloudandcapital/ai-cost-lens.git@v0.3.1"
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

## OpenAI saved-export bill review

Use the same date range for the completions-usage and cost CSV exports:

```bash
ai-cost-lens review-openai-csv \
  --usage completions_usage.csv \
  --costs cost.csv \
  --mode real \
  --output openai-bill-review.json
```

This path reconciles the provider total and usage mix without inventing billed
cost by model. It shows request and token patterns, a blended cost-per-request
baseline, and practical places to investigate. Add an outcome record only when
the decision needs cost per ready result or a savings test. See the
[saved-export runbook](docs/openai-saved-export-runbook.md).

## Workload Review

The current finance review has been tested with four fully synthetic cases. See the
[synthetic acceptance test](docs/synthetic-acceptance-test-2026-09-02.md)
for the decision logic, results, and remaining limits.

Generate the deterministic illustrative decision record:

```bash
ai-cost-lens review --demo --output workload-review.json
```

The review compares a current support workflow with a routed alternative. It includes recurring model cost, shared infrastructure, human review, a one-time change cost, retries, cache reuse, an explicit usable-result definition, policy status, evidence basis, Plan vs Actual, and a time-based decision horizon.

The demo is a synthetic false-economy stress test. Its provider bill falls, but the ready result yield and human work move enough to make each usable result more expensive. Every synthetic input is labeled illustrative and no result is presented as customer evidence.

To open the browser interface from a clone:

```bash
python -m http.server 8000 --directory web
```

Then open `http://localhost:8000`. Choose **See the worked example**, **Review OpenAI exports**, or **Compare cost per ready result**. Use **Open saved review** to inspect another `ai-cost-lens-review-result/1.0` file. The file is parsed in the browser and is not uploaded. **Print finance memo** creates a compact handoff from the same decision record; the browser's print dialog can save it as a PDF.

The OpenAI CSV path accepts matching Activity data for Completions and Cost data exports for a bill and usage review. It does not contain the business outcome evidence needed for cost per ready result. Use the universal spend and work templates for the full comparison, including for OpenAI. Anthropic, Bedrock, Gemini, gateways, and other AI tools currently use those universal templates.

### How to use another provider report

The universal upload reads the AI Cost Lens template. It does not read a raw Anthropic report, AWS CUR file, Google billing export, invoice PDF, or screenshot.

1. Download the spend template from **Start a review**.
2. Open it in Excel or Sheets. Replace the examples with rows from the current route (`baseline`) and the route being tested (`proposed`).
3. Copy provider cost and usage using the same date and model grouping. Use the same workload name and currency on both routes.
4. Mark each cost as `provider_reported`, `calculated`, or `allocated`. Do not repeat one invoice total on multiple usage rows.
5. Upload the completed template, then add a reviewed sample or a complete work log using the same definition of a ready result.

For Claude API, tokens come from the Anthropic Messages Usage Report and cost comes from the Cost Report. That usage report does not include request counts, so those must come from application or gateway logs. For Bedrock, billed cost comes from Cost Explorer or CUR while requests and tokens come from invocation logs. For Gemini or Vertex AI, cost comes from Cloud Billing and request detail comes from Vertex AI or application logs. Gateways use their own cost and usage exports. The browser setup explains every template column and what to do when a usage field is unavailable.

Official source instructions:

- [Export OpenAI API usage and cost CSVs](https://help.openai.com/en/articles/20001072-how-do-i-export-monthly-usage-details-from-the-api-usage-dashboard)
- [Anthropic Messages Usage Report](https://docs.anthropic.com/en/api/admin-api/usage-cost/get-messages-usage-report) and [Cost Report](https://docs.anthropic.com/en/api/admin-api/usage-cost/get-cost-report)
- [Track Bedrock usage and cost](https://docs.aws.amazon.com/bedrock/latest/userguide/cost-management.html) and [enable model invocation logging](https://docs.aws.amazon.com/bedrock/latest/userguide/model-invocation-logging.html)
- [Google Cloud detailed billing export fields](https://docs.cloud.google.com/billing/docs/how-to/export-data-bigquery-tables/detailed-usage)

A provider bill does not contain business outcomes. The ready result status, human time, and retry count come from the application or review process that used the model output. A bill alone cannot prove cost per ready result or savings.

Flat ChatGPT, Claude, or similar subscription receipts do not contain the request and outcome detail needed for this review. A customer may allocate a subscription cost to a workload only when they also have their own usage and result records. Allocated cost remains visibly labeled and cannot become booked savings in the tool.

See the [product brief](docs/product-brief.md), [research notes](docs/competitive-landscape.md), and [web interface notes](web/README.md) for the design and evidence model.

## Decision Record 0.1

Validate the bundled Sol versus Luna finance decision:

```bash
ai-cost-lens validate-decision \
  --input examples/decision-records/openai-model-route-002.json
```

The record keeps provider cost, objective correctness, human review evidence,
and full economics separate. It refuses a `CHANGE_ROUTE` conclusion until
equivalent work, compatible cost bases, an accepted outcome definition, and
valid human cost all pass. See the
[Decision Record 0.1 contract](docs/decision-record-0.1.md).

## Analyze local usage

### Inventory official OpenAI evidence

Save complete responses from OpenAI's organization completions usage and costs endpoints, then run:

```bash
ai-cost-lens import-openai \
  --usage openai-usage.json \
  --costs openai-costs.json \
  --mode real \
  --output openai-evidence.json
```

The importer preserves uncached input, cache reads, cache writes, output tokens, requests, provider-reported cost, source hashes, and attribution coverage. It fails if a supplied response still has another page. `--mode` is an explicit user declaration; it does not authenticate the file or certify an invoice. OpenAI's cost endpoint does not group observed dollars directly by model, so AI Cost Lens does not manufacture model-level billed cost. The output is an evidence inventory, not yet a Workload Review or savings claim.

The parser is tested against the documented response contract. A sanitized response from a real organization is still required before compatibility with the raw provider response can be described as production validated.

Use the [real OpenAI evidence pilot](docs/real-openai-evidence-pilot.md) to capture one complete UTC day, sanitize private identifiers locally, and run the first provider-compatibility check. ChatGPT subscription activity is not OpenAI API organization evidence, and the Admin API key must never be shared with AI Cost Lens.

The locked [OpenAI model route pilot](experiments/openai-model-route-002/README.md) compares the same ten bounded AI finance decisions on Sol and Luna. It preserves requests, responses, token usage, exact scoring, and a separate human outcome log, with no automatic retries or model-only acceptance claim. Pilot 001 is retained as an audit of how an ambiguous rubric produced a misleading score.

### Join cost to a usable result

Provider reporting can establish usage and billed cost. It cannot establish that the work was ready, how much correction it required, or who verified it. AI Cost Lens supports two local outcome paths. The quick path extrapolates a visibly labeled estimate from reviewed sample counts and human minutes. The detailed path uses a minimum four-column log:

```csv
period,result_id,outcome_status,human_minutes
baseline,result-001,ready_to_use,2.5
baseline,result-002,needs_correction,7.0
```

Use `ready_to_use`, `needs_correction`, or `needs_escalation`. Older logs with an
`accepted` boolean and the earlier detailed columns remain supported. Dates,
workload, request counts, retries, and separate review/correction minutes are
optional evidence. Classify each result at the end of review. Use `ready_to_use`
when it cleared the acceptance rule, including after completed correction, and
include every review and correction minute spent. Use `needs_correction` only
when material work is still required. Use `needs_escalation` when the result
could not be completed through the normal review path. This keeps corrected work
in the ready result denominator instead of treating it as lost output. A sampled
result never becomes a proven savings claim. A
browser spend template also requires `cost_basis` on every row. Use
`provider_reported`, `calculated`, or `allocated`; each route must use one basis.
Calculated and allocated route costs remain test evidence and cannot be presented
as booked savings until provider-reported spend confirms the comparison. A
versioned `ai-cost-lens-review-build/1.0`
manifest points to baseline and proposed provider-evidence files and outcome
logs. It also declares the project scope, cost boundary, hourly review rate,
shared infrastructure, one-time change cost, acceptance rule, verifier, and
policy status. An optional `planning` block adds the approved current-route
plan, expected monthly ready result volume, and decision horizon. Build the
review with:

```bash
ai-cost-lens build-review \
  --manifest review-build.json \
  --output workload-review.json
```

The first bridge supports OpenAI evidence and requires the cost boundary to be declared as `all_project_provider_cost`. It calculates human cost from review plus correction minutes. A request mismatch, period mismatch, unattributed model, partial evidence, or policy failure stays visible and blocks a savings claim. OpenAI does not report unique repeated context in the organization usage response, so AI Cost Lens leaves the context-reprocessing measure unavailable instead of estimating it.

Start from [`examples/review-build-manifest-template.json`](examples/review-build-manifest-template.json) and [`examples/outcome-log-template.csv`](examples/outcome-log-template.csv). The manifest is intentionally explicit: it cannot infer that two files describe equivalent work, that a human accepted the result, or that the selected project is the correct accounting boundary.

### Produce the canonical CCAC analysis

```bash
ai-cost-lens ccac \
  --input your-canonical-usage.csv \
  --price-book your-real-price-book.json \
  --analysis your-analysis-declaration.json \
  --contract-version 1.1.0 \
  --output ai-cost-result.json
```

Rows with `cost_basis=provider_reported` require `billed_cost`. Rows with `cost_basis=calculated` require a matching price-book entry and must leave `billed_cost` blank. Unsupported calculated models fail; they never become zero-cost usage.

Explicit 1.1 runs from local files keep three declarations separate:

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

AI Cost Lens emits no remediation commands. Workload Review only permits a savings claim when the declared comparison uses real data, compatible cost bases, an accepted outcome definition, adequate quality, and approved policy status.

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
