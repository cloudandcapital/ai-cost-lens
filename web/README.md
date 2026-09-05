# AI Cost Lens web interface

The interface is a local finance review for AI work. A user can open the
illustrative sample, build a review from the universal spend and work-log CSV
templates, or reopen a saved `ai-cost-lens-review-result/1.0` file. It has no
backend and does not upload review data.

## Run locally

From the repository root:

```bash
python -m http.server 8000 --directory web
```

Open `http://localhost:8000`.

For a standalone preview that opens without a local server:

```bash
node scripts/build-web-preview.mjs
```

Then open `web/preview.html`. The preview embeds the same illustrative result,
both downloadable CSV templates, and the browser review builder. The normal
interface continues to load its sample JSON and templates as separate files.

## Start a review

The opening presents four paths:

- **See the worked example** opens the synthetic false-economy case with no files.
- **Understand one bill** accepts a simple local invoice form or a universal spend template from any provider. Cost is enough to start; request, token, retry, outcome, and human-effort fields are optional.
- **Upload what you have** locally routes supported OpenAI CSV pairs, Claude Team/Enterprise spend CSVs, complete Claude Admin Usage and Cost JSON pairs, and text-based OpenAI or Anthropic invoice PDFs. Unknown flat CSV or JSON files can use a deterministic field mapper when date, cost, and currency are identifiable.
- **Compare cost per ready result** uses universal spend and work templates for any provider, including OpenAI.

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

- **The review** connects the bill to accepted work, cost per usable result, the
  opportunity ledger, and the next decision.
- **The bill** separates model usage, shared infrastructure, and human review,
  then exposes behavior that may explain the change.
- **The evidence** shows the cost boundary, source, coverage status,
  reconciliation issues, outcome verifier, policy status, and accepted-result
  definition.
- **Story view** removes interface chrome and leaves one finding, chart, limitation, and next step.

## Timed model route review

`model-route-review-preview.html` is the standalone local human review for
Pilot 002. It presents the twenty preserved responses anonymously, counts only
active review and correction time, saves progress in the browser, and exports a
route-aware JSON or CSV after the review is complete. Model names remain hidden
until every answer has an acceptance decision.

## Model route decision

`model-route-decision.html` turns a controlled model comparison into an
finance decision with clear evidence labels. It keeps provider cost, answer key
correctness, reviewer trust, and total economics separate instead of allowing
a lower rate to become an unsupported savings claim.

The bundled Pilot 002 decision is a controlled synthetic example. The page can
also open a local `ai-cost-lens-decision-record/0.1` JSON file using the
`model_route/0.1` profile and never uploads it. Story view removes the operating
detail for a concise summary.

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

The interface must always label illustrative data and must not display synthetic or public evidence as customer results.
