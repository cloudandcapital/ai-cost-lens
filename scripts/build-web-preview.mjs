import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const web = resolve(root, "web");

let html = await readFile(resolve(web, "index.html"), "utf8");
const css = await readFile(resolve(web, "styles.css"), "utf8");
const data = await readFile(
  resolve(web, "data", "illustrative-review-result.json"),
  "utf8",
);
const spendTemplate = await readFile(
  resolve(web, "templates", "ai-cost-lens-spend-template.csv"),
);
const workTemplate = await readFile(
  resolve(web, "templates", "ai-cost-lens-work-log-template.csv"),
);
let app = await readFile(resolve(web, "app.js"), "utf8");

const loaderPattern =
  /  \/\* AI_COST_LENS_DEMO_LOADER_START \*\/[\s\S]*?  \/\* AI_COST_LENS_DEMO_LOADER_END \*\//;
if (!loaderPattern.test(app)) {
  throw new Error("Could not find the demo loader markers in web/app.js");
}

app = app.replace(
  loaderPattern,
  `  state.data = ${data.trim()};\n  state.demoData = cloneData(state.data);\n  renderAll();`,
);
html = html
  .replace('<link rel="stylesheet" href="styles.css" />', `<style>${css}</style>`)
  .replaceAll(
    'href="templates/ai-cost-lens-spend-template.csv"',
    `href="data:text/csv;base64,${spendTemplate.toString("base64")}"`,
  )
  .replaceAll(
    'href="templates/ai-cost-lens-work-log-template.csv"',
    `href="data:text/csv;base64,${workTemplate.toString("base64")}"`,
  )
  .replace('<script src="app.js"></script>', `<script>${app}</script>`);

await writeFile(resolve(web, "preview.html"), html, "utf8");
console.log("Built web/preview.html");
