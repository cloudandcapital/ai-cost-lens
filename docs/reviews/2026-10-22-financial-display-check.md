# AI Cost Lens: financial display check

Reviewed production baseline: `4f33caba428b606d630386cdb4d1fc07a37e6a15`.

## Confirmed finding

A live comparison with monthly charges of $0.24 and $0.16, 20 monthly tasks, 18/20 and 16/20 usable sample outputs, and zero review time calculated the correct unit costs but displayed both monthly charges and monthly totals as `$0`. Whole-dollar presentation also discarded cents from ordinary charges and fractional time values. This was a display error; the financial calculations were unchanged.

Comparison totals now keep two decimals when needed, retain whole-dollar presentation for integer amounts, and show six decimals for nonzero sub-cent estimates. The comparison table and finance memo share that presentation. Existing monetary values in saved JSON, financial gates, and provider-rate inputs are unchanged.

## Independent checks

The builder regression runs actual input handlers and checks known arithmetic, visible table and memo values, and reopening the JSON:

| Scenario | Current monthly total | Other monthly total |
| --- | ---: | ---: |
| Charges of $0.24 and $0.16, no time value | $0.24 | $0.16 |
| Charges of $80.25 and $40.75; one and two review minutes at $15/hour for 20 of 20 monthly tasks | $80.50 | $41.25 |
| Sub-cent estimates, no time value | $0.004000 | $0.006000 |
| Larger charges with cents, no time value | $12,345.67 | $9,876.54 |

The browser release workflow also checks that the cent-level values survive in the actual comparison and printable memo across desktop engines and mobile. True zero-cost plans remain supported.

## Import coverage and limits

The acceptance suite exercises supported synthetic OpenAI dashboard CSV pairs, Claude spend CSV and Admin API shapes, mapped CSV/JSON, invoice text extraction, and local save/reopen flows. It checks missing versus zero fields, partial coverage, period mismatches, currencies, duplicate rows, malformed files, and ambiguous invoice amounts. These are reproducible format and arithmetic tests, not proof that every provider export or customer invoice layout is supported. No private bills or paid provider API calls were used.

Further production-provider files and physical-device testing remain additional coverage. Homepage and directory screenshots should use the accepted real interface and visibly identify example data.
