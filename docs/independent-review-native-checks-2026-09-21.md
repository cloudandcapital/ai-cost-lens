# Independent review: native PDF and Network checks

Completed September 21, 2026 against `c771bc949d2978e4e5d2f8108c8603a0a3e08f4c` on `feat/ai-cost-lens-product-readiness`. The earlier calculation, evidence-gate, and accessibility fixes are in that commit.

Scope: the two remaining checks in the independent review. Used a dedicated Safari 26.6.2 window serving the production build at `http://127.0.0.1:4173/` and synthetic input data. No merge or deployment was performed.

## Native PDF pagination

Used the application's Print finance memo action and Safari's native Save as PDF operation. Settings: A4, portrait, 100%, headers/footers off, backgrounds off. The illustrative contract-risk review produced one A4 page (595 × 842 points). Rendered and visually inspected the saved PDF: financial decision, complete comparison table, decision rules, evidence, plan/payback, next step, and footer are present. No clipped rows, overflow, or extra blank page was observed.

This validates that memo and those print settings; it does not certify every paper size or arbitrarily long custom text. No pagination defect was confirmed.

## Native Network panel

Used Safari Web Inspector's Network tab, All types, with no URL filter.

1. Reloaded the local production build: one local document resource.
2. Cleared the Network list, entered a unique synthetic prompt marker, and calculated the scenario. The only request was `GET /vendor/openai-tokenizer.js` on the same loopback origin. Inspected its Headers pane: no query parameters, request body, or prompt in request headers. No external domain appeared.
3. Cleared the list again, selected a synthetic JSON usage file, and clicked Analyze locally. The file contained 14 priced records across 14 UTC days, a synthetic customer marker, and an unknown prompt column. Analysis completed with $210 observed cost and the customer breakdown present. Network remained at **0 domains, 0 resources, 0 bytes transferred**.

No entered or imported data transmission was observed in these tested flows. This runtime evidence complements the earlier source inspection; it is not a guarantee about every browser extension or future application version. No privacy defect was confirmed, so no additional application change was made.

## Verification after the native checks

- Production build, builder-state checks, and web acceptance checks: passed.
- `uv lock --check`, Black, isort, selected flake8 checks, and `git diff --check`: passed.
- `REQUIRE_CCAC_RELEASE_VALIDATION=1 .venv/bin/pytest tests/ -q`: **250 passed, no skips**.
- npm audit and locked-runtime pip-audit: no known vulnerabilities.

Native PDF and Network screenshots were retained with the local independent-review deliverables. This record closes the two previously outstanding checks without granting merge or deployment approval.
