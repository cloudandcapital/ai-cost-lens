# AI Cost Lens: the finance decision layer for AI spend

Date: 2026-09-02

## The product in one sentence

AI Cost Lens joins the bill to sampled or observed outcome evidence and shows
what one ready-to-use result really cost, which lower-cost ideas are financially
supported, and which ones still need a test or better evidence.

## Why this is worth building

The market already has strong technical and billing products:

| Existing category | What it already does well | The remaining finance question |
|---|---|---|
| Provider dashboards | Billed spend, requests, tokens, cache measures, projects | What did the spend produce, and was the result usable? |
| LLM observability | Traces, latency, errors, models, estimated request cost | Does the telemetry reconcile to the bill and to a business result? |
| Gateways and routers | Spend by key, team, customer, job, route, and model | Did the cheaper route reduce full cost after quality and human correction? |
| FinOps platforms | Allocation, budgets, forecasts, commitments, chargeback | Which AI cost differences are observed, allocated, calculated, or only modeled? |
| Evaluation tools | Quality scores, tests, graders, and experiments | What was the cost per result that actually cleared the quality bar? |

Cost by job is necessary plumbing, but it is not the unique product. LiteLLM
already accepts job and task tags. Vantage can allocate provider cost across
telemetry tags. Langfuse distinguishes ingested cost from inferred cost. AI Cost
Lens must begin where those tools stop: financial judgment.

## The Cloud & Capital wedge

The signature screen is **The cost of one ready result**.

It combines four things that are usually separated:

1. Provider-reported model cost.
2. Shared recurring cost.
3. Human review and correction cost.
4. A three-state outcome yield: ready to use, needs correction, needs escalation.

It then classifies the decision:

- **SAVE NOW** when observed, reconciled evidence supports the reduction.
- **TEST FIRST** when a route, cache, batch, model, or prompt change may help but
  quality, policy, or human effort could reverse it.
- **FIX THE EVIDENCE** when the denominator, attribution, currency, verifier,
  policy, or cost basis is missing.
- **LEAVE IT ALONE** when the higher visible cost currently buys a better full
  result or satisfies a requirement the cheaper option does not.

This classification is the product. The dashboard is only how it is shown.

## Research basis

- OpenAI's AI scorecard defines full cost as model cost plus employee time,
  human review, retries, and rework, divided by tasks meeting the quality bar.
  It recommends tracking ready to use, needs correction, and needs escalation.
  <https://openai.com/index/a-scorecard-for-the-ai-age/>
- The FinOps Foundation's token-economics guidance asks for cost per workflow or
  outcome and introduces token yield: how much consumption contributed to a
  usable result after retries, abandonment, and failed quality.
  <https://www.finops.org/insights/token-economics-the-atomic-unit-of-ai-value/>
- FinOps for AI guidance says teams need cost by use case, model, team, owner,
  and an exit criterion when cost per unit outcome exceeds its threshold.
  <https://www.finops.org/wg/finops-for-ai-tools-services-considerations/>
- Current model-selection guidance treats the model as an ROI decision and asks
  whether a lighter model delivers the same result, not merely whether it has a
  lower rate.
  <https://www.finops.org/insights/informing-ai-model-selection/>

## Minimum input

The public workflow must remain lighter than the twenty-response experiment.
The user supplies one spend and usage CSV, then chooses one of two outcome paths:

1. **Quick sample:** period result count, sample counts for the three outcome
   states, and total human minutes for each route. The extrapolation is labeled
   sampled and cannot support `SAVE NOW` by itself.
2. **Detailed log:** one row per completed result. The minimum path is four
   columns. Dates, workload, requests, retries, and split review/correction time
   remain optional evidence.

Both paths use five declarations at most: ready-to-use rule, verifier, quality
floor, human rate, and optional shared/change costs.

The outcome log uses three understandable states:

```csv
period,result_id,outcome_status,human_minutes
baseline,result-001,ready_to_use,0.5
baseline,result-002,needs_correction,5.0
proposed,result-003,needs_escalation,3.0
```

Older `accepted=true/false` logs remain readable, but the public template uses
the clearer three-state record.

## Screen acceptance criteria

The first review view must let a finance or FinOps reader answer, without a
technical walkthrough:

- What did the provider bill say?
- What did full recurring cost become after shared and human work?
- How many attempted results were ready, corrected, or escalated?
- What did one ready result cost?
- Is the difference observed savings, a modeled opportunity, or unsupported?
- What should we save, test, fix, or leave alone?

Every number must retain an evidence state. No model-level billed cost may be
invented from token share. No provider bill may be called ROI. No proposed
change may be called savings until the bill, work, quality, policy, and cost
basis reconcile.

## What this product does not become

- A live SaaS gateway.
- A generic multi-provider price calculator.
- A trace viewer.
- A model leaderboard.
- A twenty-question human-evaluation product.
- A marketing page describing an experiment.

The FOCUS skill and the Sol-versus-Luna pilot stay preserved as adapters,
fixtures, and future articles. They feed the product; they are not the product.
