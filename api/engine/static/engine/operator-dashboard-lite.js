(function initMemoryEngineOperatorDashboardLite(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.MemoryEngineOperatorDashboardLite = api;
}(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const globalObjectRef = typeof globalThis !== "undefined"
    ? globalThis
    : (typeof window !== "undefined" ? window : {});

  const DEFAULT_ARCHIVE_COMMAND = "./scripts/session_close_archive.sh";
  const TAB_STORAGE_KEY = "memory-engine.ops-lite.selected-tab";
  const TAB_KEYS = ["open-room", "run-room", "fix-problem", "close-session"];
  const TAB_LABELS = {
    "open-room": "Open Room",
    "run-room": "Run Room",
    "fix-problem": "Fix Problem",
    "close-session": "Close Session",
  };

  function classifyState(payload) {
    const components = payload.components || {};
    const failedNames = Object.entries(components)
      .filter(([, value]) => !value.ok)
      .map(([name]) => name);
    const warnings = payload.warnings || [];

    if (!failedNames.length) {
      if (!warnings.length) {
        return {
          state: "ready",
          title: "Ready",
        };
      }
      return {
        state: warnings.some((warning) => warning.level === "critical") ? "broken" : "degraded",
        title: warnings.some((warning) => warning.level === "critical") ? "Broken" : "Degraded",
      };
    }

    const hardFailures = new Set(["database", "redis", "storage"]);
    const hasHardFailure = failedNames.some((name) => hardFailures.has(name));
    return {
      state: hasHardFailure ? "broken" : "degraded",
      title: hasHardFailure ? "Broken" : "Degraded",
    };
  }

  function recommendedStage(payload, state) {
    const operatorState = payload.operator_state || {};
    if (operatorState.maintenance_mode || state.state === "broken" || state.state === "degraded") {
      return "incident";
    }
    if (Number(payload.playable || 0) < 1) {
      return "open";
    }
    return "live";
  }

  function recommendedTab(payload, state) {
    const stage = recommendedStage(payload, state);
    if (stage === "incident") return "fix-problem";
    if (stage === "live") return "run-room";
    if (stage === "close") return "close-session";
    return "open-room";
  }

  function nextActionText(payload, state) {
    const operatorState = payload.operator_state || {};
    const firstWarning = Array.isArray(payload.warnings) && payload.warnings.length ? payload.warnings[0] : null;

    if (operatorState.maintenance_mode) {
      return "Maintenance mode is active. Keep intake and playback paused until service is complete, then clear maintenance intentionally.";
    }
    if (state.state === "broken") {
      return "Pause intake if participants are waiting, then open full bench and resolve failing dependencies before returning to normal service.";
    }
    if (state.state === "degraded") {
      return firstWarning?.detail
        ? `Address warning first: ${firstWarning.detail}`
        : "Open full bench to inspect warnings and stabilize posture before continuing.";
    }
    if (operatorState.intake_paused || operatorState.playback_paused) {
      return "Machine is healthy but currently paused. Clear pause toggles when you are ready for public operation.";
    }
    return "Open `/kiosk/` and `/room/`, run output tone, and keep this page visible during operation.";
  }

  function warningCards(warnings) {
    if (!Array.isArray(warnings) || !warnings.length) {
      return [{
        tagName: "article",
        className: "component-card ready",
        title: "No active warnings",
        detail: "Storage and pool posture look stable right now.",
      }];
    }
    return warnings.slice(0, 3).map((warning) => ({
      tagName: "article",
      className: `component-card ${warning.level === "critical" ? "broken" : "degraded"}`,
      title: warning.title || "Warning",
      detail: warning.detail || "Operator attention recommended.",
    }));
  }

  function makeCard(doc, card) {
    const el = doc.createElement(card.tagName || "article");
    el.className = card.className || "";
    if (card.title) {
      const strong = doc.createElement("strong");
      strong.textContent = card.title;
      el.appendChild(strong);
    }
    if (card.detail) {
      const detail = doc.createElement("span");
      detail.textContent = card.detail;
      el.appendChild(detail);
    }
    return el;
  }

  function replaceCardList(doc, container, cards) {
    if (!container) return;
    container.replaceChildren(...cards.map((card) => makeCard(doc, card)));
  }

  function readJsonScript(doc, id, fallback = {}) {
    const el = doc.getElementById(id);
    if (!el || !el.textContent) {
      return fallback;
    }
    try {
      return JSON.parse(el.textContent);
    } catch (error) {
      return fallback;
    }
  }

  function readCookie(doc, name) {
    const pattern = `${name}=`;
    const parts = (doc.cookie || "").split(";");
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.startsWith(pattern)) {
        return decodeURIComponent(trimmed.slice(pattern.length));
      }
    }
    return "";
  }

  function validateUsbPath(usbPath = "") {
    const path = String(usbPath || "").trim();
    if (!path) {
      return { ok: true, path: "", error: "" };
    }
    if (!path.startsWith("/")) {
      return { ok: false, path: "", error: "USB path must be absolute (for example /media/steward/SESSION_ARCHIVE)." };
    }
    if (/[\0\r\n]/.test(path)) {
      return { ok: false, path: "", error: "USB path contains unsafe control characters." };
    }
    return { ok: true, path, error: "" };
  }

  function shellQuote(value = "") {
    const escaped = String(value).replace(/'/g, "'\\''");
    return `'${escaped}'`;
  }

  function buildArchiveCommand(usbPath = "") {
    const trimmed = String(usbPath || "").trim();
    if (!trimmed) {
      return DEFAULT_ARCHIVE_COMMAND;
    }
    return `${DEFAULT_ARCHIVE_COMMAND} --to-usb ${shellQuote(trimmed)}`;
  }

  function buildArchiveCommandResult(usbPath = "") {
    const validation = validateUsbPath(usbPath);
    if (!validation.ok) {
      return {
        command: DEFAULT_ARCHIVE_COMMAND,
        error: validation.error,
      };
    }
    return {
      command: buildArchiveCommand(validation.path),
      error: "",
    };
  }

  function hasSessionFraming(state = {}) {
    return Boolean(
      String(state.session_theme_title || "").trim()
      || String(state.session_theme_prompt || "").trim()
      || String(state.deployment_focus_topic || "").trim()
      || String(state.deployment_focus_status || "").trim(),
    );
  }

  function sessionFramingStatusLine(state = {}) {
    if (!hasSessionFraming(state)) {
      return "No session framing/focus overrides are active.";
    }
    const labels = [];
    if (String(state.session_theme_title || "").trim()) labels.push(`theme title: ${String(state.session_theme_title).trim()}`);
    if (String(state.session_theme_prompt || "").trim()) labels.push("theme framing line set");
    if (String(state.deployment_focus_topic || "").trim()) labels.push(`focus topic: ${String(state.deployment_focus_topic).trim()}`);
    if (String(state.deployment_focus_status || "").trim()) labels.push(`focus status: ${String(state.deployment_focus_status).trim()}`);
    return `Session framing active: ${labels.join(", ")}.`;
  }

  function archiveReadinessLine(payload = {}) {
    const check = classifyState(payload);
    const warningCount = Array.isArray(payload.warnings) ? payload.warnings.length : 0;
    const operatorState = payload.operator_state || {};
    const parts = [check.state === "ready" ? "node is ready" : `node is ${check.state}`];
    if (warningCount > 0) {
      parts.push(`${warningCount} warning${warningCount === 1 ? "" : "s"}`);
    }
    if (operatorState.maintenance_mode) {
      parts.push("maintenance mode active");
    }
    if (operatorState.intake_paused || operatorState.playback_paused) {
      parts.push("some live paths paused");
    }
    return `Archive cue: ${parts.join(" · ")}.`;
  }

  function renderArchiveCommand(dom, command) {
    if (dom.opsLiteArchiveCommand) {
      dom.opsLiteArchiveCommand.textContent = command;
    }
  }

  function normalizeTabKey(tabKey) {
    const normalized = String(tabKey || "").trim().toLowerCase();
    return TAB_KEYS.includes(normalized) ? normalized : "";
  }

  function tabKeyFromHash(hashValue) {
    const rawHash = String(hashValue || "").trim();
    if (!rawHash.startsWith("#")) {
      return "";
    }
    const withoutHash = rawHash.slice(1);
    if (withoutHash.startsWith("ops-tab=")) {
      return normalizeTabKey(withoutHash.slice("ops-tab=".length));
    }
    return normalizeTabKey(withoutHash);
  }

  function hashForTab(tabKey) {
    return `#ops-tab=${tabKey}`;
  }

  function readStoredTab(globalObject = globalObjectRef) {
    try {
      return normalizeTabKey(globalObject.localStorage?.getItem(TAB_STORAGE_KEY) || "");
    } catch (error) {
      return "";
    }
  }

  function writeStoredTab(tabKey, globalObject = globalObjectRef) {
    try {
      if (globalObject.localStorage?.setItem) {
        globalObject.localStorage.setItem(TAB_STORAGE_KEY, tabKey);
      }
    } catch (error) {
      // Ignore storage errors in restricted browsers.
    }
  }

  function setText(el, value) {
    if (el) {
      el.textContent = value;
    }
  }

  function collectDom(doc) {
    return {
      opsLiteStateTitle: doc.getElementById("opsLiteStateTitle"),
      opsLiteStateBadge: doc.getElementById("opsLiteStateBadge"),
      opsLiteNextAction: doc.getElementById("opsLiteNextAction"),
      opsLiteRefreshed: doc.getElementById("opsLiteRefreshed"),
      opsLiteControlsForm: doc.getElementById("opsLiteControlsForm"),
      opsLiteMaintenanceMode: doc.getElementById("opsLiteMaintenanceMode"),
      opsLiteIntakePaused: doc.getElementById("opsLiteIntakePaused"),
      opsLitePlaybackPaused: doc.getElementById("opsLitePlaybackPaused"),
      opsLiteQuieterMode: doc.getElementById("opsLiteQuieterMode"),
      opsLiteControlsSave: doc.getElementById("opsLiteControlsSave"),
      opsLiteClearSessionFraming: doc.getElementById("opsLiteClearSessionFraming"),
      opsLiteClearSessionFramingTab: doc.getElementById("opsLiteClearSessionFramingTab"),
      opsLiteControlStatus: doc.getElementById("opsLiteControlStatus"),
      opsLiteSessionFramingStatus: doc.getElementById("opsLiteSessionFramingStatus"),
      opsLiteRunSessionFramingStatus: doc.getElementById("opsLiteRunSessionFramingStatus"),
      opsLiteAudioTone: doc.getElementById("opsLiteAudioTone"),
      opsLiteAudioToneOpenRoom: doc.getElementById("opsLiteAudioToneOpenRoom"),
      opsLitePlayable: doc.getElementById("opsLitePlayable"),
      opsLiteWarningCount: doc.getElementById("opsLiteWarningCount"),
      opsLiteStorage: doc.getElementById("opsLiteStorage"),
      opsLiteLastAction: doc.getElementById("opsLiteLastAction"),
      opsLiteWarnings: doc.getElementById("opsLiteWarnings"),
      opsLiteRecommendedStage: doc.getElementById("opsLiteRecommendedStage"),
      opsLiteReadyCue: doc.getElementById("opsLiteReadyCue"),
      opsLiteRunPosture: doc.getElementById("opsLiteRunPosture"),
      opsLiteRunGuidance: doc.getElementById("opsLiteRunGuidance"),
      opsLiteRunControlState: doc.getElementById("opsLiteRunControlState"),
      opsLiteRunSnapshot: doc.getElementById("opsLiteRunSnapshot"),
      opsLiteFixReason: doc.getElementById("opsLiteFixReason"),
      opsLiteArchiveReadiness: doc.getElementById("opsLiteArchiveReadiness"),
      opsLiteArchiveUsbPath: doc.getElementById("opsLiteArchiveUsbPath"),
      opsLiteArchiveCommandBuild: doc.getElementById("opsLiteArchiveCommandBuild"),
      opsLiteArchiveCommandCopy: doc.getElementById("opsLiteArchiveCommandCopy"),
      opsLiteArchiveCommand: doc.getElementById("opsLiteArchiveCommand"),
      opsLiteTabs: Array.from(doc.querySelectorAll("[data-tab]")),
      opsLiteTabPanels: Array.from(doc.querySelectorAll("[data-tab-panel]")),
    };
  }

  function renderControls(dom, operatorState) {
    if (dom.opsLiteMaintenanceMode) dom.opsLiteMaintenanceMode.checked = Boolean(operatorState.maintenance_mode);
    if (dom.opsLiteIntakePaused) dom.opsLiteIntakePaused.checked = Boolean(operatorState.intake_paused);
    if (dom.opsLitePlaybackPaused) dom.opsLitePlaybackPaused.checked = Boolean(operatorState.playback_paused);
    if (dom.opsLiteQuieterMode) dom.opsLiteQuieterMode.checked = Boolean(operatorState.quieter_mode);
  }

  function renderSessionFramingLines(dom, operatorState) {
    const line = sessionFramingStatusLine(operatorState || {});
    setText(dom.opsLiteSessionFramingStatus, line);
    setText(dom.opsLiteRunSessionFramingStatus, line);
  }

  function formatActionLine(action) {
    if (!action) return "No steward action yet";
    const detail = action.detail || action.action || "Steward action";
    const at = action.created_at ? new Date(action.created_at).toLocaleTimeString() : "unknown time";
    return `${detail} (${at})`;
  }

  function summarizeActiveControls(operatorState) {
    const labels = [];
    if (operatorState.maintenance_mode) labels.push("maintenance mode");
    if (operatorState.intake_paused) labels.push("intake paused");
    if (operatorState.playback_paused) labels.push("playback paused");
    if (operatorState.quieter_mode) labels.push("quieter mode");
    return labels.length ? `Active controls: ${labels.join(", ")}.` : "No live control overrides are active.";
  }

  function readyCueText(payload, state) {
    const operatorState = payload.operator_state || {};
    const warningCount = Array.isArray(payload.warnings) ? payload.warnings.length : 0;
    if (state.state === "broken") {
      return "Not ready to open. Resolve blockers in Fix Problem before welcoming participants.";
    }
    if (state.state === "degraded") {
      return "Possible to open only if this warning is understood. Stabilize first when in doubt.";
    }
    if (operatorState.maintenance_mode || operatorState.intake_paused || operatorState.playback_paused) {
      return "Machine is healthy but paused. Clear intentional pause/maintenance controls before opening.";
    }
    if (warningCount > 0) {
      return "Open with caution. Watch warning chips closely during first minutes.";
    }
    return "Ready to open. Surfaces and controls look clear for normal operation.";
  }

  function runGuidanceText(payload, state) {
    const warningCount = Array.isArray(payload.warnings) ? payload.warnings.length : 0;
    if (state.state === "broken") {
      return "Move to Fix Problem now. Keep participant promises conservative until state returns from broken.";
    }
    if (state.state === "degraded") {
      return "Stay in observation mode and resolve warnings in order. Avoid changing many controls at once.";
    }
    if (warningCount > 0) {
      return "Room is running with warnings. Keep this page visible and document interventions.";
    }
    return "Room posture is stable. Keep interventions minimal and legible.";
  }

  function setActiveTab(dom, tabKey, {
    persist = true,
    focus = false,
    globalObject = globalObjectRef,
  } = {}) {
    const normalized = normalizeTabKey(tabKey) || "open-room";
    dom.opsLiteTabs.forEach((tabButton) => {
      const isActive = tabButton.dataset.tab === normalized;
      tabButton.setAttribute("aria-selected", isActive ? "true" : "false");
      tabButton.tabIndex = isActive ? 0 : -1;
      if (focus && isActive) {
        tabButton.focus();
      }
    });
    dom.opsLiteTabPanels.forEach((panel) => {
      panel.hidden = panel.dataset.tabPanel !== normalized;
    });

    if (persist) {
      const hash = hashForTab(normalized);
      try {
        if (globalObject.history?.replaceState) {
          globalObject.history.replaceState(null, "", hash);
        } else if (globalObject.location) {
          globalObject.location.hash = hash;
        }
      } catch (error) {
        if (globalObject.location) {
          globalObject.location.hash = hash;
        }
      }
      writeStoredTab(normalized, globalObject);
    }

    return normalized;
  }

  function renderStatus(doc, dom, payload, recentActions = [], runtimeState = null) {
    const state = classifyState(payload);
    const suggestedTab = recommendedTab(payload, state);
    const warningCount = Array.isArray(payload.warnings) ? payload.warnings.length : 0;
    const operatorState = payload.operator_state || {};
    const lastActionLine = formatActionLine(recentActions[0]);

    setText(dom.opsLiteStateTitle, state.title);
    if (dom.opsLiteStateBadge) {
      dom.opsLiteStateBadge.textContent = state.state;
      dom.opsLiteStateBadge.className = `ops-state ${state.state}`;
    }
    setText(dom.opsLiteNextAction, nextActionText(payload, state));
    setText(dom.opsLitePlayable, String(payload.playable ?? "-"));
    setText(dom.opsLiteWarningCount, String(warningCount));
    setText(dom.opsLiteStorage, payload.storage
      ? `${payload.storage.state || "unknown"} · ${payload.storage.free_gb} GB free`
      : "-");
    setText(dom.opsLiteLastAction, lastActionLine);
    setText(dom.opsLiteRefreshed, `Last refreshed ${new Date().toLocaleTimeString()}`);
    setText(dom.opsLiteRecommendedStage, `Recommended task: ${TAB_LABELS[suggestedTab] || TAB_LABELS["open-room"]}`);
    setText(dom.opsLiteArchiveReadiness, archiveReadinessLine(payload));
    setText(dom.opsLiteReadyCue, readyCueText(payload, state));
    setText(dom.opsLiteRunPosture, `${state.title} posture with ${payload.playable ?? 0} playable and ${warningCount} warning${warningCount === 1 ? "" : "s"}.`);
    setText(dom.opsLiteRunGuidance, runGuidanceText(payload, state));
    setText(dom.opsLiteRunControlState, summarizeActiveControls(operatorState));
    setText(dom.opsLiteRunSnapshot, `Playable ${payload.playable ?? 0} · warnings ${warningCount} · last action: ${lastActionLine}.`);
    setText(dom.opsLiteFixReason, nextActionText(payload, state));

    renderControls(dom, operatorState);
    renderSessionFramingLines(dom, operatorState);
    replaceCardList(doc, dom.opsLiteWarnings, warningCards(payload.warnings || []));

    if (runtimeState && !runtimeState.userSelectedTab && (state.state === "broken" || state.state === "degraded")) {
      runtimeState.selectedTab = setActiveTab(dom, "fix-problem", {
        persist: false,
        focus: false,
        globalObject: runtimeState.globalObject,
      });
    }
  }

  async function fetchJson(fetchImpl, url, options = {}) {
    const response = await fetchImpl(url, options);
    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }
    return response.json();
  }

  async function playOutputTone(globalObject = globalObjectRef) {
    const AudioContextCtor = globalObject.AudioContext || globalObject.webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error("This browser cannot play the operator tone.");
    }

    const ctx = new AudioContextCtor();
    try {
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      gain.connect(ctx.destination);

      const startAt = ctx.currentTime + 0.02;
      const freqs = [440, 523.25, 659.25];
      freqs.forEach((freq, index) => {
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = freq;
        osc.connect(gain);
        const noteStart = startAt + (index * 0.28);
        osc.start(noteStart);
        osc.stop(noteStart + 0.18);
      });

      gain.gain.exponentialRampToValueAtTime(0.04, startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.9);
      await new Promise((resolve) => {
        globalObject.setTimeout(resolve, 950);
      });
      gain.disconnect();
    } finally {
      await ctx.close();
    }
  }

  function resolveInitialTab(globalObject = globalObjectRef) {
    const hashTab = tabKeyFromHash(globalObject.location?.hash || "");
    if (hashTab) {
      return { tab: hashTab, userSelected: true };
    }
    const stored = readStoredTab(globalObject);
    if (stored) {
      return { tab: stored, userSelected: true };
    }
    return { tab: "open-room", userSelected: false };
  }

  function start({ doc = document, fetchImpl = fetch, intervalMs = 10000 } = {}) {
    const dom = collectDom(doc);
    const initialOperatorState = readJsonScript(doc, "ops-operator-state", {});
    let latestStatusPayload = { operator_state: initialOperatorState, warnings: [] };
    let latestRecentActions = [];

    const initialTab = resolveInitialTab(globalObjectRef);
    const runtimeState = {
      selectedTab: setActiveTab(dom, initialTab.tab, {
        persist: true,
        focus: false,
        globalObject: globalObjectRef,
      }),
      userSelectedTab: initialTab.userSelected,
      globalObject: globalObjectRef,
    };

    function selectTab(tabKey, { userInitiated = true, focus = false } = {}) {
      runtimeState.selectedTab = setActiveTab(dom, tabKey, {
        persist: true,
        focus,
        globalObject: runtimeState.globalObject,
      });
      if (userInitiated) {
        runtimeState.userSelectedTab = true;
      }
      return runtimeState.selectedTab;
    }

    dom.opsLiteTabs.forEach((tabButton) => {
      tabButton.addEventListener("click", () => {
        selectTab(tabButton.dataset.tab, { userInitiated: true, focus: false });
      });

      tabButton.addEventListener("keydown", (event) => {
        const currentTab = normalizeTabKey(tabButton.dataset.tab);
        const currentIndex = TAB_KEYS.indexOf(currentTab);
        if (currentIndex < 0) {
          return;
        }

        let targetIndex = currentIndex;
        if (event.key === "ArrowRight") {
          targetIndex = (currentIndex + 1) % TAB_KEYS.length;
        } else if (event.key === "ArrowLeft") {
          targetIndex = (currentIndex - 1 + TAB_KEYS.length) % TAB_KEYS.length;
        } else if (event.key === "Home") {
          targetIndex = 0;
        } else if (event.key === "End") {
          targetIndex = TAB_KEYS.length - 1;
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectTab(currentTab, { userInitiated: true, focus: true });
          return;
        } else {
          return;
        }

        event.preventDefault();
        selectTab(TAB_KEYS[targetIndex], { userInitiated: true, focus: true });
      });
    });

    function syncHashSelection() {
      const hashTab = tabKeyFromHash(globalObjectRef.location?.hash || "");
      if (!hashTab) {
        return;
      }
      runtimeState.userSelectedTab = true;
      runtimeState.selectedTab = setActiveTab(dom, hashTab, {
        persist: true,
        focus: false,
        globalObject: runtimeState.globalObject,
      });
    }

    if (globalObjectRef.addEventListener) {
      globalObjectRef.addEventListener("hashchange", syncHashSelection);
    }

    renderControls(dom, initialOperatorState);
    renderSessionFramingLines(dom, initialOperatorState);
    renderArchiveCommand(dom, buildArchiveCommand(""));
    setText(dom.opsLiteControlStatus, summarizeActiveControls(initialOperatorState));

    async function refreshStatus() {
      const payload = await fetchJson(fetchImpl, "/api/v1/node/status", { cache: "no-store" });
      latestStatusPayload = payload;
      renderStatus(doc, dom, latestStatusPayload, latestRecentActions, runtimeState);
    }

    async function refreshControls() {
      const payload = await fetchJson(fetchImpl, "/api/v1/operator/controls", { cache: "no-store" });
      latestRecentActions = Array.isArray(payload.recent_actions) ? payload.recent_actions : [];
      latestStatusPayload = {
        ...(latestStatusPayload || {}),
        operator_state: payload.operator_state || {},
      };
      renderControls(dom, payload.operator_state || {});
      renderSessionFramingLines(dom, payload.operator_state || {});
      setText(dom.opsLiteControlStatus, summarizeActiveControls(payload.operator_state || {}));
      renderStatus(doc, dom, latestStatusPayload, latestRecentActions, runtimeState);
    }

    async function saveControls(event) {
      event.preventDefault();
      if (dom.opsLiteControlsSave) {
        dom.opsLiteControlsSave.disabled = true;
      }
      setText(dom.opsLiteControlStatus, "Applying controls...");

      try {
        const payload = await fetchJson(fetchImpl, "/api/v1/operator/controls", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": readCookie(doc, "csrftoken"),
          },
          body: JSON.stringify({
            maintenance_mode: Boolean(dom.opsLiteMaintenanceMode?.checked),
            intake_paused: Boolean(dom.opsLiteIntakePaused?.checked),
            playback_paused: Boolean(dom.opsLitePlaybackPaused?.checked),
            quieter_mode: Boolean(dom.opsLiteQuieterMode?.checked),
          }),
        });
        latestRecentActions = Array.isArray(payload.recent_actions) ? payload.recent_actions : [];
        latestStatusPayload = {
          ...(latestStatusPayload || {}),
          operator_state: payload.operator_state || {},
        };
        renderControls(dom, payload.operator_state || {});
        renderSessionFramingLines(dom, payload.operator_state || {});
        setText(dom.opsLiteControlStatus, summarizeActiveControls(payload.operator_state || {}));
        await refreshStatus();
      } catch (error) {
        setText(dom.opsLiteControlStatus, error.message || "Control update failed.");
      } finally {
        if (dom.opsLiteControlsSave) {
          dom.opsLiteControlsSave.disabled = false;
        }
      }
    }

    async function clearSessionFraming() {
      if (dom.opsLiteClearSessionFraming) {
        dom.opsLiteClearSessionFraming.disabled = true;
      }
      if (dom.opsLiteClearSessionFramingTab) {
        dom.opsLiteClearSessionFramingTab.disabled = true;
      }
      renderSessionFramingLines(dom, {
        session_theme_title: "",
        session_theme_prompt: "",
        deployment_focus_topic: "",
        deployment_focus_status: "",
      });
      setText(dom.opsLiteSessionFramingStatus, "Clearing session framing and deployment focus...");

      try {
        const payload = await fetchJson(fetchImpl, "/api/v1/operator/controls", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": readCookie(doc, "csrftoken"),
          },
          body: JSON.stringify({
            session_theme_title: "",
            session_theme_prompt: "",
            deployment_focus_topic: "",
            deployment_focus_status: "",
          }),
        });
        latestRecentActions = Array.isArray(payload.recent_actions) ? payload.recent_actions : [];
        latestStatusPayload = {
          ...(latestStatusPayload || {}),
          operator_state: payload.operator_state || {},
        };
        renderControls(dom, payload.operator_state || {});
        renderSessionFramingLines(dom, payload.operator_state || {});
        await refreshStatus();
      } catch (error) {
        setText(dom.opsLiteSessionFramingStatus, error.message || "Could not clear session framing.");
        setText(dom.opsLiteRunSessionFramingStatus, error.message || "Could not clear session framing.");
      } finally {
        if (dom.opsLiteClearSessionFraming) {
          dom.opsLiteClearSessionFraming.disabled = false;
        }
        if (dom.opsLiteClearSessionFramingTab) {
          dom.opsLiteClearSessionFramingTab.disabled = false;
        }
      }
    }

    if (dom.opsLiteControlsForm) {
      dom.opsLiteControlsForm.addEventListener("submit", (event) => {
        void saveControls(event);
      });
    }

    if (dom.opsLiteClearSessionFraming) {
      dom.opsLiteClearSessionFraming.addEventListener("click", () => {
        void clearSessionFraming();
      });
    }

    if (dom.opsLiteClearSessionFramingTab) {
      dom.opsLiteClearSessionFramingTab.addEventListener("click", () => {
        void clearSessionFraming();
      });
    }

    function applyArchiveCommandFromInput({ announce = false } = {}) {
      const result = buildArchiveCommandResult(dom.opsLiteArchiveUsbPath?.value || "");
      renderArchiveCommand(dom, result.command);
      if (result.error) {
        setText(dom.opsLiteArchiveReadiness, result.error);
      } else if (announce) {
        setText(dom.opsLiteArchiveReadiness, archiveReadinessLine(latestStatusPayload));
      }
      return result;
    }

    if (dom.opsLiteArchiveCommandBuild) {
      dom.opsLiteArchiveCommandBuild.addEventListener("click", () => {
        applyArchiveCommandFromInput({ announce: true });
      });
    }

    if (dom.opsLiteArchiveUsbPath) {
      dom.opsLiteArchiveUsbPath.addEventListener("input", () => {
        applyArchiveCommandFromInput({ announce: false });
      });
    }

    if (dom.opsLiteArchiveCommandCopy) {
      dom.opsLiteArchiveCommandCopy.addEventListener("click", async () => {
        const result = applyArchiveCommandFromInput({ announce: true });
        if (result.error) {
          return;
        }
        if (!globalObjectRef.navigator?.clipboard?.writeText) {
          setText(dom.opsLiteArchiveReadiness, "Clipboard API unavailable. Copy the command manually.");
          return;
        }
        try {
          await globalObjectRef.navigator.clipboard.writeText(result.command);
          setText(dom.opsLiteArchiveReadiness, `${archiveReadinessLine(latestStatusPayload)} Command copied.`);
        } catch (error) {
          setText(dom.opsLiteArchiveReadiness, "Could not copy archive command. Copy manually instead.");
        }
      });
    }

    async function runOutputToneFromControl() {
      if (dom.opsLiteAudioTone) {
        dom.opsLiteAudioTone.disabled = true;
      }
      if (dom.opsLiteAudioToneOpenRoom) {
        dom.opsLiteAudioToneOpenRoom.disabled = true;
      }
      const previous = dom.opsLiteControlStatus ? dom.opsLiteControlStatus.textContent : "";
      setText(dom.opsLiteControlStatus, "Playing output tone...");
      try {
        await playOutputTone(globalObjectRef);
        setText(dom.opsLiteControlStatus, "Output tone complete.");
      } catch (error) {
        setText(dom.opsLiteControlStatus, error.message || "Output tone failed.");
      } finally {
        if (dom.opsLiteAudioTone) {
          dom.opsLiteAudioTone.disabled = false;
        }
        if (dom.opsLiteAudioToneOpenRoom) {
          dom.opsLiteAudioToneOpenRoom.disabled = false;
        }
        if (dom.opsLiteControlStatus && previous && dom.opsLiteControlStatus.textContent === "Output tone complete.") {
          globalObjectRef.setTimeout(() => {
            setText(dom.opsLiteControlStatus, previous);
          }, 1800);
        }
      }
    }

    if (dom.opsLiteAudioTone) {
      dom.opsLiteAudioTone.addEventListener("click", () => {
        void runOutputToneFromControl();
      });
    }

    if (dom.opsLiteAudioToneOpenRoom) {
      dom.opsLiteAudioToneOpenRoom.addEventListener("click", () => {
        void runOutputToneFromControl();
      });
    }

    async function refreshAll() {
      try {
        await Promise.all([refreshStatus(), refreshControls()]);
      } catch (error) {
        setText(dom.opsLiteStateTitle, "Broken");
        if (dom.opsLiteStateBadge) {
          dom.opsLiteStateBadge.textContent = "broken";
          dom.opsLiteStateBadge.className = "ops-state broken";
        }
        setText(dom.opsLiteNextAction, error.message || "Unable to refresh operator lite status.");
      }
    }

    void refreshAll();
    const intervalId = globalObjectRef.setInterval(() => {
      void refreshAll();
    }, intervalMs);

    return {
      refresh: refreshAll,
      stop() {
        globalObjectRef.clearInterval(intervalId);
        if (globalObjectRef.removeEventListener) {
          globalObjectRef.removeEventListener("hashchange", syncHashSelection);
        }
      },
    };
  }

  return {
    TAB_KEYS,
    buildArchiveCommand,
    buildArchiveCommandResult,
    classifyState,
    nextActionText,
    normalizeTabKey,
    recommendedStage,
    recommendedTab,
    start,
    tabKeyFromHash,
    validateUsbPath,
  };
}));
