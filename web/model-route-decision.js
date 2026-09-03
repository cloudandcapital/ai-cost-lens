(() => {
  "use strict";

  const state = { data: window.AI_COST_LENS_MODEL_ROUTE_DECISION, story: false };
  const byId = (id) => document.getElementById(id);
  const escapeHtml = (value) =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  const compact = (value) =>
    new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
  const money = (value, digits = 7) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  const recordedDate = (data) => {
    const value = data.as_of || data.recorded_at;
    return value ? String(value).slice(0, 10) : "DATE NOT RECORDED";
  };

  function validate(data) {
    if (!data || data.schema_version !== "ai-cost-lens-decision-record/0.1") {
      throw new Error("That file is not an AI Cost Lens Decision Record 0.1.");
    }
    if (!data.decision || !data.routes?.baseline || !data.routes?.proposed) {
      throw new Error("The decision is missing a route or approval record.");
    }
    if (!Array.isArray(data.evidence) || !Array.isArray(data.claims) || !Array.isArray(data.risk_cases)) {
      throw new Error("The decision is missing its evidence ledger.");
    }
  }

  function claimState(claimId) {
    const claim = state.data.claims.find((item) => item.claim_id === claimId);
    return claim ? claim.state.replaceAll("_", " ") : "NOT RECORDED";
  }

  function statusClass(value) {
    if (value === "VERIFIED_FACT") return "verified";
    if (value === "LIMITED_EVIDENCE") return "limited";
    if (value === "UNKNOWN") return "unknown";
    return "neutral";
  }

  function scoreBlocks(route) {
    return Array.from(
      { length: state.data.workload.case_count },
      (_, index) => `<i class="${index < route.exact_responses ? "filled" : ""}" aria-hidden="true"></i>`,
    ).join("");
  }

  function routeRow(route, key, maxCost) {
    const costWidth = (route.provider_cost_usd / maxCost) * 100;
    const qualityWidth = (route.exact_responses / state.data.workload.case_count) * 100;
    return `
      <article class="route-row ${key}">
        <header>
          <div>
            <p class="kicker">${escapeHtml(route.role)}</p>
            <h3>${escapeHtml(route.label)}</h3>
            <small>${escapeHtml(route.model)}</small>
          </div>
          <span>${route.exact_responses}/${state.data.workload.case_count} exact</span>
        </header>
        <div class="route-measures">
          <div class="measure cost-measure">
            <div class="measure-label"><span>Provider cost</span><strong>${money(route.provider_cost_usd)}</strong></div>
            <div class="measure-track" aria-hidden="true"><span style="width:${costWidth.toFixed(2)}%"></span></div>
          </div>
          <div class="measure quality-measure">
            <div class="measure-label"><span>Locked-key exactness</span><strong>${qualityWidth.toFixed(0)}%</strong></div>
            <div class="score-blocks" aria-label="${route.exact_responses} of ${state.data.workload.case_count} exact responses">${scoreBlocks(route)}</div>
          </div>
        </div>
        <dl>
          <div><dt>Cost per exact response</dt><dd>${money(route.cost_per_exact_response_usd)}</dd></div>
          <div><dt>Rapid trust acceptance</dt><dd>${route.rapid_trust_acceptance}/10 <em>limited evidence</em></dd></div>
          <div><dt>Accepted with material error</dt><dd>${route.accepted_with_material_error}</dd></div>
          <div><dt>Input / output tokens</dt><dd>${compact(route.input_tokens)} / ${compact(route.output_tokens)}</dd></div>
        </dl>
      </article>`;
  }

  function render() {
    validate(state.data);
    const { decision, comparison, routes, workload } = state.data;

    byId("as-of-label").textContent = `AS OF ${recordedDate(state.data)}`;
    byId("mode-label").textContent = `${workload.evidence_label} · NOT CUSTOMER DATA`;
    byId("decision-question").textContent = state.data.question;
    byId("page-title").textContent = state.data.title;
    byId("workload-copy").textContent = `${workload.name}. ${workload.description}`;
    byId("decision-label").textContent = decision.label;
    byId("decision-reason").textContent = decision.reason;
    byId("provider-state").textContent = claimState("provider_cost_savings");
    byId("all-in-state").textContent = claimState("all_in_savings");
    byId("replacement-state").textContent = claimState("drop_in_replacement");
    byId("headline-cost").textContent = comparison.headline_metric;
    byId("headline-quality").textContent = comparison.quality_metric;
    byId("comparison-limit").textContent = comparison.limitation;

    const maxCost = Math.max(routes.baseline.provider_cost_usd, routes.proposed.provider_cost_usd);
    byId("route-comparison").innerHTML = [
      routeRow(routes.baseline, "baseline", maxCost),
      routeRow(routes.proposed, "proposed", maxCost),
    ].join("");

    byId("risk-ledger").innerHTML = state.data.risk_cases
      .map(
        (risk, index) => `
          <article>
            <span>${String(index + 1).padStart(2, "0")}</span>
            <div>
              <p class="risk-meta">${escapeHtml(risk.route)} · ${escapeHtml(risk.case_id)}</p>
              <h3>${escapeHtml(risk.headline)}</h3>
              <p>${escapeHtml(risk.detail)}</p>
            </div>
          </article>`,
      )
      .join("");

    byId("control-list").innerHTML = state.data.controls
      .map((control) => `<li>${escapeHtml(control)}</li>`)
      .join("");

    byId("evidence-ledger").innerHTML = state.data.evidence
      .map(
        (item) => `
          <article>
            <div class="evidence-topic">
              <span>${escapeHtml(item.topic)}</span>
              <strong class="state ${statusClass(item.state)}">${escapeHtml(item.state)}</strong>
            </div>
            <p class="evidence-value">${escapeHtml(item.value)}</p>
            <p class="evidence-detail">${escapeHtml(item.detail)}</p>
          </article>`,
      )
      .join("");

    byId("condition-list").innerHTML = workload.conditions
      .map((condition) => `<li>${escapeHtml(condition)}</li>`)
      .join("");
    byId("next-test-question").textContent = state.data.next_test.question;
    byId("next-test-copy").textContent = state.data.next_test.smallest_test;
    byId("next-test-metrics").innerHTML = state.data.next_test.metrics
      .map((metric) => `<li>${escapeHtml(metric)}</li>`)
      .join("");
    byId("next-test-cost").textContent = `Cash ceiling: ${money(state.data.next_test.cash_cost_ceiling_usd, 0)}`;
    byId("source-line").textContent = `Sources: ${state.data.sources.join(" · ")}`;
  }

  function showToast(message) {
    const toast = byId("toast");
    toast.textContent = message;
    toast.classList.add("active");
    window.setTimeout(() => toast.classList.remove("active"), 2800);
  }

  byId("story-toggle").addEventListener("click", () => {
    state.story = !state.story;
    document.body.classList.toggle("story-mode", state.story);
    byId("story-toggle").textContent = state.story ? "Operator view" : "Story view";
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  byId("decision-file").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      validate(data);
      state.data = data;
      render();
      showToast("Decision opened locally. Nothing was uploaded.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "That decision could not be opened.");
    } finally {
      event.target.value = "";
    }
  });

  render();
})();
