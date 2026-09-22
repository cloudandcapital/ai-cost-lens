import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { chromium, firefox, webkit } from "playwright";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const build = join(root, "build");
const fixture = join(root, "tests", "fixtures", "request-events-multi-provider.csv");
const output = await mkdtemp(join(tmpdir(), "ai-cost-lens-browser-check-"));

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

  assert(observed.egress.length === 0, `${engineName}: observed external requests: ${observed.egress.join(", ")}`);
  assert(observed.errors.length === 0, `${engineName}: browser errors: ${observed.errors.join(" | ")}`);
  await browser.close();
  return { engine: engineName, prompt_routes: estimate.comparison.length, usage_rows: usage.event_count, egress: 0 };
}

async function mobileAndAccessibility(origin) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
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
  assert(overviewA11y.violations.length === 0, `mobile overview accessibility violations: ${overviewA11y.violations.map((item) => item.id).join(", ")}`);

  await page.locator("#header-menu-toggle").click();
  await page.locator("#price-prompt").click();
  const priceA11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  assert(priceA11y.violations.length === 0, `mobile pricing accessibility violations: ${priceA11y.violations.map((item) => item.id).join(", ")}`);

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
