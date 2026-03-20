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
    container.replaceChildren(...cards.map((card) => makeCard(doc, card)));
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
    };
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
    dom.opsRefreshed.textContent = `Last refreshed ${new Date().toLocaleTimeString()}`;
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

  function start({ doc = document, fetchImpl = fetch, intervalMs = 10000 } = {}) {
    const dom = collectDom(doc);

    async function refreshStatus() {
      try {
        const response = await fetchImpl("/api/v1/node/status", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Status fetch failed (${response.status})`);
        }
        const payload = await response.json();
        renderPayload(doc, dom, payload);
      } catch (error) {
        renderError(doc, dom, error);
      }
    }

    void refreshStatus();
    const intervalId = root.setInterval(refreshStatus, intervalMs);
    return {
      refreshStatus,
      stop() {
        root.clearInterval(intervalId);
      },
    };
  }

  return {
    classifyState,
    warningCards,
    componentCards,
    renderPayload,
    renderError,
    start,
  };
}));
