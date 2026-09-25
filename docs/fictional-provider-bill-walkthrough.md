# Fictional provider bill walkthrough

**AsterDesk is fictional.** These two CSVs were generated for a repeatable product test, not downloaded from OpenAI or a customer:

- `tests/fixtures/fictional-asterdesk-openai-activity.csv`
- `tests/fixtures/fictional-asterdesk-openai-cost.csv`

They use the flat Activity and Cost column shapes already supported by AI Cost Lens. Each file covers every UTC day of August 2026 for two fictional projects: customer support on `gpt-5.6-sol` and QA on `gpt-5.6-luna`. There are 62 populated daily rows in each file. The fictional cost export totals **USD 563.58** and the activity export reports **171,120 requests**. The cache-write column is present but blank, so its total must remain unknown.

To try the case, open the draft preview, choose **Upload what you have**, select the Activity and Cost CSVs in **OpenAI bill review**, and build the review. The bill total and usage period should align. Project-level cost can be shown because both files identify projects. Model-level billed cost and cost per usable result must remain unavailable: the cost export has no defensible model cost allocation, and neither file records which results were usable. No savings claim follows from this case.

The automated check in `tests/test_web.py` asserts those figures and evidence boundaries. This checks import behavior, arithmetic, and the presentation contract against a realistic-sized month. It does **not** establish that the current OpenAI dashboard will produce exactly these columns, that any real customer invoice reconciles, or that a customer finds the workflow useful. Those questions need an actual export and independent walkthrough; the synthetic files must never be presented as observed spending.
