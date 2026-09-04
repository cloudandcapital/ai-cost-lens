import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(root, "examples", "synthetic-cases");
await mkdir(target, { recursive: true });

const spendHeader = "period,date,workload,provider,model,route,requests,input_tokens,cached_input_tokens,cache_write_input_tokens,output_tokens,provider_cost,currency";
const workHeader = "period,result_id,outcome_status,human_minutes";
const workload = "Customer due diligence case summaries";

function spendCsv(proposedCost) {
  return [
    spendHeader,
    `baseline,2026-07-31,${workload},Model API,Current reasoning model,Current production route,1000,120000000,20000000,0,8000000,100000,USD`,
    `proposed,2026-08-31,${workload},Model API,Smaller routed model,Proposed production route,1000,105000000,50000000,0,7000000,${proposedCost},USD`,
    "",
  ].join("\n");
}

function outcomeRows(period, counts, minutes) {
  const rows = [];
  let index = 1;
  for (const [status, count] of Object.entries(counts)) {
    for (let item = 0; item < count; item += 1) {
      rows.push(`${period},${period.slice(0, 1)}-${String(index).padStart(4, "0")},${status},${minutes[status]}`);
      index += 1;
    }
  }
  return rows;
}

const baselineCounts = { ready_to_use: 940, needs_correction: 50, needs_escalation: 10 };
const baselineMinutes = { ready_to_use: 3, needs_correction: 25, needs_escalation: 90 };

const falseEconomyRows = [
  workHeader,
  ...outcomeRows("baseline", baselineCounts, baselineMinutes),
  ...outcomeRows(
    "proposed",
    { ready_to_use: 750, needs_correction: 180, needs_escalation: 70 },
    { ready_to_use: 4, needs_correction: 60, needs_escalation: 180 },
  ),
  "",
].join("\n");

const trueSavingsRows = [
  workHeader,
  ...outcomeRows("baseline", baselineCounts, baselineMinutes),
  ...outcomeRows(
    "proposed",
    { ready_to_use: 950, needs_correction: 40, needs_escalation: 10 },
    { ready_to_use: 1, needs_correction: 10, needs_escalation: 30 },
  ),
  "",
].join("\n");

const baseConfig = {
  acceptanceRule: "Accurate against the source record, evidence cited, and no material rewrite required",
  verifier: "Independent operations quality review",
  qualityFloor: 0.9,
  hourlyRate: 120,
  baselinePolicyApproved: true,
  proposedPolicyApproved: true,
  baselineShared: 25000,
  proposedShared: 25000,
  changeCost: 0,
  outcomeLogComplete: true,
};

const cases = [
  ["false-economy-spend.csv", spendCsv(35000)],
  ["false-economy-outcomes.csv", falseEconomyRows],
  ["false-economy-config.json", JSON.stringify(baseConfig, null, 2) + "\n"],
  ["true-savings-spend.csv", spendCsv(55000)],
  ["true-savings-outcomes.csv", trueSavingsRows],
  [
    "true-savings-config.json",
    JSON.stringify({ ...baseConfig, proposedShared: 22000, changeCost: 150000 }, null, 2) + "\n",
  ],
  ["policy-gate-config.json", JSON.stringify({ ...baseConfig, proposedPolicyApproved: false }, null, 2) + "\n"],
  ["weak-sample-spend.csv", spendCsv(35000)],
  [
    "weak-sample-inputs.json",
    JSON.stringify(
      {
        samples: {
          baseline: { population: 100000, ready: 376, correction: 20, escalation: 4, humanMinutes: 856 },
          proposed: { population: 100000, ready: 38, correction: 2, escalation: 0, humanMinutes: 52 },
        },
        config: {
          ...baseConfig,
          baselineShared: 25000,
          proposedShared: 25000,
          sampleRandom: false,
        },
      },
      null,
      2,
    ) + "\n",
  ],
];

for (const [name, contents] of cases) {
  await writeFile(resolve(target, name), contents, "utf8");
}

console.log(`Wrote ${cases.length} synthetic case files to ${target}`);
