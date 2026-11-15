// Executes the actual app's scoped rendering and selector handler against a
// minimal document adapter. Browser, layout and download acceptance are separate.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const engine = require("../web/usage-event-engine.js");
const catalog = require("../web/data/pricing-catalog-v0.5.js");
const source = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
const fixture = JSON.parse(readFileSync(new URL("../tests/fixtures/scoped-change-two-window.json", import.meta.url), "utf8"));
const elements = new Map();
const element = (id) => {
  if (!elements.has(id)) elements.set(id, { value: "", disabled: false, innerHTML: "", listeners: {}, addEventListener(name, callback) { this.listeners[name] = callback; } });
  return elements.get(id);
};
const state = { usageReview: null };
const context = { Intl, document: { getElementById: element }, usageEventEngine: engine, state, AI_COST_LENS_PRICING_CATALOG: catalog };
const escaped = source.slice(source.indexOf("  const escapeHtml ="), source.indexOf("  const round =", source.indexOf("  const escapeHtml =")));
const render = source.slice(source.indexOf("  function renderScopedChangeDriver("), source.indexOf("  function renderRequestSpendOverview("));
const listener = source.slice(source.indexOf('  document.getElementById("request-change-dimension").addEventListener'), source.indexOf('  document.getElementById("download-usage-review").addEventListener'));
runInNewContext(escaped + render + listener + "\nglobalThis.renderScoped = renderScopedChangeDriver;", context);
const rows = fixture.rows.map((row) => ({ ...row, provider_reported_cost: row.input_tokens / 1_000_000 * (row.model === "beta" ? 20 : row.timestamp < "2026-10-08" ? 10 : 12) }));
const build = (input = rows, options = {}) => engine.buildReview(input, { catalog, period_complete_confirmed: true, ...options });
const checks = [];
const check = (name, run) => { run(); checks.push(name); };
check("Actual renderer shows Support and Unattributed with the exact total", () => {
  state.usageReview = build(); context.renderScoped(state.usageReview);
  assert(element("request-scoped-change").innerHTML.includes("+$72.00"));
  assert(element("request-scoped-change").innerHTML.includes("Unattributed"));
  assert(element("request-scoped-change").innerHTML.includes("+$100.00"));
});
check("Reported-cost copy keeps rate and mix unavailable", () => {
  assert(element("request-scoped-change").innerHTML.includes("Partial evidence"));
  assert(element("request-scoped-change").innerHTML.includes("Unavailable"));
});
check("Actual selector handler changes only the scoped record", () => {
  const bridge = JSON.stringify(state.usageReview.spend.period_variance.cost_change_bridge);
  element("request-change-dimension").value = "model";
  element("request-change-dimension").listeners.change({ target: element("request-change-dimension") });
  assert.equal(state.usageReview.spend.period_variance.scoped_change.dimension, "model");
  assert.equal(state.usageReview.spend.period_variance.scoped_change.display.totals.change, 100);
  assert.equal(JSON.stringify(state.usageReview.spend.period_variance.cost_change_bridge), bridge);
  assert(element("request-scoped-change").innerHTML.includes("Fictional · alpha"));
});
check("Selected grouping and unchanged gate survive JSON serialization", () => {
  const saved = JSON.parse(JSON.stringify(state.usageReview));
  assert.equal(saved.spend.period_variance.scoped_change.dimension, "model");
  assert.equal(saved.evidence_gate.savings_claim_allowed, false);
});
check("HTML-like labels remain text in the actual renderer", () => {
  const input = rows.map((row) => ({ ...row })); input[0].team_owner = "<img src=x onerror=alert(1)>";
  state.usageReview = build(input); context.renderScoped(state.usageReview);
  assert(element("request-scoped-change").innerHTML.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert(!element("request-scoped-change").innerHTML.includes("<img src=x"));
});
check("Unpriced input withholds the table and disables grouping", () => {
  const input = rows.map((row) => ({ ...row })); input[0].provider_reported_cost = null; input[0].model = "unpriced";
  state.usageReview = build(input); context.renderScoped(state.usageReview);
  assert(element("request-scoped-change").innerHTML.includes("Grouped change unavailable"));
  assert(!element("request-scoped-change").innerHTML.includes("<table"));
  assert.equal(element("request-change-dimension").disabled, true);
});
check("Mixed currencies withhold a combined grouped amount", () => {
  const input = rows.map((row) => ({ ...row })); input[0].currency = "EUR";
  state.usageReview = build(input); context.renderScoped(state.usageReview);
  assert(!element("request-scoped-change").innerHTML.includes("<table"));
});
process.stdout.write(JSON.stringify({ result: "passed", checks: checks.length, scope: "actual render function and selector handler with a document adapter; not browser/layout QA", names: checks }) + "\n");
