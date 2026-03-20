(function initMemoryEngineOperatorDashboard(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.MemoryEngineOperatorDashboard = api;
}(typeof globalThis !== "undefined" ? globalThis : this, () => {
  function classifyState(payload) {
    const components = payload.components || {};
    const failedNames = Object.entries(components)
      .filter(([, value]) => !value.ok)
      .map(([name]) => name);
    const warnings = payload.warnings || [];
    const criticalWarnings = warnings.filter((warning) => warning.level === "critical");

    if (failedNames.length === 0) {
      if (criticalWarnings.length) {
        return {
          state: "broken",
          title: "Broken",
          summary: criticalWarnings[0].detail,
        };
      }
      if (warnings.length) {
        return {
          state: "degraded",
          title: "Degraded",
          summary: warnings[0].detail,
        };
      }
      return {
        state: "ready",
        title: "Ready",
        summary: "All tracked dependencies are healthy. The node should be ready for capture and playback.",
      };
    }

    if (failedNames.includes("database")) {
      return {
        state: "broken",
        title: "Broken",
        summary: `The database check failed (${failedNames.join(", ")}). Operator intervention is required.`,
      };
    }

    return {
      state: "degraded",
      title: "Degraded",
      summary: `Some dependencies need attention (${failedNames.join(", ")}), but the node may still be partially usable.`,
    };
  }

  function warningCards(warnings) {
    if (!warnings || warnings.length === 0) {
      return [{
        tagName: "article",
        className: "component-card ready",
        title: "No current warnings",
        detail: "Storage headroom and pool balance both look acceptable right now.",
      }];
    }

    return warnings.map((warning) => ({
      tagName: "article",
      className: `component-card ${warning.level === "critical" ? "broken" : "degraded"}`,
      title: warning.title,
      detail: warning.detail,
    }));
  }

  function componentCards(components) {
    const entries = Object.entries(components || {});
    if (!entries.length) {
      return [{
        tagName: "div",
        className: "component-card degraded",
        detail: "No dependency data returned.",
      }];
    }

    return entries.map(([name, value]) => ({
      tagName: "article",
      className: `component-card ${value.ok ? "ready" : "broken"}`,
      title: name,
      detail: value.ok ? "ok" : (value.error || "error"),
    }));
  }

  function actionCards(actions) {
    if (!actions || actions.length === 0) {
      return [{
        tagName: "article",
        className: "component-card ready",
        title: "No steward changes yet",
        detail: "Control changes will appear here as they are applied.",
      }];
    }

    return actions.map((action) => ({
      tagName: "article",
      className: "component-card ready",
      title: action.detail || action.action,
      detail: formatActionDetail(action),
    }));
  }

  function formatActionDetail(action) {
    const timestamp = action.created_at ? new Date(action.created_at).toLocaleString() : "Unknown time";
    const actor = action.actor || "operator";
    return `${actor} · ${timestamp}`;
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

  function collectDom(doc) {
    return {
      opsStateBadge: doc.getElementById("opsStateBadge"),
      opsStateLabel: doc.getElementById("opsStateLabel"),
      opsSummary: doc.getElementById("opsSummary"),
      opsActive: doc.getElementById("opsActive"),
      opsPlayable: doc.getElementById("opsPlayable"),
      opsExpired: doc.getElementById("opsExpired"),
      opsRevoked: doc.getElementById("opsRevoked"),
      opsFresh: doc.getElementById("opsFresh"),
      opsMid: doc.getElementById("opsMid"),
      opsWorn: doc.getElementById("opsWorn"),
      opsStorage: doc.getElementById("opsStorage"),
      opsWarnings: doc.getElementById("opsWarnings"),
      opsComponents: doc.getElementById("opsComponents"),
      opsRefreshed: doc.getElementById("opsRefreshed"),
      opsControlsForm: doc.getElementById("opsControlsForm"),
      opsIntakePaused: doc.getElementById("opsIntakePaused"),
      opsPlaybackPaused: doc.getElementById("opsPlaybackPaused"),
      opsQuieterMode: doc.getElementById("opsQuieterMode"),
      opsControlsSave: doc.getElementById("opsControlsSave"),
      opsControlStatus: doc.getElementById("opsControlStatus"),
      opsRecentActions: doc.getElementById("opsRecentActions"),
    };
  }

  function renderOperatorState(dom, operatorState) {
    if (!dom.opsIntakePaused || !dom.opsPlaybackPaused || !dom.opsQuieterMode) {
      return;
    }
    dom.opsIntakePaused.checked = Boolean(operatorState.intake_paused);
    dom.opsPlaybackPaused.checked = Boolean(operatorState.playback_paused);
    dom.opsQuieterMode.checked = Boolean(operatorState.quieter_mode);
  }

  function renderPayload(doc, dom, payload) {
    const state = classifyState(payload);

    dom.opsStateBadge.textContent = state.state;
    dom.opsStateBadge.className = `ops-state ${state.state}`;
    dom.opsStateLabel.textContent = state.title;
    dom.opsSummary.textContent = state.summary;
    dom.opsActive.textContent = String(payload.active ?? "-");
    dom.opsPlayable.textContent = String(payload.playable ?? "-");
    dom.opsExpired.textContent = String(payload.expired ?? "-");
    dom.opsRevoked.textContent = String(payload.revoked ?? "-");
    dom.opsFresh.textContent = String(payload.lanes?.fresh ?? "-");
    dom.opsMid.textContent = String(payload.lanes?.mid ?? "-");
    dom.opsWorn.textContent = String(payload.lanes?.worn ?? "-");
    dom.opsStorage.textContent = payload.storage ? `${payload.storage.free_gb} GB` : "-";
    replaceCardList(doc, dom.opsWarnings, warningCards(payload.warnings || []));
    replaceCardList(doc, dom.opsComponents, componentCards(payload.components || {}));
    renderOperatorState(dom, payload.operator_state || {});
    dom.opsRefreshed.textContent = `Last refreshed ${new Date().toLocaleTimeString()}`;
  }

  function renderControlPayload(doc, dom, payload) {
    renderOperatorState(dom, payload.operator_state || {});
    replaceCardList(doc, dom.opsRecentActions, actionCards(payload.recent_actions || []));
    if (dom.opsControlStatus) {
      const state = payload.operator_state || {};
      const labels = [];
      if (state.intake_paused) labels.push("intake paused");
      if (state.playback_paused) labels.push("playback paused");
      if (state.quieter_mode) labels.push("quieter mode");
      dom.opsControlStatus.textContent = labels.length
        ? `Active controls: ${labels.join(", ")}.`
        : "No live control overrides are active.";
    }
  }

  function renderError(doc, dom, error) {
    dom.opsStateBadge.textContent = "broken";
    dom.opsStateBadge.className = "ops-state broken";
    dom.opsStateLabel.textContent = "Broken";
    dom.opsSummary.textContent = error.message || "Status refresh failed.";
    replaceCardList(doc, dom.opsWarnings, [{
      tagName: "div",
      className: "component-card broken",
      detail: "Unable to load storage and pool warnings.",
    }]);
    replaceCardList(doc, dom.opsComponents, [{
      tagName: "div",
      className: "component-card broken",
      detail: "Unable to reach /api/v1/node/status",
    }]);
    dom.opsRefreshed.textContent = "Last refresh failed";
  }

  async function fetchJson(fetchImpl, url, options = {}) {
    const response = await fetchImpl(url, options);
    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }
    return response.json();
  }

  function start({ doc = document, fetchImpl = fetch, intervalMs = 10000 } = {}) {
    const dom = collectDom(doc);
    const initialState = readJsonScript(doc, "ops-operator-state", {});
    renderOperatorState(dom, initialState);
    replaceCardList(doc, dom.opsRecentActions, actionCards([]));

    async function refreshStatus() {
      try {
        const payload = await fetchJson(fetchImpl, "/api/v1/node/status", { cache: "no-store" });
        renderPayload(doc, dom, payload);
      } catch (error) {
        renderError(doc, dom, error);
      }
    }

    async function refreshControls() {
      try {
        const payload = await fetchJson(fetchImpl, "/api/v1/operator/controls", { cache: "no-store" });
        renderControlPayload(doc, dom, payload);
      } catch (error) {
        if (dom.opsControlStatus) {
          dom.opsControlStatus.textContent = error.message || "Control refresh failed.";
        }
      }
    }

    async function saveControls(event) {
      event.preventDefault();
      if (!dom.opsControlsSave) return;
      dom.opsControlsSave.disabled = true;
      if (dom.opsControlStatus) {
        dom.opsControlStatus.textContent = "Applying controls...";
      }
      try {
        const payload = await fetchJson(fetchImpl, "/api/v1/operator/controls", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": readCookie(doc, "csrftoken"),
          },
          body: JSON.stringify({
            intake_paused: Boolean(dom.opsIntakePaused?.checked),
            playback_paused: Boolean(dom.opsPlaybackPaused?.checked),
            quieter_mode: Boolean(dom.opsQuieterMode?.checked),
          }),
        });
        renderControlPayload(doc, dom, payload);
        await refreshStatus();
      } catch (error) {
        if (dom.opsControlStatus) {
          dom.opsControlStatus.textContent = error.message || "Control update failed.";
        }
      } finally {
        dom.opsControlsSave.disabled = false;
      }
    }

    if (dom.opsControlsForm) {
      dom.opsControlsForm.addEventListener("submit", (event) => {
        void saveControls(event);
      });
    }

    void refreshStatus();
    void refreshControls();
    const intervalId = root.setInterval(() => {
      void refreshStatus();
      void refreshControls();
    }, intervalMs);

    return {
      refreshStatus,
      refreshControls,
      stop() {
        root.clearInterval(intervalId);
      },
    };
  }

  return {
    actionCards,
    classifyState,
    componentCards,
    renderControlPayload,
    renderError,
    renderPayload,
    start,
    warningCards,
  };
}));
