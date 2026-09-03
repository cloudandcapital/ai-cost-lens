import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const web = resolve(root, "web");
const recordPath = resolve(
  root,
  "examples",
  "decision-records",
  "openai-model-route-002.json",
);

let html = await readFile(resolve(web, "model-route-decision.html"), "utf8");
const css = await readFile(resolve(web, "model-route-decision.css"), "utf8");
const record = JSON.parse(await readFile(recordPath, "utf8"));
if (record.schema_version !== "ai-cost-lens-decision-record/0.1") {
  throw new Error("The bundled decision record does not use the expected schema.");
}
const data = `window.AI_COST_LENS_MODEL_ROUTE_DECISION = ${JSON.stringify(record, null, 2)};\n`;
const app = await readFile(resolve(web, "model-route-decision.js"), "utf8");

await writeFile(resolve(web, "data", "model-route-decision-v1.js"), data, "utf8");

html = html
  .replace('<link rel="stylesheet" href="model-route-decision.css" />', `<style>${css}</style>`)
  .replace('<script src="data/model-route-decision-v1.js"></script>', `<script>${data}</script>`)
  .replace('<script src="model-route-decision.js"></script>', `<script>${app}</script>`);

await writeFile(resolve(web, "model-route-decision-preview.html"), html, "utf8");
console.log("Built decision data and web/model-route-decision-preview.html");
