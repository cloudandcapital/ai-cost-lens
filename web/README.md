# AI Cost Lens web interface

The interface is a local-first finance review for AI work. A user can open the
illustrative sample, build a review from the universal spend and work-log CSV
templates, or reopen a saved `ai-cost-lens-review-result/1.0` file. It has no
backend and does not upload review data.

## Run locally

From the repository root:

```bash
python -m http.server 8000 --directory web
```

Open `http://localhost:8000`.

For a single-file preview that opens without a local server:

```bash
node scripts/build-web-preview.mjs
```

Then open `web/preview.html`. The preview embeds the same illustrative result,
both downloadable CSV templates, and the browser review builder. The normal
interface continues to load its sample JSON and templates as separate files.

## Start a review

The opening presents three paths:

- **See the worked example** opens the synthetic false-economy case with no files.
- **Check an OpenAI bill** is a convenience importer for matching Completions usage and Cost CSV exports.
- **Test a model or route change** uses universal templates for Claude, Bedrock, Gemini, gateways, and other AI tools.

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

## Finance memo

**Download decision record** preserves the complete machine-readable JSON.
**Print finance memo** creates a compact executive handoff from the same record,
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
- **Story view** removes interface chrome and leaves a screenshot-ready finding, chart, limitation, and next step.

## Timed model route review

`model-route-review-preview.html` is the single-file, local human review for
Pilot 002. It presents the twenty preserved responses anonymously, counts only
active review and correction time, saves progress in the browser, and exports a
route-aware JSON or CSV after the review is complete. Model names remain hidden
until every answer has an acceptance decision.

## Model route decision

`model-route-decision.html` turns a controlled model comparison into an
evidence-labeled finance decision. It keeps provider cost, locked-key
correctness, reviewer trust, and all-in economics separate instead of allowing
a lower rate to become an unsupported savings claim.

The bundled Pilot 002 decision is a controlled synthetic example. The page can
also open a local `ai-cost-lens-decision-record/0.1` JSON file using the
`model_route/0.1` profile and never uploads it. Story view removes the operating
detail for a restrained, screenshot-ready summary.

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
