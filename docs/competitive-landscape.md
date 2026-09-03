# Competitive landscape and product gap

Research date: 2026-08-31

This document is a product design input, not a vendor ranking. It records where current tools are already strong so AI Cost Lens does not copy mature products, and where a finance review layer can add something useful.

## Current product categories

| Category | Representative products | What they already do well | Remaining handoff problem |
|---|---|---|---|
| LLM observability | Langfuse, Helicone, Braintrust, MLflow, OpenLIT | Traces, token usage, latency, errors, model cost, custom pricing, evaluations, dashboards | Technical activity still needs to be reconciled with billed dollars, shared cost, human review, and an accepted outcome |
| AI gateways and controls | Portkey, LiteLLM, Braintrust Gateway | Routing, rate limits, budgets, usage attribution, provider abstraction | A budget or successful request does not prove the work created a usable result; unsupported pricing can also make a control incomplete |
| Enterprise FinOps | Finout, CloudZero, Vantage | Multi source ingestion, allocation, unit economics, anomalies, cloud and direct AI coverage | These products generally require accounts, enterprise setup, or proprietary platforms and are not a small local review artifact |
| Billing standards | FOCUS and CCAC | Common billing shape, cost bases, allocation, commitments, invoice reconciliation | A normalized bill still needs workload behavior, verification, quality, and decision context |
| Provider reporting | OpenAI, Anthropic, AWS, Google Cloud | Official usage and cost APIs, exports, cloud billing, request or project metadata | Provider boundaries differ. Request metadata and billed dollars may live in separate systems, and provider reporting does not establish business value |

## What the current tools tell us

### Observability is not the missing product

Langfuse tracks usage and cost for individual calls, including specialized usage types such as cached tokens, and supports ingested or inferred costs. Helicone estimates direct integration costs and describes gateway based accounting as its exact path. Braintrust, MLflow, and OpenLIT combine traces with token, cost, latency, and evaluation data. Building another call level dashboard would put AI Cost Lens in a crowded technical category.

### Controls depend on instrumentation and pricing coverage

Portkey and LiteLLM can enforce budgets or limits when traffic runs through their gateways. That is valuable production control, but it is a different job from financial review. Portkey also documents that unsupported model pricing can appear as zero and that budget limits do not apply in that case. AI Cost Lens should fail closed when a cost is unknown, as the current engine already does.

### Billed dollars and workload meaning are often separated

AWS documents that per request metadata is written to invocation logs rather than Cost Explorer or the Cost and Usage Report; practitioners must join the request ID back to billing data or calculate cost from token counts and rates. Vantage similarly describes enriching shared provider costs with custom LLM metadata for allocation. This join is not an edge case. It is the core review problem.

### The standard is moving toward AI, but not finished

FOCUS 1.4 is the current billing specification. FOCUS 1.5 is scoped to add native AI model identity and token consumption, along with a separate price sheet dataset. FOCUS already provides useful columns for AI service classification, consumed quantities, credits, and commitments. AI Cost Lens should align with that direction while retaining outcome and evidence fields that sit beyond billing normalization.

### FinOps guidance puts value beyond token counts

The FinOps Foundation's AI work spans cloud, model vendors, SaaS, on premises infrastructure, and enterprise agreements. Its guidance emphasizes allocation, forecasting, optimization, and business value. That validates a wider cost boundary than direct API token spend.

## Audience pain observed in current discussion

Community discussion is discovery evidence, not proof, but the same questions recur:

- Why did the bill double when request volume did not?
- How much of a session was repeated context rather than new work?
- Which retries, handoffs, or tools created the cost?
- Does a cheaper model stay cheaper after correction and human review?
- What should be capped: a request, a workflow, an intent, or a completed job?
- Who decides whether an action or resolution was successful?

These are review questions. They do not require AI Cost Lens to become the production gateway.

## Differentiated wedge

AI Cost Lens should become the local first financial review layer between observability and FinOps reporting.

It accepts local evidence files rather than credentials, preserves cost provenance, reconciles billing boundaries, joins usage to an explicit outcome definition, and explains the decision in plain English. Its primary output is not a monitoring dashboard. It is a defensible decision record and a publishable story view. Raw-provider support must be named endpoint by endpoint; the first strict adapter inventories saved OpenAI organization completions usage and cost responses without inventing a model-level cost join.

## Build implications

1. Keep the existing canonical and CCAC engine as the source of cost truth.
2. Add an outcome and review declaration rather than placing business claims in raw usage rows.
3. Make missing proof visible instead of inferring success.
4. Treat provider reported, calculated, and allocated cost as distinct layers.
5. Normalize comparisons by usable output before discussing savings.
6. Build a browser interface that can run locally and load exported JSON.
7. Preserve a clear boundary between analysis and enforcement.

## Primary sources reviewed

- [Langfuse token and cost tracking](https://langfuse.com/docs/observability/features/token-and-cost-tracking)
- [Helicone cost tracking](https://docs.helicone.ai/guides/cookbooks/cost-tracking)
- [Braintrust instrumentation](https://www.braintrust.dev/docs/instrument)
- [Braintrust dashboards](https://www.braintrust.dev/docs/observe/dashboards)
- [MLflow token and cost tracking](https://mlflow.org/docs/latest/genai/tracing/token-usage-cost/)
- [OpenLIT overview](https://docs.openlit.io/latest/overview)
- [Portkey cost management](https://docs.portkey.ai/docs/product/observability/cost-management)
- [Portkey budget limits](https://docs.portkey.ai/docs/product/ai-gateway/virtual-keys/budget-limits)
- [LiteLLM cost tracking](https://docs.litellm.ai/docs/proxy/cost_tracking)
- [FinOps for AI overview](https://www.finops.org/wg/finops-for-ai-overview/)
- [FOCUS for AI](https://focus.finops.org/technology-categories/focus-for-ai/)
- [FOCUS 1.5 release scope](https://focus.finops.org/focus-1-5-release-scope/)
- [OpenAI organization costs API](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs/)
- [Anthropic usage and cost API](https://docs.anthropic.com/en/api/administration-api)
- [AWS Bedrock cost attribution](https://docs.aws.amazon.com/bedrock/latest/userguide/cost-management.html)
- [AWS per request metadata](https://docs.aws.amazon.com/bedrock/latest/userguide/cost-mgmt-request-metadata.html)
- [Vantage custom LLM enrichment](https://docs.vantage.sh/custom_llm_enrichment)
