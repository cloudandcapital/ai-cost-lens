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

async function verifyFinanceMemoPdf(page) {
  await page.locator("#start-review").click();
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
  for (const expected of ["ai spend decision memo", "the other option does not meet", "provider cost", "cost per ready result", "what finance can rely on", "current cost vs plan", "proposed monthly scenario", "not booked savings", "not supported"]) {
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

async function verifyOpenAIPartialBucket(page) {
  const fixtureDir = join(root, "tests", "fixtures");
  const usage = (await readFile(join(fixtureDir, "openai-dashboard-usage.csv"), "utf8"))
    .replaceAll("1788307200,1788393600", "1788310800,1788393600");
  await page.locator("#start-review").click();
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
  for (const expected of ["INPUT\n$2", "CACHED INPUT\n$0.20", "CACHE WRITE · 5M\n$2.5", "OUTPUT\n$10"]) {
    assert(sonnetText.toUpperCase().includes(expected), `${engineName}: Claude Sonnet 5 card is missing ${expected.replace("\n", " ")}.`);
  }
  const currentRates = [
    ["GPT-6 Sol", ["INPUT\n$2", "CACHED INPUT\n$0.20", "CACHE WRITE\n$2.5", "OUTPUT\n$10"]],
    ["GPT-6 Luna", ["INPUT\n$0.10", "CACHED INPUT\n$0.01", "CACHE WRITE\n$0.125", "OUTPUT\n$0.50"]],
    ["Claude Opus 5.5", ["INPUT\n$4", "CACHED INPUT\n$0.20", "CACHE WRITE · 5M\n$5", "OUTPUT\n$20"]],
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

  const estimate = await saveJsonDownload(page, "#download-price-estimate", `${engineName}-prompt-estimate.json`);
  assert(estimate.schema_version === "ai-cost-lens-prompt-price-estimate/0.6", `${engineName}: prompt estimate schema is wrong.`);
  assert(estimate.evidence_gate.savings_claim_allowed === false, `${engineName}: prompt estimate allowed a savings claim.`);
  assert(estimate.comparison.length === 3, `${engineName}: prompt estimate lost a route.`);

  await page.locator("#send-price-to-review").click();
  assert(await page.locator("#review-dialog").evaluate((dialog) => dialog.open), `${engineName}: Review handoff did not open.`);
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

  const financeMemoPdf = engineName === "chromium" ? await verifyFinanceMemoPdf(page) : null;
  const savedReview = engineName === "chromium" ? await verifySavedReviewRoundTrip(page) : null;
  if (engineName === "chromium") await verifyOpenAIPartialBucket(page);
  assert(observed.egress.length === 0, `${engineName}: observed external requests: ${observed.egress.join(", ")}`);
  assert(observed.errors.length === 0, `${engineName}: browser errors: ${observed.errors.join(" | ")}`);
  await browser.close();
  return { engine: engineName, prompt_routes: estimate.comparison.length, usage_rows: usage.event_count, finance_memo_pdf: financeMemoPdf, saved_review_reopened: savedReview, egress: 0 };
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

  await page.locator("#header-menu-toggle").click();
  assert(await page.locator("#header-actions").isVisible(), "mobile: action menu did not open.");
  assert(await page.locator("#header-actions button").count() === 7, "mobile: action menu lost a workflow.");
  await page.locator("#header-menu-toggle").click();
  await page.locator("#mobile-section-nav").selectOption("verify");
  await page.locator("#view-verify").waitFor({ state: "visible" });

  await page.locator("#mobile-section-nav").selectOption("review");
  const overviewA11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  assert(overviewA11y.violations.length === 0, `mobile overview accessibility violations: ${axeSummary(overviewA11y)}`);

  await page.locator("#header-menu-toggle").click();
  await page.locator("#price-prompt").click();
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
