import { resolve } from "node:path";
import { chromium } from "playwright";

const origin = "https://lens.cloudandcapital.com";
const fixture = resolve("tests/fixtures/request-events-multi-provider.csv");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const requests = [];
const errors = [];
const marker = "FICTIONAL_NETWORK_CHECK_20261018";

page.on("request", (request) => {
  const url = request.url();
  if (!/^https?:/i.test(url)) return;
  const parsed = new URL(url);
  requests.push({
    origin: parsed.origin,
    method: request.method(),
    type: request.resourceType(),
    containsMarker: url.includes(marker) || Boolean(request.postData()?.includes(marker)),
  });
});
page.on("pageerror", (error) => errors.push(error.message));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function settle() {
  await page.waitForLoadState("networkidle");
}

try {
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.locator("#review-title").waitFor({ state: "visible" });
  await page.locator("#price-prompt").click();
  assert((await page.locator("#prompt-catalog-stamp").innerText()).includes("Catalog 2026-10-18"),
    "Production is not serving the expected catalog.");
  await page.locator("#prompt-text").fill(marker);
  await page.locator("#prompt-input-tokens").fill("20000");
  await page.locator("#prompt-output-tokens").fill("500");
  await page.locator("#prompt-calls").fill("1000");
  await page.locator("#prompt-cache-share").fill("25");
  await page.locator("#prompt-alt-1").selectOption("google/gemini-4-argon");
  await page.locator("#calculate-prompt-price").click();
  await page.locator("#price-results").waitFor({ state: "visible" });
  const argon = page.locator("#price-result-rows tr").filter({ hasText: "Gemini 4 Argon" });
  assert((await argon.innerText()).includes("$35.50"), "Production Argon calculation differs from the expected fictional scenario.");
  assert((await page.locator("#price-results").innerText()).includes("ESTIMATED · NOT A SAVINGS CLAIM"),
    "Production price result lost its estimate boundary.");
  await settle();
  const afterPricing = requests.length;

  const [estimateDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#download-price-estimate").click(),
  ]);
  assert(estimateDownload.suggestedFilename().endsWith(".json"), "Estimate JSON download failed.");
  await page.locator("#send-price-to-review").click();
  await page.locator("#review-dialog").waitFor({ state: "visible" });
  assert((await page.locator("#simple-example-caveat").innerText()).includes("came from your prompt estimate"),
    "Review handoff lost estimate provenance.");
  assert(await page.locator("#simple-current-checked").inputValue() === "", "Estimate was treated as quality evidence.");
  await page.locator("#close-review").click();
  await settle();
  const afterReview = requests.length;

  await page.locator("#review-usage").click();
  await page.locator("#request-log-file").setInputFiles(fixture);
  await page.locator("#analyze-request-log").click();
  await page.locator("#request-analysis-results").waitFor({ state: "visible" });
  const [usageDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#download-usage-review").click(),
  ]);
  assert(usageDownload.suggestedFilename().endsWith(".json"), "Usage JSON download failed.");
  await settle();

  const external = requests.filter((request) => request.origin !== origin);
  const outbound = requests.filter((request) => !["GET", "HEAD"].includes(request.method));
  const markerSent = requests.some((request) => request.containsMarker);
  assert(external.length === 0, `Production made ${external.length} external requests to ${[...new Set(external.map((request) => request.origin))].join(", ")}.`);
  assert(outbound.length === 0, `Production made ${outbound.length} non-read requests.`);
  assert(!markerSent, "Fictional prompt marker appeared in a network request.");
  assert(errors.length === 0, `Production page errors: ${errors.join(" | ")}`);

  process.stdout.write(`${JSON.stringify({
    result: "passed",
    origin,
    catalog: "2026-10-18",
    flows: ["load", "price-prompt", "review-handoff", "fictional-csv-import", "json-exports"],
    request_counts: {
      load_and_pricing: afterPricing,
      review_handoff: afterReview - afterPricing,
      import_and_exports: requests.length - afterReview,
      external: external.length,
      non_read: outbound.length,
      prompt_marker_sent: markerSent,
    },
    page_errors: errors.length,
  }, null, 2)}\n`);
} finally {
  await browser.close();
}
