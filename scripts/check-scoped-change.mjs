import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const engine = require("../web/usage-event-engine.js");
const fixture = JSON.parse(readFileSync(new URL("../tests/fixtures/scoped-change-two-window.json", import.meta.url), "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));
const build = (rows = fixture.rows, options = {}) => engine.buildReview(rows, {
  catalog: fixture.catalog, period_complete_confirmed: true, generated_at: "2026-11-15T17:00:00Z", ...options,
});
const close = (actual, expected) => assert(Math.abs(actual - expected) < 0.000000011, `${actual} != ${expected}`);
const fields = ["starting_cost", "ending_cost", "request_volume_effect", "verified_official_rate_effect", "usage_and_mix_effect", "unsupported_or_unproven_residual"];
const checks = [];
const records = {};
function check(name, run) { run(); checks.push(name); }
function reconciles(scoped) {
  assert.notEqual(scoped.status, "NOT_SUPPORTED", scoped.limitations.join("; "));
  for (const field of fields) if (scoped.totals[field] !== null) close(scoped.groups.reduce((sum, group) => sum + group[field], 0), scoped.totals[field]);
  for (const group of [...scoped.groups, ...scoped.display.rows]) {
    close(group.starting_cost + group.request_volume_effect + (group.verified_official_rate_effect ?? 0) + (group.usage_and_mix_effect ?? 0) + group.unsupported_or_unproven_residual, group.ending_cost);
    close(group.ending_cost - group.starting_cost, group.change);
  }
  assert.equal(scoped.groups.reduce((sum, group) => sum + group.prior_requests, 0), scoped.prior_period.requests);
  assert.equal(scoped.groups.reduce((sum, group) => sum + group.current_requests, 0), scoped.current_period.requests);
  for (const field of [...fields, "change"]) if (scoped.display.totals[field] !== null) close(scoped.display.rows.reduce((sum, group) => sum + group[field], 0), scoped.display.totals[field]);
  assert.equal(scoped.savings_claim_allowed, false);
}
const review = build();
const main = review.spend.period_variance.scoped_change;
records.complete = review;
check("Independent total oracle", () => assert.deepEqual(fields.map((field) => main.totals[field]), [200, 300, 100, 20, -20, 0]));
check("Team oracle preserves every component", () => {
  assert.deepEqual(Object.fromEntries(main.groups.map((group) => [group.label, [group.starting_cost, group.ending_cost, group.change, group.request_volume_effect, group.verified_official_rate_effect, group.usage_and_mix_effect]])), {
    Support: [20, 92, 72, 100, 12, -40], Research: [80, 94, 14, 0, 4, 10], Unattributed: [40, 54, 14, -20, 4, 30], Product: [60, 60, 0, 20, 0, -20],
  }); reconciles(main);
});
check("Model oracle and unchanged parent", () => {
  const before = JSON.stringify(review);
  const scoped = engine.scopedCostChange(review.events, review.spend.period_variance, "model", fixture.catalog);
  assert.deepEqual(scoped.groups.map((group) => [group.label, group.change, group.request_volume_effect, group.verified_official_rate_effect, group.usage_and_mix_effect]), [["Fictional · alpha", 70, 60, 20, -10], ["Fictional · beta", 30, 40, 0, -10]]);
  assert.equal(JSON.stringify(review), before); reconciles(scoped);
});
check("All ten dimensions preserve the parent bridge", () => {
  for (const [dimension] of engine.CHANGE_DIMENSIONS) {
    const result = build(fixture.rows, { change_dimension: dimension });
    const scoped = result.spend.period_variance.scoped_change;
    assert.deepEqual(scoped.totals, result.spend.period_variance.cost_change_bridge);
    reconciles(scoped); records[dimension] = result;
  }
});
check("Local-average shortcut is not additive", () => close(main.groups.reduce((sum, group) => sum + (group.current_requests - group.prior_requests) * group.starting_cost / group.prior_requests, 0), 66.66666666666667));
check("New and departed groups", () => {
  const rows = clone(fixture.rows);
  rows.forEach((row) => { if (row.team_owner === "Support") row.team_owner = row.timestamp < "2026-10-08" ? "Departed" : "New"; });
  const scoped = build(rows).spend.period_variance.scoped_change;
  assert(scoped.groups.some((group) => group.label === "New" && group.prior_requests === 0));
  assert(scoped.groups.some((group) => group.label === "Departed" && group.current_requests === 0)); reconciles(scoped);
});
check("Literal Unattributed label is separate from missing label", () => {
  const rows = clone(fixture.rows); rows[0].team_owner = "Unattributed";
  const scoped = build(rows).spend.period_variance.scoped_change;
  assert.equal(scoped.groups.filter((group) => group.label === "Unattributed").length, 2); reconciles(scoped);
});
check("Workload null preserves a literal default-name workload", () => {
  const rows = clone(fixture.rows); rows[0].workload = "Unassigned workload";
  const result = build(rows, { change_dimension: "workload" }); records.workloadNull = result;
  assert.equal(result.events.at(-1).workload, null);
  const groups = result.spend.period_variance.scoped_change.groups;
  assert(groups.some((group) => group.label === "Unassigned workload" && group.kind === "value"));
  assert(groups.some((group) => group.kind === "unattributed"));
  assert(engine.normalizedCsv(result).includes(",Unassigned workload,"));
});
check("Reported cost keeps official-rate and mix unavailable", () => {
  const rows = clone(fixture.rows); rows[0].provider_reported_cost = 10;
  const result = build(rows); records.reported = result;
  const scoped = result.spend.period_variance.scoped_change;
  assert.equal(scoped.status, "PARTIAL"); assert(scoped.groups.every((group) => group.verified_official_rate_effect === null && group.usage_and_mix_effect === null)); reconciles(scoped);
});
check("No catalog preserves an unsupported residual", () => {
  const result = build(clone(review.events), { catalog: null }); records.noCatalog = result;
  assert.equal(result.spend.period_variance.scoped_change.status, "PARTIAL"); reconciles(result.spend.period_variance.scoped_change);
});
check("Inconsistent calculated cost stays partial", () => {
  const rows = clone(fixture.rows); rows[0].calculated_cost = 11;
  const scoped = build(rows).spend.period_variance.scoped_change;
  assert.equal(scoped.status, "PARTIAL"); reconciles(scoped);
});
for (const [name, mutate, options, reason] of [
  ["Unpriced", (rows) => { rows[0].model = "unknown"; }, {}, "unpriced"],
  ["Mixed currency", (rows) => { rows[0].currency = "EUR"; rows[0].provider_reported_cost = 10; }, {}, "currency"],
  ["Missing currency", (rows) => { rows[0].currency = null; rows[0].calculated_cost = 10; }, {}, "currency"],
  ["Missing timestamp", (rows) => { rows[0].timestamp = null; rows[0].calculated_cost = 10; }, {}, "timestamp"],
  ["Unconfirmed period", () => {}, { period_complete_confirmed: false }, "confirmed"],
  ["Quarantined row", (rows) => { rows[0].input_tokens = -1; }, { quarantine_invalid_rows: true }, "confirmed"],
]) check(name + " blocks grouped dollars", () => {
  const rows = clone(fixture.rows); mutate(rows); const result = build(rows, options); records[name] = result;
  const scoped = result.spend.period_variance.scoped_change;
  assert.equal(scoped.status, "NOT_SUPPORTED"); assert.equal(scoped.groups.length, 0); assert.equal(scoped.display, null); assert(scoped.limitations.some((text) => text.toLowerCase().includes(reason)));
});
check("Odd window excludes same leading day", () => {
  const rows = [{ ...fixture.rows[0], event_id: "leading", timestamp: "2026-09-30T12:00:00Z", provider_reported_cost: 99 }, ...fixture.rows];
  const result = build(rows); assert.equal(result.spend.period_variance.excluded_leading_days, 1);
  assert.equal(result.spend.period_variance.scoped_change.totals.starting_cost, 200); reconciles(result.spend.period_variance.scoped_change);
});
check("Top six plus Other and Unattributed reconcile without omitted cost", () => {
  const rows = clone(fixture.rows); rows.forEach((row, index) => { if (row.team_owner) row.team_owner = "Team " + index; });
  const result = build(rows); records.manyGroups = result;
  const scoped = result.spend.period_variance.scoped_change;
  assert.equal(scoped.display.rows.filter((group) => group.kind === "value").length, 6);
  assert(scoped.display.rows.some((group) => group.kind === "other")); assert(scoped.display.rows.some((group) => group.kind === "unattributed")); reconciles(scoped);
});
check("Opposite signs remain separate", () => {
  const rows = clone(review.events); rows.forEach((row) => { if (row.team_owner === "Product" && row.timestamp > "2026-10-07T23:59:59Z") row.provider_reported_cost = 0; });
  const scoped = build(rows).spend.period_variance.scoped_change;
  assert.equal(scoped.groups.find((group) => group.label === "Product").change, -60);
  assert.equal(scoped.groups.find((group) => group.label === "Support").change, 72); reconciles(scoped);
});
check("Fractional cents balance and record adjustments", () => {
  const rows = clone(review.events); rows.forEach((row, index) => { row.provider_reported_cost = (index + 1) * 0.00037; });
  const result = build(rows); records.fractional = result;
  assert(result.spend.period_variance.scoped_change.display.rounding_adjustments.length > 0); reconciles(result.spend.period_variance.scoped_change);
});
check("100 fractional fixtures across all dimensions", () => {
  let seed = 19347;
  for (let n = 0; n < 100; n += 1) {
    const rows = clone(review.events); rows.forEach((row) => { seed = (seed * 1664525 + 1013904223) >>> 0; row.provider_reported_cost = (seed % 1000000) / 100000000; });
    const result = build(rows);
    for (const [dimension] of engine.CHANGE_DIMENSIONS) reconciles(engine.scopedCostChange(result.events, result.spend.period_variance, dimension, fixture.catalog));
  }
});
check("Zero costs remain zero without a savings claim", () => {
  const rows = clone(review.events); rows.forEach((row) => { row.provider_reported_cost = 0; });
  const result = build(rows); records.zero = result;
  assert.equal(result.spend.period_variance.scoped_change.totals.ending_cost, 0); reconciles(result.spend.period_variance.scoped_change);
});
check("Formula-like values remain neutralized in normalized CSV", () => {
  const rows = clone(fixture.rows); rows[0].team_owner = '=HYPERLINK("https://example.invalid")';
  const result = build(rows); assert(engine.normalizedCsv(result).includes("'=")); assert.equal(result.evidence_gate.savings_claim_allowed, false);
});
check("Unsupported dimension rejected", () => assert.throws(() => build(fixture.rows, { change_dimension: "invented" }), /supported/));
check("Legacy review CSV export remains available", () => {
  const legacy = clone(review); legacy.schema_version = "ai-cost-lens-usage-review/1.1";
  assert.equal(engine.normalizedCsv(legacy), engine.normalizedCsv(review));
});
check("Precision limit withholds the scoped result without changing the parent", () => {
  const rows = clone(review.events); rows.forEach((row) => { row.provider_reported_cost = 100000000; });
  const result = build(rows); const variance = result.spend.period_variance;
  assert.equal(variance.status, "AVAILABLE"); assert.equal(variance.scoped_change.status, "NOT_SUPPORTED");
  assert.equal(variance.scoped_change.groups.length, 0); assert.equal(variance.cost_change_bridge.ending_cost, 1500000000);
  assert(variance.scoped_change.limitations.some((text) => text.includes("precision")));
});
check("JSON round trip keeps dimension, provenance and savings gates", () => {
  const result = build(fixture.rows, { change_dimension: "model" }); const roundtrip = clone(result);
  assert.deepEqual(roundtrip, result); assert.equal(roundtrip.spend.period_variance.scoped_change.dimension, "model");
  assert.equal(roundtrip.spend.period_variance.scoped_change.totals.provenance.reference_rate_date, "2026-10-07");
  assert.equal(roundtrip.evidence_gate.savings_claim_allowed, false); assert.equal(roundtrip.spend.period_variance.scoped_change.savings_claim_allowed, false);
});
if (process.argv.includes("--records")) process.stdout.write(JSON.stringify(records));
else process.stdout.write(JSON.stringify({ result: "passed", checks: checks.length, names: checks, stress_fixtures: 100, dimensions: engine.CHANGE_DIMENSIONS.length }) + "\n");
