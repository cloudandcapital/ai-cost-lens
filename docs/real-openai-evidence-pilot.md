# Real OpenAI evidence pilot

This pilot tests AI Cost Lens against one complete UTC day of real OpenAI API organization evidence. It validates raw-provider compatibility before a baseline-versus-proposed workload experiment is attempted.

It does **not** use ChatGPT subscription activity. ChatGPT Pro and OpenAI API billing are separate products. The organization usage and cost endpoints require an OpenAI organization Admin API key and return API-platform activity only.

Official references:

- [OpenAI completions usage endpoint](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/completions)
- [OpenAI organization costs endpoint](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs)
- [OpenAI usage and cost API cookbook](https://developers.openai.com/cookbook/examples/completions_usage_api)

## Safety boundary

- Create or retrieve the Admin API key only in the OpenAI Platform organization settings.
- Keep the key in the `OPENAI_ADMIN_KEY` environment variable. Never paste it into a chat, source file, command history, screenshot, or issue.
- Raw responses stay inside `private-openai-capture/`, which is ignored by git.
- Sanitized responses replace project, API key, user, organization, and pagination identifiers. Token counts, request counts, models, dates, line items, currency, and amounts remain because they are the financial evidence under test.
- Read the sanitized files before sharing them. A custom fine-tuned model name or descriptive line item could still reveal private context.

## 1. Check that the account can support the pilot

The pilot needs:

1. Access to an OpenAI API organization as an owner.
2. An organization Admin API key.
3. At least one day with OpenAI API completions usage and corresponding cost. ChatGPT use does not count.

If any of these is missing, stop. AI Cost Lens should not manufacture a real-provider validation from synthetic data.

## 2. Capture the last complete UTC day

From the repository root, set the key in the current terminal session:

```bash
read -s OPENAI_ADMIN_KEY
export OPENAI_ADMIN_KEY
```

Press Return, paste the key into the hidden prompt, and press Return again. The key is not displayed.

Calculate the last complete UTC-day window and create the private directory:

```bash
ACL_END=$(python3 -c 'from datetime import datetime, timezone; now=datetime.now(timezone.utc); print(int(now.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()))')
ACL_START=$((ACL_END - 86400))
mkdir private-openai-capture
```

Capture usage grouped by project and model:

```bash
curl --fail-with-body --silent --show-error --get \
  "https://api.openai.com/v1/organization/usage/completions" \
  -H "Authorization: Bearer ${OPENAI_ADMIN_KEY}" \
  -H "Content-Type: application/json" \
  --data-urlencode "start_time=${ACL_START}" \
  --data-urlencode "end_time=${ACL_END}" \
  --data-urlencode "bucket_width=1d" \
  --data-urlencode "limit=1" \
  --data-urlencode "group_by=project_id" \
  --data-urlencode "group_by=model" \
  > private-openai-capture/openai-usage.raw.json
```

Capture cost grouped by project and line item:

```bash
curl --fail-with-body --silent --show-error --get \
  "https://api.openai.com/v1/organization/costs" \
  -H "Authorization: Bearer ${OPENAI_ADMIN_KEY}" \
  -H "Content-Type: application/json" \
  --data-urlencode "start_time=${ACL_START}" \
  --data-urlencode "end_time=${ACL_END}" \
  --data-urlencode "bucket_width=1d" \
  --data-urlencode "limit=1" \
  --data-urlencode "group_by=project_id" \
  --data-urlencode "group_by=line_item" \
  > private-openai-capture/openai-costs.raw.json
```

Remove the key from the shell when capture is complete:

```bash
unset OPENAI_ADMIN_KEY
```

## 3. Sanitize locally

The sanitizer reads both files together so the same project receives the same replacement ID across usage and cost. It refuses to overwrite an existing output directory.

```bash
uv run ai-cost-lens sanitize-openai \
  --usage private-openai-capture/openai-usage.raw.json \
  --costs private-openai-capture/openai-costs.raw.json \
  --output-dir sanitized-openai-evidence
```

Inspect the two sanitized JSON files. Search for known project names, API key IDs, user IDs, email addresses, custom model names, or other private text before sharing.

## 4. Run the strict importer

```bash
uv run ai-cost-lens import-openai \
  --usage sanitized-openai-evidence/openai-usage.sanitized.json \
  --costs sanitized-openai-evidence/openai-costs.sanitized.json \
  --mode real \
  --output sanitized-openai-evidence/openai-evidence.json
```

The importer must either produce a valid evidence inventory or fail with a specific incompatibility. A failure is useful product evidence; do not hand-edit the provider response to make it pass.

## 5. Record the result

For the first compatibility report, preserve:

- Whether pagination was complete.
- Whether usage and cost dates aligned.
- Whether project attribution was present on both sides.
- Whether cached, cache-write, uncached, and output tokens reconciled.
- Whether observed cost joined at project scope.
- Any undocumented or newly added provider field.
- The exact importer error if the response failed.

Do not call this a savings analysis. The first real pilot validates the evidence bridge only. A workload comparison requires two equivalent periods or routes plus outcome logs.
