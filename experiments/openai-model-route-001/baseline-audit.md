# Baseline audit: why 1/10 was not a model-quality result

The first Sol run completed ten requests with zero retries. It used 5,019 input
tokens and 1,998 output tokens. At the published September 1, 2026 Sol token
rates, that implies approximately `$0.0600` before the provider cost export is
reconciled.

The original machine score was 1/10. A response-by-response audit found that
the score could not be used as model quality evidence:

- Five cases failed because the key expected a generic unit such as `USD`,
  while the model returned a more precise unit such as `USD/month` or
  `USD per accepted result`.
- The benchmark case selected the useful 15x prompt-size mismatch; the key had
  arbitrarily required the vendor's 3x headline instead.
- The currency case forced a numeric metric even though no valid normalized
  comparison could be calculated.
- Two cases did not identify what the APPROVE, INVESTIGATE, or REJECT decision
  applied to. The model's decisions were defensible, but the key assumed a
  different target.
- Three evidence-label disagreements came from claim wording that mixed an
  unknown outcome with whether a stated inference was valid.

Two model weaknesses survived the audit. In the rate and cache cases, Sol
called unproven all-in savings claims `CONTRADICTED`. The supplied facts did not
directly disprove every possible all-in result, so `UNKNOWN` was the disciplined
state.

The run is preserved as evaluation-design evidence, not used to compare Sol
with another model. Pilot 002 fixes the decision target, required metric,
precise unit, null handling, and evidence-state definitions before either route
is evaluated.
