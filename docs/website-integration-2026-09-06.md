# Website integration candidate — 2026-09-06

Production base: 9a3955d51fef71fc02f0724819b3f6a77353ce39 (v0.3.3).
Destination: lens.cloudandcapital.com, the existing Vercel production site backed by cloudandcapital/ai-cost-lens. This is separate from the ChatGPT Sites publication.

Integrated the reviewed no-file monthly tool comparison into the existing Start a review chooser. Preserved production single-bill, Claude, OpenAI, structured mapping, invoice PDF, missing-usage handling, and non-blocking print behavior. Simple inputs use the reviewed sampled calculation path; file-based comparison retains the production importer. Both share the comparison validation and decision layer. Kept distinct simple rendering where its user-entered inputs have different evidence boundaries.

Corrected chart unit labels, kept tool names in the report and memo, handled free-plan comparisons, recomputed comparison flags and derived values, and fixed download-anchor lifecycle. Existing provider parsing and PDF dependencies were not replaced.

Validation on this integration candidate:
- REQUIRE_CCAC_RELEASE_VALIDATION=1 pytest tests/ -q: 195 passed, zero skipped (Python 3.12).
- npm run build: passed.
- npm audit --audit-level=high: zero vulnerabilities.
- Node tests execute actual registered submit handlers with HTML-derived defaults: default $70/$220 total economic cost, named tool memo, JSON reimport, both-free no-advantage result, zero-usable rejection with prior result preserved, transition back to example and existing importer, and non-blocking print lifecycle.
- Real cloud Chromium: opened integrated chooser, submitted default no-file comparison, confirmed $1.84/$6.88, keep-current recommendation, tool names, clear scenario limitations, and visually inspected desktop layout.
- Earlier standalone build had Safari PDF and narrow-width testing; those are not claimed as fresh tests of this merged candidate. Physical Android and production browser interactions remain untested.

Publishing is blocked: the GitHub connector returned HTTP 403 Resource not accessible by integration for both issue creation and creation of a Git tree. No production GitHub branch, PR, or deployment was changed. The separately published Sites version is not a replacement for this production project.

Next: apply the accompanying patch in the authorized local production checkout, run repository-required checks, use the existing PR workflow, and verify the exact merged revision in Vercel and at lens.cloudandcapital.com. Do not replace the entire production tree with the older Sites checkout. Do not alter DNS to bypass the existing deployment. Do not claim the custom domain was updated before verification.
