(() => {
  "use strict";

  const STORAGE_KEY = "bosvut-7q91-state-v1";
  const FIT_EPOCH_MS = Date.UTC(1989, 11, 31);
  const RACE = {
    name: "Veluwe Ultra Trail",
    date: "2026-07-25",
    distanceKm: 53,
    ascentM: 450,
    targetMinutes: 315
  };

  const PROFILE = {
    age: 43,
    heightM: 1.76,
    weightKg: 72.5,
    vo2max: 54,
    maxHr: 201,
    paces: {
      easy: "5:31",
      threshold60: "4:19",
      threshold30: "4:07",
      vma: "3:37"
    },
    gutTraining: [50, 70]
  };

  const HR_ZONES = [
    { label: "Z1", min: 99, max: 122, color: "#6aa06b" },
    { label: "Z2", min: 122, max: 142, color: "#1e827a" },
    { label: "Z3", min: 142, max: 160, color: "#d58a24" },
    { label: "Z4", min: 160, max: 183, color: "#c95d49" },
    { label: "Z5", min: 183, max: 203, color: "#874a7d" }
  ];

  const DEFAULT_PRODUCTS = {
    puree: 26,
    gel25: 25,
    gel30: 30,
    bar: 27,
    drink: 55
  };

  const PRODUCT_META = [
    { key: "puree", label: "Purée", unit: "g / unité", kind: "solid" },
    { key: "gel25", label: "Gel 25", unit: "g / unité", kind: "solid" },
    { key: "gel30", label: "Gel 30", unit: "g / unité", kind: "solid" },
    { key: "bar", label: "Barre", unit: "g / unité", kind: "solid" },
    { key: "drink", label: "Boisson 500 mL", unit: "g / flasque", kind: "liquid" }
  ];

  let state = loadState();
  let currentPlanWeeks = [];
  let latestAdjustmentText = "";

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    registerServiceWorker();
    integrateSeedData();
    bindNavigation();
    bindForms();
    bindDataControls();
    renderAll();
    updateFeedbackNutritionPreview();
    updateNutritionCalculators();
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  }

  function loadState() {
    const fallback = {
      activities: [],
      feedbacks: [],
      adjustments: [],
      products: { ...DEFAULT_PRODUCTS },
      lastImportAt: null,
      seedVersion: null
    };

    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return fallback;
      const parsed = JSON.parse(saved);
      return {
        ...fallback,
        ...parsed,
        products: { ...DEFAULT_PRODUCTS, ...(parsed.products || {}) },
        activities: Array.isArray(parsed.activities) ? parsed.activities : [],
        feedbacks: Array.isArray(parsed.feedbacks) ? parsed.feedbacks : [],
        adjustments: Array.isArray(parsed.adjustments) ? parsed.adjustments : [],
        seedVersion: parsed.seedVersion || null
      };
    } catch {
      return fallback;
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function integrateSeedData() {
    const seed = window.BOSVUT_SEED_DATA;
    if (!seed || !Array.isArray(seed.activities) || !seed.activities.length) return;

    const before = state.activities.length;
    state.activities = mergeActivities(state.activities, seed.activities);
    const changed = before !== state.activities.length || state.seedVersion !== seed.version;
    if (!changed) return;

    state.seedVersion = seed.version || state.seedVersion;
    state.lastImportAt = seed.generatedAt || state.lastImportAt || new Date().toISOString();
    saveState();
  }

  function bindNavigation() {
    document.querySelectorAll(".tab-button").forEach((button) => {
      button.addEventListener("click", () => {
        const view = button.dataset.view;
        document.querySelectorAll(".tab-button").forEach((item) => item.classList.remove("active"));
        document.querySelectorAll("[data-view-panel]").forEach((panel) => panel.classList.remove("active"));
        button.classList.add("active");
        document.querySelector(`[data-view-panel="${view}"]`)?.classList.add("active");
      });
    });
  }

  function bindForms() {
    const adjustmentForm = document.getElementById("adjustmentForm");
    adjustmentForm?.addEventListener("submit", handleAdjustmentSubmit);
    adjustmentForm?.querySelectorAll('input[type="range"]').forEach((input) => {
      input.addEventListener("input", () => updateRangeOutput(input));
      updateRangeOutput(input);
    });

    const feedbackForm = document.getElementById("feedbackForm");
    feedbackForm?.addEventListener("submit", handleFeedbackSubmit);
    feedbackForm?.addEventListener("input", updateFeedbackNutritionPreview);
    feedbackForm?.sessionId?.addEventListener("change", syncFeedbackDurationFromSession);

    const directForm = document.getElementById("directNutritionForm");
    const inverseForm = document.getElementById("inverseNutritionForm");
    directForm?.addEventListener("input", updateNutritionCalculators);
    inverseForm?.addEventListener("input", updateNutritionCalculators);
    document.getElementById("autoPlanNutritionButton")?.addEventListener("click", autoPlanNutrition);
    document.getElementById("copyAdjustmentButton")?.addEventListener("click", copyLatestAdjustment);
  }

  function bindDataControls() {
    document.getElementById("fileInput")?.addEventListener("change", handleFileImport);
    document.getElementById("exportButton")?.addEventListener("click", exportBackup);
    document.getElementById("backupInput")?.addEventListener("change", importBackup);
  }

  function renderAll() {
    currentPlanWeeks = buildPlanWeeks(new Date());
    renderRaceHeader();
    renderDashboard();
    renderPlan();
    renderSessionSelects();
    renderFeedbackHistory();
    renderProductEditor();
    renderActivityList();
    renderDataStatus();
  }

  function renderDataStatus() {
    const status = document.getElementById("importStatus");
    if (!status) return;

    const seed = window.BOSVUT_SEED_DATA;
    if (state.activities.length && seed?.summary) {
      status.textContent =
        `${state.activities.length} activité(s) intégrée(s), dont ${seed.summary.runs} sorties running préchargées depuis ${seed.summary.files} fichier(s). ` +
        `Période: ${formatDate(new Date(seed.summary.firstActivity))} → ${formatDate(new Date(seed.summary.lastActivity))}.`;
    } else if (state.activities.length) {
      status.textContent = `${state.activities.length} activité(s) disponibles dans le navigateur.`;
    }
  }

  function renderRaceHeader() {
    const chip = document.getElementById("raceChip");
    const countdown = document.getElementById("countdownMetric");
    const target = document.getElementById("targetMetric");
    const gut = document.getElementById("gutMetric");
    const days = Math.max(0, daysBetween(startOfDay(new Date()), parseLocalDate(RACE.date)));

    if (chip) chip.textContent = `${RACE.name} · ${formatDate(parseLocalDate(RACE.date))}`;
    if (countdown) countdown.textContent = `${days} jours`;
    if (target) target.textContent = `objectif < ${formatDuration(RACE.targetMinutes * 60)}`;
    if (gut) gut.textContent = `gut training ${PROFILE.gutTraining[0]}-${PROFILE.gutTraining[1]} g/h`;
  }

  function renderDashboard() {
    const now = new Date();
    const runs = getRuns();
    const all = getActivities();
    const currentWeekStart = startOfWeek(now);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const last4Start = addDays(now, -28);
    const last8Start = addDays(now, -56);
    const previous4Start = addDays(now, -56);
    const previous4End = addDays(now, -28);

    const yearStats = sumStats(runs.filter((item) => new Date(item.date) >= yearStart));
    const monthStats = sumStats(runs.filter((item) => new Date(item.date) >= monthStart));
    const weekStats = sumStats(runs.filter((item) => new Date(item.date) >= currentWeekStart));
    const fourWeekStats = sumStats(runs.filter((item) => new Date(item.date) >= last4Start));
    const eightWeekStats = sumStats(runs.filter((item) => new Date(item.date) >= last8Start));
    const previous4Stats = sumStats(
      runs.filter((item) => {
        const date = new Date(item.date);
        return date >= previous4Start && date < previous4End;
      })
    );

    const readiness = calculateReadiness(runs, state.feedbacks, fourWeekStats, eightWeekStats);
    const volumeTrend = previous4Stats.distanceKm
      ? ((fourWeekStats.distanceKm - previous4Stats.distanceKm) / previous4Stats.distanceKm) * 100
      : null;

    renderProgressCards(yearStats, monthStats, weekStats, fourWeekStats);
    renderWeeklyChart(runs);
    renderIntensityChart(runs);
    renderPerformanceEstimates(readiness, volumeTrend);
    renderFitnessSummary(all, runs, readiness, volumeTrend);

    const ring = document.getElementById("readinessRing");
    const value = document.getElementById("readinessValue");
    if (ring) ring.style.setProperty("--score", String(readiness.score));
    if (value) value.textContent = `${readiness.score}`;

    const lastImport = document.getElementById("lastImportLabel");
    if (lastImport) {
      lastImport.textContent = state.lastImportAt
        ? `import ${formatDateTime(new Date(state.lastImportAt))}`
        : "aucune donnée importée";
    }
  }

  function renderProgressCards(yearStats, monthStats, weekStats, fourWeekStats) {
    const container = document.getElementById("progressMetrics");
    if (!container) return;

    const cards = [
      {
        label: "Année",
        value: `${round(yearStats.distanceKm, 1)} km`,
        detail: `${formatDuration(yearStats.durationSec)} · D+ ${Math.round(yearStats.ascentM)} m`
      },
      {
        label: "Mois",
        value: `${round(monthStats.distanceKm, 1)} km`,
        detail: `${monthStats.runs} sorties · ${round(monthStats.avgKmPerRun, 1)} km/sortie`
      },
      {
        label: "Semaine",
        value: `${round(weekStats.distanceKm, 1)} km`,
        detail: `${formatDuration(weekStats.durationSec)} · ${weekStats.runs} runs`
      },
      {
        label: "4 dernières semaines",
        value: `${round(fourWeekStats.distanceKm, 1)} km`,
        detail: `${round(fourWeekStats.distanceKm / 4, 1)} km/semaine · ${fourWeekStats.longRuns} longues`
      }
    ];

    container.innerHTML = cards.map(renderMetricCard).join("");
  }

  function renderMetricCard(card) {
    return `
      <article class="metric-card">
        <span>${escapeHtml(card.label)}</span>
        <strong>${escapeHtml(card.value)}</strong>
        <p>${escapeHtml(card.detail)}</p>
      </article>
    `;
  }

  function renderWeeklyChart(runs) {
    const container = document.getElementById("weeklyChart");
    if (!container) return;

    const weeks = buildWeekBuckets(runs, 12);
    const maxDistance = Math.max(1, ...weeks.map((week) => week.distanceKm));

    if (!runs.length) {
      container.innerHTML = `<p class="empty-state">Importe un export Garmin pour visualiser la charge.</p>`;
      return;
    }

    container.innerHTML = weeks
      .map((week) => {
        const width = Math.max(3, (week.distanceKm / maxDistance) * 100);
        return `
          <div class="bar-row">
            <span>${escapeHtml(week.label)}</span>
            <div class="bar-track"><div class="bar-fill" style="--bar-width:${width}%"></div></div>
            <span>${round(week.distanceKm, 1)} km</span>
          </div>
        `;
      })
      .join("");
  }

  function renderIntensityChart(runs) {
    const container = document.getElementById("intensityChart");
    if (!container) return;

    const zoneTotals = HR_ZONES.map((zone) => ({ ...zone, seconds: 0 }));
    let totalSeconds = 0;
    runs.forEach((run) => {
      if (!run.avgHr || !run.durationSec) return;
      const zone = zoneTotals.find((item) => run.avgHr >= item.min && run.avgHr < item.max) || zoneTotals[zoneTotals.length - 1];
      zone.seconds += run.durationSec;
      totalSeconds += run.durationSec;
    });

    if (!totalSeconds) {
      container.innerHTML = `<p class="empty-state">Pas encore assez de fréquence cardiaque exploitable.</p>`;
      return;
    }

    container.innerHTML = zoneTotals
      .map((zone) => {
        const percent = (zone.seconds / totalSeconds) * 100;
        return `
          <div class="zone-row">
            <span><i class="zone-dot" style="--zone-color:${zone.color}"></i> ${zone.label}</span>
            <div class="zone-track">
              <div class="zone-fill" style="--zone-width:${percent}%; --zone-color:${zone.color}"></div>
            </div>
            <span>${Math.round(percent)}%</span>
          </div>
        `;
      })
      .join("");
  }

  function renderPerformanceEstimates(readiness, volumeTrend) {
    const trend = document.getElementById("projectionTrend");
    const container = document.getElementById("performanceEstimates");
    if (!container) return;

    if (trend) {
      if (volumeTrend === null) {
        trend.textContent = "profil initial";
      } else if (volumeTrend > 18) {
        trend.textContent = "progression nette";
      } else if (volumeTrend < -18) {
        trend.textContent = "volume en baisse";
      } else {
        trend.textContent = "stable";
      }
    }

    const estimates = estimatePerformances(readiness.score);
    container.innerHTML = [
      { label: "Marathon", value: formatDuration(estimates.marathon * 60), detail: "référence route" },
      { label: "Trail 50 km", value: formatDuration(estimates.trail50 * 60), detail: "profil roulant" },
      { label: "Trail 80 km", value: formatDuration(estimates.trail80 * 60), detail: "endurance longue" },
      { label: "Trail 100 km", value: formatDuration(estimates.trail100 * 60), detail: "objectif 1-2 ans" },
      { label: "VUT100 53 km", value: formatDuration(estimates.vut * 60), detail: readiness.note }
    ]
      .map(
        (item) => `
          <article class="estimate-card">
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.value)}</strong>
            <p>${escapeHtml(item.detail)}</p>
          </article>
        `
      )
      .join("");
  }

  function renderFitnessSummary(allActivities, runs, readiness, volumeTrend) {
    const headline = document.getElementById("fitnessHeadline");
    const summary = document.getElementById("fitnessSummary");
    if (!headline || !summary) return;

    if (!allActivities.length) {
      headline.textContent = "Profil initial prêt";
      summary.textContent =
        "Allures actuelles, zones Garmin, VUT100 et gut training sont préchargés. Importe tes fichiers pour personnaliser la charge réelle.";
      return;
    }

    const last4 = sumStats(runs.filter((item) => new Date(item.date) >= addDays(new Date(), -28)));
    const last8 = sumStats(runs.filter((item) => new Date(item.date) >= addDays(new Date(), -56)));
    const warnings = [];
    if (volumeTrend !== null && volumeTrend > 25) warnings.push("hausse de volume à surveiller");
    if (readiness.maxPain >= 5) warnings.push("douleur récente à sécuriser");
    if (readiness.avgFatigue >= 7) warnings.push("fatigue élevée");
    if (!warnings.length) warnings.push("charge lisible");

    headline.textContent = `${round(last4.distanceKm / 4, 1)} km/semaine sur 4 semaines`;
    summary.textContent = `${runs.length} sorties running importées. 8 semaines: ${round(last8.distanceKm, 1)} km. Sorties longues récentes: ${last4.longRuns}. Point de vigilance: ${warnings.join(", ")}.`;
  }

  function calculateReadiness(runs, feedbacks, fourWeekStats, eightWeekStats) {
    const recentRuns = runs.filter((item) => new Date(item.date) >= addDays(new Date(), -28));
    const avg4 = fourWeekStats.distanceKm / 4;
    const avg8 = eightWeekStats.distanceKm / 8;
    const longest = recentRuns.reduce((max, item) => Math.max(max, item.distanceKm || 0), 0);
    const weeksWithThreeRuns = countWeeksWithRuns(recentRuns, 4, 3);
    const recentFeedback = feedbacks.slice(-6);
    const avgFatigue = average(recentFeedback.map((item) => numberOrZero(item.fatigue)).filter(Boolean));
    const maxPain = recentFeedback.reduce((max, item) => Math.max(max, numberOrZero(item.painIntensity)), 0);
    const gutRates = feedbacks
      .filter((item) => item.durationMin >= 60 && item.carbRate)
      .slice(-8)
      .map((item) => item.carbRate);
    const avgGut = average(gutRates);

    if (!runs.length) {
      return {
        score: 62,
        note: "à confirmer avec données",
        avgFatigue: 0,
        maxPain: 0,
        avgGut: 0,
        avg4: 0,
        avg8: 0,
        longest: 0
      };
    }

    const volumeScore = clamp((avg4 / 55) * 32, 0, 32);
    const longScore = clamp((longest / 32) * 22, 0, 22);
    const consistencyScore = clamp((weeksWithThreeRuns / 4) * 18, 0, 18);
    const stabilityScore = avg8 ? clamp(18 - Math.abs(avg4 - avg8) * 0.7, 4, 18) : 10;
    const gutScore = avgGut ? clamp(((avgGut - 45) / 30) * 10, 0, 10) : 6;
    const fatiguePenalty = avgFatigue >= 7 ? (avgFatigue - 6) * 4 : 0;
    const painPenalty = maxPain >= 4 ? maxPain * 2 : 0;
    const score = Math.round(clamp(volumeScore + longScore + consistencyScore + stabilityScore + gutScore - fatiguePenalty - painPenalty, 20, 96));

    let note = "trajectoire cohérente";
    if (score < 55) note = "prudence, consolider";
    if (score >= 75) note = "objectif réaliste";
    if (score >= 86) note = "objectif solide";

    return { score, note, avgFatigue, maxPain, avgGut, avg4, avg8, longest };
  }

  function estimatePerformances(score) {
    const delta = 70 - score;
    const marathon = clamp(215.5 + delta * 0.7, 195, 255);
    const vut = clamp(RACE.targetMinutes + delta * 1.8, 292, 395);
    const trail50 = clamp(vut * (50 / 53) - 4, 275, 380);
    const trail80 = clamp(vut * Math.pow(80 / 53, 1.15) + 22, 480, 790);
    const trail100 = clamp(vut * Math.pow(100 / 53, 1.18) + 50, 650, 1080);
    return { marathon, trail50, trail80, trail100, vut };
  }

  function renderPlan() {
    const container = document.getElementById("planContainer");
    const phase = document.getElementById("planPhase");
    renderFullPlanOverview();
    if (!container) return;

    if (phase) phase.textContent = currentPlanWeeks[0]?.phase || "phase VUT100";

    container.innerHTML = currentPlanWeeks
      .map((week) => {
        const totals = sumPlanWeek(week);
        return `
          <section class="week-block">
            <div class="week-heading">
              <h3>${escapeHtml(week.title)}</h3>
              <span>${escapeHtml(week.phase)} · ${totals.duration} · ${totals.km}</span>
            </div>
            <div class="plan-days">
              ${week.sessions.map(renderPlanSession).join("")}
            </div>
          </section>
        `;
      })
      .join("");
  }

  function renderFullPlanOverview() {
    const container = document.getElementById("fullPlanOverview");
    const metrics = document.getElementById("fullPlanMetrics");
    const horizon = document.getElementById("fullPlanHorizon");
    if (!container || !metrics) return;

    const weeks = buildFullPlanOverview(new Date());
    if (horizon) {
      horizon.textContent = weeks.length
        ? `${weeks.length} semaine(s) · course le ${formatDate(parseLocalDate(RACE.date))}`
        : "objectif passé";
    }

    if (!weeks.length) {
      metrics.innerHTML = "";
      container.innerHTML = `<p class="empty-state">Aucune semaine future à projeter.</p>`;
      return;
    }

    const plannedKm = weeks.reduce((sum, week) => sum + week.plannedDistanceKm, 0);
    const plannedSeconds = weeks.reduce((sum, week) => sum + week.plannedDurationMin * 60, 0);
    const preRaceLongRun = weeks
      .flatMap((week) => week.sessions)
      .filter((sessionItem) => sessionItem.type !== "Course")
      .reduce((max, sessionItem) => Math.max(max, averageKmFromLabel(sessionItem.kmLabel)), 0);
    const currentWeek = weeks.find((week) => week.statusKey === "current") || weeks[0];

    metrics.innerHTML = [
      {
        label: "Total prévu",
        value: `${round(plannedKm, 0)} km`,
        detail: `${formatDuration(plannedSeconds)} de course`
      },
      {
        label: "Semaine en cours",
        value: `${round(currentWeek.plannedDistanceKm, 0)} km`,
        detail: `${formatDuration(currentWeek.plannedDurationMin * 60)} prévus · ${round(currentWeek.actualDistanceKm, 1)} km réalisés`
      },
      {
        label: "Plus longue avant course",
        value: `${round(preRaceLongRun, 0)} km`,
        detail: "hors VUT100"
      },
      {
        label: "Jour J",
        value: "53 km",
        detail: `D+ ${RACE.ascentM} m · cible ${formatDuration(RACE.targetMinutes * 60)}`
      }
    ].map(renderMetricCard).join("");

    const maxKm = Math.max(1, ...weeks.map((week) => Math.max(week.plannedDistanceKm, week.actualDistanceKm)));
    container.innerHTML = `
      <div class="plan-overview-row plan-overview-head">
        <span>Semaine</span>
        <span>Phase</span>
        <span>Prévu</span>
        <span>Réalisé</span>
        <span>Sortie clé</span>
        <span>Focus</span>
      </div>
      ${weeks.map((week) => renderPlanOverviewRow(week, maxKm)).join("")}
    `;
  }

  function renderPlanOverviewRow(week, maxKm) {
    const plannedWidth = Math.max(3, (week.plannedDistanceKm / maxKm) * 100);
    const actualWidth = Math.max(0, (week.actualDistanceKm / maxKm) * 100);
    const actualText = week.actualDistanceKm
      ? `${round(week.actualDistanceKm, 1)} km · ${formatDuration(week.actualDurationSec)}`
      : "à venir";

    return `
      <article class="plan-overview-row ${week.statusKey}">
        <div>
          <strong>S${week.isoWeek}</strong>
          <span>${escapeHtml(week.rangeLabel)}</span>
          <span class="status-chip ${week.statusKey === "current" ? "today" : week.statusKey === "future" ? "future" : "past"}">${escapeHtml(week.statusLabel)}</span>
        </div>
        <div>
          <strong>${escapeHtml(week.phase)}</strong>
          <span>${week.sessions.filter((item) => item.type !== "Repos").length} séances running</span>
        </div>
        <div>
          <strong>${round(week.plannedDistanceKm, 0)} km</strong>
          <span>${escapeHtml(formatDuration(week.plannedDurationMin * 60))}</span>
          <div class="mini-track"><div class="mini-fill planned" style="--mini-width:${plannedWidth}%"></div></div>
        </div>
        <div>
          <strong>${escapeHtml(actualText)}</strong>
          <span>${week.actualAscentM ? `D+ ${Math.round(week.actualAscentM)} m` : "Garmin"}</span>
          <div class="mini-track"><div class="mini-fill actual" style="--mini-width:${actualWidth}%"></div></div>
        </div>
        <div>
          <strong>${escapeHtml(week.keySession.title)}</strong>
          <span>${escapeHtml(week.keySession.kmLabel)} · ${escapeHtml(week.keySession.durationLabel)}</span>
        </div>
        <div>
          <strong>${escapeHtml(week.focus)}</strong>
          <span>${escapeHtml(week.nutrition)}</span>
        </div>
      </article>
    `;
  }

  function buildFullPlanOverview(referenceDate) {
    const today = startOfDay(referenceDate);
    const currentMonday = startOfWeek(today);
    const raceMonday = startOfWeek(parseLocalDate(RACE.date));
    if (currentMonday > raceMonday) return [];

    const runs = getRuns();
    const weeks = [];
    for (let weekStart = currentMonday, offset = 0; weekStart <= raceMonday; weekStart = addDays(weekStart, 7), offset += 1) {
      const planWeek = buildPlanWeek(weekStart, offset);
      const totals = sumPlanWeekNumbers(planWeek);
      const weekEnd = addDays(weekStart, 7);
      const actualStats = sumStats(runs.filter((run) => {
        const date = new Date(run.date);
        return date >= weekStart && date < weekEnd;
      }));
      const keySession = planWeek.sessions
        .filter((sessionItem) => sessionItem.type !== "Repos")
        .sort((a, b) => averageKmFromLabel(b.kmLabel) - averageKmFromLabel(a.kmLabel))[0] || planWeek.sessions[0];
      const statusKey = weekStart.getTime() === currentMonday.getTime() ? "current" : weekStart > currentMonday ? "future" : "past";

      weeks.push({
        ...planWeek,
        isoWeek: getIsoWeek(weekStart),
        rangeLabel: formatWeekRange(weekStart),
        plannedDistanceKm: totals.distanceKm,
        plannedDurationMin: totals.durationMin,
        actualDistanceKm: actualStats.distanceKm,
        actualDurationSec: actualStats.durationSec,
        actualAscentM: actualStats.ascentM,
        keySession,
        statusKey,
        statusLabel: statusKey === "current" ? "en cours" : "à venir",
        focus: planWeek.phase === "Semaine course" ? "Course cible" : keySession.objective,
        nutrition: keySession.nutrition || "Hydratation simple"
      });
    }

    return weeks;
  }

  function renderPlanSession(session) {
    const status = getSessionStatus(session.date);
    return `
      <article class="plan-day">
        <div>
          <strong class="day-name">${escapeHtml(session.day)}</strong>
          <span class="day-date">${escapeHtml(formatShortDate(parseLocalDate(session.date)))}</span>
          <span class="status-chip ${status.className}">${escapeHtml(status.label)}</span>
        </div>
        <div>
          <strong class="session-title">${escapeHtml(session.type)}</strong>
          <span class="subtext">${escapeHtml(session.title)}</span>
        </div>
        <div class="session-content">${escapeHtml(session.content)}<br><strong>Objectif:</strong> ${escapeHtml(session.objective)}</div>
        <div>
          <strong>${escapeHtml(session.durationLabel)}</strong>
          <span class="subtext">${escapeHtml(session.kmLabel)}</span>
        </div>
        <div class="session-content">${escapeHtml(session.nutrition || "Hydratation simple")}</div>
      </article>
    `;
  }

  function buildPlanWeeks(referenceDate) {
    const monday = startOfWeek(referenceDate);
    return [0, 1, 2].map((offset) => buildPlanWeek(addDays(monday, offset * 7), offset));
  }

  function buildPlanWeek(monday, offset) {
    const daysToRace = daysBetween(monday, parseLocalDate(RACE.date));
    const phase = getPlanPhase(daysToRace);
    const template = getPlanTemplate(phase, offset);
    const title = offset === 0 ? `Semaine en cours · ${formatDate(monday)}` : `Semaine +${offset} · ${formatDate(monday)}`;

    return {
      id: isoDate(monday),
      title,
      phase,
      sessions: template.map((session) => ({
        ...session,
        id: `${isoDate(addDays(monday, session.dayOffset))}-${slugify(session.type)}`,
        date: isoDate(addDays(monday, session.dayOffset))
      }))
    };
  }

  function getPlanPhase(daysToRace) {
    if (daysToRace <= 7) return "Semaine course";
    if (daysToRace <= 14) return "Affûtage final";
    if (daysToRace <= 21) return "Affûtage progressif";
    if (daysToRace <= 30) return "Dernier gros bloc";
    return "Bloc spécifique";
  }

  function getPlanTemplate(phase) {
    const commonTuesday = {
      dayOffset: 1,
      day: "Mardi",
      type: "Repos",
      title: "Récupération",
      content: "Repos complet, mobilité douce 8-10 min si besoin.",
      durationMin: 0,
      durationLabel: "0 min",
      kmLabel: "0 km",
      objective: "Assimiler la charge sans compensation.",
      nutrition: "Repas normaux, hydratation régulière."
    };

    if (phase === "Semaine course") {
      return [
        session(0, "Lundi", "Activation", "Footing + lignes droites", "35 min Z1-Z2 puis 5 x 20 s relâchées, récupération complète.", 40, "6-7 km", "Garder de la fraîcheur neuromusculaire.", "Hydratation, glucides normaux."),
        commonTuesday,
        session(2, "Mercredi", "Rappel allure", "Dernier rappel", "15 min faciles, 3 x 3 min allure course en aisance, 10 min faciles.", 38, "6-7 km", "Verrouiller le rythme sans créer de fatigue.", "Tester une dernière prise légère si sortie > 45 min."),
        session(4, "Vendredi", "Pré-course", "Déverrouillage", "20-25 min très facile + 4 accélérations de 12 s. Pas de renforcement intense.", 25, "4 km", "Arriver frais.", "Préparer le plan A/B/C nutrition."),
        session(5, "Samedi", "Course", "Veluwe Ultra Trail 53 km", "Départ prudent, Z2 majoritaire, relances courtes, marche active si besoin.", 315, "53 km · D+ 450 m", "Terminer sous 5 h 15 avec gestion régulière.", "70 g/h si toléré: 2/3 liquide, 1/3 solide, boire tôt.")
      ];
    }

    if (phase === "Affûtage final") {
      return [
        session(0, "Lundi", "Qualité légère", "3 x 8 min seuil 60", "15 min EF, 3 x 8 min à 4:19/km ou Z3 haute, récup 3 min, 10 min retour calme.", 58, "10-11 km", "Entretenir le seuil sans entamer les jambes.", "Eau, pas de charge glucidique spécifique."),
        commonTuesday,
        session(2, "Mercredi", "Endurance", "Footing court", "40-45 min en Z2 basse, cadence fluide.", 45, "7-8 km", "Rester économique.", "Hydratation simple."),
        session(4, "Vendredi", "Facile", "Footing ou renfo allégé", "30-35 min Z1-Z2. Si renfo vendredi midi: réduire les jambes et éviter l’échec musculaire.", 35, "5-6 km", "Conserver le rythme hebdo avec fraîcheur.", "Hydratation simple."),
        session(5, "Samedi", "Sortie longue", "Longue réduite", "1 h 45 à 2 h 00 en Z2, 3 blocs de 10 min allure course, terrain souple si possible.", 115, "18-21 km", "Dernière répétition sans fatigue durable.", "60-70 g/h, tester combinaison prévue.")
      ];
    }

    if (phase === "Affûtage progressif") {
      return [
        session(0, "Lundi", "Qualité", "5 x 5 min seuil 30 contrôlé", "15 min EF, 5 x 5 min à 4:07/km avec 2 min trot, 10 min retour calme.", 60, "11-12 km", "Stimuler l’allure sans volume excessif.", "Eau, collation post-séance."),
        commonTuesday,
        session(2, "Mercredi", "Endurance", "45 min EF", "45 min à 5:31-5:50/km, Z2 basse.", 45, "7-8 km", "Aérobie facile.", "Hydratation simple."),
        session(4, "Vendredi", "Facile", "Footing + mobilité", "35-40 min Z1-Z2, mobilité hanches/mollets. Renfo intense seulement si jambes fraîches.", 40, "6-7 km", "Garder la mécanique sans stress.", "Hydratation simple."),
        session(6, "Dimanche", "Sortie longue", "2 h 10 trail simulé", "Z2 majoritaire, intégrer ponts, escaliers ou faux-plats, 4 x 12 min allure course.", 130, "22-24 km", "Valider économie et nutrition.", "60-70 g/h: 1 flasque/h + solides réguliers.")
      ];
    }

    if (phase === "Dernier gros bloc") {
      return [
        session(0, "Lundi", "Qualité", "2 x 20 min seuil 60", "15 min EF, 2 x 20 min à 4:19/km ou Z3 stable, récup 4 min, 10 min retour calme.", 72, "13-15 km", "Construire la puissance durable.", "Eau, dîner riche en glucides."),
        commonTuesday,
        session(2, "Mercredi", "Endurance", "45 min EF", "45 min facile, garder la FC en Z2 basse même si l’allure baisse.", 45, "7-8 km", "Assimilation.", "Hydratation simple."),
        session(4, "Vendredi", "Facile", "Footing pré-long", "30-35 min très facile + 6 x 15 s relâchées. Renfo jambes à modérer.", 35, "5-6 km", "Préparer la sortie longue.", "Hydratation simple."),
        session(5, "Samedi", "Sortie longue", "3 h 10 spécifique VUT", "Z2, alternance course/marche 5 min toutes les 40 min, chercher terrain irrégulier Amsterdamse Bos.", 190, "30-34 km", "Dernier gros stimulus d’endurance.", "65-70 g/h: viser stratégie course, noter digestion.")
      ];
    }

    return [
      session(0, "Lundi", "Qualité", "3 x 10 min seuil 60", "15 min EF, 3 x 10 min à 4:19/km, récup 3 min trot, 10 min retour calme.", 65, "12-13 km", "Solidifier le seuil aérobie.", "Eau, collation post-séance."),
      commonTuesday,
      session(2, "Mercredi", "Endurance", "45 min EF", "45 min à 5:31-5:50/km, option 6 x 20 s si jambes fraîches.", 45, "7-8 km", "Volume facile compatible famille.", "Hydratation simple."),
      session(4, "Vendredi", "Facile", "Footing + renfo", "35-40 min Z1-Z2. Si renfo intense à midi: courir très facile ou remplacer par mobilité.", 40, "6-7 km", "Limiter la charge cumulée avec le renforcement.", "Hydratation simple."),
      session(5, "Samedi", "Sortie longue", "2 h 45 spécifique trail plat", "Z2, insérer 5 x 8 min allure course sur chemins, ponts ou escaliers si disponibles.", 165, "27-30 km", "Endurance longue et économie en terrain roulant.", "60-65 g/h: boisson + gels/purées, noter g/h réel.")
    ];
  }

  function session(dayOffset, day, type, title, content, durationMin, kmLabel, objective, nutrition) {
    return {
      dayOffset,
      day,
      type,
      title,
      content,
      durationMin,
      durationLabel: formatDuration(durationMin * 60),
      kmLabel,
      objective,
      nutrition
    };
  }

  function renderSessionSelects() {
    const sessions = currentPlanWeeks.flatMap((week) => week.sessions).filter((item) => item.type !== "Repos");
    const options = sessions
      .map((sessionItem) => `<option value="${escapeAttr(sessionItem.id)}">${escapeHtml(formatShortDate(parseLocalDate(sessionItem.date)))} · ${escapeHtml(sessionItem.type)} · ${escapeHtml(sessionItem.title)}</option>`)
      .join("");

    const feedbackSelect = document.getElementById("feedbackSessionSelect");
    const missedSelect = document.getElementById("missedSessionSelect");
    if (feedbackSelect) feedbackSelect.innerHTML = options || `<option value="manual">Séance libre</option>`;
    if (missedSelect) missedSelect.innerHTML = `<option value="none">Aucune séance manquée</option>${options}`;
    syncFeedbackDurationFromSession();
  }

  function handleAdjustmentSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const fatigue = numberOrZero(data.fatigue);
    const painIntensity = numberOrZero(data.painIntensity);
    const availableTime = numberOrZero(data.availableTime);
    const sessionLabel = getSessionLabel(data.missedSession);
    const lines = [];

    lines.push(`Contrainte: ${data.note?.trim() || "non précisée"}.`);
    lines.push(`Temps restant: ${availableTime} min. Fatigue: ${fatigue}/10. Douleur: ${data.painLocation || "aucune"} (${painIntensity}/10).`);

    if (painIntensity >= 6) {
      lines.push("Décision: supprimer l’intensité et la sortie longue ambitieuse. Remplacer par 30-45 min Z1 ou marche active, puis réévaluer la douleur 24 h après.");
    } else if (painIntensity >= 3) {
      lines.push("Décision: garder uniquement l’endurance facile, éviter seuil/VMA, réduire la sortie longue de 25-35%.");
    } else if (fatigue >= 8) {
      lines.push("Décision: semaine allégée immédiate, volume -40%, aucune compensation d’une séance manquée.");
    } else if (fatigue >= 6) {
      lines.push("Décision: réduire les blocs intenses de moitié et garder le week-end en Z2 confortable.");
    } else if (availableTime < 90) {
      lines.push("Décision: conserver une séance clé courte, 35-45 min EF + 6 accélérations, et reporter la progression à la semaine suivante.");
    } else if (availableTime < 150) {
      lines.push("Décision: prioriser la sortie longue raccourcie et supprimer les extras. Pas de rattrapage.");
    } else {
      lines.push("Décision: plan maintenu, avec contrôle de la fraîcheur avant la prochaine séance qualitative.");
    }

    if (data.missedSession && data.missedSession !== "none") {
      lines.push(`Séance concernée: ${sessionLabel}. Ne pas la rattraper automatiquement; la semaine reste cohérente autour des séances restantes.`);
    }

    lines.push("Message coach: ajustement demandé pour préserver la progression durable vers le VUT100.");
    latestAdjustmentText = lines.join("\n");

    state.adjustments.unshift({
      id: cryptoId(),
      createdAt: new Date().toISOString(),
      text: latestAdjustmentText,
      fatigue,
      painIntensity,
      painLocation: data.painLocation || "",
      availableTime,
      sessionId: data.missedSession || "none"
    });
    state.adjustments = state.adjustments.slice(0, 20);
    saveState();
    renderAdjustmentResult();
  }

  function renderAdjustmentResult() {
    const result = document.getElementById("adjustmentResult");
    const history = document.getElementById("adjustmentHistory");
    if (result) result.textContent = latestAdjustmentText || state.adjustments[0]?.text || "Aucun ajustement demandé pour l’instant.";
    if (!history) return;

    history.innerHTML = state.adjustments.slice(0, 4).map((item) => `
      <article class="timeline-item">
        <strong>${escapeHtml(formatDateTime(new Date(item.createdAt)))}</strong>
        <p>${escapeHtml(item.text.split("\n").slice(-2).join(" "))}</p>
      </article>
    `).join("");
  }

  function copyLatestAdjustment() {
    const text = latestAdjustmentText || state.adjustments[0]?.text || "";
    if (!text) return;
    navigator.clipboard?.writeText(text).then(() => {
      const box = document.getElementById("adjustmentResult");
      if (box) box.textContent = `${text}\n\nCopié.`;
    });
  }

  function handleFeedbackSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const nutrition = readNutritionCounts(form);
    const carbs = calculateCarbs(nutrition, state.products) + numberOrZero(data.otherCarbs);
    const durationMin = numberOrZero(data.durationMin);
    const carbRate = durationMin ? carbs / (durationMin / 60) : 0;
    const sessionLabel = getSessionLabel(data.sessionId);

    state.feedbacks.unshift({
      id: cryptoId(),
      createdAt: new Date().toISOString(),
      sessionId: data.sessionId,
      sessionLabel,
      feeling: data.feeling,
      fatigue: numberOrZero(data.fatigue),
      painLocation: data.painLocation || "",
      painIntensity: numberOrZero(data.painIntensity),
      sleep: data.sleep,
      durationMin,
      nutrition,
      otherCarbs: numberOrZero(data.otherCarbs),
      carbs,
      carbRate: round(carbRate, 1),
      note: data.note || ""
    });
    state.feedbacks = state.feedbacks.slice(0, 80);
    saveState();
    form.reset();
    form.feeling.value = "comme attendu";
    syncFeedbackDurationFromSession();
    updateFeedbackNutritionPreview();
    renderAll();
  }

  function renderFeedbackHistory() {
    const container = document.getElementById("feedbackHistory");
    if (!container) return;
    if (!state.feedbacks.length) {
      container.innerHTML = `<p class="empty-state">Aucun feedback enregistré.</p>`;
      return;
    }

    container.innerHTML = state.feedbacks.slice(0, 8).map((item) => {
      const pain = item.painIntensity ? ` · douleur ${escapeHtml(item.painLocation || "?" )} ${item.painIntensity}/10` : "";
      return `
        <article class="timeline-item">
          <strong>${escapeHtml(item.sessionLabel || "Séance")} · ${escapeHtml(item.feeling)}</strong>
          <p>${escapeHtml(formatDateTime(new Date(item.createdAt)))} · fatigue ${item.fatigue}/10 · sommeil ${escapeHtml(item.sleep)}${pain} · ${round(item.carbRate || 0, 1)} g/h</p>
        </article>
      `;
    }).join("");
  }

  function updateFeedbackNutritionPreview() {
    const form = document.getElementById("feedbackForm");
    const preview = document.getElementById("feedbackCarbRate");
    if (!form || !preview) return;
    const nutrition = readNutritionCounts(form);
    const other = numberOrZero(form.otherCarbs?.value);
    const durationMin = numberOrZero(form.durationMin?.value);
    const carbs = calculateCarbs(nutrition, state.products) + other;
    const rate = durationMin ? carbs / (durationMin / 60) : 0;
    preview.textContent = `${round(rate, 1)} g/h · ${round(carbs, 0)} g`;
  }

  function syncFeedbackDurationFromSession() {
    const form = document.getElementById("feedbackForm");
    if (!form?.sessionId || !form.durationMin) return;
    const sessionItem = findPlanSession(form.sessionId.value);
    if (sessionItem?.durationMin) form.durationMin.value = String(sessionItem.durationMin);
    updateFeedbackNutritionPreview();
  }

  function renderProductEditor() {
    const container = document.getElementById("productEditor");
    if (!container) return;
    container.innerHTML = PRODUCT_META.map((product) => `
      <div class="product-row">
        <label>
          ${escapeHtml(product.label)}
          <input type="number" min="0" step="1" value="${state.products[product.key]}" data-product-key="${escapeAttr(product.key)}" />
          <span>${escapeHtml(product.unit)}</span>
        </label>
      </div>
    `).join("");

    container.querySelectorAll("[data-product-key]").forEach((input) => {
      input.addEventListener("input", () => {
        state.products[input.dataset.productKey] = numberOrZero(input.value);
        saveState();
        updateFeedbackNutritionPreview();
        updateNutritionCalculators();
      });
    });
  }

  function autoPlanNutrition() {
    const form = document.getElementById("directNutritionForm");
    if (!form) return;
    const durationHours = readDurationHours(form);
    const target = numberOrZero(form.targetCarbs?.value);
    const total = target * durationHours;
    const solidTarget = total / 3;
    const bar = solidTarget > 130 ? 1 : 0;
    const puree = Math.max(1, Math.round((solidTarget * 0.28) / state.products.puree));
    let remaining = Math.max(0, solidTarget - bar * state.products.bar - puree * state.products.puree);
    const gel30 = Math.max(0, Math.floor(remaining / state.products.gel30));
    remaining -= gel30 * state.products.gel30;
    const gel25 = remaining > 8 ? 1 : 0;

    form.bar.value = String(bar);
    form.puree.value = String(puree);
    form.gel30.value = String(gel30);
    form.gel25.value = String(gel25);
    updateNutritionCalculators();
  }

  function updateNutritionCalculators() {
    renderDirectNutrition();
    renderInverseNutrition();
  }

  function renderDirectNutrition() {
    const form = document.getElementById("directNutritionForm");
    const result = document.getElementById("directNutritionResult");
    if (!form || !result) return;

    const durationHours = readDurationHours(form);
    const target = numberOrZero(form.targetCarbs?.value);
    const totalTarget = target * durationHours;
    const liquidTarget = totalTarget * (2 / 3);
    const solidTarget = totalTarget / 3;
    const flasks = state.products.drink ? Math.ceil(liquidTarget / state.products.drink) : 0;
    const counts = readNutritionCounts(form);
    const solidCarbs = counts.gel25 * state.products.gel25 + counts.gel30 * state.products.gel30 + counts.puree * state.products.puree + counts.bar * state.products.bar;
    const liquidCarbs = flasks * state.products.drink;
    const actualTotal = liquidCarbs + solidCarbs;
    const actualRate = durationHours ? actualTotal / durationHours : 0;

    result.textContent =
      `Cible: ${round(totalTarget, 0)} g sur ${formatHourDecimal(durationHours)}.\n` +
      `Répartition cible: ${round(liquidTarget, 0)} g liquide / ${round(solidTarget, 0)} g solide.\n` +
      `À prévoir: ${flasks} flasque(s) de 500 mL, ${counts.gel25} Gel 25, ${counts.gel30} Gel 30, ${counts.puree} purée(s), ${counts.bar} barre(s).\n` +
      `Plan actuel: ${round(actualTotal, 0)} g au total, soit ${round(actualRate, 1)} g/h. Écart: ${round(actualTotal - totalTarget, 0)} g.`;
  }

  function renderInverseNutrition() {
    const form = document.getElementById("inverseNutritionForm");
    const result = document.getElementById("inverseNutritionResult");
    if (!form || !result) return;

    const durationHours = readDurationHours(form);
    const counts = readNutritionCounts(form);
    const total = calculateCarbs(counts, state.products);
    const liquid = counts.drink * state.products.drink;
    const solid = total - liquid;
    const rate = durationHours ? total / durationHours : 0;

    result.textContent =
      `Total embarqué: ${round(total, 0)} g de glucides.\n` +
      `Liquide: ${round(liquid, 0)} g · solide: ${round(solid, 0)} g.\n` +
      `Pour ${formatHourDecimal(durationHours)}, cela donne ${round(rate, 1)} g/h.\n` +
      `Zone actuelle à travailler: ${PROFILE.gutTraining[0]}-${PROFILE.gutTraining[1]} g/h.`;
  }

  async function handleFileImport(event) {
    const files = Array.from(event.target.files || []);
    const status = document.getElementById("importStatus");
    if (!files.length) return;
    if (status) status.textContent = `Lecture de ${files.length} fichier(s)...`;

    const parsedActivities = [];
    const failures = [];

    for (const file of files) {
      const lower = file.name.toLowerCase();
      try {
        if (lower.endsWith(".csv")) {
          const text = await file.text();
          parsedActivities.push(...parseGarminCsv(text, file.webkitRelativePath || file.name));
        } else if (lower.endsWith(".fit")) {
          const buffer = await file.arrayBuffer();
          const fitActivity = parseFitActivity(buffer, file.webkitRelativePath || file.name);
          if (fitActivity) parsedActivities.push(fitActivity);
        }
      } catch (error) {
        failures.push(`${file.name}: ${error.message || "lecture impossible"}`);
      }
    }

    const before = state.activities.length;
    state.activities = mergeActivities(state.activities, parsedActivities);
    state.lastImportAt = new Date().toISOString();
    saveState();
    renderAll();

    const added = state.activities.length - before;
    if (status) {
      status.textContent =
        `${parsedActivities.length} activité(s) lue(s), ${added} nouvelle(s) ajoutée(s), ${state.activities.length} au total.` +
        (failures.length ? `\nFichiers ignorés: ${failures.slice(0, 5).join("; ")}` : "");
    }
    event.target.value = "";
  }

  function parseGarminCsv(text, source) {
    const rows = parseCsvRows(text.replace(/^\uFEFF/, ""));
    if (rows.length < 2) return [];
    const headers = rows[0].map(normalizeHeader);
    const index = {
      type: findHeader(headers, ["type activite", "activity type", "type"]),
      date: findHeader(headers, ["date"]),
      title: findHeader(headers, ["titre", "title"]),
      distance: findHeader(headers, ["distance"]),
      calories: findHeader(headers, ["calories"]),
      duration: findHeader(headers, ["duree", "time"]),
      avgHr: findHeader(headers, ["frequence cardiaque moyenne", "average heart rate", "avg hr"]),
      maxHr: findHeader(headers, ["frequence cardiaque maximale", "maximum heart rate", "max hr"]),
      trainingEffect: findHeader(headers, ["te aerobie", "aerobic"]),
      pace: findHeader(headers, ["allure moyenne", "avg pace"]),
      ascent: findHeader(headers, ["ascension totale", "total ascent"]),
      descent: findHeader(headers, ["descente totale", "total descent"]),
      tss: findHeader(headers, ["training stress score", "tss"])
    };

    return rows.slice(1).map((row, rowIndex) => {
      const rawType = cell(row, index.type);
      const normalizedType = normalizeText(rawType);
      const isRun = /course|running|run/.test(normalizedType);
      const isStrength = /muscu|strength|renforcement|cardio/.test(normalizedType);
      if (!isRun && !isStrength) return null;

      const date = parseGarminDate(cell(row, index.date));
      if (!date) return null;
      const distanceKm = numberOrZero(cell(row, index.distance));
      const durationSec = parseDuration(cell(row, index.duration));
      const trainingEffect = numberOrZero(cell(row, index.trainingEffect));
      const tss = numberOrZero(cell(row, index.tss));
      const avgHr = numberOrZero(cell(row, index.avgHr));
      const maxHr = numberOrZero(cell(row, index.maxHr));
      const paceSec = parsePace(cell(row, index.pace)) || (distanceKm ? durationSec / distanceKm : 0);

      return {
        id: stableActivityId(source, rowIndex, date, distanceKm, durationSec),
        source,
        type: isRun ? "run" : "strength",
        title: cell(row, index.title) || (isRun ? "Course à pied" : "Renforcement"),
        date: date.toISOString(),
        distanceKm,
        durationSec,
        calories: numberOrZero(cell(row, index.calories)),
        avgHr,
        maxHr,
        trainingEffect,
        tss,
        load: tss || estimateLoad(durationSec, trainingEffect, avgHr),
        paceSec,
        ascentM: numberOrZero(cell(row, index.ascent)),
        descentM: numberOrZero(cell(row, index.descent)),
        format: "csv"
      };
    }).filter(Boolean);
  }

  function parseCsvRows(text) {
    const rows = [];
    let row = [];
    let value = "";
    let quoted = false;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      const next = text[index + 1];

      if (char === '"' && quoted && next === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === "," && !quoted) {
        row.push(value);
        value = "";
      } else if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && next === "\n") index += 1;
        row.push(value);
        if (row.some((cellValue) => cellValue.trim() !== "")) rows.push(row);
        row = [];
        value = "";
      } else {
        value += char;
      }
    }

    row.push(value);
    if (row.some((cellValue) => cellValue.trim() !== "")) rows.push(row);
    return rows;
  }

  function parseFitActivity(buffer, source) {
    const view = new DataView(buffer);
    const headerSize = view.getUint8(0);
    const dataSize = view.getUint32(4, true);
    const dataStart = headerSize;
    const dataEnd = Math.min(buffer.byteLength, dataStart + dataSize);
    const defs = new Map();
    const sessions = [];
    const records = [];
    let offset = dataStart;

    while (offset < dataEnd) {
      const header = view.getUint8(offset);
      offset += 1;
      const compressed = Boolean(header & 0x80);
      const isDefinition = !compressed && Boolean(header & 0x40);
      const hasDeveloperFields = !compressed && Boolean(header & 0x20);
      const localMessage = compressed ? (header >> 5) & 0x03 : header & 0x0f;

      if (isDefinition) {
        const reserved = view.getUint8(offset);
        const architecture = view.getUint8(offset + 1);
        const littleEndian = architecture === 0;
        const globalMessage = view.getUint16(offset + 2, littleEndian);
        const fieldCount = view.getUint8(offset + 4);
        offset += 5;
        const fields = [];

        for (let index = 0; index < fieldCount; index += 1) {
          fields.push({
            num: view.getUint8(offset),
            size: view.getUint8(offset + 1),
            baseType: view.getUint8(offset + 2) & 0x1f
          });
          offset += 3;
        }

        if (hasDeveloperFields) {
          const devFieldCount = view.getUint8(offset);
          offset += 1 + devFieldCount * 3;
        }

        defs.set(localMessage, { reserved, globalMessage, fields, littleEndian });
        continue;
      }

      const def = defs.get(localMessage);
      if (!def) break;
      const values = {};
      for (const field of def.fields) {
        values[field.num] = readFitValue(view, offset, field.size, field.baseType, def.littleEndian);
        offset += field.size;
      }

      if (def.globalMessage === 18) sessions.push(values);
      if (def.globalMessage === 20) records.push(values);
    }

    const sessionMessage = sessions.find((item) => item[9] || item[8]) || sessions[0];
    if (sessionMessage) {
      const startTime = fitTimestamp(sessionMessage[2] || sessionMessage[253]);
      const durationSec = fitScaled(sessionMessage[8] || sessionMessage[7], 1000);
      const distanceKm = fitScaled(sessionMessage[9], 100000);
      const sport = sessionMessage[5];
      const type = sport === 1 || distanceKm > 0 ? "run" : "strength";
      return {
        id: stableActivityId(source, 0, startTime, distanceKm, durationSec),
        source,
        type,
        title: type === "run" ? "Course à pied FIT" : "Activité FIT",
        date: startTime.toISOString(),
        distanceKm,
        durationSec,
        calories: numberOrZero(sessionMessage[11]),
        avgHr: numberOrZero(sessionMessage[16]),
        maxHr: numberOrZero(sessionMessage[17]),
        trainingEffect: 0,
        tss: 0,
        load: estimateLoad(durationSec, 0, numberOrZero(sessionMessage[16])),
        paceSec: distanceKm ? durationSec / distanceKm : fitPaceFromSpeed(sessionMessage[14]),
        ascentM: numberOrZero(sessionMessage[21]),
        descentM: numberOrZero(sessionMessage[22]),
        format: "fit"
      };
    }

    if (records.length) {
      const timestamps = records.map((record) => record[253]).filter(Boolean).sort((a, b) => a - b);
      const first = fitTimestamp(timestamps[0]);
      const last = fitTimestamp(timestamps[timestamps.length - 1]);
      const durationSec = Math.max(0, (last - first) / 1000);
      const distanceKm = Math.max(0, ...records.map((record) => fitScaled(record[5], 100000)));
      const heartRates = records.map((record) => numberOrZero(record[3])).filter(Boolean);
      const avgHr = average(heartRates);
      const maxHr = Math.max(0, ...heartRates);
      return {
        id: stableActivityId(source, 0, first, distanceKm, durationSec),
        source,
        type: "run",
        title: "Course à pied FIT",
        date: first.toISOString(),
        distanceKm,
        durationSec,
        calories: 0,
        avgHr: Math.round(avgHr || 0),
        maxHr,
        trainingEffect: 0,
        tss: 0,
        load: estimateLoad(durationSec, 0, avgHr),
        paceSec: distanceKm ? durationSec / distanceKm : 0,
        ascentM: 0,
        descentM: 0,
        format: "fit"
      };
    }

    return null;
  }

  function readFitValue(view, offset, size, baseType, littleEndian) {
    if (size <= 0) return null;
    try {
      if (baseType === 7) {
        const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, size);
        return new TextDecoder().decode(bytes).replace(/\0+$/g, "");
      }
      if (size > baseTypeSize(baseType)) {
        return readFitValue(view, offset, baseTypeSize(baseType), baseType, littleEndian);
      }
      switch (baseType) {
        case 0:
        case 2:
        case 10:
        case 13:
          return invalidIf(view.getUint8(offset), 0xff);
        case 1:
          return view.getInt8(offset);
        case 3:
          return invalidIf(view.getInt16(offset, littleEndian), 0x7fff);
        case 4:
        case 11:
          return invalidIf(view.getUint16(offset, littleEndian), 0xffff);
        case 5:
          return invalidIf(view.getInt32(offset, littleEndian), 0x7fffffff);
        case 6:
        case 12:
          return invalidIf(view.getUint32(offset, littleEndian), 0xffffffff);
        case 8:
          return view.getFloat32(offset, littleEndian);
        case 9:
          return view.getFloat64(offset, littleEndian);
        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  function baseTypeSize(baseType) {
    if ([0, 1, 2, 7, 10, 13].includes(baseType)) return 1;
    if ([3, 4, 11].includes(baseType)) return 2;
    if ([5, 6, 8, 12].includes(baseType)) return 4;
    if ([9, 14, 15, 16].includes(baseType)) return 8;
    return 1;
  }

  function invalidIf(value, invalid) {
    return value === invalid ? null : value;
  }

  function fitTimestamp(value) {
    const seconds = numberOrZero(value);
    if (!seconds) return new Date();
    return new Date(FIT_EPOCH_MS + seconds * 1000);
  }

  function fitScaled(value, scale) {
    const number = numberOrZero(value);
    return number ? number / scale : 0;
  }

  function fitPaceFromSpeed(value) {
    const speed = fitScaled(value, 1000);
    return speed ? 1000 / speed : 0;
  }

  function mergeActivities(existing, incoming) {
    const map = new Map();
    [...existing, ...incoming].forEach((activity) => {
      const key = `${activity.type}-${activity.date.slice(0, 19)}-${round(activity.distanceKm, 2)}-${Math.round(activity.durationSec || 0)}`;
      map.set(key, { ...activity, id: key });
    });
    return Array.from(map.values()).sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  function renderActivityList() {
    const container = document.getElementById("activityList");
    const count = document.getElementById("activityCount");
    const activities = getActivities();
    if (count) count.textContent = String(activities.length);
    if (!container) return;

    if (!activities.length) {
      container.innerHTML = `<p class="empty-state">Aucune activité importée.</p>`;
      return;
    }

    container.innerHTML = activities.slice(0, 14).map((item) => `
      <article class="activity-item">
        <strong>${escapeHtml(formatShortDate(new Date(item.date)))} · ${escapeHtml(item.title || item.type)}</strong>
        <p>${round(item.distanceKm || 0, 2)} km · ${formatDuration(item.durationSec || 0)} · D+ ${Math.round(item.ascentM || 0)} m · FC ${Math.round(item.avgHr || 0)} · ${escapeHtml(item.format?.toUpperCase() || "")}</p>
      </article>
    `).join("");
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `bosvut-7q91-sauvegarde-${isoDate(new Date())}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function importBackup(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      state = {
        activities: Array.isArray(parsed.activities) ? parsed.activities : [],
        feedbacks: Array.isArray(parsed.feedbacks) ? parsed.feedbacks : [],
        adjustments: Array.isArray(parsed.adjustments) ? parsed.adjustments : [],
        products: { ...DEFAULT_PRODUCTS, ...(parsed.products || {}) },
        lastImportAt: parsed.lastImportAt || new Date().toISOString(),
        seedVersion: parsed.seedVersion || null
      };
      saveState();
      renderAll();
      updateFeedbackNutritionPreview();
      updateNutritionCalculators();
      const status = document.getElementById("importStatus");
      if (status) status.textContent = "Sauvegarde importée.";
    } catch {
      const status = document.getElementById("importStatus");
      if (status) status.textContent = "Sauvegarde illisible.";
    }
    event.target.value = "";
  }

  function getActivities() {
    return [...state.activities].sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  function getRuns() {
    return getActivities().filter((item) => item.type === "run");
  }

  function sumStats(items) {
    const stats = items.reduce(
      (acc, item) => {
        acc.distanceKm += numberOrZero(item.distanceKm);
        acc.durationSec += numberOrZero(item.durationSec);
        acc.ascentM += numberOrZero(item.ascentM);
        acc.load += numberOrZero(item.load);
        acc.runs += 1;
        if ((item.distanceKm || 0) >= 15 || (item.durationSec || 0) >= 75 * 60) acc.longRuns += 1;
        return acc;
      },
      { distanceKm: 0, durationSec: 0, ascentM: 0, load: 0, runs: 0, longRuns: 0, avgKmPerRun: 0 }
    );
    stats.avgKmPerRun = stats.runs ? stats.distanceKm / stats.runs : 0;
    return stats;
  }

  function buildWeekBuckets(runs, count) {
    const start = startOfWeek(addDays(new Date(), -7 * (count - 1)));
    return Array.from({ length: count }, (_, index) => {
      const weekStart = addDays(start, index * 7);
      const weekEnd = addDays(weekStart, 7);
      const stats = sumStats(runs.filter((run) => {
        const date = new Date(run.date);
        return date >= weekStart && date < weekEnd;
      }));
      return {
        label: `S${getIsoWeek(weekStart)}`,
        distanceKm: stats.distanceKm,
        durationSec: stats.durationSec
      };
    });
  }

  function countWeeksWithRuns(runs, weekCount, minimumRuns) {
    const start = startOfWeek(addDays(new Date(), -7 * (weekCount - 1)));
    let count = 0;
    for (let index = 0; index < weekCount; index += 1) {
      const weekStart = addDays(start, index * 7);
      const weekEnd = addDays(weekStart, 7);
      const runsThisWeek = runs.filter((run) => {
        const date = new Date(run.date);
        return date >= weekStart && date < weekEnd;
      }).length;
      if (runsThisWeek >= minimumRuns) count += 1;
    }
    return count;
  }

  function sumPlanWeek(week) {
    const totals = sumPlanWeekNumbers(week);
    const km = totals.distanceKm ? `${Math.round(totals.distanceKm)} km env.` : "km variable";
    return { duration: formatDuration(totals.durationMin * 60), km };
  }

  function sumPlanWeekNumbers(week) {
    return week.sessions.reduce(
      (acc, item) => {
        acc.durationMin += numberOrZero(item.durationMin);
        acc.distanceKm += averageKmFromLabel(item.kmLabel);
        return acc;
      },
      { durationMin: 0, distanceKm: 0 }
    );
  }

  function averageKmFromLabel(label) {
    const match = String(label || "").match(/(\d+(?:[.,]\d+)?)(?:\s*[-–]\s*(\d+(?:[.,]\d+)?))?\s*km/i);
    if (!match) return 0;
    const first = Number(match[1].replace(",", "."));
    const second = match[2] ? Number(match[2].replace(",", ".")) : first;
    return (first + second) / 2;
  }

  function readNutritionCounts(form) {
    return {
      drink: numberOrZero(form.drink?.value),
      gel25: numberOrZero(form.gel25?.value),
      gel30: numberOrZero(form.gel30?.value),
      puree: numberOrZero(form.puree?.value),
      bar: numberOrZero(form.bar?.value)
    };
  }

  function calculateCarbs(counts, products) {
    return PRODUCT_META.reduce((sum, product) => sum + numberOrZero(counts[product.key]) * numberOrZero(products[product.key]), 0);
  }

  function readDurationHours(form) {
    return numberOrZero(form.hours?.value) + numberOrZero(form.minutes?.value) / 60;
  }

  function getSessionLabel(sessionId) {
    if (!sessionId || sessionId === "none") return "Aucune";
    const sessionItem = findPlanSession(sessionId);
    if (!sessionItem) return "Séance libre";
    return `${formatShortDate(parseLocalDate(sessionItem.date))} · ${sessionItem.type} · ${sessionItem.title}`;
  }

  function findPlanSession(sessionId) {
    return currentPlanWeeks.flatMap((week) => week.sessions).find((item) => item.id === sessionId);
  }

  function getSessionStatus(dateString) {
    const today = startOfDay(new Date());
    const date = parseLocalDate(dateString);
    if (date.getTime() === today.getTime()) return { label: "aujourd’hui", className: "today" };
    if (date < today) return { label: "passé", className: "past" };
    return { label: "à venir", className: "future" };
  }

  function updateRangeOutput(input) {
    const output = document.querySelector(`[data-output-for="${input.name}"]`);
    if (output) output.textContent = `${input.value}/10`;
  }

  function findHeader(headers, candidates) {
    return headers.findIndex((header) => candidates.some((candidate) => header.includes(normalizeHeader(candidate))));
  }

  function cell(row, index) {
    return index >= 0 ? String(row[index] || "").trim() : "";
  }

  function normalizeHeader(value) {
    return normalizeText(value).replace(/[^a-z0-9]+/g, " ").trim();
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/Ã©|Ã¨|Ãª|Ã«/g, "e")
      .replace(/Ã |Ã¢|Ã¤/g, "a")
      .replace(/Ã®|Ã¯/g, "i")
      .replace(/Ã´|Ã¶/g, "o")
      .replace(/Ã¹|Ã»|Ã¼/g, "u")
      .replace(/Ã§/g, "c")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function parseGarminDate(value) {
    const text = String(value || "").trim().replace(/^'+/, "");
    if (!text) return null;
    const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (isoMatch) {
      return new Date(
        Number(isoMatch[1]),
        Number(isoMatch[2]) - 1,
        Number(isoMatch[3]),
        Number(isoMatch[4] || 0),
        Number(isoMatch[5] || 0),
        Number(isoMatch[6] || 0)
      );
    }

    const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (slashMatch) {
      const first = Number(slashMatch[1]);
      const second = Number(slashMatch[2]);
      const month = first <= 12 ? first : second;
      const day = first <= 12 ? second : first;
      return new Date(Number(slashMatch[3]), month - 1, day, Number(slashMatch[4] || 0), Number(slashMatch[5] || 0), Number(slashMatch[6] || 0));
    }

    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function parseLocalDate(value) {
    if (value instanceof Date) return startOfDay(value);
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return startOfDay(new Date(value));
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  function parseDuration(value) {
    const text = String(value || "").trim().replace(/^'+/, "");
    if (!text) return 0;
    const parts = text.split(":");
    if (parts.length === 3) {
      return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number.parseFloat(parts[2]);
    }
    if (parts.length === 2) {
      return Number(parts[0]) * 60 + Number.parseFloat(parts[1]);
    }
    return numberOrZero(text);
  }

  function parsePace(value) {
    const text = String(value || "").trim();
    if (!text || text === "--") return 0;
    const parts = text.split(":");
    if (parts.length === 2) return Number(parts[0]) * 60 + Number(parts[1]);
    if (parts.length === 3) return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
    return 0;
  }

  function numberOrZero(value) {
    if (value === null || value === undefined || value === "") return 0;
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    let text = String(value).trim().replace(/^'+/, "").replace(/\s/g, "");
    if (!text || text === "--") return 0;
    text = text.replace(/[^\d,.-]/g, "");
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) {
      text = text.replace(/,/g, "");
    } else if (text.includes(",") && !text.includes(".")) {
      text = text.replace(",", ".");
    } else {
      text = text.replace(/,/g, "");
    }
    const number = Number(text);
    return Number.isFinite(number) ? number : 0;
  }

  function estimateLoad(durationSec, trainingEffect, avgHr) {
    const hours = durationSec / 3600;
    if (trainingEffect) return Math.round(hours * trainingEffect * 24);
    if (avgHr) return Math.round(hours * Math.max(25, avgHr - 100));
    return Math.round(hours * 35);
  }

  function stableActivityId(source, rowIndex, date, distanceKm, durationSec) {
    return `${source}-${rowIndex}-${date.toISOString().slice(0, 19)}-${round(distanceKm, 2)}-${Math.round(durationSec)}`;
  }

  function cryptoId() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function startOfWeek(date) {
    const day = date.getDay() || 7;
    return startOfDay(addDays(date, 1 - day));
  }

  function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  function daysBetween(start, end) {
    return Math.ceil((startOfDay(end) - startOfDay(start)) / 86400000);
  }

  function getIsoWeek(date) {
    const target = startOfDay(date);
    target.setDate(target.getDate() + 3 - ((target.getDay() + 6) % 7));
    const week1 = new Date(target.getFullYear(), 0, 4);
    return 1 + Math.round(((target - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  }

  function isoDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function formatDate(date) {
    return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "long", year: "numeric" }).format(date);
  }

  function formatShortDate(date) {
    return new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "2-digit", month: "short" }).format(date);
  }

  function formatWeekRange(weekStart) {
    const weekEnd = addDays(weekStart, 6);
    const start = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short" }).format(weekStart);
    const end = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short" }).format(weekEnd);
    return `${start} → ${end}`;
  }

  function formatDateTime(date) {
    return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function formatDuration(seconds) {
    const total = Math.round(numberOrZero(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.round((total % 3600) / 60);
    if (hours <= 0) return `${minutes} min`;
    if (minutes === 0) return `${hours} h`;
    return `${hours} h ${String(minutes).padStart(2, "0")}`;
  }

  function formatHourDecimal(hours) {
    const totalMin = Math.round(numberOrZero(hours) * 60);
    return formatDuration(totalMin * 60);
  }

  function average(values) {
    const clean = values.filter((value) => Number.isFinite(value) && value > 0);
    return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
  }

  function round(value, digits = 0) {
    const factor = 10 ** digits;
    return Math.round((numberOrZero(value) + Number.EPSILON) * factor) / factor;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function slugify(value) {
    return normalizeHeader(value).replace(/\s+/g, "-");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#096;");
  }
})();
