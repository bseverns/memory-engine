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

  function buildArchiveCommand(usbPath = "") {
    const trimmed = String(usbPath || "").trim();
    if (!trimmed) {
      return "./scripts/session_close_archive.sh";
    }
    return `./scripts/session_close_archive.sh --to-usb "${trimmed}"`;
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
      opsLiteControlStatus: doc.getElementById("opsLiteControlStatus"),
      opsLiteSessionFramingStatus: doc.getElementById("opsLiteSessionFramingStatus"),
      opsLiteAudioTone: doc.getElementById("opsLiteAudioTone"),
      opsLitePlayable: doc.getElementById("opsLitePlayable"),
      opsLiteWarningCount: doc.getElementById("opsLiteWarningCount"),
      opsLiteStorage: doc.getElementById("opsLiteStorage"),
      opsLiteLastAction: doc.getElementById("opsLiteLastAction"),
      opsLiteWarnings: doc.getElementById("opsLiteWarnings"),
      opsLiteRecommendedStage: doc.getElementById("opsLiteRecommendedStage"),
      opsLiteStageOpen: doc.getElementById("opsLiteStageOpen"),
      opsLiteStageLive: doc.getElementById("opsLiteStageLive"),
      opsLiteStageIncident: doc.getElementById("opsLiteStageIncident"),
      opsLiteStageClose: doc.getElementById("opsLiteStageClose"),
      opsLiteArchiveReadiness: doc.getElementById("opsLiteArchiveReadiness"),
      opsLiteArchiveUsbPath: doc.getElementById("opsLiteArchiveUsbPath"),
      opsLiteArchiveCommandBuild: doc.getElementById("opsLiteArchiveCommandBuild"),
      opsLiteArchiveCommandCopy: doc.getElementById("opsLiteArchiveCommandCopy"),
      opsLiteArchiveCommand: doc.getElementById("opsLiteArchiveCommand"),
    };
  }

  function renderControls(dom, operatorState) {
    if (dom.opsLiteMaintenanceMode) dom.opsLiteMaintenanceMode.checked = Boolean(operatorState.maintenance_mode);
    if (dom.opsLiteIntakePaused) dom.opsLiteIntakePaused.checked = Boolean(operatorState.intake_paused);
    if (dom.opsLitePlaybackPaused) dom.opsLitePlaybackPaused.checked = Boolean(operatorState.playback_paused);
    if (dom.opsLiteQuieterMode) dom.opsLiteQuieterMode.checked = Boolean(operatorState.quieter_mode);
  }

  function formatActionLine(action) {
    if (!action) return "No steward action yet";
    const detail = action.detail || action.action || "Steward action";
    const at = action.created_at ? new Date(action.created_at).toLocaleTimeString() : "unknown time";
    return `${detail} (${at})`;
  }

  function highlightRecommendedStage(dom, stage) {
    const all = [
      dom.opsLiteStageOpen,
      dom.opsLiteStageLive,
      dom.opsLiteStageIncident,
      dom.opsLiteStageClose,
    ];
    all.forEach((el) => {
      if (!el) return;
      el.classList.remove("active");
    });
    const lookup = {
      open: dom.opsLiteStageOpen,
      live: dom.opsLiteStageLive,
      incident: dom.opsLiteStageIncident,
      close: dom.opsLiteStageClose,
    };
    if (lookup[stage]) {
      lookup[stage].classList.add("active");
    }
  }

  function summarizeActiveControls(operatorState) {
    const labels = [];
    if (operatorState.maintenance_mode) labels.push("maintenance mode");
    if (operatorState.intake_paused) labels.push("intake paused");
    if (operatorState.playback_paused) labels.push("playback paused");
    if (operatorState.quieter_mode) labels.push("quieter mode");
    return labels.length ? `Active controls: ${labels.join(", ")}.` : "No live control overrides are active.";
  }

  function renderStatus(doc, dom, payload, recentActions = []) {
    const state = classifyState(payload);
    const stage = recommendedStage(payload, state);

    if (dom.opsLiteStateTitle) dom.opsLiteStateTitle.textContent = state.title;
    if (dom.opsLiteStateBadge) {
      dom.opsLiteStateBadge.textContent = state.state;
      dom.opsLiteStateBadge.className = `ops-state ${state.state}`;
    }
    if (dom.opsLiteNextAction) {
      dom.opsLiteNextAction.textContent = nextActionText(payload, state);
    }
    if (dom.opsLitePlayable) {
      dom.opsLitePlayable.textContent = String(payload.playable ?? "-");
    }
    if (dom.opsLiteWarningCount) {
      dom.opsLiteWarningCount.textContent = String((payload.warnings || []).length);
    }
    if (dom.opsLiteStorage) {
      dom.opsLiteStorage.textContent = payload.storage ? `${payload.storage.free_gb} GB` : "-";
    }
    if (dom.opsLiteLastAction) {
      dom.opsLiteLastAction.textContent = formatActionLine(recentActions[0]);
    }
    if (dom.opsLiteRefreshed) {
      dom.opsLiteRefreshed.textContent = `Last refreshed ${new Date().toLocaleTimeString()}`;
    }
    if (dom.opsLiteRecommendedStage) {
      dom.opsLiteRecommendedStage.textContent = `Recommended stage: ${stage}`;
    }
    if (dom.opsLiteArchiveReadiness) {
      dom.opsLiteArchiveReadiness.textContent = archiveReadinessLine(payload);
    }

    highlightRecommendedStage(dom, stage);
    replaceCardList(doc, dom.opsLiteWarnings, warningCards(payload.warnings || []));
    renderControls(dom, payload.operator_state || {});
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

  function start({ doc = document, fetchImpl = fetch, intervalMs = 10000 } = {}) {
    const dom = collectDom(doc);
    const initialOperatorState = readJsonScript(doc, "ops-operator-state", {});
    let latestStatusPayload = { operator_state: initialOperatorState, warnings: [] };
    let latestRecentActions = [];
    renderControls(dom, initialOperatorState);
    if (dom.opsLiteSessionFramingStatus) {
      dom.opsLiteSessionFramingStatus.textContent = sessionFramingStatusLine(initialOperatorState);
    }
    renderArchiveCommand(dom, buildArchiveCommand(""));
    if (dom.opsLiteControlStatus) {
      dom.opsLiteControlStatus.textContent = summarizeActiveControls(initialOperatorState);
    }

    async function refreshStatus() {
      const payload = await fetchJson(fetchImpl, "/api/v1/node/status", { cache: "no-store" });
      latestStatusPayload = payload;
      renderStatus(doc, dom, latestStatusPayload, latestRecentActions);
    }

    async function refreshControls() {
      const payload = await fetchJson(fetchImpl, "/api/v1/operator/controls", { cache: "no-store" });
      latestRecentActions = Array.isArray(payload.recent_actions) ? payload.recent_actions : [];
      latestStatusPayload = {
        ...(latestStatusPayload || {}),
        operator_state: payload.operator_state || {},
      };
      renderControls(dom, payload.operator_state || {});
      if (dom.opsLiteSessionFramingStatus) {
        dom.opsLiteSessionFramingStatus.textContent = sessionFramingStatusLine(payload.operator_state || {});
      }
      if (dom.opsLiteControlStatus) {
        dom.opsLiteControlStatus.textContent = summarizeActiveControls(payload.operator_state || {});
      }
      renderStatus(doc, dom, latestStatusPayload, latestRecentActions);
    }

    async function saveControls(event) {
      event.preventDefault();
      if (dom.opsLiteControlsSave) {
        dom.opsLiteControlsSave.disabled = true;
      }
      if (dom.opsLiteControlStatus) {
        dom.opsLiteControlStatus.textContent = "Applying controls...";
      }

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
        if (dom.opsLiteSessionFramingStatus) {
          dom.opsLiteSessionFramingStatus.textContent = sessionFramingStatusLine(payload.operator_state || {});
        }
        if (dom.opsLiteControlStatus) {
          dom.opsLiteControlStatus.textContent = summarizeActiveControls(payload.operator_state || {});
        }
        await refreshStatus();
      } catch (error) {
        if (dom.opsLiteControlStatus) {
          dom.opsLiteControlStatus.textContent = error.message || "Control update failed.";
        }
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
      if (dom.opsLiteSessionFramingStatus) {
        dom.opsLiteSessionFramingStatus.textContent = "Clearing session framing and deployment focus...";
      }
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
        if (dom.opsLiteSessionFramingStatus) {
          dom.opsLiteSessionFramingStatus.textContent = sessionFramingStatusLine(payload.operator_state || {});
        }
        await refreshStatus();
      } catch (error) {
        if (dom.opsLiteSessionFramingStatus) {
          dom.opsLiteSessionFramingStatus.textContent = error.message || "Could not clear session framing.";
        }
      } finally {
        if (dom.opsLiteClearSessionFraming) {
          dom.opsLiteClearSessionFraming.disabled = false;
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

    function applyArchiveCommandFromInput() {
      const command = buildArchiveCommand(dom.opsLiteArchiveUsbPath?.value || "");
      renderArchiveCommand(dom, command);
      return command;
    }

    if (dom.opsLiteArchiveCommandBuild) {
      dom.opsLiteArchiveCommandBuild.addEventListener("click", () => {
        applyArchiveCommandFromInput();
      });
    }

    if (dom.opsLiteArchiveUsbPath) {
      dom.opsLiteArchiveUsbPath.addEventListener("input", () => {
        applyArchiveCommandFromInput();
      });
    }

    if (dom.opsLiteArchiveCommandCopy) {
      dom.opsLiteArchiveCommandCopy.addEventListener("click", async () => {
        const command = applyArchiveCommandFromInput();
        if (!globalObjectRef.navigator?.clipboard?.writeText) {
          if (dom.opsLiteArchiveReadiness) {
            dom.opsLiteArchiveReadiness.textContent = "Clipboard API unavailable. Copy the command manually.";
          }
          return;
        }
        try {
          await globalObjectRef.navigator.clipboard.writeText(command);
          if (dom.opsLiteArchiveReadiness) {
            dom.opsLiteArchiveReadiness.textContent = `${archiveReadinessLine(latestStatusPayload)} Command copied.`;
          }
        } catch (error) {
          if (dom.opsLiteArchiveReadiness) {
            dom.opsLiteArchiveReadiness.textContent = "Could not copy archive command. Copy manually instead.";
          }
        }
      });
    }

    if (dom.opsLiteAudioTone) {
      dom.opsLiteAudioTone.addEventListener("click", async () => {
        dom.opsLiteAudioTone.disabled = true;
        const previous = dom.opsLiteControlStatus ? dom.opsLiteControlStatus.textContent : "";
        if (dom.opsLiteControlStatus) {
          dom.opsLiteControlStatus.textContent = "Playing output tone...";
        }
        try {
          await playOutputTone(globalObjectRef);
          if (dom.opsLiteControlStatus) {
            dom.opsLiteControlStatus.textContent = "Output tone complete.";
          }
        } catch (error) {
          if (dom.opsLiteControlStatus) {
            dom.opsLiteControlStatus.textContent = error.message || "Output tone failed.";
          }
        } finally {
          dom.opsLiteAudioTone.disabled = false;
          if (dom.opsLiteControlStatus && previous && dom.opsLiteControlStatus.textContent === "Output tone complete.") {
            globalObjectRef.setTimeout(() => {
              dom.opsLiteControlStatus.textContent = previous;
            }, 1800);
          }
        }
      });
    }

    async function refreshAll() {
      try {
        await Promise.all([refreshStatus(), refreshControls()]);
      } catch (error) {
        if (dom.opsLiteStateTitle) dom.opsLiteStateTitle.textContent = "Broken";
        if (dom.opsLiteStateBadge) {
          dom.opsLiteStateBadge.textContent = "broken";
          dom.opsLiteStateBadge.className = "ops-state broken";
        }
        if (dom.opsLiteNextAction) {
          dom.opsLiteNextAction.textContent = error.message || "Unable to refresh operator lite status.";
        }
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
      },
    };
  }

  return {
    buildArchiveCommand,
    classifyState,
    nextActionText,
    recommendedStage,
    start,
  };
}));
