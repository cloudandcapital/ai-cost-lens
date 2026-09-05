# AI Cost Lens product brief

## Product promise

AI Cost Lens helps a finance, FinOps, or operating team answer four questions without turning the review into an LLM infrastructure project:

1. What did the work cost?
2. Why did that cost move?
3. Was the result usable?
4. What can we change without hiding a tradeoff?

When an approved plan is supplied, it also answers two finance questions that
do not belong in a token dashboard: where did actual performance miss plan, and
does a proposed change pay back inside the decision horizon?

The tool is free, open source, and runs locally. It does not require provider credentials, upload prompts, or claim to enforce production budgets. It reviews exported evidence and keeps observed, calculated, and allocated costs visibly separate.

The browser can directly review supported OpenAI dashboard CSV exports, the documented Claude Team or Enterprise spend-report CSV, complete Claude Messages Usage and Cost Admin API JSON responses saved by the user, and identifiable text-based OpenAI or Anthropic invoice PDFs. An explicit local mapper can normalize one unknown flat CSV or JSON file when the user confirms its fields. Claude Team and Enterprise personal identifiers and all unmapped source fields are discarded before the decision record is created. The importers never ask for an API key, and invoices or provider exports do not supply business outcomes or prove savings.

## Positioning

AI Cost Lens is a financial review layer, not another LLM observability platform.

Observability tools are already good at tracing requests, tokens, latency, errors, and model calls. Enterprise FinOps platforms are already good at ingesting large billing estates and allocating spend. The gap is the handoff between technical telemetry and financial judgment: joining a bill to a workload, naming the cost basis, checking the outcome, exposing missing proof, and explaining the decision in plain language.

That is the Cloud & Capital lane.

## Primary user

A finance, FinOps, cloud economics, product operations, or engineering leader who needs to review AI spend but does not want to become an LLM infrastructure specialist.

## Product principles

### Ask a financial question first

Navigation and page titles use questions people actually ask: `What did we pay?`, `Why did it move?`, `Was it worth it?`, and `What should we test?`

### Never manufacture certainty

If the file proves cost but not outcome, the interface says so. A missing verifier is not treated as a successful result. An unattributed charge is not called savings. An estimate is not displayed as a billed amount.

### Preserve three cost bases

- **Observed:** provider reported or invoiced cost.
- **Calculated:** usage multiplied by a dated price book.
- **Allocated:** a business assignment such as shared infrastructure or human review.

They may appear together in a review, but they must remain individually visible and traceable.

### Compare equivalent work

Total spend alone is not a fair comparison when volume or usable output changed. The product should normalize cost to a declared unit such as a usable result, resolved conversation, reviewed document, or completed task. If no valid denominator exists, the comparison remains incomplete.

### Keep the product calm

The visual language is editorial rather than cybernetic: warm Cloud & Capital beige, charcoal type, muted sage, one clay accent, generous space, and restrained charts. Avoid neon gradients, dense card grids, and decorative AI imagery.

### Make every screen clear

The product has two modes:

- **Operator view:** complete decision record with inputs, calculations, assumptions, and evidence.
- **Story view:** one finding, one visual, one limitation, and its sources.

## Progressive review depth

AI Cost Lens starts with the evidence a team already has:

- **Crawl: Understand the bill.** Provider cost is enough to establish a baseline. Missing usage, retries, outcomes, and human effort remain unavailable.
- **Walk: Explain the usage.** Requests, tokens, models, routes, or cache data show where to investigate. They do not prove savings.
- **Run: Connect cost to outcomes.** A reviewed sample or work log can add cost per ready result. Human effort is included only when people actively review or correct the work.

These labels describe the depth of one review, not a formal maturity rating. A team does not need to supply every field before the tool is useful.

## Route comparison

The comparison path reviews one workload across a baseline and a proposed setup.

### Comparison fields

#### Identity

- Workload and task
- Provider, model, and route
- Team, project, and environment
- Period and timezone

#### Cost

- Provider reported cost
- Calculated usage cost
- Shared infrastructure allocation
- Human review cost
- One time migration or test cost
- Currency and cost basis

#### Usage and behavior

- Requests or runs
- Unique input tokens
- Processed input tokens
- Cached input tokens
- Cache-write input tokens when the provider exposes them
- Output and reasoning tokens
- Retries, fallbacks, and escalations

#### Outcome

- Completed results
- Usable results
- Verification rule and verifier
- Human review minutes
- Quality or acceptance threshold

#### Contract and policy

- List and effective price
- Commitment term and committed spend
- Hard cap and alert status
- Billing unit and charge trigger
- Retry owner and dispute rule
- Data retention mode and policy approval

#### Evidence

- Source, observed date, and pricing effective date
- Coverage, coverage status, and freshness
- Reconciliation issues that prevent a savings claim
- Company claim, independent test, or production observation
- Known gaps and overlap treatment

### Calculated measures

- Recurring operating cost
- All in pilot cost
- Cost per usable result
- Usable result rate
- Retry rate
- Cache reuse rate
- Human review minutes per usable result
- Normalized cost at equivalent usable volume
- Plan versus actual variance for cost, output, yield, and cost per usable result
- Monthly operating difference at expected ready result volume
- Time-based payback and net difference inside the declared decision horizon

The interface only labels a difference `savings` when the comparison uses equivalent work, an accepted outcome definition, and compatible cost boundaries. Otherwise it uses neutral language such as `cost difference` or `lower modeled cost`.

## Screen system

### 1. Workload Review

The hero screen answers whether a change improved the economics of a workload. It shows baseline and proposed cost per usable result, cost anatomy, quality and policy status, and a plain language finding.

### 2. Cost Anatomy

Breaks cost into model usage, shared infrastructure, human review, retries, and one time change cost. Token categories remain available, but they do not dominate the financial view.

### 3. Plan & Payback

Keeps the approved plan, current actual, and proposed change in three distinct
columns. It identifies the largest cost variances, shows whether output and
yield beat plan, and converts the proposed unit-cost difference into monthly
operating impact, payback months, and net impact inside a declared horizon. A
modeled payback never overrides the evidence, quality, or policy gates.

### 4. Agent Session

Shows unique versus processed context, cache reuse, retries, handoffs, tool calls, stop reason, verifier result, and total session cost. This is the place for the AgentX and prompt caching ideas.

### 5. Contract & Policy

Shows effective price, commitment exposure, cap status, billing unit, charge trigger, verifier, retry ownership, disputes, and retention eligibility. This is the place for commitment discounts and outcome pricing analysis.

### 6. Evidence Check

Shows the declared cost boundary, what came from the provider, what came from the outcome log, what was calculated, and what still does not reconcile. Benchmark results carry the workload, model, hardware, software version, cache state, fabric, concurrency, latency target, and evidence label.

### 7. Story View

Creates a restrained, screenshot ready summary: the finding, the most useful chart, the exact limitation, and the source line.

### 8. Model Route Decision

Compares provider cost, objective correctness, reviewer trust, internal
consistency, and unresolved human cost before approving a model route. It is a
reusable AI Cost Lens decision module, not the AI Finance Lab answer key or
experiment runner. Controlled pilot evidence may populate the demo, but the
screen keeps synthetic results visibly labeled and accepts a portable local
decision record.

## What this product will not do yet

- Connect to live provider or cloud accounts.
- Store prompts or model responses.
- Enforce budgets or route production traffic.
- Claim independently verified performance from vendor material.
- Treat public or synthetic examples as customer results.
- Optimize a workload from a single price card.

## Success criteria

The first public interface is successful when:

- A FinOps practitioner understands the decision in under one minute.
- A finance reviewer can inspect the cost basis and denominator.
- An engineer can trace the finding back to usage and evidence.
- A screenshot can support a Cloud & Capital post without needing a fake dashboard.
- The demo is clearly illustrative and the calculations are independently tested.
