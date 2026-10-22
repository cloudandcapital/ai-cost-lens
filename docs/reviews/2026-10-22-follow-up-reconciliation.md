# AI Cost Lens: follow-up review reconciliation

The independent follow-up review confirmed the comparison arithmetic and simpler welcome screen, and identified remaining problems in usage entry, exports, approval visibility and forms.

## Changes

- Usage opens an isolated request-log view. Illustrative opportunities, their dollar amounts, unrelated navigation and decision-record downloads stay hidden. A real bill or comparison has a return action; standalone usage does not manufacture a linked bill.
- Fresh comparison inputs are blank. Examples remain an explicit choice, so submitting untouched example values cannot produce a purported user-entered result.
- The comparison shows monthly time value beside tool charges and total cost. Confirmed approval remains visible, and the result heading receives focus after submission.
- Simple records include the same cost finding and before-switching statement as the screen. Their decision code is `COMPARE ESTIMATES`, their finance posture is `ESTIMATE ONLY`, and the memo uses tool costs, estimated time value and usable results.
- The v1 normalized calculation fields remain for format compatibility. An accompanying context explains the hypothetical baseline-output volume and distinguishes that diagnostic from the monthly cost change and cash savings. They are not printed as an opportunity or recommendation.
- Inline errors focus and describe the relevant comparison field, cost-basis selector or boundary checkbox. Editing clears stale feedback; a neighboring field does not stretch to match an error.
- A combined-tools baseline can be edited after creation or reopening. Charges, sources, owners and period are restored. Changes affecting the charge boundary require confirming it again.
- Imports show cost and usage periods separately when they differ; the memo follows the same convention. Single-bill stage labels omit WALK. Model-cost totals use consistent cent formatting while preserving sub-cent precision.
- Upload failures have one live announcement. Mobile welcome actions and Menu have 44px minimum heights, and the no-spreadsheet note stacks vertically.

## Verification

The existing web acceptance and builder-state checks cover arithmetic, evidence gates, edited charges, reopening records, blank inputs, approval declarations, validation rollback and source provenance. Browser regressions additionally check standalone usage isolation, keyboard focus, error-field geometry, the tools editor and a rendered simple-comparison PDF. The existing release gate also runs Python tests, dependency audits, three browser engines, mobile accessibility, package installation and production privacy checks.

Manual browser QA confirmed blank comparison fields, Plan A/B arithmetic ($230/$340 total and $2.56/$4.25 per usable result), 41px input heights with a neighboring error, immediate removal of stale feedback, visible approval and the time-value row. The actual downloaded JSON was read from disk and matched the screen. Cloud automation stalled during the native chooser reopen attempt; that attempt is not counted as a manual pass. The release browser suite exercises the chooser and round trip separately.

## Scope

No financial engines, provider rates, savings gates, homepage design, hosting access or dependencies changed. This review does not establish complete compatibility with every real-world invoice or export. Broader source-file coverage and refreshed homepage screenshots remain part of the tools audit.
