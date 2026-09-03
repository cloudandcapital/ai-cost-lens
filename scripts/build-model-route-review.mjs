import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const result = { experiment: "openai-model-route-002" };
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(
        "Expected --baseline DIR --proposed DIR [--experiment ID] [--baseline-charge USD] [--proposed-charge USD]",
      );
    }
    const name = key.slice(2);
    result[name] = ["baseline", "proposed"].includes(name) ? resolve(value) : value;
  }
  if (!result.baseline || !result.proposed) {
    throw new Error("Both --baseline and --proposed evidence directories are required");
  }
  if (!/^openai-model-route-\d{3}$/.test(result.experiment)) {
    throw new Error("The experiment identifier is invalid");
  }
  for (const name of ["baseline-charge", "proposed-charge"]) {
    if (result[name] !== undefined) {
      const value = Number(result[name]);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`${name} must be a finite non-negative USD amount`);
      }
      result[name] = value;
    }
  }
  return result;
}

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function parsedResponses(directory) {
  const files = (await readdir(resolve(directory, "parsed")))
    .filter((name) => name.endsWith(".json"))
    .sort();
  return Object.fromEntries(
    await Promise.all(
      files.map(async (name) => {
        const response = await json(resolve(directory, "parsed", name));
        return [response.case_id, response];
      }),
    ),
  );
}

function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} does not match across routes`);
  }
}

const args = parseArgs(process.argv.slice(2));
const experimentDir = resolve(root, "experiments", args.experiment);
const casesDocument = await json(resolve(experimentDir, "cases.json"));
const baselineSummary = await json(resolve(args.baseline, "summary.json"));
const proposedSummary = await json(resolve(args.proposed, "summary.json"));
const baselineResponses = await parsedResponses(args.baseline);
const proposedResponses = await parsedResponses(args.proposed);

assertEqual(baselineSummary.source_hashes, proposedSummary.source_hashes, "Source hashes");
assertEqual(baselineSummary.experiment_id, proposedSummary.experiment_id, "Experiment ID");
const expectedResponses = casesDocument.cases.length;
if (
  baselineSummary.request_count !== expectedResponses ||
  proposedSummary.request_count !== expectedResponses
) {
  throw new Error(
    `${args.experiment} requires exactly ${expectedResponses} completed responses per route`,
  );
}
if (baselineSummary.automatic_retries !== 0 || proposedSummary.automatic_retries !== 0) {
  throw new Error("Pilot 002 review packet cannot include automatically retried runs");
}

const legacyCharges =
  args.experiment === "openai-model-route-002"
    ? { baseline: 0.065008, proposed: 0.0037392 }
    : { baseline: null, proposed: null };
const routes = {
  baseline: {
    role: "Baseline route",
    model: baselineSummary.model,
    input_tokens: baselineSummary.results.reduce(
      (sum, result) => sum + result.usage.input_tokens,
      0,
    ),
    output_tokens: baselineSummary.results.reduce(
      (sum, result) => sum + result.usage.output_tokens,
      0,
    ),
    estimated_token_charge: args["baseline-charge"] ?? legacyCharges.baseline,
  },
  proposed: {
    role: "Proposed lower-priced route",
    model: proposedSummary.model,
    input_tokens: proposedSummary.results.reduce(
      (sum, result) => sum + result.usage.input_tokens,
      0,
    ),
    output_tokens: proposedSummary.results.reduce(
      (sum, result) => sum + result.usage.output_tokens,
      0,
    ),
    estimated_token_charge: args["proposed-charge"] ?? legacyCharges.proposed,
  },
};

const digest = (value) => createHash("sha256").update(value).digest("hex");
const reviewSeed =
  args.experiment === "openai-model-route-002"
    ? "pilot-002-review-v1"
    : `${args.experiment}-review-v1`;
const caseOrder = [...casesDocument.cases].sort((left, right) =>
  digest(`${reviewSeed}:${left.case_id}`).localeCompare(
    digest(`${reviewSeed}:${right.case_id}`),
  ),
);

const orderedPairs = [];
caseOrder.forEach((caseData, index) => {
  orderedPairs.push({
    caseData,
    routeKey: index % 2 === 0 ? "baseline" : "proposed",
  });
});
caseOrder.forEach((caseData, index) => {
  orderedPairs.push({
    caseData,
    routeKey: index % 2 === 0 ? "proposed" : "baseline",
  });
});

const items = orderedPairs.map(({ caseData, routeKey }, index) => {
  const response =
    routeKey === "baseline"
      ? baselineResponses[caseData.case_id]
      : proposedResponses[caseData.case_id];
  if (!response) throw new Error(`Missing ${routeKey} response for ${caseData.case_id}`);
  return {
    item_id: `review-${String(index + 1).padStart(2, "0")}`,
    response_label: `RESPONSE ${String(index + 1).padStart(2, "0")}`,
    case_id: caseData.case_id,
    route_key: routeKey,
    decision_question: caseData.decision_question,
    situation: caseData.situation,
    claims: caseData.claims,
    claim_labels: Object.fromEntries(
      caseData.claims.map((claim) => [claim.claim_id, claim.text]),
    ),
    response,
  };
});

const packet = {
  schema_version: "ai-cost-lens-human-review-packet/1.0",
  packet_id:
    args.experiment === "openai-model-route-002"
      ? "openai-model-route-002-human-review-v2"
      : `${args.experiment}-human-review-v1`,
  experiment_id: baselineSummary.experiment_id,
  case_count: expectedResponses,
  response_count: expectedResponses * 2,
  source_hashes: baselineSummary.source_hashes,
  route_names_hidden_until_complete: true,
  routes,
  items,
};

const serialized = JSON.stringify(packet, null, 2).replaceAll("<", "\\u003c");
const dataScript = `window.AI_COST_LENS_REVIEW_PACKET = ${serialized};\n`;
const web = resolve(root, "web");
await writeFile(resolve(web, "data", "model-route-review-packet.js"), dataScript, "utf8");

let html = await readFile(resolve(web, "model-route-review.html"), "utf8");
const css = await readFile(resolve(web, "model-route-review.css"), "utf8");
const app = await readFile(resolve(web, "model-route-review.js"), "utf8");
html = html
  .replace('<link rel="stylesheet" href="model-route-review.css" />', `<style>${css}</style>`)
  .replace('<script src="data/model-route-review-packet.js"></script>', `<script>${dataScript}</script>`)
  .replace('<script src="model-route-review.js"></script>', `<script>${app}</script>`);
await writeFile(resolve(web, "model-route-review-preview.html"), html, "utf8");

console.log("Built web/data/model-route-review-packet.js");
console.log("Built web/model-route-review-preview.html");
