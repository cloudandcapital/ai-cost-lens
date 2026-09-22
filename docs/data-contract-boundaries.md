# AI Cost Lens data-contract boundaries

AI Cost Lens has two deliberate usage contracts because they answer different questions at different levels of detail. They are not alternate column names for one interchangeable file.

| Contract | Grain | Primary job | Entry point |
| --- | --- | --- | --- |
| `ai-cost-lens/2.0` and `ai-cost-lens/2.1` | One daily or period usage bucket, which may represent many requests | Reconcile provider-reported or independently calculated usage cost and produce CCAC output | Python CLI |
| `ai-cost-lens-usage-event/1.0` | One request or trace observation | Diagnose request behavior, allocation coverage, retries, latency, caching, tools, and outcome joins | Browser **Review AI usage** |

The CLI contract is strict and aggregate. It requires explicit mutually exclusive token categories, a request count, a batch price multiplier, ownership fields, and one cost basis. The browser event contract is granular. It preserves one row per call, keeps missing values unknown, and can carry operational fields that do not exist in the aggregate ledger.

## Relationship between fields

This table is a translation guide, not an instruction to rename headers mechanically.

| CLI usage field | Browser event field | Safe interpretation |
| --- | --- | --- |
| `usage_id` | `event_id` | Not generally equivalent. A CLI row can summarize many requests; an event ID identifies one request or observation. |
| `date` | `timestamp` | The CLI records a calendar day. The browser accepts a date or timestamp, but request-order, latency, and retry analysis need the real event time. |
| `provider` | `provider` | Direct when the same model provider is meant. |
| `model` | `model` | Direct when the source model identifier is preserved. |
| `currency` | `currency` | Direct. Both paths refuse unsafe mixed-currency totals. |
| `uncached_input_tokens` | `input_tokens`, `cached_input_tokens`, `cache_write_tokens` | Browser `input_tokens` is the total input count. With no cache writes, CLI uncached input can be `input_tokens - cached_input_tokens`. Cache-write pricing has no lossless CLI 2.x equivalent and must not be silently folded into another category. |
| `cached_input_tokens` | `cached_input_tokens` | Direct only for cache-read tokens. Keep cache-write tokens separate in the browser path. |
| `output_tokens` and `reasoning_tokens` | `output_tokens` and `reasoning_tokens` | The CLI categories are mutually exclusive. In the browser event, reasoning is a subset of total output. A safe event-to-CLI conversion requires both values: CLI output is browser output minus reasoning. |
| `requests` | one event row | Aggregate event rows to produce a request count. A bucket with `requests > 1` cannot be expanded into real event records without the original log. |
| `batch_multiplier` | `processing_mode` and `batch` | Not interchangeable. The CLI stores an explicit price multiplier; the browser stores the named provider mode. Translate only from a documented rate contract. |
| `billed_cost` with `cost_basis=provider_reported` | `provider_reported_cost` | Direct only when the amount was present in the source. Never relabel calculated or allocated cost as provider reported. |
| calculated CLI cost | `calculated_cost` | Preserve the pricing source, effective date, and assumptions. Do not turn a calculated value into billing evidence. |
| `billing_channel` | `billing_channel` | Direct when supplied. |
| `billing_provider` | no equivalent | The request event currently has no separate charge-issuer field. Do not substitute model provider. |
| `project` | `project` | Direct when definitions match. |
| `team` | `team_owner` | Direct when definitions match. |
| `environment` | `environment` | Direct when definitions match. |
| `task` | `workload` | Use only when the source task and browser workload mean the same business unit of work. |

Browser-only fields such as feature, customer, product, workflow, session, request status, retry parent, latency, prefix fingerprint, tool calls, cache storage, and outcome status have no lossless CLI 2.x destination. The CLI-only analysis and billing-provider declarations likewise cannot be reconstructed from a request log.

## Practical rule

- Use the CLI canonical CSV when you have aggregated usage or billing buckets and need a strict finance/CCAC artifact.
- Use **Review AI usage** when you have one row per request, generation, or trace observation and want operational findings plus allocation and evidence checks.
- Keep both when available. Request telemetry explains behavior; the aggregate ledger and bill confirm the financial boundary.
- Do not manufacture request rows from an aggregate count, timestamps from a date, billing evidence from calculated cost, or ownership values from model names.

The browser template is at `web/templates/ai-cost-lens-request-log-template.csv`. CLI examples are at `examples/canonical-usage-v2.csv` and `examples/canonical-usage-v2.1.csv`.
