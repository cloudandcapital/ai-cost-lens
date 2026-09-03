(() => {
  "use strict";

  const packet = window.AI_COST_LENS_REVIEW_PACKET;
  if (!packet || packet.schema_version !== "ai-cost-lens-human-review-packet/1.0") {
    throw new Error("The model route review packet is missing or invalid.");
  }

  const storageKey = `ai-cost-lens-review:${packet.packet_id}`;
  const caseCount = packet.case_count || new Set(packet.items.map((item) => item.case_id)).size;
  const responseCount = packet.response_count || packet.items.length;
  const storageAvailable = (() => {
    try {
      const testKey = `${storageKey}:test`;
      window.localStorage.setItem(testKey, "1");
      window.localStorage.removeItem(testKey);
      return true;
    } catch (_error) {
      return false;
    }
  })();
  const initialState = () => ({
    schema_version: "ai-cost-lens-human-review-progress/1.0",
    status: "intro",
    index: 0,
    records: [],
    phase: null,
    current: null,
    timer_elapsed_ms: 0,
    timer_started_at: null,
    paused: true,
    labor_rate: null,
  });

  let state = loadState();
  let tickHandle = null;

  const byId = (id) => document.getElementById(id);
  const escapeHtml = (value) =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  function loadState() {
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey));
      if (
        saved?.schema_version === "ai-cost-lens-human-review-progress/1.0" &&
        Array.isArray(saved.records)
      ) {
        saved.paused = true;
        saved.timer_started_at = null;
        return saved;
      }
    } catch (_error) {
      // A broken browser cache should not block a new review.
    }
    return initialState();
  }

  function saveState() {
    if (!storageAvailable) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state));
    } catch (_error) {
      // The review remains usable in memory when local storage is unavailable.
    }
  }

  function setScreen(name) {
    document.querySelectorAll(".screen").forEach((screen) => {
      screen.classList.toggle("active", screen.id === `${name}-screen`);
    });
  }

  function activeElapsedMs() {
    if (state.paused || state.timer_started_at === null) {
      return state.timer_elapsed_ms;
    }
    return state.timer_elapsed_ms + (Date.now() - state.timer_started_at);
  }

  function formatDuration(milliseconds) {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    const minutes = Math.floor(seconds / 60);
    return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function updateTimer() {
    byId("timer-display").textContent = formatDuration(activeElapsedMs());
  }

  function beginTimer() {
    state.paused = false;
    state.timer_started_at = Date.now();
    byId("pause-panel").classList.remove("active");
    clearInterval(tickHandle);
    tickHandle = window.setInterval(updateTimer, 500);
    updateTimer();
    saveState();
  }

  function pauseTimer(showPanel = true) {
    if (!state.paused && state.timer_started_at !== null) {
      state.timer_elapsed_ms = activeElapsedMs();
    }
    state.paused = true;
    state.timer_started_at = null;
    clearInterval(tickHandle);
    tickHandle = null;
    updateTimer();
    if (showPanel && state.status === "reviewing") {
      byId("pause-panel").classList.add("active");
    }
    saveState();
  }

  function resetPhaseTimer() {
    state.timer_elapsed_ms = 0;
    state.timer_started_at = null;
    state.paused = true;
  }

  function formatMetric(metric) {
    if (metric.value === null) return "Unavailable";
    const value = Number(metric.value);
    if (metric.unit === "PERCENT") return `${value.toFixed(1)}%`;
    if (metric.unit === "MULTIPLIER") return `${value.toFixed(0)}×`;
    if (metric.unit.startsWith("USD")) {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: value < 1 ? 4 : 2,
        maximumFractionDigits: value < 1 ? 4 : 2,
      }).format(value);
    }
    if (metric.unit === "DAYS") return `${value.toFixed(0)} days`;
    return String(value);
  }

  function renderCurrent() {
    const item = packet.items[state.index];
    if (!item) {
      finishReview();
      return;
    }

    setScreen("review");
    byId("response-label").textContent = item.response_label;
    byId("progress-label").textContent = `${state.index + 1} of ${packet.items.length}`;
    byId("progress-fill").style.width = `${(state.index / packet.items.length) * 100}%`;
    byId("case-title").textContent = item.decision_question;
    byId("case-situation").textContent = item.situation;
    byId("case-claims").innerHTML = item.claims
      .map((claim) => `<li>${escapeHtml(claim.text)}</li>`)
      .join("");

    const answer = item.response;
    byId("answer-decision").textContent = answer.decision;
    byId("metric-label").textContent = answer.primary_metric.label;
    byId("metric-value").textContent = `${formatMetric(answer.primary_metric)} · ${answer.primary_metric.unit}`;
    byId("answer-claims").innerHTML = answer.claim_assessments
      .map(
        (claim) => `
          <div>
            <dt>${escapeHtml(item.claim_labels[claim.claim_id] || claim.claim_id)}</dt>
            <dd>${escapeHtml(claim.state)}</dd>
          </div>`,
      )
      .join("");
    byId("answer-memo").textContent = answer.memo;
    byId("answer-next").textContent = answer.next_question;

    const correcting = state.phase === "correction";
    byId("decision-actions").style.display = correcting ? "none" : "grid";
    byId("correction-panel").classList.toggle("active", correcting);
    byId("phase-label").textContent = correcting ? "CORRECTION TIME" : "REVIEW TIME";
    byId("correction-error").textContent = "";
    updateTimer();

    if (state.paused) {
      byId("pause-panel").classList.add("active");
    }
  }

  function beginReview() {
    if (state.status === "intro") {
      state.status = "reviewing";
      state.phase = "review";
      state.current = {
        item_id: packet.items[0].item_id,
        review_ms: 0,
        correction_ms: 0,
        correction_categories: [],
        correction_note: "",
        review_disposition: null,
      };
      resetPhaseTimer();
    }
    renderCurrent();
    beginTimer();
  }

  function commitPhaseTime() {
    pauseTimer(false);
    if (state.phase === "review") {
      state.current.review_ms += state.timer_elapsed_ms;
    } else if (state.phase === "correction") {
      state.current.correction_ms += state.timer_elapsed_ms;
    }
    resetPhaseTimer();
  }

  function advance(record) {
    state.records.push(record);
    state.index += 1;
    if (state.index >= packet.items.length) {
      finishReview();
      return;
    }
    state.phase = "review";
    state.current = {
      item_id: packet.items[state.index].item_id,
      review_ms: 0,
      correction_ms: 0,
      correction_categories: [],
      correction_note: "",
      review_disposition: null,
    };
    resetPhaseTimer();
    saveState();
    renderCurrent();
    beginTimer();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function acceptCurrent() {
    if (state.paused || state.phase !== "review") return;
    commitPhaseTime();
    advance({ ...state.current, accepted: true, review_disposition: "usable_unchanged" });
  }

  function flagForExpertReview() {
    if (state.paused || state.phase !== "review") return;
    commitPhaseTime();
    advance({
      ...state.current,
      accepted: false,
      review_disposition: "needs_expert_review",
      correction_categories: ["unsure"],
      correction_note: "Reviewer would not rely on this response without expert review.",
    });
  }

  function beginCorrection() {
    if (state.paused || state.phase !== "review") return;
    commitPhaseTime();
    state.phase = "correction";
    byId("decision-actions").style.display = "none";
    byId("correction-panel").classList.add("active");
    byId("phase-label").textContent = "CORRECTION TIME";
    beginTimer();
    byId("correction-note").focus();
  }

  function cancelCorrection() {
    if (state.paused || state.phase !== "correction") return;
    commitPhaseTime();
    state.current.review_ms += state.current.correction_ms;
    state.current.correction_ms = 0;
    state.phase = "review";
    byId("decision-actions").style.display = "grid";
    byId("correction-panel").classList.remove("active");
    byId("phase-label").textContent = "REVIEW TIME";
    beginTimer();
  }

  function saveCorrection(event) {
    event.preventDefault();
    if (state.paused || state.phase !== "correction") return;
    const categories = [...byId("correction-options").querySelectorAll("input:checked")].map(
      (input) => input.value,
    );
    const note = byId("correction-note").value.trim();
    if (!categories.length || !note) {
      byId("correction-error").textContent =
        "Choose at least one correction type and describe the change.";
      return;
    }
    commitPhaseTime();
    state.current.correction_categories = categories;
    state.current.correction_note = note;
    byId("correction-options").querySelectorAll("input").forEach((input) => {
      input.checked = false;
    });
    byId("correction-note").value = "";
    advance({ ...state.current, accepted: false, review_disposition: "corrected_by_reviewer" });
  }

  function itemForRecord(record) {
    return packet.items.find((item) => item.item_id === record.item_id);
  }

  function routeAggregate(routeKey) {
    const route = packet.routes[routeKey];
    const records = state.records.filter(
      (record) => itemForRecord(record).route_key === routeKey,
    );
    const accepted = records.filter((record) => record.accepted).length;
    const expertReview = records.filter(
      (record) => record.review_disposition === "needs_expert_review",
    ).length;
    const reviewMs = records.reduce((sum, record) => sum + record.review_ms, 0);
    const correctionMs = records.reduce((sum, record) => sum + record.correction_ms, 0);
    return {
      ...route,
      route_key: routeKey,
      records,
      accepted,
      expertReview,
      reviewMs,
      correctionMs,
    };
  }

  const minutes = (milliseconds) => milliseconds / 60000;
  const money = (value, digits = 4) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  const unitMoney = (value) =>
    value < 1 ? `${(value * 100).toFixed(1)}¢` : money(value, 2);

  function routeCard(route) {
    const reviewed = route.records.length;
    const acceptedRate = reviewed ? (route.accepted / reviewed) * 100 : 0;
    const tokenCharge = Number.isFinite(route.estimated_token_charge)
      ? money(route.estimated_token_charge, 6)
      : "Add reported cost";
    return `
      <article class="route-card">
        <header>
          <div>
            <p class="kicker">${escapeHtml(route.role)}</p>
            <h2>${escapeHtml(route.model)}</h2>
          </div>
          <span class="route-score">${route.accepted}/${reviewed}</span>
        </header>
        <div class="route-ledger">
          <div><span>Usable unchanged</span><strong>${acceptedRate.toFixed(0)}%</strong></div>
          <div><span>Needs expert review</span><strong>${route.expertReview}</strong></div>
          <div><span>Active review</span><strong>${minutes(route.reviewMs).toFixed(2)} min</strong></div>
          <div><span>Correction work</span><strong>${minutes(route.correctionMs).toFixed(2)} min</strong></div>
          <div><span>Estimated model charge</span><strong>${tokenCharge}</strong></div>
        </div>
      </article>`;
  }

  function renderAllIn() {
    if (state.status !== "complete") return;
    const laborInput = byId("labor-rate").value.trim();
    const laborRate = laborInput === "" ? null : Number(laborInput);
    state.labor_rate =
      laborRate !== null && Number.isFinite(laborRate) && laborRate >= 0
        ? laborRate
        : null;
    saveState();
    const routes = [routeAggregate("baseline"), routeAggregate("proposed")];
    byId("all-in-results").innerHTML = routes
      .map((route) => {
        if (state.labor_rate === null) {
          return `
            <article class="all-in-card">
              <h3>${escapeHtml(route.model)}</h3>
              <div><span>All-in review cost</span><strong>Add an hourly value</strong></div>
              <div><span>Cost per accepted answer</span><strong>Not calculated</strong></div>
            </article>`;
        }
        const humanCost =
          (minutes(route.reviewMs + route.correctionMs) / 60) * state.labor_rate;
        const hasModelCharge = Number.isFinite(route.estimated_token_charge);
        const allIn = hasModelCharge ? route.estimated_token_charge + humanCost : null;
        const perAccepted = route.accepted && allIn !== null ? allIn / route.accepted : null;
        if (route.expertReview) {
          return `
            <article class="all-in-card">
              <h3>${escapeHtml(route.model)}</h3>
              <div><span>Recorded human cost so far</span><strong>${money(humanCost, 2)}</strong></div>
              <div><span>Expert reviews still needed</span><strong>${route.expertReview}</strong></div>
              <div><span>Final all-in cost</span><strong>Pending</strong></div>
            </article>`;
        }
        return `
          <article class="all-in-card">
            <h3>${escapeHtml(route.model)}</h3>
            <div><span>Measured human cost</span><strong>${money(humanCost, 2)}</strong></div>
            <div><span>Model + human review</span><strong>${allIn === null ? "Add reported model cost" : money(allIn, 2)}</strong></div>
            <div><span>Cost per accepted answer</span><strong>${perAccepted === null ? "Unavailable" : unitMoney(perAccepted)}</strong></div>
          </article>`;
      })
      .join("");
  }

  function renderComplete() {
    setScreen("complete");
    const baseline = routeAggregate("baseline");
    const proposed = routeAggregate("proposed");
    byId("route-results").innerHTML = routeCard(baseline) + routeCard(proposed);
    byId("labor-rate").value = state.labor_rate ?? "";
    renderAllIn();

    const hasBothCharges =
      Number.isFinite(baseline.estimated_token_charge) &&
      Number.isFinite(proposed.estimated_token_charge);
    const difference = hasBothCharges
      ? baseline.estimated_token_charge - proposed.estimated_token_charge
      : null;
    const finding = byId("finding-note");
    if (proposed.accepted < baseline.accepted) {
      finding.innerHTML = `
        <p class="kicker">THE DECISION</p>
        <h2>${escapeHtml(baseline.model)} produced more finance-ready answers.</h2>
        <p>
          ${hasBothCharges
            ? `${escapeHtml(proposed.model)} reduced the estimated provider charge by ${money(Math.abs(difference), 6)}, but it created`
            : `${escapeHtml(proposed.model)} created`}
          ${baseline.accepted - proposed.accepted}
          additional answers that needed correction. Human time must be valued before
          anyone calls that difference savings.
        </p>`;
    } else {
      finding.innerHTML = `
        <p class="kicker">THE DECISION</p>
        <h2>The lower-priced route did not reduce human acceptance.</h2>
        <p>Reconcile project billing and value the measured review time before making a route decision.</p>`;
    }
  }

  function finishReview() {
    pauseTimer(false);
    state.status = "complete";
    state.phase = null;
    state.current = null;
    state.index = packet.items.length;
    saveState();
    renderComplete();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function exportPayload() {
    const records = state.records.map((record) => {
      const item = itemForRecord(record);
      return {
        item_id: record.item_id,
        case_id: item.case_id,
        response_label: item.response_label,
        route: item.route_key,
        model: packet.routes[item.route_key].model,
        accepted: record.accepted,
        review_seconds: Number((record.review_ms / 1000).toFixed(3)),
        correction_seconds: Number((record.correction_ms / 1000).toFixed(3)),
        correction_categories: record.correction_categories,
        correction_note: record.correction_note,
        review_disposition: record.review_disposition,
      };
    });
    const aggregates = Object.fromEntries(
      ["baseline", "proposed"].map((routeKey) => {
        const route = routeAggregate(routeKey);
        return [
          routeKey,
          {
            model: route.model,
            accepted: route.accepted,
            needs_expert_review: route.expertReview,
            reviewed: route.records.length,
            review_minutes: Number(minutes(route.reviewMs).toFixed(4)),
            correction_minutes: Number(minutes(route.correctionMs).toFixed(4)),
            estimated_token_charge_usd: route.estimated_token_charge,
          },
        ];
      }),
    );
    return {
      schema_version: "ai-cost-lens-human-review/1.0",
      experiment_id: packet.experiment_id,
      packet_id: packet.packet_id,
      completed_at: new Date().toISOString(),
      source_hashes: packet.source_hashes,
      labor_rate_usd_per_hour: state.labor_rate,
      aggregates,
      records,
    };
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function downloadJson() {
    const payload = exportPayload();
    download(
      `${packet.experiment_id}-human-review.json`,
      `${JSON.stringify(payload, null, 2)}\n`,
      "application/json",
    );
  }

  function showJson() {
    const panel = byId("json-fallback");
    const output = byId("json-output");
    output.value = JSON.stringify(exportPayload(), null, 2);
    panel.hidden = false;
    output.focus();
    output.select();
    panel.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function csvCell(value) {
    const string = Array.isArray(value) ? value.join("|") : String(value ?? "");
    return `"${string.replaceAll('"', '""')}"`;
  }

  function downloadCsv() {
    const payload = exportPayload();
    const header = [
      "item_id",
      "case_id",
      "response_label",
      "route",
      "model",
      "accepted",
      "review_disposition",
      "review_seconds",
      "correction_seconds",
      "correction_categories",
      "correction_note",
    ];
    const rows = payload.records.map((record) =>
      header.map((field) => csvCell(record[field])).join(","),
    );
    download(
      `${packet.experiment_id}-human-review.csv`,
      `${header.join(",")}\n${rows.join("\n")}\n`,
      "text/csv;charset=utf-8",
    );
  }

  function resetReview() {
    if (!window.confirm("Reset every review decision and timer for this packet?")) return;
    if (storageAvailable) window.localStorage.removeItem(storageKey);
    state = initialState();
    window.location.reload();
  }

  byId("begin-review").addEventListener("click", beginReview);
  byId("resume-review").addEventListener("click", beginTimer);
  byId("accept-response").addEventListener("click", acceptCurrent);
  byId("unsure-response").addEventListener("click", flagForExpertReview);
  byId("correct-response").addEventListener("click", beginCorrection);
  byId("back-to-decision").addEventListener("click", cancelCorrection);
  byId("correction-panel").addEventListener("submit", saveCorrection);
  byId("labor-rate").addEventListener("input", renderAllIn);
  byId("download-json").addEventListener("click", downloadJson);
  byId("download-csv").addEventListener("click", downloadCsv);
  byId("show-json").addEventListener("click", showJson);
  byId("reset-review").addEventListener("click", resetReview);

  byId("pilot-label").textContent = `${packet.experiment_id.replaceAll("-", " ")} · blinded review`;
  byId("intro-response-count").textContent = String(responseCount);
  byId("response-count").textContent = String(responseCount);
  byId("decision-count").textContent = String(caseCount);

  if (!storageAvailable) {
    byId("storage-note").textContent =
      "This browser is not allowing local progress storage. Keep the file open until you download the completed review.";
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.status === "reviewing") pauseTimer(true);
  });
  window.addEventListener("beforeunload", () => pauseTimer(false));

  if (state.status === "complete" && state.records.length === packet.items.length) {
    renderComplete();
  } else if (state.status === "reviewing") {
    renderCurrent();
  } else {
    setScreen("intro");
  }
})();
