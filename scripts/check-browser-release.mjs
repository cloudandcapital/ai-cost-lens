import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { chromium, firefox, webkit } from "playwright";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const build = join(root, "build");
const fixture = join(root, "tests", "fixtures", "request-events-multi-provider.csv");
const output = process.env.BROWSER_ARTIFACT_DIR || await mkdtemp(join(tmpdir(), "ai-cost-lens-browser-check-"));
await mkdir(output, { recursive: true });

const mime = {
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function axeSummary(result) {
  return result.violations.map((violation) => {
    const targets = violation.nodes.flatMap((node) => node.target).join(", ");
    return `${violation.id} (${targets})`;
  }).join("; ");
}

function startServer() {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      const candidate = resolve(build, normalize(relative));
      if (!candidate.startsWith(`${build}/`) && candidate !== join(build, "index.html")) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      const body = await readFile(candidate);
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": mime[extname(candidate)] || "application/octet-stream",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolvePromise(server));
  });
}

function localOrigin(server) {
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

function watchPage(page, origin) {
  const errors = [];
  const egress = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  page.on("request", (request) => {
    const url = request.url();
    if (/^https?:/i.test(url) && !url.startsWith(origin)) egress.push(url);
  });
  return { errors, egress };
}

async function saveJsonDownload(page, selector, filename) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(selector).click(),
  ]);
  const path = join(output, filename);
  await download.saveAs(path);
  return JSON.parse(await readFile(path, "utf8"));
}

async function openAdvancedChoices(page) {
  const choices = page.locator(".builder-more-paths");
  if (!(await choices.evaluate((element) => element.open))) await choices.locator("summary").click();
}

async function verifyFinanceMemoPdf(page) {
  await page.locator("#start-review").click();
  await openAdvancedChoices(page);
  await page.locator('[data-builder-mode="example"]').click();
  await page.waitForFunction(() => document.querySelector("#memo-decision-code")?.textContent?.trim());
  await page.evaluate(() => { window.print = () => {}; });
  await page.locator("#print-memo").click();
  assert(await page.locator("body").evaluate((body) => body.classList.contains("printing-memo")), "print button did not activate the finance memo layout.");

  const bytes = await page.pdf({ format: "Letter", preferCSSPageSize: true, printBackground: true });
  assert(bytes.subarray(0, 5).toString() === "%PDF-", "print output is not a PDF.");
  await writeFile(join(output, "finance-memo-example.pdf"), bytes);
  const loadingTask = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const document = await loadingTask.promise;
  assert(document.numPages >= 1 && document.numPages <= 3, `finance memo PDF has ${document.numPages} pages.`);
  const pages = [];
  for (let index = 1; index <= document.numPages; index += 1) {
    const content = await (await document.getPage(index)).getTextContent();
    pages.push(content.items.map((item) => item.str).join(" "));
  }
  const text = pages.join(" ").toLowerCase();
  for (const expected of ["ai spend decision memo", "the other option does not meet", "provider cost", "cost per ready result", "what finance can rely on", "current cost vs plan", "monthly scenario compares route unit costs", "one time change cost", "month net after change cost", "not booked savings", "not supported"]) {
    assert(text.includes(expected), `finance memo PDF is missing ${expected}.`);
  }
  await loadingTask.destroy();
  return { pages: pages.length, bytes: bytes.length };
}

async function verifySavedReviewRoundTrip(page) {
  const decision = await page.locator("#memo-decision-code").textContent();
  const review = await saveJsonDownload(page, "#download-review", "worked-example-review.json");
  assert(review.schema_version === "ai-cost-lens-review-result/1.0", "saved review schema is wrong.");
  await page.reload({ waitUntil: "networkidle" });
  const chooser = page.waitForEvent("filechooser");
  await page.locator("#open-review").click();
  await (await chooser).setFiles({
    name: "worked-example-review.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(review)),
  });
  await page.waitForFunction(() => document.querySelector("#toast")?.textContent?.includes("worked-example-review.json is open"));
  assert(await page.locator("#memo-decision-code").textContent() === decision, "saved review did not restore its decision.");
  return review.schema_version;
}

async function verifyRichDecisionFlow(page) {
  const scenarios = [
    { name: "false-economy", allowed: false, status: "no_improvement" },
    { name: "true-savings", allowed: true, status: "observed_improvement" },
  ];
  const results = [];
  for (const scenario of scenarios) {
    const directory = join(root, "examples", "synthetic-cases");
    const config = JSON.parse(await readFile(join(directory, `${scenario.name}-config.json`), "utf8"));
    await page.locator("#start-review").click();
    await openAdvancedChoices(page);
    await page.locator('[data-builder-mode="workload"]').click();
    await page.locator("#spend-file").setInputFiles(join(directory, `${scenario.name}-spend.csv`));
    await page.locator('[data-outcome-mode="detailed"]').click();
    await page.locator("#work-file").setInputFiles(join(directory, `${scenario.name}-outcomes.csv`));
    await page.locator("#acceptance-rule").fill(config.acceptanceRule);
    await page.locator("#verifier").fill(config.verifier);
    await page.locator("#quality-floor").fill(String(config.qualityFloor * 100));
    await page.locator("#hourly-rate").fill(String(config.hourlyRate));
    await page.locator("#baseline-policy-approved").setChecked(config.baselinePolicyApproved);
    await page.locator("#proposed-policy-approved").setChecked(config.proposedPolicyApproved);
    const advancedCosts = page.locator(".advanced-costs");
    if (!(await advancedCosts.evaluate((details) => details.open))) await advancedCosts.locator("summary").click();
    await page.locator("#baseline-shared").fill(String(config.baselineShared));
    await page.locator("#proposed-shared").fill(String(config.proposedShared));
    await page.locator("#change-cost").fill(String(config.changeCost));
    await page.locator("#build-review").click();
    await page.waitForFunction(() => !document.querySelector("#review-dialog")?.open || document.querySelector("#builder-error")?.textContent?.trim(), null, { timeout: 20000 });
    assert(!(await page.locator("#review-dialog").evaluate((dialog) => dialog.open)), `${scenario.name}: detailed review did not close the builder: ${await page.locator("#builder-error").innerText()}`);
    const review = await saveJsonDownload(page, "#download-review", `${scenario.name}-browser-review.json`);
    assert(review.schema_version === "ai-cost-lens-review-result/1.0", `${scenario.name}: wrong review export.`);
    assert(review.comparison.status === scenario.status, `${scenario.name}: decision status changed to ${review.comparison.status}.`);
    assert(review.comparison.savings_claim_allowed === scenario.allowed, `${scenario.name}: savings gate is wrong.`);
    assert(review.mode === "real" && review.comparison.evidence_complete === true, `${scenario.name}: complete work log lost its evidence status.`);
    assert(review.baseline.costs.model_cost > review.proposed.costs.model_cost, `${scenario.name}: provider cost did not fall.`);
    results.push({ scenario: scenario.name, status: review.comparison.status, savings_claim_allowed: scenario.allowed });
  }
  return results;
}

async function verifyOpenAIPartialBucket(page) {
  const fixtureDir = join(root, "tests", "fixtures");
  const usage = (await readFile(join(fixtureDir, "openai-dashboard-usage.csv"), "utf8"))
    .replaceAll("1788307200,1788393600", "1788310800,1788393600");
  await page.locator("#start-review").click();
  await openAdvancedChoices(page);
  await page.locator('[data-builder-mode="openai"]').click();
  await page.locator("#openai-usage-file").setInputFiles({ name: "partial-usage.csv", mimeType: "text/csv", buffer: Buffer.from(usage) });
  await page.locator("#openai-cost-file").setInputFiles(join(fixtureDir, "openai-dashboard-cost.csv"));
  await page.locator("#build-review").click();
  await page.locator("#bill-mode-tag").waitFor({ state: "visible" });
  assert((await page.locator("#bill-mode-tag").innerText()) === "PERIOD MISMATCH", "Same-day partial usage bucket was accepted.");
  assert((await page.locator("#bill-source-copy").innerText()).includes("do not match"), "Mismatch introduction describes exports as aligned.");
  assert((await page.locator("#bill-finding-limit").innerText()).includes("same calendar dates"), "Mismatch warning omits partial UTC buckets.");
  assert((await page.locator("#bill-metric-ledger").innerText()).includes("Unavailable until usage and cost UTC time buckets match"), "Mismatch did not suppress blended cost per request.");
  assert((await page.locator("#bill-boundary-copy").innerText()).includes("even if their calendar dates match"), "Mismatch guidance blames dates that already match.");
}

async function priceAndUsageFlow(engineName, engine, origin) {
  const browser = await engine.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const observed = watchPage(page, origin);
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.locator("#review-title").waitFor({ state: "visible" });

  await page.locator('[data-example="growth"]').click();
  assert((await page.locator("#workload-name").innerText()) === "Growing support AI workload", `${engineName}: startup example did not open.`);
  assert((await page.locator("#mode-tag").innerText()) === "ILLUSTRATIVE DATA", `${engineName}: invented example lacks its evidence label.`);
  assert((await page.locator("#decision-title").innerText()) === "Test the lower-cost route", `${engineName}: startup example overclaims the route change.`);
  assert((await page.locator("#opportunity-ledger").innerText()).includes("One time change cost"), `${engineName}: growth example omitted migration cost.`);
  assert((await page.locator("#review-title").innerText()).includes("Cost per ready result down 19%"), `${engineName}: startup example hides its result.`);
  assert((await page.locator("#receipt-grid").innerText()).includes("ILLUSTRATIVE"), `${engineName}: receipt lost its evidence label.`);
  assert((await page.locator("#receipt-grid").innerText()).includes("$1.77"), `${engineName}: receipt lines do not support the proposed unit cost.`);
  assert((await page.locator("#price-crosscheck-result").innerText()).includes("$22,000.00"), `${engineName}: token-to-cost check did not reprice the example.`);
  const [receiptDownload] = await Promise.all([page.waitForEvent("download"), page.locator("#download-receipt").click()]);
  assert(receiptDownload.suggestedFilename().endsWith(".svg"), `${engineName}: receipt did not export as an image.`);
  await page.locator("#growth-revenue").fill("3");
  assert(await page.locator("#growth-results tbody tr").count() === 4, `${engineName}: growth planner lacks volume scenarios.`);
  assert((await page.locator("#growth-results tbody tr").first().innerText()).includes("26.7%"), `${engineName}: modeled current gross margin is wrong.`);
  await page.locator('.nav-item[data-view="evidence"]').click();
  assert((await page.locator("#evidence-kit-list").innerText()).includes("Replace the example"), `${engineName}: evidence kit lost its concrete next step.`);
  assert((await page.locator("#sample-size-result").innerText()).includes("385"), `${engineName}: sample planner returned an incorrect precision estimate.`);
  const [kitDownload] = await Promise.all([page.waitForEvent("download"), page.locator("#download-evidence-kit").click()]);
  assert(kitDownload.suggestedFilename().endsWith(".md"), `${engineName}: evidence action list did not download.`);
  await page.locator('.nav-item[data-view="review"]').click();
  await page.locator("#start-review-inline").click();
  assert(await page.locator("#baseline-population").inputValue() === "" && await page.locator("#proposed-ready").inputValue() === "", `${engineName}: example outcomes leaked into a real review.`);
  assert(await page.locator("#review-dialog").evaluate((dialog) => dialog.open), `${engineName}: inline review action did not open.`);
  assert(await page.locator(".builder-mode-choice > .builder-mode").count() === 3, `${engineName}: start dialog still presents too many choices.`);
  await page.locator("#close-review").click();
  await page.locator('[data-example="cost-trap"]').click();
  assert((await page.locator("#workload-name").innerText()) === "Contract risk summaries", `${engineName}: could not return to the original example.`);

  assert(await page.locator("#header-menu-toggle").isHidden(), `${engineName}: desktop menu toggle should be hidden.`);
  assert(await page.locator("#price-prompt").isVisible(), `${engineName}: Price a prompt is not visible.`);
  await page.locator("#price-prompt").click();
  assert(await page.locator("#price-prompt-dialog").evaluate((dialog) => dialog.open), `${engineName}: pricing dialog did not open.`);
  assert(await page.locator("#prompt-alt-3").inputValue() === "", `${engineName}: the addable comparison slot is not empty.`);

  await page.locator("#prompt-input-tokens").fill("1000");
  await page.locator("#prompt-output-tokens").fill("500");
  await page.locator("#prompt-calls").fill("1000");
  await page.locator("#prompt-cache-share").fill("25");
  await page.locator("#calculate-prompt-price").click();
  await page.locator("#price-results").waitFor({ state: "visible" });
  assert(await page.locator("#price-result-rows tr").count() === 3, `${engineName}: pricing comparison did not render three routes.`);
  assert((await page.locator("#price-result-rows").innerText()).toLowerCase().includes("global / default"), `${engineName}: route geography is missing from results.`);

  await page.locator(".model-catalog-browser").evaluate((details) => { details.open = true; });
  const sonnet = page.locator(".model-catalog-card").filter({ hasText: "Claude Sonnet 5" });
  const sonnetText = await sonnet.innerText();
  for (const expected of ["INPUT\n$2.00", "CACHED INPUT\n$0.20", "CACHE WRITE · 5 MIN\n$2.50", "OUTPUT\n$10.00"]) {
    assert(sonnetText.toUpperCase().includes(expected), `${engineName}: Claude Sonnet 5 card is missing ${expected.replace("\n", " ")}.`);
  }
  const currentRates = [
    ["GPT-6 Sol", ["INPUT\n$2.00", "CACHED INPUT\n$0.20", "CACHE WRITE\n$2.50", "OUTPUT\n$10.00"]],
    ["GPT-6 Luna", ["INPUT\n$0.10", "CACHED INPUT\n$0.01", "CACHE WRITE\n$0.125", "OUTPUT\n$0.50"]],
    ["Claude Opus 5.5", ["INPUT\n$4.00", "CACHED INPUT\n$0.20", "CACHE WRITE · 5 MIN\n$5.00", "OUTPUT\n$20.00"]],
  ];
  for (const [name, expectedRates] of currentRates) {
    const card = page.locator(".model-catalog-card").filter({ hasText: name });
    const row = await card.innerText();
    for (const expected of expectedRates) {
      assert(row.toUpperCase().includes(expected), `${engineName}: ${name} missing ${expected.replace("\n", " ")}.`);
    }
    const provenance = await card.locator(".model-catalog-card-head span").textContent();
    assert(provenance.includes("checked 2026-09-23"), `${engineName}: ${name} is missing its checked date: ${provenance}`);
  }
  for (const [name, rates] of [
    ["GPT-6 Sol", ["INPUT\n$4.00", "CACHED INPUT\n$0.40", "CACHE WRITE\n$5.00", "OUTPUT\n$15.00"]],
    ["GPT-6 Luna", ["INPUT\n$0.20", "CACHED INPUT\n$0.02", "CACHE WRITE\n$0.25", "OUTPUT\n$0.75"]],
  ]) {
    const card = page.locator(".model-catalog-card").filter({ hasText: name });
    const tier = card.locator('[aria-label="Standard long-context USD rates per 1 million tokens"]');
    assert((await card.innerText()).includes("over 272,000 input tokens per request; higher rates apply to the full request"), `${engineName}: ${name} hides the long-context threshold.`);
    for (const expected of rates) {
      assert((await tier.innerText()).toUpperCase().includes(expected), `${engineName}: ${name} long-context rate is missing ${expected.replace("\n", " ")}.`);
    }
  }

  const estimate = await saveJsonDownload(page, "#download-price-estimate", `${engineName}-prompt-estimate.json`);
  assert(estimate.schema_version === "ai-cost-lens-prompt-price-estimate/0.6", `${engineName}: prompt estimate schema is wrong.`);
  assert(estimate.evidence_gate.savings_claim_allowed === false, `${engineName}: prompt estimate allowed a savings claim.`);
  assert(estimate.comparison.length === 3, `${engineName}: prompt estimate lost a route.`);

  await page.locator("#prompt-input-tokens").fill("1200000");
  await page.locator("#calculate-prompt-price").click();
  assert(await page.locator("#price-results").isHidden(), `${engineName}: stale pricing results survived a calculation error.`);
  assert(await page.locator("#download-price-estimate").isDisabled(), `${engineName}: stale estimate is still downloadable.`);
  await page.locator("#prompt-input-tokens").fill("1000");
  await page.locator("#calculate-prompt-price").click();
  await page.locator("#price-results").waitFor({ state: "visible" });
  await page.locator("#price-review-alternative").selectOption("1");

  await page.locator("#send-price-to-review").click();
  assert(await page.locator("#review-dialog").evaluate((dialog) => dialog.open), `${engineName}: Review handoff did not open.`);
  assert(await page.locator("#simple-other-name").inputValue() === estimate.comparison[2].label, `${engineName}: Review ignored the selected route.`);
  assert(await page.locator("#simple-approved").isChecked() === false, `${engineName}: policy approval was preselected.`);
  assert(await page.locator("#simple-hourly-rate").inputValue() === "", `${engineName}: the handoff silently valued human time at zero.`);
  for (const selector of ["#simple-current-checked", "#simple-current-usable", "#simple-other-checked", "#simple-other-usable"]) {
    assert(await page.locator(selector).inputValue() === "", `${engineName}: estimated pricing prefilled quality evidence.`);
  }
  assert((await page.locator("#builder-action-note").innerText()).toLowerCase().includes("same task sample"), `${engineName}: Review handoff omitted the quality-evidence requirement.`);
  await page.locator("#close-review").click();

  await page.locator("#review-usage").click();
  await page.locator("#request-log-file").setInputFiles(fixture);
  await page.locator("#analyze-request-log").click();
  await page.locator("#request-analysis-results").waitFor({ state: "visible" });
  assert((await page.locator("#request-analysis-boundary").innerText()).toLowerCase().includes("do not prove realized savings"), `${engineName}: usage review lost its evidence boundary.`);
  const usage = await saveJsonDownload(page, "#download-usage-review", `${engineName}-usage-review.json`);
  assert(usage.event_count === 7, `${engineName}: usage import did not retain all seven rows.`);
  assert(usage.evidence_gate.savings_claim_allowed === false, `${engineName}: usage review allowed a savings claim.`);
  await page.locator("#request-billed-total").fill("70");
  await page.locator("#request-billed-currency").fill("USD");
  await page.locator("#request-bill-scope-confirmed").check();
  await page.locator("#request-period-complete").check();
  const malformedLog = [
    "event_id,timestamp,provider,model,provider_reported_cost,currency",
    "good,2026-09-01T12:00:00Z,OpenAI,gpt-5.6-sol,10,USD",
    "bad,2026-09-02T12:00:00Z,OpenAI,gpt-5.6-sol,oops,USD",
    "wrong-fields,2026-09-03T12:00:00Z,OpenAI,gpt-5.6-sol,10",
  ].join("\n");
  await page.locator("#request-log-file").setInputFiles({ name: "malformed.csv", mimeType: "text/csv", buffer: Buffer.from(malformedLog) });
  await page.locator("#analyze-request-log").click();
  await page.locator("#request-analysis-results").waitFor({ state: "visible" });
  const partial = await saveJsonDownload(page, "#download-usage-review", `${engineName}-partial-usage-review.json`);
  assert(partial.event_count === 1 && partial.import_coverage.excluded_rows === 2, `${engineName}: partial import lost coverage.`);
  assert(partial.reconciliation.bill.status === "ROWS_EXCLUDED" && partial.spend.run_rate_status === "NOT_SUPPORTED", `${engineName}: excluded rows allowed a whole-log financial claim.`);
  const issuesDownload = page.waitForEvent("download");
  await page.locator("#download-request-issues").click();
  const issues = await readFile(await (await issuesDownload).path(), "utf8");
  assert(issues.includes("2,") && issues.includes("4,"), `${engineName}: issue export lost source record numbers.`);
  assert((await page.locator("#request-analysis-boundary").innerText()).includes("valid rows only"), `${engineName}: scoped warning missing.`);
  const allBadLog = "event_id,provider_reported_cost,currency\nbad,oops,USD\n";
  await page.locator("#request-log-file").setInputFiles({ name: "all-bad.csv", mimeType: "text/csv", buffer: Buffer.from(allBadLog) });
  await page.locator("#analyze-request-log").click();
  assert((await page.locator("#request-log-error").innerText()).includes("No valid request rows"), `${engineName}: wholly invalid import was not stopped.`);
  assert(await page.locator("#download-request-issues").isVisible(), `${engineName}: wholly invalid import lost the issue download.`);
  await page.locator("#request-billed-total").fill("");
  await page.locator("#request-bill-scope-confirmed").uncheck();
  await page.locator("#request-period-complete").uncheck();
  const mixedLog = [
    "event_id,timestamp,provider,model,customer,input_tokens,output_tokens,cached_input_tokens,tool_charges,provider_reported_cost,currency",
    "a,2026-09-01T10:00:00Z,OpenAI,gpt-5.6-sol,A,100,20,0,0,12,USD",
    "b,2026-09-01T10:01:00Z,OpenAI,gpt-5.6-sol,A,100,20,,,,USD",
    "c,2026-09-01T10:02:00Z,OpenAI,gpt-5.6-sol,B,100,20,0,0,5,EUR",
  ].join("\n");
  await page.locator("#request-log-file").setInputFiles({ name: "mixed.csv", mimeType: "text/csv", buffer: Buffer.from(mixedLog) });
  await page.locator("#analyze-request-log").click();
  await page.locator("#request-analysis-results").waitFor({ state: "visible" });
  assert((await page.locator("#request-analysis-summary").innerText()).includes("$12.00"), `${engineName}: a EUR row hid comparable USD cost.`);
  assert((await page.locator("#request-currency-slices").innerText()).includes("EUR"), `${engineName}: currency coverage was hidden.`);
  assert((await page.locator("#request-spend-breakdowns").innerText()).includes("Breakdowns below use USD only"), `${engineName}: mixed currency breakdowns lack an explicit scope.`);
  const revenueLog = "customer,period_start,period_end,revenue,currency\nA,2026-09-01,2026-09-01,100,USD\n";
  await page.locator("#customer-revenue-file").setInputFiles({ name: "revenue.csv", mimeType: "text/csv", buffer: Buffer.from(revenueLog) });
  await page.locator("#analyze-customer-revenue").click();
  await page.locator("#customer-revenue-result").waitFor({ state: "visible" });
  assert((await page.locator("#customer-revenue-result").innerText()).includes("At least"), `${engineName}: unpriced customer cost lost its lower-bound label. Error: ${await page.locator("#customer-revenue-error").innerText()}; result: ${await page.locator("#customer-revenue-result").innerText()}`);
  await page.locator("#try-illustrative-request-log").click();
  await page.locator("#request-analysis-results").waitFor({ state: "visible" });
  await page.locator("#try-customer-economics").click();
  assert((await page.locator("#customer-revenue-result").innerText()).includes("Example customer A"), `${engineName}: customer example failed to join.`);
  assert((await page.locator("#customer-revenue-result").innerText()).includes("Illustrative inputs"), `${engineName}: customer example lost its evidence label.`);
  assert((await page.locator("#customer-revenue-result").innerText()).includes("lack customer IDs"), `${engineName}: unallocated cost is hidden.`);
  await page.locator("#request-human-review-cost").evaluate((input) => { input.closest("details").open = true; });
  await page.locator("#request-human-review-cost").fill("0.12");
  await page.locator("#analyze-request-log").click();
  await page.locator("#request-analysis-results").waitFor({ state: "visible" });
  await page.locator("#customer-allocation-method").selectOption("requests");
  await page.locator("#try-customer-economics").click();
  assert((await page.locator("#customer-revenue-result").innerText()).toLowerCase().includes("allocated operating cost"), `${engineName}: entered human cost was not available for explicit allocation. Error: ${await page.locator("#customer-revenue-error").innerText()}`);
  if (engineName === "chromium") {
    await page.locator('[data-view="evidence"]').click();
    const workspace = await saveJsonDownload(page, "#download-workspace", "workspace-archive.json");
    assert(workspace.schema_version === "ai-cost-lens-workspace/1.0" && workspace.request_review?.event_count === 7 && workspace.customer_cost_to_serve?.analysis?.customers?.length, "Workspace archive lost imported request or customer analysis.");
  }

  const financeMemoPdf = engineName === "chromium" ? await verifyFinanceMemoPdf(page) : null;
  const savedReview = engineName === "chromium" ? await verifySavedReviewRoundTrip(page) : null;
  const rich_decisions = engineName === "chromium" ? await verifyRichDecisionFlow(page) : null;
  if (engineName === "chromium") await verifyOpenAIPartialBucket(page);
  await page.locator("#start-review").click();
  await page.locator('[data-builder-mode="single"]').click();
  await page.locator("#invoice-provider").fill("OpenAI");
  await page.locator("#invoice-workload").fill("Personal plan");
  await page.locator("#invoice-date").fill("2026-09-23");
  await page.locator("#invoice-amount").fill("90");
  await page.locator("#invoice-currency").fill("USD");
  await page.locator("#build-review").click();
  assert(await page.locator("#bill-review-screen").isVisible(), `${engineName}: one-bill review did not render.`);
  assert((await page.locator("#bill-metric-ledger .metric-cell:first-child span").textContent()).includes("User-entered billed amount"), `${engineName}: manual amount was presented as provider-verified.`);
  await page.locator("#review-usage").click();
  assert(await page.locator("#request-log-file").isVisible(), `${engineName}: one-bill to usage path opened a blank page.`);
  assert(await page.locator("#request-billed-total").inputValue() === "90", `${engineName}: the bill amount did not reach usage review.`);
  assert(await page.locator("#request-billed-currency").inputValue() === "USD", `${engineName}: the bill currency did not reach usage review.`);
  assert(await page.locator("#request-bill-scope-confirmed").isChecked() === false, `${engineName}: bill scope was assumed to match.`);
  await page.locator("#request-log-file").setInputFiles(fixture);
  await page.locator("#analyze-request-log").click();
  await page.locator("#request-analysis-results").waitFor({ state: "visible" });
  await page.locator("#back-to-bill").click();
  assert(await page.locator("#bill-review-screen").isVisible(), `${engineName}: could not return to the bill.`);
  assert((await page.locator("#bill-metric-ledger").innerText()).includes("7 imported requests"), `${engineName}: analyzed usage did not appear on the bill review.`);
  assert(observed.egress.length === 0, `${engineName}: observed external requests: ${observed.egress.join(", ")}`);
  assert(observed.errors.length === 0, `${engineName}: browser errors: ${observed.errors.join(" | ")}`);
  await browser.close();
  return { engine: engineName, prompt_routes: estimate.comparison.length, usage_rows: usage.event_count, finance_memo_pdf: financeMemoPdf, saved_review_reopened: savedReview, rich_decisions, egress: 0 };
}

async function mobileAndAccessibility(origin) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const observed = watchPage(page, origin);
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.locator("#review-title").waitFor({ state: "visible" });

  assert(await page.locator("#header-menu-toggle").isVisible(), "mobile: menu toggle is not visible.");
  assert(await page.locator("#header-actions").isHidden(), "mobile: action stack is visible before opening the menu.");
  assert(await page.locator(".question-nav").isHidden(), "mobile: seven-button section navigation is still visible.");
  assert(await page.locator(".mobile-section-picker").isVisible(), "mobile: section picker is missing.");
  const titleBox = await page.locator("#review-title").boundingBox();
  assert(titleBox && titleBox.y < 560, `mobile: primary content begins too low (${titleBox?.y ?? "missing"}px).`);
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(horizontalOverflow <= 1, `mobile: page overflows horizontally by ${horizontalOverflow}px.`);
  await page.locator('[data-example="growth"]').click();
  await page.locator("#growth-revenue").fill("3");
  assert((await page.locator("#receipt-grid").innerText()).includes("$1.77"), "mobile: receipt failed to render.");
  assert(await page.locator("#growth-results").evaluate((element) => element.scrollWidth > element.clientWidth), "mobile: growth results should scroll inside their own region.");
  assert(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 1, "mobile: growth planner causes page overflow.");
  await page.locator('[data-example="cost-trap"]').click();

  await page.locator("#header-menu-toggle").click();
  assert(await page.locator("#header-actions").isVisible(), "mobile: action menu did not open.");
  assert(await page.locator("#header-actions button").count() === 7, "mobile: action menu lost a workflow.");
  await page.locator("#header-menu-toggle").click();
  await page.locator("#mobile-section-nav").selectOption("verify");
  await page.locator("#view-verify").waitFor({ state: "visible" });

  await page.locator("#mobile-section-nav").selectOption("review");
  const overviewA11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  assert(overviewA11y.violations.length === 0, `mobile overview accessibility violations: ${axeSummary(overviewA11y)}`);
  await page.locator("#mobile-section-nav").selectOption("opportunities");
  await page.locator("#try-illustrative-request-log").click();
  await page.locator("#request-analysis-results").waitFor({ state: "visible" });
  assert(await page.locator(".request-deep-dive").first().evaluate((element) => !element.open), "mobile: detailed request analysis should start collapsed.");
  await page.locator(".request-deep-dive").first().locator("summary").click();
  assert(await page.locator("#request-spend-overview-title").isVisible(), "mobile: spend context could not be opened.");
  assert(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 1, "mobile: request analysis causes page overflow.");

  await page.locator("#header-menu-toggle").click();
  await page.locator("#price-prompt").click();
  await page.locator("#prompt-input-tokens").fill("1000");
  await page.locator("#calculate-prompt-price").click();
  await page.locator("#price-results").waitFor({ state: "visible" });
  assert(await page.locator(".price-table-wrap").evaluate((element) => element.scrollWidth <= element.clientWidth + 1), "mobile: prompt costs are still hidden sideways.");
  const priceA11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  assert(priceA11y.violations.length === 0, `mobile pricing accessibility violations: ${axeSummary(priceA11y)}`);

  assert(observed.egress.length === 0, `mobile: observed external requests: ${observed.egress.join(", ")}`);
  assert(observed.errors.length === 0, `mobile: browser errors: ${observed.errors.join(" | ")}`);
  await browser.close();
  return { viewport: "390x844", horizontal_overflow_px: horizontalOverflow, accessibility_violations: 0, egress: 0 };
}

const server = await startServer();
try {
  const origin = localOrigin(server);
  const browsers = [];
  for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    browsers.push(await priceAndUsageFlow(name, engine, origin));
  }
  const mobile = await mobileAndAccessibility(origin);
  process.stdout.write(`${JSON.stringify({ result: "passed", browsers, mobile }, null, 2)}\n`);
} finally {
  await new Promise((resolvePromise) => server.close(resolvePromise));
}
