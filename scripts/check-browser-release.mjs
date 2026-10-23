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
  const choices = page.locator(".builder-mode-choice > .builder-more-paths");
  if (!(await choices.evaluate((element) => element.open))) await choices.locator("summary").click();
}

async function verifyFinanceMemoPdf(page, { simple = false } = {}) {
  if (!simple) {
    await page.locator("#start-review").click();
    await openAdvancedChoices(page);
    await page.locator('[data-builder-mode="example"]').click();
  }
  await page.waitForFunction(() => document.querySelector("#memo-decision-code")?.textContent?.trim());
  await page.evaluate(() => { window.print = () => {}; });
  await page.locator("#print-memo").click();
  assert(await page.locator("body").evaluate((body) => body.classList.contains("printing-memo")), "print button did not activate the finance memo layout.");

  const bytes = await page.pdf({ format: "Letter", preferCSSPageSize: true, printBackground: true });
  assert(bytes.subarray(0, 5).toString() === "%PDF-", "print output is not a PDF.");
  await writeFile(join(output, simple ? "finance-memo-simple.pdf" : "finance-memo-example.pdf"), bytes);
  const loadingTask = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const document = await loadingTask.promise;
  assert(document.numPages >= 1 && document.numPages <= 3, `finance memo PDF has ${document.numPages} pages.`);
  const pages = [];
  for (let index = 1; index <= document.numPages; index += 1) {
    const content = await (await document.getPage(index)).getTextContent();
    pages.push(content.items.map((item) => item.str).join(" "));
  }
  const text = pages.join(" ").toLowerCase().replace(/\s+/g, " ");
  // PDF text runs can insert spaces between the letters of tracked headings.
  const compactText = text.replace(/\s/g, "");
  const required = simple
    ? ["ai tool cost comparison", "cost finding", "before switching", "approval: you confirmed", "monthly tool cost", "time value at $30/hr", "$150", "$300", "cost per usable result", "not booked savings"]
    : ["ai spend decision memo", "the other option does not meet", "provider cost", "cost per ready result", "what finance can rely on", "current cost vs plan", "monthly scenario compares route unit costs", "one time change cost", "month net after change cost", "not booked savings", "not supported"];
  for (const expected of required) {
    assert(compactText.includes(expected.replace(/\s/g, "")), `finance memo PDF is missing ${expected}. Extracted text: ${text.slice(0, 1800)}`);
  }
  if (simple) {
    for (const forbidden of ["keep current route", "stop change", "cost per ready result", "provider cost"]) {
      assert(!compactText.includes(forbidden.replace(/\s/g, "")), `simple memo retained unrelated wording: ${forbidden}.`);
    }
  }
  await loadingTask.destroy();
  if (simple) await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
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

async function verifyFictionalProjectCost(page) {
  const fixtureDir = join(root, "tests", "fixtures");
  await page.locator("#start-review").click();
  await openAdvancedChoices(page);
  assert(await page.locator('.builder-mode-choice [data-builder-mode="openai"]').isVisible(), "Provider upload is missing from the other starting options.");
  await page.locator('.builder-mode-choice [data-builder-mode="openai"]').click();
  await page.locator("#openai-usage-file").setInputFiles(join(fixtureDir, "fictional-asterdesk-openai-activity.csv"));
  await page.locator("#openai-cost-file").setInputFiles(join(fixtureDir, "fictional-asterdesk-openai-cost.csv"));
  await page.locator("#build-review").click();
  await page.locator("#bill-project-cost").waitFor({ state: "visible" });
  assert((await page.locator("#bill-project-cost").innerText()).includes("$487.20"), "Billed Support cost is missing.");
  assert((await page.locator("#bill-next-step").innerText()).includes("proj_aster_support"), "The review prioritized the busy low-cost model instead of the billed project.");
  assert((await page.locator("#bill-model-rows").innerText()).includes("Unavailable"), "Project billed cost was assigned to a model.");
  assert((await page.locator("#memo-next-step").textContent()).includes("proj_aster_support"), "The memo contradicts the project-cost priority.");
}

async function verifyToolSpendFlow(page, { mobile = false, roundTrip = false } = {}) {
  if (mobile && await page.locator("#header-actions").isHidden()) await page.locator("#header-menu-toggle").click();
  await page.locator("#start-review").click();
  await page.locator('[data-builder-mode="tools"]').click();
  assert(await page.locator("#tools-basis").inputValue() === "", "The tools review preselected a verification claim.");
  for (const [id, value] of Object.entries({
    "tools-name": "Example team tools", "tools-start": "2026-10-01", "tools-end": "2026-10-20",
    "tool-name-1": "Writing plan", "tool-amount-1": "20", "tool-source-1": "October invoice", "tool-owner-1": "Content",
    "tool-name-2": "Coding plan", "tool-amount-2": "45", "tool-source-2": "October invoice",
  })) await page.locator(`#${id}`).fill(value);
  await page.locator("#add-tool-charge").click();
  await page.locator("#tool-name-3").fill("Coding plan");
  await page.locator("#tool-kind-3").selectOption("usage");
  await page.locator("#tool-amount-3").fill("3.25");
  await page.locator("#tool-source-3").fill("Separate usage charge");
  await page.locator("#build-review").click();
  assert(await page.locator("#tools-basis-error").isVisible() && await page.locator("#tools-basis").evaluate((element) => element === document.activeElement), "Missing cost basis was not explained at the focused field.");
  await page.locator("#tools-basis").selectOption("provider_reported");
  await page.locator("#build-review").click();
  assert(await page.locator("#tools-scope-error").isVisible() && await page.locator("#tools-scope").evaluate((element) => element === document.activeElement), "Missing charge boundary was not explained at the focused checkbox.");
  await page.locator("#tools-scope").check();
  await page.locator("#build-review").click();
  await page.locator("#tool-spend-result").waitFor({ state: "visible" });
  assert((await page.locator("#bill-finding-title").innerText()).includes("$68.25"), "AI tool total did not reconcile.");
  assert((await page.locator("#bill-metric-ledger").innerText()).includes("$65.00"), "Subscriptions were not separated from extra usage.");
  assert((await page.locator("#bill-evidence-summary").innerText()).includes("no live sync"), "AI tool review suggests live data.");
  assert(await page.locator("#story-toggle").isHidden(), "Presentation view must be hidden for bill reviews.");
  // WebKit updates the root scroll area after closing a top-layer dialog.
  // Measure the settled page, while still failing a persistent overflow.
  await page.waitForFunction(() => document.documentElement.scrollWidth - window.innerWidth <= 1, null, { timeout: 3000 }).catch(() => {});
  const layout = await page.evaluate(() => ({
    viewport: window.innerWidth, page: document.documentElement.scrollWidth, bodyClass: document.body.className,
    overflowing: [...document.querySelectorAll("body *")].map((element) => ({
      tag: element.tagName, id: element.id, classes: String(element.className),
      right: Math.round(element.getBoundingClientRect().right), width: Math.round(element.getBoundingClientRect().width),
      scroll: element.scrollWidth, client: element.clientWidth,
    })).filter((element) => element.width > 0 && (element.right > window.innerWidth + 1 || element.scroll > element.client + 1)).slice(0, 16),
  }));
  assert(layout.page - layout.viewport <= 1, `${page.context().browser().browserType().name()}: AI tool review overflows horizontally: ${JSON.stringify(layout)}`);
  if (mobile) {
    const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    assert(a11y.violations.length === 0, `AI tool review accessibility violations: ${axeSummary(a11y)}`);
  }
  if (roundTrip) {
    const record = await saveJsonDownload(page, "#bill-save-next", "ai-tool-spend-review.json");
    assert(record.config.toolSpend.items.length === 3, "Saved review lost source references or charges.");
    await page.reload({ waitUntil: "networkidle" });
    const chooser = page.waitForEvent("filechooser");
    await page.locator("#open-review").click();
    await (await chooser).setFiles({ name: "ai-tool-spend-review.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(record)) });
    await page.locator("#tool-spend-result").waitFor({ state: "visible" });
    assert((await page.locator("#bill-finding-title").innerText()).includes("$68.25"), "Reopening changed the AI tool baseline.");
  }
  await page.locator("#edit-tool-review").click();
  assert(await page.locator("#tool-amount-1").inputValue() === "20" && await page.locator("#tool-source-3").inputValue() === "Separate usage charge", "Editing the tools baseline lost a charge or source reference.");
  await page.locator("#tool-amount-1").fill("25");
  assert(!(await page.locator("#tools-scope").isChecked()), "Changed charges retained the old scope confirmation.");
  await page.locator("#tools-scope").check();
  await page.locator("#build-review").click();
  assert((await page.locator("#bill-finding-title").innerText()).includes("$73.25"), "Editing one tool did not retain and recalculate the other charges.");
  await page.locator("#bill-compare-next").click();
  assert(await page.locator("#simple-builder-fields").isVisible(), "AI tool review did not open a tool comparison.");
  assert(await page.locator("#simple-current-cost").inputValue() === "", "Combined spending was silently allocated to a single tool.");
  await page.locator("#close-review").click();
}

async function verifyEditableComparison(page, { mobile = false } = {}) {
  if (mobile) await page.locator("#header-menu-toggle").click();
  await page.locator("#start-review").click();
  await page.locator('[data-builder-mode="simple"]').click();
  for (const [id, value] of Object.entries({
    "simple-current-name": "Plan A", "simple-other-name": "Plan B",
    "simple-current-cost": "80", "simple-other-cost": "40", "simple-monthly-tasks": "100",
    "simple-current-checked": "20", "simple-current-usable": "18", "simple-current-minutes": "60",
    "simple-other-checked": "20", "simple-other-usable": "16", "simple-other-minutes": "120",
    "simple-hourly-rate": "30", "simple-quality-floor": "75",
  })) await page.locator(`#${id}`).fill(value);
  await page.locator("#build-review").click();
  assert((await page.locator("#finding-title").innerText()).includes("Plan A has the lower estimated cost"), "The approval gate hid the cost finding.");
  assert((await page.locator("#simple-cost-finding").innerText()).includes("Plan A: $2.56. Plan B: $4.25."), "The result hero lost the calculated cost finding.");
  assert((await page.locator("#simple-switch-check").innerText()).includes("approval"), "The cost finding bypassed approval.");
  assert(!(await page.locator(".question-nav").isVisible()) && !(await page.locator(".mobile-section-picker").isVisible()), "Simple mode exposes unrelated opportunity or verification views.");
  if (!mobile) {
    for (const width of [1024, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert(await page.locator(".decision-table-wrap").first().evaluate((element) => element.scrollWidth <= element.clientWidth + 1), `The simple comparison table clips at ${width}px.`);
      assert(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 1, `The comparison overflows at ${width}px.`);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  assert((await page.locator("#decision-title").innerText()).includes("Confirm policy approval first"), "The cost finding bypassed approval.");
  await page.locator("#edit-simple-comparison").click();
  assert(await page.locator("#simple-current-cost").inputValue() === "80" && await page.locator("#simple-other-minutes").inputValue() === "120", "Editing replaced entered values.");
  await page.locator("#simple-other-usable").fill("21");
  const checkedHeight = (await page.locator("#simple-other-checked").boundingBox()).height;
  await page.locator("#build-review").click();
  assert((await page.locator("#simple-other-usable-error").innerText()).includes("greater than the number you checked"), "Invalid usable counts were accepted.");
  assert((await page.locator("#simple-other-usable-error").innerText()).includes("Plan B"), "The error does not identify the option.");
  assert(await page.locator("#simple-other-usable").getAttribute("aria-invalid") === "true", "The invalid field was not marked.");
  assert(await page.locator("#simple-other-usable").evaluate((element) => element === document.activeElement), "The error did not focus its field.");
  assert(Math.abs((await page.locator("#simple-other-checked").boundingBox()).height - checkedHeight) <= 1, "A neighboring field stretched when the error appeared.");
  await page.locator("#simple-other-usable").fill("16");
  assert(!(await page.locator("#simple-other-usable-error").isVisible()) && await page.locator("#simple-other-usable").getAttribute("aria-invalid") === "false", "The corrected field kept a stale error.");
  await page.locator("#build-review").click();
  if (mobile) await page.locator("#header-menu-toggle").click();
  const saved = await saveJsonDownload(page, "#download-review", "editable-comparison.json");
  assert(saved.baseline.costs.recurring_operating_cost === 230 && saved.proposed.costs.recurring_operating_cost === 340, "The saved comparison differs from independent arithmetic.");
  assert(saved.comparison.savings_claim_allowed === false, "A sample comparison claimed savings.");
  assert(saved.baseline.outcomes.ready_rate_interval_95 === null && saved.proposed.outcomes.ready_rate_interval_95 === null, "A user-selected sample exported a statistical interval.");
  assert(saved.comparison.finding.includes("Plan A has the lower estimated cost"), "The exported comparison lost its visible cost finding.");
  assert(saved.comparison.decision_code === "COMPARE ESTIMATES" && saved.comparison.finance_posture === "ESTIMATE ONLY", "The simple export retained a route-change verdict.");
  assert(saved.comparison.summary.cost_finding === await page.locator("#simple-cost-finding").innerText(), "The file and screen disagree on the cost finding.");
  assert(saved.comparison.normalized_cost_difference_context.includes("not the monthly cost change, cash savings"), "The normalized diagnostic has no financial boundary.");
  assert((await page.locator("#unit-economics-card").innerText()).includes("Time value at $30/hr"), "The result hides the time value behind its total.");
  await page.locator("#edit-simple-comparison").click();
  await page.locator("#simple-approved").check();
  await page.locator("#build-review").click();
  assert((await page.locator("#simple-switch-check").innerText()).includes("Approval: you confirmed"), "Confirmed approval disappeared from the result.");
  assert(await page.locator("#review-title").evaluate((element) => element === document.activeElement), "A completed comparison did not focus its result heading.");
  if (!mobile && page.context().browser().browserType().name() === "chromium") {
    await page.screenshot({ path: join(output, "comparison-followup.png") });
    await verifyFinanceMemoPdf(page, { simple: true });
  }
  await page.locator("#edit-simple-comparison").click();
  for (const [id, value] of Object.entries({
    "simple-current-cost": "0.24", "simple-other-cost": "0.16", "simple-monthly-tasks": "20",
    "simple-current-minutes": "0", "simple-other-minutes": "0", "simple-hourly-rate": "0",
  })) await page.locator(`#${id}`).fill(value);
  await page.locator("#build-review").click();
  for (const selector of ["#unit-economics-card", "#memo-table-body"]) {
    const text = await page.locator(selector).textContent();
    assert(text.includes("$0.24") && text.includes("$0.16"), `${selector} rounded a nonzero charge to zero.`);
  }
  await page.reload();
  await page.locator("#welcome-title").waitFor({ state: "visible" });
  if (mobile) await page.locator("#header-menu-toggle").click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.locator("#open-review").click();
  await (await chooserPromise).setFiles({ name: "editable-comparison.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(saved)) });
  await page.locator("#edit-simple-comparison").click();
  assert(await page.locator("#simple-monthly-tasks").inputValue() === "100" && !(await page.locator("#simple-approved").isChecked()), "Saved editor values or approval changed on reopen.");
  await page.locator("#close-review").click();
  assert(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 1, "Editable comparison caused horizontal overflow.");
}

async function verifyGuide(page, origin) {
  await page.goto(`${origin}/guide.html`);
  await page.getByRole("heading", { name: "Understand your AI costs. Start with what you have.", exact: true }).waitFor({ state: "visible" });
  assert((await page.locator(".guide table").innerText()).includes("$4.25"), "The worked example did not load.");
  assert(await page.locator(".guide").evaluate((element) => getComputedStyle(element).maxWidth !== "none"), "The guide stylesheet did not load.");
  assert(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 1, "The guide caused horizontal overflow.");
  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  assert(a11y.violations.length === 0, `Guide accessibility violations: ${axeSummary(a11y)}`);
  await page.getByRole("link", { name: "Open the tool", exact: true }).click();
  await page.locator("#welcome-title").waitFor({ state: "visible" });
}

async function priceAndUsageFlow(engineName, engine, origin) {
  const browser = await engine.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const observed = watchPage(page, origin);
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.locator("#welcome-title").waitFor({ state: "visible" });
  assert(!(await page.locator("#review-title").isVisible()), `${engineName}: the advanced example displaced the welcome screen.`);
  await page.locator("#start-review").click();
  await openAdvancedChoices(page);
  await page.locator('[data-builder-mode="usage"]').click();
  assert(await page.locator("#request-log-file").isVisible() && !(await page.locator("#request-analysis-results").isVisible()), `${engineName}: standalone usage did not start with its own empty input.`);
  for (const selector of ["#opportunity-summary", "#opportunity-workbench-list", "#download-review", ".question-nav", "#back-to-bill"]) {
    assert(!(await page.locator(selector).isVisible()), `${engineName}: standalone usage exposes an unrelated example or review action: ${selector}.`);
  }
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#welcome-example").click();
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
  assert(await page.locator(".builder-mode-choice > .builder-mode").count() === 3, `${engineName}: start dialog should show three everyday paths.`);
  assert(await page.locator('[data-builder-mode="tools"]').isVisible(), `${engineName}: AI tool review is missing from the primary choices.`);
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
  const sonnet = page.locator(".model-catalog-card").filter({ has: page.getByRole("link", { name: "Claude Sonnet 5", exact: true }) });
  const sonnetText = await sonnet.innerText();
  for (const expected of ["INPUT\n$2.00", "CACHED INPUT\n$0.20", "CACHE WRITE · 5 MIN\n$2.50", "OUTPUT\n$10.00"]) {
    assert(sonnetText.toUpperCase().includes(expected), `${engineName}: Claude Sonnet 5 card is missing ${expected.replace("\n", " ")}.`);
  }
  const currentRates = [
    ["GPT-6.1 Sol", ["INPUT\n$2.00", "CACHED INPUT\n$0.10", "CACHE WRITE\n$2.50", "OUTPUT\n$10.00"]],
    ["Claude Sonnet 5.5", ["INPUT\n$2.00", "CACHED INPUT\n$0.10", "CACHE WRITE · 5 MIN\n$2.50", "OUTPUT\n$10.00"]],
    ["Claude Haiku 5.5", ["INPUT\n$0.10", "CACHED INPUT\n$0.01", "CACHE WRITE · 5 MIN\n$0.125", "OUTPUT\n$0.50"]],
    ["Gemini 3.6 Flash", ["INPUT\n$0.75", "CACHED INPUT\n$0.075", "OUTPUT\n$3.75"]],
    ["Gemini 4 Argon", ["INPUT\n$2.00", "CACHED INPUT\n$0.10", "OUTPUT\n$10.00"]],
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
    const expectedCheck = name === "Gemini 4 Argon" ? "2026-10-18" : ["Claude Sonnet 5.5", "Claude Haiku 5.5", "Gemini 3.6 Flash"].includes(name) ? "2026-10-11" : "2026-10-05";
    assert(provenance.includes(`checked ${expectedCheck}`), `${engineName}: ${name} is missing its checked date: ${provenance}`);
  }
  for (const oldName of ["Gemini 3.5 Flash", "Gemini 3.7 Flash"]) {
    assert(await page.locator(".model-catalog-card").filter({ has: page.getByRole("link", { name: oldName, exact: true }) }).count() === 0,
      `${engineName}: deprecated ${oldName} is still a current catalog choice.`);
  }
  const haikuCard = page.locator(".model-catalog-card").filter({ has: page.getByRole("link", { name: "Claude Haiku 5.5", exact: true }) });
  assert((await haikuCard.innerText()).includes("over 100,000 input tokens per request"), `${engineName}: Haiku threshold is missing.`);
  assert((await haikuCard.innerText()).includes("1-hour cache write $1.00"), `${engineName}: Haiku long-context 1-hour cache write is missing.`);
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
  assert((await page.locator("#simple-example-caveat").innerText()).includes("came from your prompt estimate"), `${engineName}: Review handoff mislabeled estimate fields as a sample.`);
  await page.locator("#close-review").click();

  await page.locator("#price-prompt").click();
  await page.locator("#prompt-alt-2").selectOption("google/gemini-4-argon");
  await page.locator("#prompt-input-tokens").fill("20000");
  await page.locator("#calculate-prompt-price").click();
  await page.locator("#price-results").waitFor({ state: "visible" });
  const argonEstimate = await saveJsonDownload(page, "#download-price-estimate", `${engineName}-argon-estimate.json`);
  const argonResult = argonEstimate.comparison.find((result) => result.model_id === "google/gemini-4-argon");
  assert(argonResult?.rates_per_1m_tokens.input === 2 && argonResult.rates_per_1m_tokens.output === 10,
    `${engineName}: Argon estimate did not use the official introductory rates.`);
  assert(argonResult.estimated_annual_cost_usd === null && argonEstimate.evidence_gate.savings_claim_allowed === false,
    `${engineName}: Argon estimate crossed the rate boundary or allowed a savings claim.`);
  await page.locator("#close-price-prompt").click();
  await page.locator("#start-review").click();
  await page.locator('[data-builder-mode="simple"]').click();
  assert((await page.locator("#simple-example-caveat").innerText()).includes("Enter your own costs"),
    `${engineName}: a fresh comparison retained the prompt-estimate caveat.`);
  for (const selector of ["#simple-current-cost", "#simple-current-checked", "#simple-other-usable", "#simple-hourly-rate", "#simple-quality-floor"]) {
    assert(await page.locator(selector).inputValue() === "", `${engineName}: example numbers were prefilled as user inputs.`);
  }
  await page.locator("#close-review").click();

  await page.locator("#review-usage").click();
  await page.locator("#request-log-file").setInputFiles(fixture);
  await page.locator("#analyze-request-log").click();
  await page.locator("#request-analysis-results").waitFor({ state: "visible" });
  assert((await page.locator("#request-analysis-boundary").innerText()).toLowerCase().includes("do not prove realized savings"), `${engineName}: usage review lost its evidence boundary.`);
  const usage = await saveJsonDownload(page, "#download-usage-review", `${engineName}-usage-review.json`);
  assert(usage.event_count === 7, `${engineName}: usage import did not retain all seven rows.`);
  assert(usage.evidence_gate.savings_claim_allowed === false, `${engineName}: usage review allowed a savings claim.`);
  const gatewayRows = [
    { request_id: "gateway-1", startTime: "2026-10-09T12:00:00Z", model: "gpt-6-sol", model_group: "route-a",
      custom_llm_provider: "openai", team_id: "team-a", prompt_tokens: 100, completion_tokens: 20,
      spend: 0.2, metadata: { prompt: "private prompt" }, messages: { content: "private message" }, api_key: "private key" },
    { request_id: "gateway-2", startTime: "2026-10-09T12:01:00Z", model: "gpt-6-sol", model_group: "route-a",
      custom_llm_provider: "openai", prompt_tokens: 200, completion_tokens: 30, spend: 0.3 },
  ];
  await page.locator("#request-log-file").setInputFiles({
    name: "litellm-spend.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(gatewayRows)),
  });
  await page.locator("#request-billed-total").fill("0.60");
  await page.locator("#request-billed-currency").fill("USD");
  await page.locator("#request-bill-scope-confirmed").check();
  await page.locator("#analyze-request-log").click();
  await page.locator("#request-analysis-results").waitFor({ state: "visible" });
  const gateway = await saveJsonDownload(page, "#download-usage-review", `${engineName}-litellm-review.json`);
  assert(gateway.source.adapter.includes("LiteLLM") && gateway.event_count === 2, `${engineName}: LiteLLM adapter lost rows.`);
  assert(gateway.reconciliation.provider_reported_cost === null
    && gateway.reconciliation.bill.raw_selected_cost_difference === 0.1, `${engineName}: gateway spend was misclassified as invoice evidence.`);
  assert(gateway.evidence_gate.savings_claim_allowed === false, `${engineName}: gateway telemetry became a savings claim.`);
  assert(!JSON.stringify(gateway).includes("private"), `${engineName}: LiteLLM private fields entered the normalized export.`);
  const gatewayStack = await page.locator("#request-cost-stack").innerText();
  assert(gatewayStack.includes("GATEWAY SPEND ONLY") && gatewayStack.includes("Selected request cost")
    && gatewayStack.includes("LiteLLM-calculated gateway spend"), `${engineName}: gateway spend was mislabeled as provider billing.`);
  await page.locator("#request-log-file").setInputFiles({
    name: "litellm-page.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ data: gatewayRows.slice(0, 1), total: 2, page: 1, page_size: 1, total_pages: 2 })),
  });
  await page.locator("#analyze-request-log").click();
  await page.locator("#request-log-error.visible").waitFor({ state: "visible" });
  assert((await page.locator("#request-log-error").innerText()).includes("only part of the spend log"), `${engineName}: paginated LiteLLM file was accepted as complete.`);
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
  assert(issues.includes("3,") && issues.includes("4,"), `${engineName}: issue export lost source record numbers.`);
  assert((await page.locator("#request-analysis-boundary").innerText()).includes("valid rows only"), `${engineName}: scoped warning missing.`);
  const allBadLog = "event_id,provider_reported_cost,currency\nbad,oops,USD\n";
  await page.locator("#request-log-file").setInputFiles({ name: "all-bad.csv", mimeType: "text/csv", buffer: Buffer.from(allBadLog) });
  await page.locator("#analyze-request-log").click();
  await page.locator("#request-log-error.visible").waitFor({ state: "visible" });
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
    // Standalone usage intentionally hides the unrelated decision navigation.
    // Open an explicitly labeled example before checking the advanced archive.
    await page.locator("#start-review").click();
    await openAdvancedChoices(page);
    await page.locator('[data-builder-mode="example"]').click();
    await page.locator('[data-view="evidence"]').click();
    const workspace = await saveJsonDownload(page, "#download-workspace", "workspace-archive.json");
    assert(workspace.schema_version === "ai-cost-lens-workspace/1.0" && workspace.request_review?.event_count === 7 && workspace.customer_cost_to_serve?.analysis?.customers?.length, "Workspace archive lost imported request or customer analysis.");
  }

  const financeMemoPdf = engineName === "chromium" ? await verifyFinanceMemoPdf(page) : null;
  const savedReview = engineName === "chromium" ? await verifySavedReviewRoundTrip(page) : null;
  const rich_decisions = engineName === "chromium" ? await verifyRichDecisionFlow(page) : null;
  if (engineName === "chromium") await verifyOpenAIPartialBucket(page);
  if (engineName === "chromium") await verifyFictionalProjectCost(page);
  await verifyToolSpendFlow(page, { roundTrip: engineName === "chromium" });
  await page.locator("#start-review").click();
  await page.locator('[data-builder-mode="single"]').click();
  assert((await page.locator("#single-builder-fields .path-requirements").first().innerText()).includes("no file is required"), `${engineName}: bill-only path incorrectly requires a CSV.`);
  const detailedCsv = page.locator("#single-builder-fields details").filter({ hasText: "Have more detail?" });
  assert(!(await page.locator("#single-spend-file").isVisible()), `${engineName}: advanced CSV instructions obscure the manual bill entry.`);
  assert(!(await page.locator("#single-work-file").isVisible()), `${engineName}: optional outcome inputs obscure the manual bill entry.`);
  await detailedCsv.locator("summary").click();
  assert(await page.locator("#single-spend-file").isVisible(), `${engineName}: detailed CSV path cannot be opened.`);
  await detailedCsv.locator("summary").click();
  const outcomeDetails = page.locator("#single-builder-fields details").filter({ hasText: "Add outcome evidence" });
  await outcomeDetails.locator("summary").click();
  assert(await page.locator("#single-work-file").isVisible(), `${engineName}: optional outcome path cannot be opened.`);
  await outcomeDetails.locator("summary").click();
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
  await page.locator("#start-review").click();
  await page.locator('[data-builder-mode="single"]').click();
  await page.locator("#invoice-provider").fill("OpenAI");
  await page.locator("#invoice-workload").fill("Support summaries");
  await page.locator("#invoice-date").fill("2026-09-30");
  await page.locator("#invoice-period-start").fill("2026-09-01");
  await page.locator("#invoice-period-end").fill("2026-09-30");
  await page.locator("#invoice-amount").fill("90");
  await page.locator("#invoice-currency").fill("USD");
  await page.locator("#bill-history-input summary").click();
  await page.locator("#previous-bill-amount").fill("100");
  await page.locator("#previous-bill-date").fill("2026-08-30");
  await page.locator("#previous-bill-start").fill("2026-08-01");
  await page.locator("#previous-bill-end").fill("2026-08-30");
  await page.locator("#previous-bill-scope").check();
  await page.locator("#bill-budget-input summary").click();
  await page.locator("#bill-budget-amount").fill("80");
  await page.locator("#bill-budget-scope").check();
  await page.locator("#build-review").click();
  assert(await page.locator("#bill-history-result").isVisible(), `${engineName}: two-bill comparison is missing.`);
  const billTrend = await page.locator("#bill-history-result").innerText();
  assert(billTrend.includes("$100.00") && billTrend.includes("$90.00") && billTrend.includes("−$10.00") && billTrend.includes("10.0% lower"), `${engineName}: equal-period bill difference is incorrect: ${billTrend}`);
  assert(billTrend.includes("unverified") && billTrend.includes("does not explain why") && billTrend.includes("does not") && billTrend.includes("savings"), `${engineName}: a lower typed bill became a savings or causal claim.`);
  const budgetCheck = await page.locator("#bill-budget-result").innerText();
  assert(budgetCheck.includes("$80.00") && budgetCheck.includes("+$10.00") && budgetCheck.includes("112.5%") && budgetCheck.includes("not a live alert") && budgetCheck.includes("savings claim"), `${engineName}: same-period budget comparison is incorrect or misrepresented: ${budgetCheck}`);
  const budgetGuidance = await page.locator("#bill-opportunity-ledger").innerText();
  assert(budgetGuidance.includes("Investigate the entered budget overage") && !budgetGuidance.includes("set a monthly budget"), `${engineName}: next steps ignored the entered budget.`);
  if (engineName === "chromium") {
    const savedTrend = await saveJsonDownload(page, "#download-review", "two-bill-review.json");
    assert(savedTrend.config.previousBill.amount === "100" && savedTrend.config.previousBill.sameScope === true && savedTrend.config.billBudget.amount === "80", "Two-bill and budget raw inputs were not saved for recomputation.");
    await page.locator("#start-review").click();
    await page.locator('[data-builder-mode="single"]').click();
    await page.locator("#invoice-provider").fill("OpenAI");
    await page.locator("#invoice-workload").fill("Support summaries");
    await page.locator("#invoice-date").fill("2026-09-30");
    await page.locator("#invoice-period-start").fill("2026-09-01");
    await page.locator("#invoice-period-end").fill("2026-09-30");
    await page.locator("#invoice-amount").fill("90");
    await page.locator("#invoice-currency").fill("USD");
    await page.locator("#bill-history-input summary").click();
    await page.locator("#previous-bill-amount").fill("100");
    await page.locator("#previous-bill-date").fill("2026-08-31");
    await page.locator("#previous-bill-start").fill("2026-08-01");
    await page.locator("#previous-bill-end").fill("2026-08-31");
    await page.locator("#previous-bill-scope").check();
    await page.locator("#build-review").click();
    assert(!(await page.locator("#bill-budget-result").isVisible()), "A previous budget persisted into a new bill review.");
    const unequalTrend = await page.locator("#bill-history-result").innerText();
    const unequalLabels = await page.locator("#bill-history-metrics .metric-cell span").allTextContents();
    assert(/different lengths/i.test(unequalTrend) && /calendar-day reference/i.test(unequalTrend) && /fixed monthly plans/i.test(unequalTrend) && !unequalLabels.some((label) => label.trim().toLowerCase() === "bill change"), `Unequal service periods were presented as a like-for-like change or lacked the daily caveat: ${unequalTrend}`);
  }
  await verifyEditableComparison(page);
  await verifyGuide(page, origin);
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
  await page.locator("#welcome-title").waitFor({ state: "visible" });
  const welcomeA11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  assert(welcomeA11y.violations.length === 0, `mobile welcome accessibility violations: ${axeSummary(welcomeA11y)}`);
  for (const selector of ["#welcome-compare", "#welcome-spending", "#header-menu-toggle"]) {
    assert((await page.locator(selector).boundingBox()).height >= 44, `mobile touch target is shorter than 44px: ${selector}.`);
  }
  await page.locator("#welcome-example").click();

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
  await page.locator("#close-price-prompt").click();
  await verifyToolSpendFlow(page, { mobile: true });
  await verifyEditableComparison(page, { mobile: true });
  await verifyGuide(page, origin);

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
