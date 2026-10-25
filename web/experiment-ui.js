(function (root) {
  "use strict";
  const engine = root.AICostLensExperiments;
  const labels = { model: "Model", effort: "Effort", prompt_version: "Prompt version", caching: "Caching", processing: "Processing mode" };
  const decisions = { REVIEW_CANDIDATE: "Candidate worth a finance review", REJECT_CHANGE: "Keep the starting setup", NEEDS_MORE_EVIDENCE: "More test evidence needed" };
  const $ = (id) => document.getElementById(id);
  const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const percent = (n) => `${(n * 100).toFixed(1)}%`;
  let context;
  let record = null;
  let linkedReview = null;

  function error(message) {
    $("experiment-error").textContent = message;
    $("experiment-error").classList.toggle("visible", Boolean(message));
  }

  function money(value) {
    if (value === null) return "Unavailable";
    const format = new Intl.NumberFormat("en-US", { style: "currency", currency: record.plan.currency, maximumFractionDigits: 8 });
    return value > 0 && value < 1e-8 ? `Less than ${format.format(1e-8)}` : format.format(value);
  }

  function summaryHtml() {
    if (!record) return "";
    const s = record.summary;
    return `<p class="kicker">${record.mode === "illustrative" ? "ILLUSTRATIVE TEST · INVENTED DATA" : "USER-SUPPLIED TEST EVIDENCE · API COST ONLY"}</p>
      <h3>${escape(decisions[s.decision])}</h3><p>${escape(record.plan.workload)} · ${escape(record.plan.change_kind)} change</p>
      <p>${escape(s.reason)}</p>
      <p><strong>${s.validation_runs} validation runs · ${s.unique_validation_cases} distinct validation cases</strong> · ${s.validation_observations} paired observations across repeats.</p>
      <p>${escape(s.statistical_note)}</p><p>${escape(record.evidence_gate.reason)}</p>`;
  }

  function tableHtml() {
    return `<table class="usage-table experiment-run-table"><thead><tr><th>Run</th><th>Cases</th><th>Ready rate</th><th>API cost per ready result</th><th>Review minutes</th><th>Quality</th></tr></thead><tbody>${record.summary.runs.map((run) => `<tr>
      <th>${escape(run.id)}<small>${escape(run.partition)}</small></th><td>${run.baseline.cases}</td>
      <td>${percent(run.baseline.ready_rate)} → ${percent(run.candidate.ready_rate)}</td>
      <td>${money(run.baseline_api_cost_per_ready)} → ${money(run.candidate_api_cost_per_ready)}</td>
      <td>${run.baseline.human_minutes ?? "Not recorded"} → ${run.candidate.human_minutes ?? "Not recorded"}</td>
      <td>${run.quality_held ? "Held in this run" : "Failed locked rule"}<small>Checks: ${percent(run.baseline.deterministic_pass_rate)} → ${percent(run.candidate.deterministic_pass_rate)}</small></td></tr>`).join("")}</tbody></table>`;
  }

  function settingsHtml() {
    return `<table class="usage-table"><thead><tr><th>Locked setting</th><th>${escape(record.plan.baseline.label)}</th><th>${escape(record.plan.candidate.label)}</th></tr></thead><tbody>${Object.entries(labels).map(([field, label]) => `<tr><th>${label}</th><td>${escape(record.plan.baseline[field] ?? "Not recorded")}</td><td>${escape(record.plan.candidate[field] ?? "Not recorded")}</td></tr>`).join("")}</tbody></table>`;
  }

  function render() {
    $("experiment-plan").hidden = Boolean(record);
    $("experiment-locked").hidden = !record;
    $("experiment-result").hidden = !record;
    if (!record) {
      $("experiment-summary").replaceChildren();
      $("experiment-actuals-note").hidden = true;
      return;
    }
    $("experiment-plan-summary").textContent = `${record.plan.workload} · ${record.plan.change_kind} only · ${record.plan.quality_rule}`;
    const field = { prompt: "prompt_version", batch: "processing" }[record.plan.change_kind] || record.plan.change_kind;
    $("experiment-config-summary").textContent = `${labels[field]}: ${record.plan.baseline[field]} → ${record.plan.candidate[field]}. Check pass minimum: ${percent(record.plan.thresholds.minimum_deterministic_pass_rate)}; ready-result minimum: ${percent(record.plan.thresholds.minimum_ready_rate)}; permitted regression: ${(record.plan.thresholds.maximum_ready_rate_regression * 100).toFixed(1)} points.`;
    $("experiment-config-details").innerHTML = settingsHtml();
    $("experiment-summary").innerHTML = summaryHtml();
    $("experiment-runs").innerHTML = record.runs.length ? tableHtml() : "<p>No runs recorded. Complete a paired output check below or open its saved record, then add the matching API cost for that execution.</p>";
    const canViewActuals = context.getReview()?.baseline && context.getReview()?.proposed && context.getReview()?.experience !== "simple";
    $("experiment-to-actuals").hidden = !canViewActuals;
    const attached = linkedReview === context.getReview();
    $("experiment-attachment").textContent = attached ? "The test summary will accompany this review’s finance memo and workspace archive. Its test costs do not replace production costs." : "This is a separate test record. Open or build a review for the same workload before attaching its summary.";
    $("experiment-actuals-note").hidden = !attached;
    if (attached) $("experiment-actuals-copy").textContent = `${record.plan.workload}: ${decisions[record.summary.decision]}. Use full post-change cost and outcome records below; small test-run costs are not production actuals. No approval or evidence box is filled automatically.`;
    $("experiment-run-id").value = `run-${record.runs.length + 1}`;
  }

  function attach() {
    const review = context.getReview();
    if (!record || !review || record.plan.workload !== review.workload?.name || record.plan.currency !== review.currency
        || (record.mode === "illustrative") !== (review.mode === "illustrative")) {
      throw new Error("The test and review must name the same workload, currency, and evidence mode. Keep unrelated or illustrative tests separate.");
    }
    linkedReview = review;
  }

  function config() {
    const route = (name) => Object.fromEntries(["label", ...Object.keys(labels)].map((field) => [field, $(`experiment-${name}-${field}`).value.trim()]));
    return {
      workload: $("experiment-workload").value, quality_rule: $("experiment-quality-rule").value,
      currency: $("experiment-currency").value, change_kind: $("experiment-change").value,
      baseline: route("baseline"), candidate: route("candidate"),
      other_settings_unchanged: $("experiment-unchanged").checked,
      minimum_deterministic_pass_rate: requiredPercent("experiment-check-floor"),
      minimum_ready_rate: requiredPercent("experiment-ready-floor"),
      maximum_ready_rate_regression: requiredPercent("experiment-regression"),
    };
  }

  function requiredPercent(id) {
    const input = $(id);
    if (!input.value.trim()) throw new Error("Fill in all three quality thresholds before locking the test.");
    const n = Number(input.value);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error("Quality thresholds must be between 0 and 100.");
    return n / 100;
  }

  function clearRunInputs() {
    ["experiment-baseline-cost", "experiment-candidate-cost", "experiment-cost-source"].forEach((id) => { $(id).value = ""; });
    $("experiment-verification-file").value = "";
    $("experiment-independent").checked = false;
    $("experiment-reserved").checked = false;
  }

  function download() {
    if (!record) return;
    const safe = engine.restoreExperiment(record);
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(safe, null, 2)}\n`], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = "ai-cost-lens-test-record.json"; document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function init(api) {
    context = api;
    $("experiment-plan").addEventListener("submit", (event) => {
      event.preventDefault(); error("");
      try {
        const next = engine.createExperiment(config());
        record = next; linkedReview = null;
        try { attach(); } catch (_ignored) { /* Standalone tests remain separate. */ }
        clearRunInputs(); render(); $("experiment-locked-title").focus();
      } catch (caught) { error(caught.message); }
    });
    $("experiment-run-form").addEventListener("submit", async (event) => {
      event.preventDefault(); error("");
      const submit = $("experiment-add-run"); submit.disabled = true;
      try {
        const file = $("experiment-verification-file").files[0];
        const evidence = file ? JSON.parse(await context.readFile(file)) : context.getVerification();
        if (!evidence) throw new Error("Complete a paired output check below, or choose its saved verification JSON.");
        record = engine.addRun(record, {
          id: $("experiment-run-id").value,
          partition: $("experiment-partition").value,
          baseline_cost: $("experiment-baseline-cost").value,
          candidate_cost: $("experiment-candidate-cost").value,
          cost_source: $("experiment-cost-source").value,
          independent_execution: $("experiment-independent").checked,
          reserved_before_tuning: $("experiment-reserved").checked,
        }, evidence);
        clearRunInputs(); render(); context.toast("Run recorded locally. Test evidence stays separate from savings.");
      } catch (caught) { error(caught instanceof SyntaxError ? "Choose a valid saved paired verification JSON file." : caught.message); }
      finally { submit.disabled = false; }
    });
    $("experiment-download").addEventListener("click", download);
    $("experiment-open").addEventListener("click", () => $("experiment-file").click());
    $("experiment-file").addEventListener("change", async (event) => {
      error(""); const file = event.target.files[0]; if (!file) return;
      try {
        const restored = engine.restoreExperiment(JSON.parse(await context.readFile(file)));
        record = restored; linkedReview = null;
        clearRunInputs(); render(); context.toast("Saved test reopened. Its calculations were rebuilt locally.");
      } catch (caught) { error(caught instanceof SyntaxError ? "Choose a valid saved test JSON file." : caught.message); }
      finally { event.target.value = ""; }
    });
    $("experiment-example").addEventListener("click", () => {
      error("");
      if (record) { error("A test is already open. Download it, then choose Start another test before opening the example."); return; }
      record = engine.illustrativeExample(context.verifier); linkedReview = null; render();
      context.toast("Illustrative caching example open. All costs, outputs, and review declarations are invented.");
    });
    $("experiment-new").addEventListener("click", () => {
      error("");
      if (!$("experiment-reset-confirm").checked) { error("Download the open test if you need it, then confirm you are ready to clear it."); return; }
      record = null; linkedReview = null; $("experiment-reset-confirm").checked = false; clearRunInputs(); render();
      $("experiment-workload").focus();
    });
    $("experiment-attach").addEventListener("click", () => { error(""); try { attach(); render(); context.toast("Test summary attached to this review’s memo. Savings gates are unchanged."); } catch (caught) { error(caught.message); } });
    $("experiment-to-actuals").addEventListener("click", () => context.setView("actuals"));
    $("start-controlled-test").addEventListener("click", () => { context.setView("verify"); $("experiment-title").focus(); $("experiment-panel").scrollIntoView({ block: "start", behavior: "smooth" }); });
    $("experiment-print").addEventListener("click", () => {
      if (!record) return;
      $("experiment-printout").innerHTML = `<img class="print-brand-wordmark" src="brand/cloud-and-capital-wordmark.png" alt="Cloud &amp; Capital" width="1551" height="174" /><p class="memo-brand">AI COST LENS</p><h1>One change test record</h1>${summaryHtml()}<h2>The locked change</h2><p>${escape(record.plan.quality_rule)}</p><p>${escape($("experiment-config-summary").textContent)}</p>${settingsHtml()}<h2>Results by run</h2>${tableHtml()}<h2>Cost evidence supplied</h2><ul>${record.runs.map((run) => `<li>${escape(run.id)}: ${escape(run.cost_source)}</li>`).join("")}</ul>`;
      document.body.classList.add("printing-experiment");
      try { window.print(); } catch (_caught) { document.body.classList.remove("printing-experiment"); error("Printing could not start. Download the test record instead."); }
    });
    const cleanup = () => document.body.classList.remove("printing-experiment");
    window.addEventListener("afterprint", cleanup);
    const media = window.matchMedia?.("print");
    media?.addEventListener?.("change", () => { if (!media.matches) cleanup(); });
    render();
  }

  function setContext() {
    if (record) { render(); return; }
    const review = context.getReview();
    if (review?.mode !== "illustrative" && review?.workload?.name) {
      $("experiment-workload").value = review.workload.name;
      $("experiment-currency").value = review.currency || "";
      $("experiment-quality-rule").value = review.baseline?.outcomes?.acceptance_rule || review.config?.acceptanceRule || "";
      $("experiment-baseline-label").value = review.baseline?.label || "Starting setup";
      $("experiment-candidate-label").value = review.proposed?.label || "Changed setup";
    }
  }

  root.AICostLensExperimentUI = Object.freeze({ init, setContext,
    getRecord: () => record ? engine.restoreExperiment(record) : null,
    memoHtml: () => record && linkedReview === context.getReview() ? `<h2>Controlled test evidence</h2>${summaryHtml()}<p>${escape($("experiment-config-summary").textContent)}</p>${tableHtml()}` : "",
  });
})(globalThis);
