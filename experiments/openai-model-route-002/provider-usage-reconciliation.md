# Pilot 002 provider usage reconciliation

## Source exports

- `completions_usage_2026-08-02_2026-09-01.csv`
- `completions_usage_2026-08-02_2026-09-01-2.csv`

The two exports contain the same populated usage rows in a different order.
They are organization-level completion-usage exports; the attempted project
filter was not retained in the downloaded files. This does not prevent
reconciliation because each populated row includes a project ID and model.

## Pilot 002 usage

| Route | Project | Model | Requests | Input tokens | Output tokens | Cached input tokens |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Baseline | AI Cost Lens Baseline v2 (`proj_3Hcwv4SY5QgSW50GFld9hA4q`) | `gpt-5.6-sol` | 10 | 6,852 | 1,880 | 0 |
| Proposed | AI Cost Lens Proposed (`proj_riQnVHsmo9aTXJj28thWXZHJ`) | `gpt-5.6-luna` | 10 | 6,852 | 1,974 | 0 |

The exports exactly match the request and token totals preserved in the Pilot
002 evidence bundles. Both routes completed ten requests, no cached input was
reported, and the identical 6,852 input-token total confirms that the routes
received the same case workload.

The separate row for `proj_Aar7w6R6qTI8YqGMOSfDvdLh` is the earlier Pilot 001
Sol run. It used 5,019 input tokens and 1,998 output tokens and is excluded from
Pilot 002.

## Billed-cost reconciliation

The completion-usage exports do not contain a billed amount or cost column, so
they verify utilization rather than spend. Two additional organization-level
cost exports provide the September 1 billed total. The files are byte-identical
and report `$0.1287832` for the day.

The daily total reconciles exactly to the three September 1 usage rows:

| Run | Reconciled provider cost |
| --- | ---: |
| Pilot 001 Sol | $0.0600360 |
| Pilot 002 Sol baseline | $0.0650080 |
| Pilot 002 Luna proposed | $0.0037392 |
| **September 1 organization total** | **$0.1287832** |

The arithmetic is exact: `$0.0600360 + $0.0650080 + $0.0037392 = $0.1287832`.
No unexplained September 1 cost remains. Although the cost export is aggregated
at organization level and leaves project fields blank, the unique project/model
usage rows and exact additive match reconcile the run-level charges.

For Pilot 002, Luna's provider charge was `$0.0612688` lower than Sol, a 94.25%
reduction in model spend for the same ten-case input workload.

## Reconciliation status

- Request count: passed
- Model identity: passed
- Project identity: passed
- Input tokens: passed
- Output tokens: passed
- Cache tokens: passed
- Billed cost: passed at organization-total level
- Unexplained September 1 cost: $0
