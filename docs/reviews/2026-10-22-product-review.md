# AI Cost Lens: product review, October 22, 2026

Status: first product pass; independent visitor review is the next step. This is not a claim that every import format, real provider export, or physical device has been certified.

Reviewed baseline: `8ab845dc688bd1cae976f5ff94ebb992f6d7d27a`. The earlier October 20 Claude audit supplied the initial questions. Findings below distinguish fresh browser observations, code checks, automated tests, and product judgment. The approved Cloud & Capital homepage is outside this change.

## The job worth doing

Help a person or a small/growing team understand the AI costs they can document, then compare the cost of usable work when outcome evidence is available. An invoice baseline, an API estimate, request telemetry, and a supported financial conclusion are different results. The interface should explain which one it has produced.

Suggested short description: **Understand an AI bill or compare what two options cost per usable result, including the time you spend checking the work.**

This is a product judgment, not demonstrated demand. The case for Lens is an accessible, browser-local review with explicit financial boundaries and an exportable result. A bill-only manual entry is a foundation, not a discovery of what caused the charge. The comparison and combined-tool reviews provide more context when the visitor can supply it.

## Research against alternatives

Primary product documentation was checked October 22, 2026. No competitor account, paid plan, or performance benchmark was tested. Prices and model rates were not used to rank products.

| Alternative | What its own documentation supports | Implication for Lens |
| --- | --- | --- |
| [Langfuse cost tracking](https://langfuse.com/docs/observability/features/token-and-cost-tracking) and [scores](https://langfuse.com/docs/evaluation/scores/data-model) | Ingested or inferred LLM cost, dashboards and alerts; manual, API, or automated quality scores attached to observations and other objects. | Cost plus quality is not a unique Lens feature. Lens should explain the effort and result of its one-off local review. |
| [Helicone cost tracking](https://docs.helicone.ai/guides/cookbooks/cost-tracking), [custom properties](https://docs.helicone.ai/features/advanced-usage/custom-properties), and [evaluation scores](https://docs.helicone.ai/features/advanced-usage/scores) | Cost analytics, unit economics by request metadata, and reported evaluation scores. | Do not claim competitors only count tokens or cannot connect cost to outcomes. An imported review serves a different workflow from continuous application observability. |
| [Token Cost Calculator](https://tokencalculator.net/pricing/) | Input, cached, and output token assumptions used to calculate request and monthly API estimates. | A list-price calculator is useful but not sufficient differentiation. Lens can explain the broader supplied cost boundary and sampled usable outputs. Its estimate remains separate from a bill. |

## Confirmed problems and this change

### C6: the approval check displaced the cost explanation

Observed in the live baseline: an unapproved comparison correctly calculated $230 and $340 in monthly cost, and $2.56 and $4.25 per usable result. The headline in the table, the finance read, and Lumen's opening instead repeated the approval prerequisite. A visitor had to reconstruct the cost finding themselves.

The simple comparison now states which option has the lower estimated unit cost and shows both amounts in Lumen's explanation. The decision remains **Confirm policy approval first** when approval is missing. The financial recommendation, quality checks, evidence gates, and restriction on savings claims are preserved. A cost finding is not permission to switch.

### C7: no way to edit the entered comparison

Observed in the live baseline: Start a review followed by Compare two options returned the example defaults. There was no explicit editing action.

New comparisons now have **Edit this comparison**. Exact input strings and the explicit approval choice travel in the downloaded JSON and are validated against the calculated record. Reopening that file restores the inputs for editing. An invalid edit keeps the previous valid result. Changing a tool name clears approval so the new tool needs a fresh declaration. Start a review still deliberately starts fresh. Older records without editable inputs remain readable; original values are not guessed from rounded outputs.

An unchanged prompt-price estimate keeps its provenance when reopened for editing. Changing a tool, charge, or monthly task volume clears that earlier estimate attachment and labels the comparison as user-entered costs instead. A regression checks that edited figures do not inherit a stale rate estimate.

### Instructions and mobile spacing

`/guide.html` explains the available starting paths, a reproducible comparison, how to interpret cost versus decision checks, and saving/reopening. Its figures are invented and labeled. The tool links to it from the setup help and footer. The single-column result heading now uses a 16px gap rather than inheriting the desktop's 60px gap.

The guide loads a same-origin stylesheet under the existing Content Security Policy. No inline-style permission or other policy relaxation was added. Release browser checks cover the editor's save/reopen flow and the guide's stylesheet delivery, mobile overflow, return link, and accessibility.

## Reproducible comparison

Both options handle 100 tasks per month. Each sample contains 20 outputs. The same acceptance rule applies to both. Time is valued at $30/hour. Minimum usable rate is 75%. Approval is left unconfirmed.

| Input/result | Plan A | Plan B |
| --- | ---: | ---: |
| Monthly tool charge | $80 | $40 |
| Usable sample outputs | 18 | 16 |
| Sample review/fixing time | 60 minutes | 120 minutes |
| Projected usable results | 90 | 80 |
| Projected time value | $150 | $300 |
| Tool cost plus time value | $230 | $340 |
| Estimated cost per usable result | $2.56 | $4.25 |

Independent arithmetic: projected time cost = sample minutes / sample count × monthly tasks / 60 × hourly value. Unit cost = (tool charge + projected time cost) / projected usable results. This projects a sample, values time rather than necessarily recovering cash, and excludes repaired outputs from the first-pass denominator.

## Evidence from this pass

| Check | Evidence and outcome |
| --- | --- |
| Own-number comparison | Observed in live baseline and revised browser preview; the table matches independent arithmetic. Revised cost finding remains visible without approval. |
| Invalid input | Observed in revised preview: 21 usable outputs from 20 checked is rejected with a specific message. |
| Editing | Observed in revised preview: names, costs, sample counts, time, quality floor, and approval choice are restored. |
| Save/reopen | A JSON file was downloaded using the actual page control, independently checked, reopened through the file picker, and edited. Its $230/$340 totals and approval state were retained. |
| Bill-only | Observed live: entered $240 and a September service period; result reports an unverified entered baseline, with usage unavailable and no savings claim. |
| Combined AI charges | Observed live: $50 and $30 subscriptions plus $10 separately billed usage total $90. Missing owners are follow-up prompts, not claimed waste. |
| OpenAI paired CSV | Observed live with synthetic fixtures through the file picker: format recognized; $12.75 / 30 requests = $0.4250. Model dollars remain unavailable rather than allocated by token share. Independently summed the fixture amount and request columns. |
| Claude spend CSV | Observed live through the file picker and explicit normalization confirmation: $4.00, 17 requests, 2,300 input tokens and 600 output tokens. Independent sums matched. Unknown cache/retry/outcome fields remain unavailable. This does not certify unrelated native Console CSV layouts. |
| Regression checks | Production static build; builder-state and web-acceptance scripts; 38 Python web/decision tests passed. Builder regressions cover edit/save/reopen, invalid rollback, fresh approval after a name change, tampered input snapshots, and older records. |
| Responsive layout | Revised comparison completed and editing reopened in a 375px iframe (360px content width); no horizontal document overflow. Final example layouts at 320, 414, 768 and 1024px, and the guide at 375px, also had no document overflow. Desktop result and guide were inspected visually. This is Chromium layout simulation, not a physical-device/Safari certification. |

## Remaining questions for the independent review

- Does a first-time visitor understand how to choose a path without reading the entire guide? The initial example still exposes a substantial workbench.
- Does the bill-only result earn its screen space when the visitor supplies only one total? A baseline is useful, but it must not imply unexplained analytical discovery.
- Are “ready,” “usable,” “route,” and “attempt” consistent enough in the simple experience? Some advanced/shared labels remain.
- Non-random samples still contain a computed `ready_rate_interval_95` in the underlying record while the UI withholds statistical interpretation. Export metadata deserves a separate contract review; this pass does not certify that ambiguity as resolved.
- The source has broad automated import coverage, but this pass has not manually exercised every PDF layout, scanned invoice, nested provider export, or large production file. Supported synthetic formats are not a claim of universal import compatibility.
- New screenshots and directory copy should follow the visitor review. The approved homepage preview continues to show the real Growing AI startup example; no fictitious interface has been substituted.

No new account connections, analytics, hosted storage, model API calls, or paid dependencies were added.
