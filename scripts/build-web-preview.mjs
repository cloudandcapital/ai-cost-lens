import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOpenAITokenizer } from "./build-openai-tokenizer.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const web = resolve(root, "web");

await buildOpenAITokenizer();

let html = await readFile(resolve(web, "index.html"), "utf8");
const css = await readFile(resolve(web, "styles.css"), "utf8");
const welcomeArt = await readFile(resolve(web, "brand/ai-cost-lens-optic-v2.png"));
const startArrow = await readFile(resolve(web, "brand/arrow-right.svg"));
let designerCSS = await readFile(resolve(web, "designer.css"), "utf8");
for (const font of [
  "cormorant-garamond-latin-400-normal.woff2",
  "cormorant-garamond-latin-400-italic.woff2",
  "jost-latin-400-normal.woff2",
  "jost-latin-500-normal.woff2",
  "jost-latin-700-normal.woff2",
]) {
  const bytes = await readFile(resolve(web, "brand/fonts", font));
  designerCSS = designerCSS.replaceAll(`url("brand/fonts/${font}")`, `url("data:font/woff2;base64,${bytes.toString("base64")}")`);
}
const brandWordmark = await readFile(resolve(web, "brand/cloud-and-capital-wordmark.png"));
const data = await readFile(
  resolve(web, "data", "illustrative-review-result.json"),
  "utf8",
);
const growthData = await readFile(
  resolve(web, "data", "startup-growth-review-result.json"),
  "utf8",
);
const spendTemplate = await readFile(
  resolve(web, "templates", "ai-cost-lens-spend-template.csv"),
);
const workTemplate = await readFile(
  resolve(web, "templates", "ai-cost-lens-work-log-template.csv"),
);
const requestLogTemplate = await readFile(
  resolve(web, "templates", "ai-cost-lens-request-log-template.csv"),
);
const verificationTemplate = await readFile(
  resolve(web, "templates", "ai-cost-lens-verification-template.csv"),
);
const verificationExample = await readFile(resolve(web, "templates", "ai-cost-lens-verification-example.csv"));
let app = await readFile(resolve(web, "app.js"), "utf8");
const pricingCatalog = await readFile(
  resolve(web, "data", "pricing-catalog-v0.5.js"),
  "utf8",
);
const pricingEngine = await readFile(resolve(web, "pricing-engine.js"), "utf8");
const opportunityEngine = await readFile(resolve(web, "opportunity-engine.js"), "utf8");
const usageEventEngine = await readFile(resolve(web, "usage-event-engine.js"), "utf8");
const verificationEngine = await readFile(resolve(web, "verification-engine.js"), "utf8");
const experimentEngine = await readFile(resolve(web, "experiment-engine.js"), "utf8");
const experimentUI = await readFile(resolve(web, "experiment-ui.js"), "utf8");
const scenarioEngine = await readFile(resolve(web, "scenario-engine.js"), "utf8");
const actualsEngine = await readFile(resolve(web, "actuals-engine.js"), "utf8");
const growthEngine = await readFile(resolve(web, "growth-engine.js"), "utf8");
const evidenceTools = await readFile(resolve(web, "evidence-tools.js"), "utf8");
const customerEconomics = await readFile(resolve(web, "customer-economics-engine.js"), "utf8");
const customerRevenueTemplate = await readFile(resolve(web, "templates", "ai-cost-lens-customer-revenue-template.csv"));

const loaderPattern =
  /  \/\* AI_COST_LENS_DEMO_LOADER_START \*\/[\s\S]*?  \/\* AI_COST_LENS_DEMO_LOADER_END \*\//;
if (!loaderPattern.test(app)) {
  throw new Error("Could not find the demo loader markers in web/app.js");
}

app = app.replace(
  loaderPattern,
  `  state.data = ${data.trim()};\n  state.demoData = cloneData(state.data);\n  state.growthDemoData = ${growthData.trim()};\n  renderAll();`,
);
html = html
  .replace('src="brand/ai-cost-lens-optic-v2.png"', () => `src="data:image/png;base64,${welcomeArt.toString("base64")}"`)
  .replaceAll('src="brand/arrow-right.svg"', () => `src="data:image/svg+xml;base64,${startArrow.toString("base64")}"`)
  .replace('<link rel="stylesheet" href="styles.css" />', () => `<style>${css}</style>`)
  .replace('<link rel="stylesheet" href="designer.css" />', () => `<style>${designerCSS}</style>`)
  .replaceAll(
    'href="templates/ai-cost-lens-spend-template.csv"',
    `href="data:text/csv;base64,${spendTemplate.toString("base64")}"`,
  )
  .replaceAll(
    'href="templates/ai-cost-lens-work-log-template.csv"',
    `href="data:text/csv;base64,${workTemplate.toString("base64")}"`,
  )
  .replaceAll(
    'href="templates/ai-cost-lens-request-log-template.csv"',
    `href="data:text/csv;base64,${requestLogTemplate.toString("base64")}"`,
  )
  .replaceAll(
    'href="templates/ai-cost-lens-verification-template.csv"',
    `href="data:text/csv;base64,${verificationTemplate.toString("base64")}"`,
  )
  .replaceAll('href="templates/ai-cost-lens-verification-example.csv"', `href="data:text/csv;base64,${verificationExample.toString("base64")}"`)
  .replaceAll('href="templates/ai-cost-lens-customer-revenue-template.csv"', `href="data:text/csv;base64,${customerRevenueTemplate.toString("base64")}"`)
  .replace('<script src="data/pricing-catalog-v0.5.js"></script>', () => `<script>${pricingCatalog}</script>`)
  .replace('<script src="pricing-engine.js"></script>', () => `<script>${pricingEngine}</script>`)
  .replace('<script src="opportunity-engine.js"></script>', () => `<script>${opportunityEngine}</script>`)
  .replace('<script src="usage-event-engine.js"></script>', () => `<script>${usageEventEngine}</script>`)
  .replace('<script src="verification-engine.js"></script>', () => `<script>${verificationEngine}</script>`)
  .replace('<script src="experiment-engine.js"></script>', () => `<script>${experimentEngine}</script>`)
  .replace('<script src="experiment-ui.js"></script>', () => `<script>${experimentUI}</script>`)
  .replace('<script src="scenario-engine.js"></script>', () => `<script>${scenarioEngine}</script>`)
  .replace('<script src="actuals-engine.js"></script>', () => `<script>${actualsEngine}</script>`)
  .replace('<script src="growth-engine.js"></script>', () => `<script>${growthEngine}</script>`)
  .replace('<script src="evidence-tools.js"></script>', () => `<script>${evidenceTools}</script>`)
  .replace('<script src="customer-economics-engine.js"></script>', () => `<script>${customerEconomics}</script>`)
  .replace('<script src="app.js"></script>', () => `<script>${app}</script>`)
  .replaceAll('src="brand/cloud-and-capital-wordmark.png"', `src="data:image/png;base64,${brandWordmark.toString("base64")}"`);

if (!html.includes(`<script>${app}</script>`)) {
  throw new Error("The browser application was not embedded byte-for-byte.");
}

await writeFile(resolve(web, "preview.html"), html, "utf8");
console.log("Built web/preview.html");
