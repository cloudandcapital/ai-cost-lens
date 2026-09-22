# AI Cost Lens 1.0 independent review brief

Prepared: September 21, 2026; finalized September 22, 2026
Release branch: `release/v1.0.0`

This brief is for an independent Codex or Claude review before merge or deployment. Treat the implementation as a release candidate, not as approved production software.

## Product claim to test

AI Cost Lens is a browser-local finance decision workbench for AI spend. It joins rate estimates, observed request cost, billed evidence, workload behavior, output quality, optional human effort, and post-change actuals without asking for an API key or uploading the imported files.

It is comparable to model-price directories, LLM observability products, and local optimization tools by specific capability. It does **not** claim overall parity with hosted gateways, live telemetry, broad model directories, automated replay, alerts, or routing.

## Non-negotiable invariants

1. Prompt text, paired output text, and imported request files stay in the browser.
2. Unknown numeric evidence remains unavailable; it never becomes zero implicitly.
3. Mixed or missing currency cannot produce one combined amount.
4. Provider-reported row cost takes precedence over calculated row cost without erasing either provenance.
5. Suspected duplicate request rows are flagged and retained.
6. Prompt-price estimates, custom rates, request findings, budget checks, and variance results cannot authorize a savings claim.
7. A realized-savings state still requires real source evidence, implementation, comparable periods, provider-reported cost, complete outcomes, quality, and approval.
8. Official list rates and user-supplied rates remain visibly distinct.
9. Internal synthetic model-route pilots are not linked or copied into the deployable static build; only the clearly labeled illustrative review ships as example data.
10. Period-level compute, retrieval/data, network, tooling, pipeline, and human costs are never allocated automatically across request dimensions.
11. `fully_loaded_cost` remains unavailable unless every additional operating-cost category is explicitly supplied; blank never means confirmed zero.
12. Allocation coverage uses known cost and an explicit user-selected dimension and threshold. A warning cannot become a savings claim.
13. Usage telemetry, request cost, and billing evidence remain separate evidence layers.

## 1.0 scope to review

- Direct opening paths for **Price a prompt** and **Review AI usage**.
- Local monthly-budget status against the evidence-gated 30-day run rate.
- Equal-window period variance that reconciles total cost change into request-volume and average-cost-per-request effects.
- Provider and provider-model cost-change tables.
- Status, retry-link, cache, latency, and outcome coverage with missing-evidence behavior.
- Complete provider/model plus project, team/owner, feature, customer, product, workload, workflow, session, and environment breakdowns.
- Cost-weighted unallocated percentages and a user-set allocation decision check.
- Optional compute, retrieval/data, network, tooling/observability, pipeline/orchestration, and human-review cost stack with fail-closed fully loaded cost.
- Separate usage-telemetry, request-cost, and billing-evidence status.
- Plain optimization categories and a finance posture of fund change, fix evidence, stop change, or insufficient evidence.
- Downloadable `ai-cost-lens-usage-review/1.1` JSON.
- One local custom/contract prompt-pricing route with explicit `user_supplied` provenance.
- Downloadable `ai-cost-lens-prompt-price-estimate/0.6` JSON.
- Application/package version `1.0.0`.

## Primary files

- `web/usage-event-engine.js`
- `web/pricing-engine.js`
- `web/app.js`
- `web/index.html`
- `web/styles.css`
- `schemas/ai-cost-lens-usage-review-1.1.schema.json`
- `schemas/ai-cost-lens-prompt-price-estimate-0.6.schema.json`
- `tests/test_usage_event_engine.py`
- `tests/test_prompt_pricing.py`
- `scripts/check-builder-state.mjs`
- `docs/competitor-parity-2026-09-21.md`

## Repeatable verification

```bash
npm ci --ignore-scripts
npm audit --audit-level=high
npm run build
node scripts/check-builder-state.mjs
node scripts/check-web-acceptance.mjs
uv lock --check
uv sync --frozen --extra dev
uv run --frozen black --check ai_cost_lens tests
uv run --frozen isort --check-only ai_cost_lens tests
uv run --frozen flake8 ai_cost_lens tests --count --select=E9,F63,F7,F82,F401 --show-source --statistics
uv run --frozen pytest tests/ -q
```

The final local release-candidate run completed with 250 tests passed and 5 expected skips. Those five checks require the separately released CCAC validator that CI installs. Generated full, minimal, mixed-currency, and unpriced usage reviews validate against the published event and review schemas. `npm audit --audit-level=high` and the locked runtime `pip-audit` both reported no known vulnerabilities. The wheel installed in a fresh virtual environment as `ai-cost-lens==1.0.0`, and its CCAC 1.0 and 1.1 demo artifacts were deterministic across repeated runs.

## Adversarial cases

Try to make the product overstate certainty:

1. Leave status, retry, cache, latency, and outcome fields absent. Their rates or percentiles must be unavailable, not 0%.
2. Mix USD and EUR request rows. Combined spend, budget, variance dollars, and opportunity dollars must remain unavailable.
3. Remove one timestamp or one row price from an otherwise complete period. Run rate, budget comparison, and period variance must fail closed.
4. Supply a 13-day period. The 30-day run rate may be eligible after confirmation, but period variance must remain unavailable until 14 days.
5. Supply an odd-length complete period. The earliest day may be excluded, and the UI must disclose that the two compared windows are equal.
6. Make the prior comparison window cost zero. Percentage change must be unavailable while the dollar bridge remains defined.
7. Repeat an event ID. Both rows must remain in the export and the duplicate-excluded number must stay labeled as a review reference.
8. Select one custom rate twice. The calculator must reject duplicate routes.
9. Supply only one or two custom batch rates. The calculator must reject the partial rate set.
10. Use a custom rate without a source label or with a future effective date. The scenario must fail.
11. Send any price estimate to Review. The comparison must remain `TEST_FIRST`, clear the quality sample fields, and keep `savings_claim_allowed: false`.
12. Put spreadsheet-formula prefixes in normalized CSV text fields. The download must neutralize them.
13. Inspect `build/` after `npm run build`. It must not contain the internal `model-route-decision*`, `model-route-review*`, or corresponding pilot data files.
14. Omit the selected project/team/feature/customer/product/workload/workflow/session/environment field from enough priced rows to exceed the allocation threshold. The review must warn, preserve every row, and make no savings claim. Add an unpriced row and confirm that allocation decision support becomes unavailable.
15. Add period-level operating costs. Confirm that they increase known operating cost but remain unallocated to request dimensions. Blank one category and verify that fully loaded cost becomes unavailable; enter an explicit zero and verify that it counts as supplied.
16. Supply usage fields without a bill, then add a comparable bill with a variance, then reconcile it. Telemetry, request cost, and billing evidence must retain separate statuses throughout.
17. Confirm that every deterministic request finding carries a useful category and that routing, caching, context, output, reasoning, or tool candidates remain test-first rather than savings.
18. Exercise route decisions that should fund, fix evidence, stop the proposed change, or report insufficient evidence. The compact posture and detailed next action must not contradict one another.

## Manual browser review still required

The automated DOM harness tests real event handlers and state transitions, but it is not layout or native-browser QA. Before merge, use a real browser at desktop and mobile widths to inspect:

- opening-path hierarchy and keyboard focus;
- Price a prompt, custom rate, JSON download, and Review handoff;
- request import, allocation warnings, partial and fully loaded cost states, evidence layers, budget states, 14-day variance, coverage states, both downloads, and filters;
- blind verification, saved-review reopen, and print/PDF output;
- dialog overflow, tables, focus return, reduced widths, browser console, and network panel.

No release claim should say that live alerts, gateway routing, automatic replay, a 300-model directory, or historical rate-card decomposition exists. The dated capability ledger is the source of truth for those boundaries.

## Research anchors

- [OpenAI API pricing](https://developers.openai.com/api/docs/pricing)
- [Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Helicone cost tracking](https://docs.helicone.ai/guides/cookbooks/cost-tracking)
- [Portkey cost management](https://portkey.ai/docs/product/observability/cost-management)
- [Braintrust dashboards](https://www.braintrust.dev/docs/observe/dashboards)
- [Vantage custom LLM enrichment](https://docs.vantage.sh/custom_llm_enrichment)
- [FOCUS 1.5 release scope](https://focus.finops.org/focus-1-5-release-scope/)
