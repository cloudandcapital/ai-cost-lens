# AI Cost Lens product reset

Research date: 2026-09-02

## The decision

Build one public product: **AI Cost Lens**, a free, open-source, local-first
financial review for AI work.

The product promise is:

> Upload the cost evidence and a small work log. See what the AI work actually
> cost, what made it through the quality bar, where money leaked, and which
> savings are proven versus merely worth testing.

AI Cost Lens is not a model price calculator, an LLM observability dashboard,
an AI gateway, or a static case-study page. It sits after those systems. It
turns their exports into a defensible finance review.

The AI Finance Lab remains the research engine. Model-routing, prompt-caching,
FOCUS, skill, and human-review experiments produce evidence, test cases, and
articles. They do not become separate public products.

## Why this is the right problem

OpenAI CFO Sarah Friar argues that AI economics should be evaluated using the
full cost of successful work, including corrections, retries, and human review,
not the model's rate card alone. Her proposed operating measures distinguish
work that is ready to use, needs correction, or needs escalation. The FinOps
Foundation reaches the same conclusion from a different direction: task-level
attribution is becoming necessary, gross AI invoices contain several kinds of
leakage, and finance needs evidence that connects cost to usable work.

That leaves a practical problem. Provider reports show billed cost and usage.
Observability products show calls, traces, tokens, latency, retries, feedback,
and evaluations. Gateways set budgets and route traffic. Enterprise FinOps
platforms allocate spend across teams, customers, and features. None of those
categories, by itself, gives a small finance or operating team a local review
that reconciles the bill, includes human and shared cost, tests the denominator,
and labels a savings conclusion according to the evidence behind it.

That review is the product.

## What the market already does well

| Product category | Representative products | Strong existing capability | Why AI Cost Lens should not copy it |
|---|---|---|---|
| Provider reporting | OpenAI and Anthropic organization usage and cost APIs | Official usage, model, token, cache, project or workspace, and billed-cost evidence | These reports do not know whether the work was accepted, how much correction it required, or the complete cost boundary |
| LLM observability and evaluation | Langfuse, Helicone, Braintrust | Per-call traces, token and cost tracking, custom prices, retries, feedback, task completion, evaluation, and model comparisons | Another technical dashboard would enter a mature category and still leave a finance reviewer to define cost basis and decision rules |
| AI gateways and controls | LiteLLM and Portkey | Routing, keys, tags, budgets, rate limits, cached requests, and spend by user, team, model, or job | A cap controls exposure. It does not prove the work was worth doing or that a cheaper route preserved quality |
| Enterprise FinOps | Vantage, Finout, CloudZero | Multi-provider ingestion, bill allocation, budgets, anomaly detection, unit economics, and business dimensions | These are account-based platforms, not a free local review; Vantage already productizes the bill-to-telemetry join |
| Billing standards | FOCUS and provider-neutral allocation schemas | Consistent billing fields, cost bases, quantities, commitments, and allocation vocabulary | A normalized bill still does not contain the accepted-result definition, human correction, or the evidence needed for a route decision |

### The important competitive finding

“Cost by job” is necessary, but it is not a unique headline. LiteLLM already
accepts `jobID` and `taskName` tags. Vantage can split provider-billed dollars
across arbitrary telemetry tags. Helicone and Braintrust can connect usage to
completion and quality signals.

AI Cost Lens should use job or workload attribution as plumbing. Its distinct
value is the **finance decision layer**:

1. Reconcile the observed bill before allocating it.
2. Keep observed, calculated, and allocated cost visibly separate.
3. Include provider cost, shared infrastructure, human review, correction, and
   one-time change cost in the declared boundary.
4. Normalize against accepted work, not raw requests.
5. Separate known waste from modeled opportunity.
6. State what finance may conclude, what must be tested, and what the evidence
   cannot support.

## The user

The primary user is a FinOps, finance, cloud economics, product operations, or
engineering lead reviewing one or more AI workloads without wanting to deploy a
new observability stack.

The public product also has to work for:

- A founder trying to understand whether an AI feature has a viable cost to
  serve.
- A small team whose provider bill is rising faster than expected.
- A practitioner who needs a credible portfolio artifact or interview example.
- A reader who wants to use the included sample data and templates before they
  have clean production evidence.

It is not designed for an individual trying to optimize a five-dollar personal
API bill. Small dollar amounts are useful for learning, but the product's unit
of analysis is a repeatable workload whose economics can scale.

## The one-sentence job to be done

> When our AI spend changes, help me explain whether we bought more usable work,
> paid for avoidable leakage, or only found an idea that still needs a test.

## Product shape

The product is a calm, browser-based workbench. It can be hosted as a public
demo and run locally. User files are processed in the browser or local CLI and
are never uploaded by default.

### The four-part review

Every completed review tells the story in the same order:

1. **The bill** — What was observed, what was calculated, what was allocated,
   and whether the period reconciles.
2. **The work** — What the workload attempted, what met the declared quality
   bar, and how much human effort remained.
3. **The leak** — Which spend went to failed work, retries, repeated input,
   unnecessary output, unattributed activity, or an unsupported route.
4. **The decision** — Save now, test first, fix the evidence, or leave it alone.

This is not four separate products. It is one finance review with progressive
detail.

## Public v1 workflow

### 1. Start with evidence, not a questionnaire

The landing page offers three clear paths:

- **Try the sample review** — no file required.
- **Open provider exports** — OpenAI first, followed by Anthropic.
- **Use the universal template** — for a gateway, observability tool, FOCUS
  export, or a small manually prepared dataset.

### 2. Add a small result log

The minimum result log stays intentionally small:

```csv
result_id,date,workload,outcome_status,model_requests,retry_requests,human_review_minutes,correction_minutes
```

The setup asks for no more than five declarations:

1. Workload name.
2. What “accepted” means.
3. Who or what verified it.
4. Hourly review cost, if human cost should be included.
5. Shared recurring or one-time cost, if it belongs in the boundary.

If the user has only provider evidence, the product still performs a bill
review. It does not pretend to know cost per usable result.

### 3. Produce one review

The first screen is an editorial finance memo, not a card wall.

#### Header finding

A plain-language sentence such as:

> Spend rose 18%, but accepted work rose 31%. Cost per usable result fell 10%.
> The larger bill is not the main problem; correction time is.

The sentence is generated deterministically from validated measures and rule
states. It is not an ungrounded LLM summary.

#### Cost bridge

A single waterfall or bridge from provider bill to all-in operating cost:

- Provider-reported model and tool cost.
- Shared infrastructure allocation.
- Human review and correction.
- One-time change cost shown separately.

The chart must distinguish observed, calculated, and allocated amounts.

#### Work efficiency strip

- Attempted results.
- Accepted results.
- Usable-result rate.
- Cost per usable result.
- Retry rate.
- Human minutes per usable result.
- Cache reuse when the source actually exposes it.

#### Opportunity ledger

Each row contains the dollars or unit impact, evidence state, why it matters,
and the next action. Rows are classified as:

- **SAVE NOW** — observed cost attached to work explicitly recorded as failed,
  duplicate, or outside the declared workload, with no quality tradeoff being
  assumed.
- **TEST FIRST** — a model, cache, batching, prompt, or routing change that may
  lower cost but could change quality, latency, policy, or human correction.
- **FIX THE EVIDENCE** — a missing owner, denominator, page, price source,
  currency conversion, policy status, or result log blocks the conclusion.
- **LEAVE IT ALONE** — higher cost is currently justified by more accepted work,
  a policy requirement, or a worse all-in result from the cheaper option.

That four-way classification is the signature interaction of AI Cost Lens.

### 4. Let the user inspect and share

The same review has three supporting views:

- **Workloads** — a finance table ranked by all-in cost, cost per accepted result,
  retry rate, human effort, and evidence coverage.
- **Test a change** — a bounded scenario workbench for model, cache, retry,
  batching, commitment, or human-review assumptions. It shows recurring impact,
  one-time cost, break-even, quality threshold, and which inputs are modeled.
- **Evidence** — source files, hashes, dates, cost bases, reconciliation, missing
  coverage, policy limitations, and every assumption behind the conclusion.

One button creates a clean Story View or finance memo. Public and synthetic data
remain visibly labeled.

## Measures and formulas

The product will calculate only measures supported by the supplied evidence.

### Core measures

```text
recurring operating cost
  = observed provider cost
  + allocated shared infrastructure
  + human review and correction cost
  + other declared recurring AI service cost

cost per usable result
  = recurring operating cost / accepted results

usable result rate
  = accepted results / attempted results

retry rate
  = retry requests / model requests

human minutes per usable result
  = (review minutes + correction minutes) / accepted results

normalized cost difference
  = proposed cost per usable result at equivalent accepted volume
    - baseline cost per usable result at that volume

break-even accepted volume
  = one-time change cost / recurring savings per accepted result
```

### Cost and evidence states

Every amount carries both a cost basis and an evidence state.

Cost basis:

- `observed` — reported by the provider or billing source.
- `calculated` — usage multiplied by a dated price source.
- `allocated` — shared or human cost assigned by a declared rule.
- `modeled` — a scenario assumption, never displayed as realized savings.

Evidence state:

- `verified_input` — present in a validated source file.
- `reconciled_calculation` — deterministically calculated from verified inputs.
- `declared_assumption` — supplied by the user.
- `experiment_result` — produced by a named, versioned test.
- `unknown` — unavailable and not inferred.

## The savings gate

AI Cost Lens may call an amount **realized savings** only when:

1. Both periods use compatible cost boundaries and currencies.
2. Provider or invoice totals reconcile within an explicit tolerance.
3. Work volume is normalized to the same accepted-result definition.
4. Quality and policy thresholds pass.
5. Human review and correction are included or explicitly excluded from both
   sides for a defensible reason.
6. One-time change cost is shown separately.
7. The proposed result is observed after the change, not only modeled.

Before that gate passes, the interface says `modeled opportunity`, `cost
difference`, or `test case`.

## What belongs in v1

### Required

- Public sample review with transparent synthetic data.
- Local browser file handling.
- OpenAI saved organization usage and cost response support.
- Universal cost-and-usage template.
- Small result log and five-field review setup.
- Period, currency, pagination, attribution, and reconciliation checks.
- Provider, shared infrastructure, and human-cost boundary.
- Accepted-result, retry, human-review, and cache measures where available.
- Four-way opportunity ledger.
- Workload table, scenario workbench, evidence view, and screenshot-ready Story
  View.
- Exportable JSON decision record and a concise finance memo.

### Next adapter, not a new product

- Anthropic Usage and Cost API responses.
- Langfuse, LiteLLM, Helicone, Braintrust, OpenTelemetry, and Vantage allocation
  exports.
- FOCUS 1.4 billing import, with explicit extensions for workflow outcomes.

### Later, only after real use

- Commitments and budget-envelope planning.
- Contract charge-trigger and outcome-pricing review.
- Agent-session context and tool-call analysis.
- More providers and automated mappings.

## What does not belong in v1

- Live provider credentials.
- Production traffic routing or budget enforcement.
- Prompt or completion storage.
- An AI chatbot that invents recommendations.
- A giant model-price table.
- A 20-question blind-review workflow.
- A static Sol-versus-Luna page presented as the product.
- A claim of FOCUS conformance before the relevant profile is validated.
- Customer ROI claims based on synthetic or public data.

## Design direction

The interface should look like Cloud & Capital, not generic AI software.

- Background: the established warm beige (`#f5eee9` unless the canonical brand
  token says otherwise).
- Typography: editorial serif for the finding and section titles; clean sans
  serif for evidence and tables.
- Color: charcoal, muted sage, and one clay accent.
- Structure: long-form financial review with thin rules, strong numbers, margin
  notes, and generous space.
- Charts: one useful cost bridge, one workload comparison, and restrained
  sparklines. No neon, glowing nodes, robot imagery, or interchangeable SaaS
  cards.
- Voice: “Here is what the evidence says, here is what it does not say, and here
  is the next decision.”

The headline visual is the opportunity ledger, because it makes Cloud &
Capital's judgment visible: **save now, test first, fix the evidence, or leave it
alone.**

## How the research becomes content

AI Finance Lab experiments feed the product without becoming product screens.

| Research asset | Public article | Product contribution |
|---|---|---|
| Sol versus Luna route pilot | “I tested the cheap-model assumption. The token bill was the easy part.” | Route-test evidence profile and human-cost reversal example |
| FOCUS finance skill experiment | “Can an AI review a cloud bill without inventing a story?” | Golden test cases for evidence labels and unsupported conclusions |
| Prompt caching test | “The cost of repeating yourself” follow-on | Cache opportunity rule and break-even example |
| Outcome-pricing research | “When an action is billed like an outcome” | Charge-trigger fields and contract review pattern |
| Provider export pilots | “What your provider cost export can and cannot tell finance” | Import validation, data-gap messages, and resource guides |

Each article can link to a sample inside AI Cost Lens. Each product update can
create a real, evidence-backed post. This is one product and one research
flywheel, not a pile of disconnected tools.

## Build sequence

### Stage 0 — Freeze and demote the drift

- Keep the existing Sol-versus-Luna decision record, validator, evidence, and
  page.
- Relabel that page as a sample case study or article asset.
- Do not use it as the product landing page.

### Stage 1 — Lock the product contract

- Define `ai-cost-lens-review/1.0` around bill, work, leak, and decision.
- Define the opportunity-ledger states and savings gate.
- Map the existing canonical, CCAC, review builder, and decision-record fields
  into that contract rather than creating a parallel schema.
- Add a sanitized full-size sample with multiple workloads and enough scale to
  demonstrate finance decisions, not a five-dollar toy bill.

Acceptance: every displayed number traces to a source, calculation, allocation,
or explicit scenario assumption.

### Stage 2 — Build the actual first screen

- Replace the static case-study-first experience with the Review screen.
- Implement the cost bridge, work efficiency strip, and opportunity ledger.
- Add a clear sample-versus-local-file switch.

Acceptance: a new reader can explain the decision and its main limitation in
under one minute.

### Stage 3 — Make it useful with local files

- Complete browser import for OpenAI evidence and the universal templates.
- Add the five-field review setup and result-log join.
- Fail visibly on partial pages, mismatched dates, mixed currencies, unsupported
  prices, or non-equivalent work.

Acceptance: a user can produce a valid bill review with provider evidence and a
valid workload review after adding the result log.

### Stage 4 — Add the decision workbench

- Implement Test a Change using modeled inputs, quality thresholds, one-time
  cost, and break-even.
- Use the Sol-versus-Luna experiment as one sample, not as the whole interface.

Acceptance: the product cannot label a modeled route change as realized savings.

### Stage 5 — Package the public release

- Add downloadable templates, export instructions, definitions, a sample
  dataset, methodology, and limitations.
- Add Story View and finance memo export.
- Publish one article explaining a real experiment and one launch post showing
  the tool solving the broader review problem.

Acceptance: the GitHub repository, public demo, resume bullet, and website case
study all describe the same product promise.

## Resume and website framing

> Built AI Cost Lens, a free local-first FinOps workbench that reconciles
> provider AI cost exports with workload outcomes and human review, calculates
> cost per accepted result, detects evidence gaps and recoverable leakage, and
> prevents modeled savings from being presented as realized financial results.

The supporting proof is stronger than a screenshot alone: versioned schemas,
deterministic validation, public synthetic fixtures, provider adapters,
reconciliation tests, evidence labels, and documented experiments.

## Sources

- OpenAI, [A scorecard for the AI age](https://openai.com/index/a-scorecard-for-the-ai-age/), July 17, 2026.
- FinOps Foundation, [Who sets the AI budget?](https://www.finops.org/insights/setting-ai-budget/), August 5, 2026.
- FinOps Foundation, [FinOps for AI overview](https://www.finops.org/wg/finops-for-ai-overview/).
- FinOps Foundation, [Effect of optimization on AI forecasting](https://www.finops.org/wg/effect-of-optimization-on-ai-forecasting/), March 17, 2026.
- OpenAI, [Organization usage and cost API](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/).
- Anthropic, [Usage and Cost API](https://platform.claude.com/docs/en/manage-claude/usage-cost-api).
- Langfuse, [Token and cost tracking](https://langfuse.com/docs/observability/features/token-and-cost-tracking).
- Braintrust, [Playgrounds and evaluations](https://www.braintrust.dev/docs/evaluate/playgrounds).
- Helicone, [User metrics and analytics](https://docs.helicone.ai/features/advanced-usage/user-metrics).
- LiteLLM, [Cost tracking](https://docs.litellm.ai/docs/proxy/cost_tracking).
- Portkey, [Model pricing and cost management](https://portkey.ai/docs/product/observability/cost-management).
- Vantage, [Custom LLM enrichment](https://docs.vantage.sh/custom_llm_enrichment).
- Finout, [AI cost management](https://www.finout.io/artificial-intelligence).
- FOCUS, [FinOps Open Cost and Usage Specification](https://focus.finops.org/).
- FOCUS GitHub, [AI model and token consumption feature request](https://github.com/FinOps-Open-Cost-and-Usage-Spec/FOCUS_Spec/issues/2018).
