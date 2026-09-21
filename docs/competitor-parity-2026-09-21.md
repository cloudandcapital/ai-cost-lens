# Competitor capability ledger

Research checked: September 21, 2026

This is the release truth for AI Cost Lens 0.5. It is not a marketing comparison and it does not declare overall parity. A capability is marked implemented only when the repository contains a working path and a testable evidence boundary.

## Bottom line

AI Cost Lens is now a credible browser-local AI cost decision workbench. It is strongest where list-price estimates, observed request cost, output quality, billed evidence, human effort, and post-change actuals have to become one defensible finance decision.

It is not a replacement for hosted observability, a production gateway, or a 300-model directory. Optimaizr remains more automatic for supported transcript and live-traffic optimization. Price Per Token, TokenCost, and Artificial Analysis remain broader model-discovery products. Helicone, Braintrust, Portkey, and the enterprise FinOps platforms remain stronger at continuous collection, alerts, routing, and organization-wide operation.

The defensible claim is therefore:

> AI Cost Lens provides a local finance decision loop that model-price directories and trace dashboards do not attempt; it is not the broadest catalog or the most automated production monitor.

## Evidence-based comparison

| Capability | Market reference | AI Cost Lens 0.5 evidence | Status |
|---|---|---|---|
| Browser-local use without an account or API key | [Optimaizr](https://www.optimaizr.com/) emphasizes local analysis | Static browser application; local file parsing; source records state `uploaded: false`; prompt and output text are omitted from saved estimate and verification records | Implemented |
| Prompt and model price comparison | [Price Per Token](https://pricepertoken.com/) and [TokenCost](https://tokencost.app/) specialize in model price comparison | Dated, source-linked OpenAI, Anthropic, and Google catalog; per-call, per-1,000-call, monthly, annual, cache, batch, retry, and usable-result calculations | Implemented, deliberately narrow |
| Very broad model directory | Price Per Token advertises 300+ models, [TokenCost](https://tokencost.app/) advertises 151+, and [Artificial Analysis](https://artificialanalysis.ai/models) lists hundreds with benchmark dimensions | 13 curated models from three providers, plus one explicitly user-supplied custom or contract route | Directory breadth is not at parity; private-rate coverage is implemented |
| Model-aware input counting | TokenCost emphasizes provider/model tokenization | Exact local `o200k_base` raw-text count for OpenAI; disclosed four-character estimate for Anthropic and Google; manual override for provider-reported counts | Partial |
| Capability or task filters | Price Per Token and Artificial Analysis put capability or benchmark context beside price | Provider-sourced workload signals for general, reasoning, coding, high volume, long context, and multimodal; no generic benchmark is treated as task proof | Implemented as a shortlist, not a benchmark leaderboard |
| Import observed request cost | [Helicone](https://docs.helicone.ai/guides/cookbooks/cost-tracking), [Braintrust](https://www.braintrust.dev/docs/observe/dashboards), and Langfuse collect request data continuously | Local flat CSV/JSON normalization with common OpenAI-compatible, Anthropic-compatible, OpenRouter, Langfuse, and Helicone field aliases; strict OpenAI and Claude bill paths remain separate | Implemented with named compatibility limits |
| Spend breakdown and run rate | Observability and FinOps tools segment spend and project run rate continuously | Local provider/model/project/team/workload/customer breakdowns and average priced-row cost; 30-day run rate fails closed unless a complete 7+ day period, timestamps, prices, and one currency are confirmed | Implemented as a static snapshot |
| Budget visibility | [Helicone](https://docs.helicone.ai/guides/cookbooks/cost-tracking) and [Portkey](https://portkey.ai/docs/product/observability/cost-management) expose ongoing spend controls | Optional local monthly budget and warning threshold are compared only with an eligible evidence-gated run rate | Implemented as a user-run threshold check; not live enforcement |
| Operational cost signals | [Braintrust](https://www.braintrust.dev/docs/observe/dashboards) combines requests, latency, tokens, cost, and scores | Status, retry-link, cache-token, latency, and outcome coverage with failure/retry/cache shares plus median and p95 latency when supported | Implemented for supplied local fields |
| Automatic transcript or live-traffic scan | Optimaizr supports transcript scanning and wrapper/live analysis | No automatic Claude Code or Codex transcript parser; no network wrapper | Not implemented |
| Deterministic waste findings | Optimaizr detects cache, tool, reasoning, model-fit, and size candidates | Duplicate IDs, failed/retried calls, retry chains, cache candidates, oversized input/output, reasoning intensity, repeated tools, route candidates, missing outcomes, concentration, and cost spikes | Implemented for supported local fields |
| Period variance decomposition | FinOps tools and mature variance systems explain spend change | Two equal consecutive windows reconcile exactly into request-volume effect and average-cost-per-request effect, with top provider/model changes; the average-cost effect is not mislabeled as a rate change | Implemented for complete 14+ day local evidence |
| Pricing-change decomposition | Mature variance systems isolate rate, volume, and mix | Only one current checked-in catalog is shipped, so the average-cost effect cannot yet be split reliably into model mix, token shape, cache, tools, service tier, and official rate changes | Not implemented without reliable price history |
| Bill reconciliation | FinOps tools reconcile usage and invoices; observability tools may show estimated cost | Optional same-scope bill comparison, raw selected request cost, and a duplicate-excluded review reference; no row is deleted or presumed invalid | Implemented |
| Simulation | Optimaizr simulates changes before verification | Reprices observed request shape under model, cache, batch, output, and retry assumptions while keeping the result `TEST_FIRST` | Implemented |
| Same-task quality verification | Optimaizr and [Braintrust evaluations](https://www.braintrust.dev/docs/evaluate) compare outputs on test cases | Local paired cases, deterministic rules, cryptographically randomized A/B presentation, blinded human outcomes, review time, quality gates, and output-free record export | Implemented |
| Automatic replay and model-as-judge | Optimaizr can replay candidate traffic and run automated judging; evaluation platforms support model scorers | No provider call or model judge | Intentionally excluded pending key handling, security review, and explicit opt-in |
| Cost per ready result and human rework | FinOps platforms support unit economics, but provider dashboards generally stop at requests and tokens | Existing decision engine joins provider, shared, human, outcome, retry, policy, and one-time costs | Implemented; core differentiator |
| Evidence-gated savings claim | Most pricing tools show differences or potential savings | Estimated calculator and request-finding data always set `savings_claim_allowed: false`; equivalent work, provider evidence, policy, quality, and cost basis must pass | Implemented; core differentiator |
| Post-change actuals | Enterprise FinOps tools track budgets and actuals | Local actuals ledger requires implementation date, comparable periods, provider-reported cost, complete outcomes, approval, and quality before `REALIZED` | Implemented locally |
| Continuous monitoring, alerts, enforcement, and routing | Helicone, Portkey, Braintrust, Vantage, and similar platforms are built for ongoing operation | Static, user-initiated review and local threshold check only | Not implemented; outside the privacy-safe static scope |

## What was added because of this audit

- Exact local OpenAI raw-text tokenization, with prompt text kept out of the estimate record.
- A catalog expiry gate that stops current calculations after the published review date instead of quietly using stale prices.
- Provider-sourced workload filters instead of presenting price alone as model suitability.
- Request-cost spike detection that adjusts for request volume and never labels the excess as savings.
- Bill-to-request reconciliation with an explicit same-scope confirmation and a non-destructive duplicate reference.
- Local spend breakdowns and a conservative 30-day run rate that refuses partial, unpriced, undated, short, or cross-currency evidence.
- Fail-closed currency handling. Missing request currency stays unknown; it never inherits USD from the illustrative review.
- Built-in blinded, randomized paired-output scoring with deterministic checks and an output-free verification record.
- Verification-to-Review provenance that preserves that safe record in the finance decision without preserving raw outputs.
- A blank verification template instead of a plausible-looking sample result.
- Direct opening paths for prompt pricing and request-log review so core workflows are discoverable before a user learns the full workbench.
- Local monthly-budget status that inherits every run-rate evidence gate and makes no live-alert or forecast claim.
- Exact equal-window period variance, top provider/model changes, and operational coverage for failures, retries, cache, latency, and outcomes.
- A complete safe JSON analysis export for independent review and downstream audit.
- A versioned prompt-estimate export and one local custom/contract route so unsupported or negotiated prices can be compared without uploading an agreement or presenting them as official.

## Deliberate accuracy boundaries

### Transcript imports

Claude Code and Codex transcript formats are not treated as stable public contracts. Community examples also show cumulative and per-turn token fields that can be double counted if interpreted casually. AI Cost Lens will not advertise a transcript adapter until sanitized, authentic fixtures for each supported version exist and tests prove that a session total cannot be duplicated.

### Automatic replay and judging

Replay requires provider credentials, network transmission of prompts, provider-specific request reconstruction, and metering of the verification run itself. Automatic judging also introduces a second model's bias and cost. Those features need a separate opt-in security design; they are not smuggled into a product whose primary promise is local processing.

### Catalog breadth and public benchmarks

The catalog is a curated shortlist, not a scraped directory. External benchmark data is excluded until its license, refresh process, task meaning, and provenance can be defended. Provider workload descriptions are discovery signals only; the paired local test remains the decision evidence.

## Release gates

These are not optional polish. They are the conditions for a responsible public release:

1. **Automated release checks completed September 21, 2026.** The full Python suite passed 238 tests with five expected CCAC-validator skips; Node interaction/static acceptance, production build, formatting, locked dependency audits, package install, and deterministic package smoke checks passed.
2. **Real-browser review remains open.** Exercise Price a Prompt, request import, bill reconciliation, blind verification, Review handoff, saved-review reopen, and print at desktop and mobile widths with no console errors.
3. **Catalog source check completed September 21, 2026.** Recheck every catalog entry against its official provider source no later than the November 21, 2026 catalog review date.
4. **Authentic-fixture gate remains permanent.** Validate any newly claimed provider export against a sanitized authentic fixture. Field-name similarity alone is not production validation.
5. **Claim boundary remains permanent.** Keep automatic transcript parsing, provider replay, live alerts, and routing out of the public claim until their separate acceptance gates exist.

## Next highest-value additions

1. Add signed, historical official pricing snapshots and decompose spend change into rate, volume, and mix effects.
2. Separate average-cost movement into model-mix, token-shape, cache, tool, service-tier, and rate effects only when the required row evidence and price history make the bridge exact.
3. Add a versioned bulk custom price-book import only after the single-rate workflow has authentic user testing and clear duplicate/effective-date behavior.
4. Promote individual source adapters only after authentic fixture validation and version-specific regression tests.
5. Consider opt-in replay only after a documented threat model, session-only key handling, redaction, explicit network disclosure, and cost accounting.

## Sources

- [Optimaizr website](https://www.optimaizr.com/) and [source repository](https://github.com/blendbunjaku/optimaizr)
- [Price Per Token](https://pricepertoken.com/)
- [TokenCost](https://tokencost.app/)
- [Artificial Analysis model comparison](https://artificialanalysis.ai/models)
- [Helicone cost tracking](https://docs.helicone.ai/guides/cookbooks/cost-tracking)
- [Braintrust dashboards](https://www.braintrust.dev/docs/observe/dashboards) and [evaluation](https://www.braintrust.dev/docs/evaluate)
- [Portkey cost management](https://portkey.ai/docs/product/observability/cost-management)
- [Vantage custom LLM enrichment](https://docs.vantage.sh/custom_llm_enrichment)
- [FOCUS 1.5 release scope](https://focus.finops.org/focus-1-5-release-scope/)
- [OpenAI models](https://developers.openai.com/api/docs/models), [Claude models](https://platform.claude.com/docs/en/models/overview), and [Gemini models](https://ai.google.dev/gemini-api/docs/models)
