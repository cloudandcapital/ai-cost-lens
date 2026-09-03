# AI Cost Lens validation report: September 2, 2026

## Release candidate

This validation covers the finance-first workload review with Plan vs Actual,
time-based payback, evidence gates, the three-path local start, the printable
finance memo, the saved OpenAI export path, and the reusable blinded model-route
reviewer.

## Automated result

- 174 tests passed, including the five checks that invoke the separately
  released CCAC acceptance validator used in CI verification.
- No test was skipped.
- Python compiled successfully.
- The browser application and review-builder JavaScript passed syntax checks.
- The self-contained site rebuilt successfully.
- The generated illustrative browser record exactly matched the Python engine.
- The worked-example reset uses the embedded canonical record in the standalone preview.
- The finance memo reads from the active decision record and adds no separate calculation path.

## Finance controls verified

- Provider, shared infrastructure, human review, and one-time change cost reconcile.
- Cost per ready result uses recurring operating cost divided by ready results.
- The provider bill reduction and full recurring cost reduction stay distinct.
- Plan, actual, and proposed-change values remain separate.
- Time-based payback uses expected ready results per month and an explicit horizon.
- A non-positive operating difference produces no payback rather than an invented period.
- A savings claim requires real mode, complete evidence, equivalent cost bases,
  provider-reported cost on both routes, quality, and policy approval.
- Calculated or allocated provider costs may support a test decision but not booked savings.
- A saved OpenAI bill export supports total cost and usage mix without manufacturing model-level billed cost.

## Shipped illustrative case

The sample is synthetic and labeled as such. It demonstrates a false economy:
provider cost falls 65.0%, total recurring cost falls 16.4%, ready result yield
falls from 94% to 75%, and cost per ready result rises 4.8%.

Against the supplied current-route plan, actual recurring cost is $5,940 over
plan, ready output is 20 results above plan, and cost per ready result is $3.34
above plan. At 940 expected ready results per month, the proposed route has no
operating payback and produces a modeled twelve-month shortfall of $77,232.

## Human and provider validation already completed

- Independent cold source reviews identified presentation and evidence-label
  defects; those defects were corrected and covered by regression tests.
- An independent scripted browser review exercised all three onboarding paths,
  synthetic CSV uploads, saved-review round trips, printing, and mobile layout;
  the reported defects were corrected and covered by regression tests.
- A real saved OpenAI organization export was parsed locally and reconciled to
  $0.133051 of provider-reported cost, 40 requests, 23,394 input tokens, and
  6,474 output tokens. The tool correctly withheld unsupported model-level cost allocation.
- Model-route Pilot 002 preserved provider usage and blinded human-review evidence.
- Pilot 003 is locked at five finance decisions per route. Its runner and
  ten-response blinded reviewer are ready; live requests remain pending and
  must use separate project credentials.

## Remaining boundary

This is a tested beta, not an invoice certification,
production observability system, or customer deployment. The sample proves the
method and implementation against declared inputs. It does not prove savings or
performance for a live company workload.
