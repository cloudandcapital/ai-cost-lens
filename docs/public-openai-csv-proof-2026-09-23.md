# Public OpenAI CSV compatibility check — September 23, 2026

This is a reproducible import check using a third-party [public repository](https://github.com/sabah-naveed/njc-cost-analysis) pinned to commit `8befd694190307752e69f935fd068cb7caca061f`, not a provider-attested download, a customer engagement, or an invoice reconciliation. We did not copy its raw CSVs into AI Cost Lens: the files contain organization, project, user, and key identifiers. The five unmodified pairs use `completions_usage_*.csv` and `cost_*.csv` with matching filename ranges. The overlapping and unmatched June files are excluded.

From a clean checkout, clone that repository outside this one, check out the pinned commit, and run each matching pair through `ai-cost-lens review-openai-csv --usage <usage.csv> --costs <cost.csv> --output <review.json>`. Keep the output private until reviewed because source identifiers may survive in the JSON. The same pairs were passed to the browser importer locally. Both import paths accepted the populated older CSV header, preserved a missing cache-write field as unknown, and withheld a blended cost per request when UTC bucket boundaries differed. For a file-level check, the Jan usage and cost SHA-256 hashes are `46f693f74d297b9cd5401366b8e295aaa9a4e7f381616a63f2e4a11ccedc90f5` and `ec1c6a06c65d8ce59169817eac7e11fb59cd0c76525df2270d74cd87eef91a05`.

| Filename range (2025) | Source-reported cost, USD | Requests | Result |
| --- | ---: | ---: | --- |
| Jan 1–31 | 6.535791 | 2,727 | Period mismatch |
| Feb 1–Mar 3 | 178.847754 | 57,474 | Period mismatch |
| Mar 4–Apr 3 | 2.957488 | 1,454 | Period mismatch |
| Apr 4–May 4 | 0.132266 | 71 | Period mismatch |
| May 5–Jun 4 | 0.013168 | 7 | Period mismatch |

The usage and cost files cover the same calendar days, but at least one bucket endpoint differs by one second. In every pair, cost project coverage is 0%, cache-write tokens are absent rather than zero, and `blended_cost_per_request` remains unavailable. These amounts are source-reported export totals. There is no independent invoice, no project-level cost join, no human work or outcome record, and no evidence of realized savings. Do not sum the rows into an invoice total or allocate cost to a model by token share.

The OpenAI [API Usage Dashboard export instructions](https://help.openai.com/en/articles/20001072-how-do-i-export-monthly-usage-details-from-the-api-usage-dashboard) distinguish Activity and Cost exports. These CSV pairs exercise that shape, but a current provider-attested matched export plus invoice and a user-observed review remain separate release evidence.
