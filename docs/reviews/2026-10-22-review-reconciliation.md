# AI Cost Lens: independent review follow-up

Baseline: `9075b6f9cb3ca1b9119bdb069caceec8b9e3ded1`. October 22, 2026.

The independent visitor review confirmed the worked comparison and found that advanced workflows obscured it. The approved Cloud & Capital homepage is outside this release.

## Changes and evidence

| Finding | Resolution | Verification |
| --- | --- | --- |
| A simple comparison exposes a second dollar amount as an opportunity | Simple mode offers only its Overview. Unrelated opportunity, verification and evidence views are not generated for it. A separate usage review remains available through the starting choices. | Builder regression checks both navigation controls and available views; browser release checks assert these views are absent. |
| JSON exposes a statistical interval that the screen withholds | User-selected samples have a null interval. Declared random/systematic samples retain a Wilson interval recomputed from their sample counts. Older records are normalized when reopened. | Builder and browser download assertions; actual downloaded JSON independently inspected. |
| The visible finding is missing from the saved comparison | The validated simple record contains the same cost finding. Approval and savings gates remain separate and unchanged. | Independently known $230/$340 totals, $2.56/$4.25 unit costs; saved finding inspected. |
| Manual bills imply provider verification | Manual and confirmed PDF entries use `mode: user_entered` and `cost_basis: user_entered`. Older manual bill records are downgraded when reopened. Typed comparison costs are labeled user-entered; attached prompt-price estimates remain calculated. | Builder regressions cover new records and older manual records. |
| A tools review certifies checked bills by default | The basis begins blank and is required explicitly. A missing boundary confirmation has its own message. | Builder and browser assertions. |
| Several competing verdicts and repeated workbench panels | The simple hero separates the cost finding from the prerequisite for switching. The table, sample quality and expandable calculation notes remain; redundant panels, unrelated sliders and repeated decisions are omitted. The memo retains its approval check and includes the cost finding above its numbers. | Desktop and 375px simulated-phone UI inspection; financial decision regressions. |
| Choosing a path and editing require excessive scrolling | A clear opening offers a direct comparison action. Three everyday starting choices remain up front, with technical paths under other options. Selecting a path hides the chooser and focuses the first field. Editing restores and focuses the actual inputs. | Actual browser comparison, editing, invalid-field correction and file reopen; mobile first field focused. |
| Errors are remote from the field and approval clearing is silent | Invalid comparison fields receive an adjacent option-specific error, `aria-invalid`, focus and scroll. Renaming an approved tool explains why approval was cleared. The previous valid result survives an invalid edit. | Builder regressions and simulated-phone browser checks. |
| The comparison clips at intermediate widths | The simple table uses four columns. Explanations move into an expandable note, and the advanced cockpit stacks at 901–1280px. | Browser release checks table/page overflow at 1024 and 1280px, plus phone layout. |
| Import messaging overstates file alignment | Finding both OpenAI files no longer says their periods match. A single known export names its missing partner. A mismatched result labels the separate cost and usage periods. Claude spend confirmation explicitly identifies net cost. | Parser and result regressions; existing mismatch and provider-import coverage retained. |

Bill-only results also omit an empty usage table, display the invoice date, and suggest a concrete next-period comparison. The guide now explains the tools basis, boundary confirmation, approval reset and both save controls. Privacy wording refers to source files not being uploaded, without implying that every preference in every advanced page is never stored.

## Validation and limits

- Local full suite: 286 passed, five official-validator integration checks skipped in the default local environment. Release CI supplies that validator and is the release gate.
- Builder transitions, financial decisions, static build and malformed-record/CSV acceptance checks passed locally.
- Browser inspection used invented inputs, the actual download and file chooser, and responsive Chromium simulation. It does not certify physical phones, assistive technology, all invoice PDFs or every current provider export.
- Three-engine browser tests cover the changed comparison, save/reopen, errors, guide, existing provider imports, actuals and accessibility. The associated PR run records the final result.

The tool's focus is a one-off financial comparison or documented bill baseline. Competitor documentation supports workflow differences, not a claim that competing platforms cannot connect cost and quality. No new account connections, analytics, dependencies, hosted storage or security-policy changes were introduced.
