# AI Cost Lens web interface

The interface is a local finance review for AI work. A user can open the
illustrative sample, build a review from the universal spend and work-log CSV
templates, or reopen a saved `ai-cost-lens-review-result/1.0` file. It has no
backend and does not upload review data.

## Run locally

From the repository root:

```bash
npm ci
npm run dev
```

Open the local URL printed by Vite. The development command first prepares the
same tokenizer and PDF.js assets used by the production build.

For a standalone preview that opens without a local server:

```bash
npm run build
```

Then open `web/preview.html`. The preview embeds the same illustrative result,
the spend, work-log, request-log, and verification CSV templates, and the
browser review builder. The local OpenAI tokenizer is prepared beside it and
loads only when an OpenAI price scenario needs an exact raw-text count. The
normal interface continues to load its sample JSON and templates as separate
files.

## Start a review

The opening presents seven paths:

- **Price a prompt** opens the local direct-API pricing workspace without requiring a bill or review file.
- **Review AI usage** opens the request-log analysis path for local CSV or JSON records.

- **Compare two AI tools or plans** accepts two monthly prices and a small same-task quality sample without a spreadsheet.
- **See the worked example** opens the bundled false-economy case with no files.
- **Understand one bill** accepts a simple local invoice form or a universal spend template from any provider. Cost is enough to start; request, token, retry, outcome, and human-effort fields are optional.
- **Upload what you have** locally routes supported OpenAI CSV pairs, Claude Team/Enterprise spend CSVs, complete Claude Admin Usage and Cost JSON pairs, and text-based OpenAI or Anthropic invoice PDFs. Unknown flat CSV or JSON files can use a deterministic field mapper when date, cost, and currency are identifiable.
- **Compare cost per ready result** uses universal spend and work templates for any provider, including OpenAI.

The masthead also opens **Price a prompt**, a separate browser-local scenario workspace. It uses the versioned `ai-cost-lens-pricing-catalog/0.4` snapshot to compare up to four direct API models across OpenAI, Anthropic, and Google. One route may instead use a locally entered custom or contract rate with a required effective date and short source label; the agreement is not uploaded, the rate is marked `user_supplied`, and AI Cost Lens does not claim to verify it. The workspace models per-call, per-1,000-call, monthly, annual, and optional per-usable-result costs with explicit token, retry, cache, and batch assumptions. OpenAI raw text is counted locally with `o200k_base`; other providers use a disclosed character estimate unless the user enters a known count. Prompt text is not stored in the generated `ai-cost-lens-prompt-price-estimate/0.5` record, which can be downloaded locally. Sending the estimate to Review preloads calculated provider charges but deliberately clears the sample fields; the existing evidence gate requires the user to review comparable outputs and still forbids a savings claim from estimated calculator data.

The Price a prompt workspace includes a searchable catalog with provider and provider-sourced workload-signal filters, official source links, verification dates, standard input/cached/output rates, and published context limits. It does not present generic benchmarks as proof that a model can do the user's work.

The **Opportunities** view accepts a flat local request log and runs `usage-event-engine.js`. The engine emits `ai-cost-lens-usage-event/1.0` rows and an `ai-cost-lens-usage-review/1.1` record, retains unpriced rows, gives provider-reported cost precedence, flags repeated event IDs without deleting them, refuses missing- or mixed-currency addition, identifies cost spikes beyond request-volume change, unions overlapping event cost in its high-confidence boundary, and exports formula-safe normalized CSV plus the complete JSON review. It also produces local provider/model/project/team/workload/customer breakdowns. A 30-day run rate requires a confirmed complete period of at least seven days with every row timestamped, priced, and in one currency; otherwise it remains unavailable. A local monthly-budget threshold can use that run rate but is not a live alert or forecast. Confirmed complete periods of at least 14 days also receive an exact equal-window volume-versus-average-cost bridge, while latency, cache, status, retry, and outcome signals show their own coverage. An optional billed total is compared only after same-scope confirmation and shows both raw and duplicate-excluded reference differences. Prompt text and unknown input fields are not copied. Common flat OpenAI-compatible, Anthropic-compatible, OpenRouter, Langfuse, and Helicone names are aliases rather than separate network integrations; nested or changed exports still require local flattening or the universal template.

The **Verify** view imports paired baseline and candidate outputs. It can check non-empty text, JSON validity, required and forbidden terms, required JSON fields, exact labels, and maximum length. Its built-in review uses browser cryptographic randomness to assign A/B order per case, hides route names during scoring, records human outcomes and optional review minutes, then clears raw output text. The exported `ai-cost-lens-verification/1.0` record contains checks and results but not the outputs, and it cannot authorize a savings claim. When its outcome counts are sent to Review, that same output-free record is retained as `verification_evidence` in the downloaded finance decision.

The interface uses a simple review-depth ladder: Crawl understands the bill, Walk explains the usage, and Run connects cost to outcomes. These labels describe the available evidence, not a formal FinOps maturity score. A bill-only review still returns a cost baseline, visible limits, and practical next steps.

Direct provider imports do not include business outcomes, so they cannot produce cost per ready result on their own. Invoice PDFs are bill evidence only and never become usage evidence. The Claude importer uses net provider-reported spend, discards Team/Enterprise email and account identifiers, and keeps absent request or token measures unavailable. Native Claude Console CSV headers are not publicly documented, so that format is not claimed as directly supported without an authentic sample. Use guided mapping or the universal paths for other flat provider reports, a work log, a reviewed sample, or a route comparison.

The setup screen explains that transfer. It identifies the cost and usage sources for OpenAI, Claude API, Bedrock, Gemini or Vertex AI, and gateways; defines every template column; distinguishes missing data from a reported zero; and explains that screenshots, scanned PDFs, nested JSON, and arbitrary raw provider files are not automatically supported.

The route-change builder accepts:

- One spend-and-usage CSV containing `baseline` and `proposed` rows.
- One work-log CSV containing completed results, acceptance, requests, retries,
  human review, and correction time.
- A small finance declaration covering the acceptance rule, verifier, quality
  floor, human hourly rate, policy approval, and optional shared or one-time
  cost.

It validates dates, workloads, currency, request reconciliation, token totals,
and accepted results before producing a review. Cost differences remain
separate from supported savings until the bill, work, quality, and policy gates
all pass.

Provider cost is required. Request, token, and cache fields may be left blank when the source report does not supply them. A complete work log can supply model-call and retry counts when the provider report omits request totals. Other missing measures remain unavailable instead of being shown as zero.

For each completed result, `model_requests` counts every model call and `retry_requests` counts only the additional calls after the first attempt. A result produced with three calls has three model requests and two retries. Retry rate is total retry requests divided by total provider requests. The provider bill already includes those calls, so retry cost is never added a second time.

Outcome status is assigned at the end of review. A result that cleared the rule after completed correction is `ready_to_use`, with all correction time included in `human_minutes`. `needs_correction` means the result is still not ready. `needs_escalation` means it could not be completed through the normal review path.

## Finance memo

**Download decision record** preserves the complete machine-readable JSON.
**Print finance memo** creates a compact finance handoff from the same record,
including the decision, cost bridge, outcome yield, plan and payback when
available, evidence boundary, and next step. The browser print dialog can save
the memo as a PDF. It does not recompute or reinterpret the decision.

## Views

- **Overview** connects the bill to accepted work, cost per usable result, the current decision, and its boundary.
- **Spend** separates model usage, shared infrastructure, and human review, then exposes behavior that may explain the change.
- **Opportunities** ranks structured findings without adding overlapping candidate amounts.
- **Simulate** reprices an observed aggregate token shape and keeps every result in `TEST_FIRST`.
- **Verify** routes a candidate into a same-task quality sample and the blinded review tool.
- **Evidence** shows the cost boundary, source, coverage, reconciliation, outcome, policy, and ready-result definition.
- **Actuals** normalizes a post-change period and withholds realized savings until every source and decision gate passes.
- **Share view** removes interface chrome and leaves one finding, chart, limitation, and next step.

The simple no-file comparison hides Spend, Simulate, and Actuals because its sampled answers cannot support those observed-data workflows.

## Internal model-route test artifacts

`model-route-review-preview.html` is the standalone local human review for
Pilot 002. It presents the twenty preserved responses anonymously, counts only
active review and correction time, saves progress in the browser, and exports a
route-aware JSON or CSV after the review is complete. Model names remain hidden
until every answer has an acceptance decision.

`model-route-decision.html` turns a controlled model comparison into a
finance decision with clear evidence labels. It keeps provider cost, answer key
correctness, reviewer trust, and total economics separate instead of allowing
a lower rate to become an unsupported savings claim.

The bundled Pilot 002 decision is an illustrative example. The page can
also open a local `ai-cost-lens-decision-record/0.1` JSON file using the
`model_route/0.1` profile and never uploads it. Story view removes the operating
detail for a concise summary.

These pages are repository-level experiment and regression artifacts. They are
not linked from the public workbench, and `npm run build` explicitly excludes
their pages, scripts, styles, and data from the deployable `build/` directory.

The browser fixture is generated from
`examples/decision-records/openai-model-route-002.json`. Run the Python
validator before rebuilding the preview:

```bash
ai-cost-lens validate-decision \
  --input examples/decision-records/openai-model-route-002.json
node scripts/build-model-route-decision-preview.mjs
```

Rebuild it only from the two preserved evidence directories:

```bash
node scripts/build-model-route-review.mjs \
  --baseline private-openai-capture/model-route-002-baseline \
  --proposed private-openai-capture/model-route-002-proposed
```

## Regenerate the bundled demo

```bash
ai-cost-lens review --demo --output web/data/illustrative-review-result.json
```

The test suite compares the committed browser demo byte-for-value with the Python calculation result so the interface fixture cannot drift from the engine.

## Design system

- Background: Cloud & Capital soft beige `#f5eee9`, with white working-paper surfaces
- Type: high-contrast system serif with compact neutral sans-serif labels
- Ink: near-black
- Supporting colors: muted sage and one clay accent
- Charts: restrained ledgers and rules, not generic dashboard cards
- Language: financial questions first; technical detail remains available without leading the page

The interface must always label illustrative data and must not display example or public evidence as customer results.
