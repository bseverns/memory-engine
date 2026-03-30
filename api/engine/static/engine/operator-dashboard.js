(function initMemoryEngineOperatorDashboard(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.MemoryEngineOperatorDashboard = api;
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
      title: String(name || "").replace(/_/g, " "),
      detail: value.ok ? (value.detail || "ok") : (value.error || value.detail || "error"),
    }));
  }

  function actionCards(actions) {
    if (!actions || actions.length === 0) {
      return [{
        tagName: "article",
        className: "component-card ready",
        title: "No operator events yet",
        detail: "Steward controls, restores, exports, and revocations will appear here.",
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

  function describeKioskLanguage(code) {
    const normalized = String(code || "").trim().toLowerCase();
    if (normalized === "es_mx_ca") return "español";
    if (normalized === "en") return "english";
    return normalized;
  }

  function retentionCards(retention) {
    if (!retention) {
      return [{
        tagName: "article",
        className: "component-card degraded",
        title: "Retention data unavailable",
        detail: "The node did not report raw-expiry or fossil-retention details.",
      }];
    }

    const cards = [];
    const soonHours = retention.soon_window_hours ?? 24;
    cards.push({
      tagName: "article",
      className: "component-card ready",
      title: `Raw audio expiring in ${soonHours}h`,
      detail: `${retention.raw_expiring_soon ?? 0} recording(s) are due to shed raw audio soon.`,
    });
    cards.push({
      tagName: "article",
      className: "component-card ready",
      title: "Next raw expiry",
      detail: retention.next_raw_expiry_at
        ? new Date(retention.next_raw_expiry_at).toLocaleString()
        : "No raw-audio expiry is currently scheduled.",
    });
    cards.push({
      tagName: "article",
      className: "component-card ready",
      title: "Next fossil retention edge",
      detail: retention.next_fossil_expiry_at
        ? new Date(retention.next_fossil_expiry_at).toLocaleString()
        : "No active fossil retention window is currently scheduled.",
    });
    return cards;
  }

  function throttleCards(throttles) {
    if (!throttles) {
      return [{
        tagName: "article",
        className: "component-card degraded",
        title: "Throttle data unavailable",
        detail: "The node did not report current public ingest and revoke budgets.",
      }];
    }

    const lastEvent = throttles.public_ingest?.last_denied_at
      || throttles.public_revoke?.last_denied_at
      || throttles.public_ingest_ip?.last_denied_at
      || throttles.public_revoke_ip?.last_denied_at;
    const windowMinutes = Math.max(1, Math.round((Number(throttles.public_ingest?.window_seconds || 3600) / 60)));

    return [
      {
        tagName: "article",
        className: `component-card ${Number(throttles.public_ingest?.recent_denials || 0) > 0 ? "degraded" : "ready"}`,
        title: "Recent ingest denials",
        detail: `${throttles.public_ingest?.recent_denials || 0} kiosk-level and ${throttles.public_ingest_ip?.recent_denials || 0} IP-level denials in the last ${windowMinutes} minute(s).`,
      },
      {
        tagName: "article",
        className: `component-card ${Number(throttles.public_revoke?.recent_denials || 0) > 0 ? "degraded" : "ready"}`,
        title: "Recent revoke denials",
        detail: `${throttles.public_revoke?.recent_denials || 0} kiosk-level and ${throttles.public_revoke_ip?.recent_denials || 0} IP-level denials in the last ${windowMinutes} minute(s).`,
      },
      {
        tagName: "article",
        className: "component-card ready",
        title: "Last throttle event",
        detail: lastEvent ? new Date(lastEvent).toLocaleString() : "No recent public throttling events.",
      },
    ];
  }

  function artifactSummaryCards(payload) {
    if (!payload || typeof payload !== "object") {
      return [{
        tagName: "article",
        className: "component-card degraded",
        title: "Artifact summary unavailable",
        detail: "The node did not return enough archive detail to summarize the current posture.",
      }];
    }

    const lanes = payload.lanes || {};
    const moods = payload.moods || {};
    const active = Number(payload.active || 0);
    const playable = Number(payload.playable || 0);
    const expired = Number(payload.expired || 0);
    const revoked = Number(payload.revoked || 0);
    const moodSummary = Object.entries(moods)
      .filter(([, count]) => Number(count || 0) > 0)
      .sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0))
      .slice(0, 3)
      .map(([mood, count]) => `${mood} ${count}`)
      .join(" · ");
    const deployment = payload.deployment || {};
    const behaviorSummary = deployment.behavior_summary || deployment.description || "room-memory default posture";
    const tuningSource = deployment.tuning_source ? ` · ${deployment.tuning_source}` : "";

    return [
      {
        tagName: "article",
        className: "component-card ready",
        title: "Active deployment",
        detail: `${deployment.label || "Memory Engine"} (${deployment.code || "memory"}) · ${behaviorSummary}${tuningSource}`,
      },
      {
        tagName: "article",
        className: "component-card ready",
        title: "Archive totals",
        detail: `${active} active · ${playable} playable · ${expired} expired · ${revoked} revoked`,
      },
      {
        tagName: "article",
        className: "component-card ready",
        title: "Lane balance",
        detail: `fresh ${lanes.fresh || 0} · mid ${lanes.mid || 0} · worn ${lanes.worn || 0}`,
      },
      {
        tagName: "article",
        className: "component-card ready",
        title: "Dominant moods",
        detail: moodSummary || "No playable moods are represented yet.",
      },
    ];
  }

  function memoryColorCards(memoryColors) {
    const profiles = Array.isArray(memoryColors?.catalog?.profiles) ? memoryColors.catalog.profiles : [];
    const counts = memoryColors?.counts || {};
    if (!profiles.length) {
      return [{
        tagName: "article",
        className: "component-card degraded",
        title: "Memory color data unavailable",
        detail: "The node did not report participant color posture for the playable pool.",
      }];
    }

    return profiles.map((profile) => ({
      tagName: "article",
      className: `component-card ${(counts[profile.code] || 0) > 0 ? "ready" : "degraded"}`,
      title: profile.labels?.en || profile.code,
      detail: `${counts[profile.code] || 0} playable artifact(s) currently lean ${profile.labels?.en || profile.code}.`,
    }));
  }

  function formatDurationMs(durationMs) {
    const totalSeconds = Math.max(0, Math.round(Number(durationMs || 0) / 1000));
    if (totalSeconds < 60) {
      return `${totalSeconds}s`;
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  function artifactMetadataStatusLine(payload) {
    const deployment = payload?.deployment?.label || "active deployment";
    const count = Number(payload?.artifacts?.length || 0);
    const suggestions = payload?.editable_fields?.lifecycle_status?.suggestions || [];
    const suggestionText = suggestions.length ? ` Status picker presets: ${suggestions.join(", ")}.` : "";
    return `Showing ${count} stacked artifact(s) for ${deployment}. Remove one and the remaining stack closes the gap automatically.${suggestionText}`;
  }

  function lifecycleStatusOptions(field, currentValue) {
    const suggestions = Array.isArray(field?.suggestions) ? field.suggestions : [];
    const allowBlank = field?.allow_blank !== false;
    const current = String(currentValue || "").trim().toLowerCase();
    const values = [];
    if (allowBlank) {
      values.push("");
    }
    suggestions.forEach((value) => {
      const normalized = String(value || "").trim().toLowerCase();
      if (normalized && !values.includes(normalized)) {
        values.push(normalized);
      }
    });
    if (current && !values.includes(current)) {
      values.push(current);
    }
    return values;
  }

  async function playOperatorMonitorTone(globalObject = globalObjectRef) {
    const AudioContextCtor = globalObject.AudioContext || globalObject.webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error("This browser cannot play the operator monitor tone.");
    }

    const ctx = new AudioContextCtor();
    try {
      if (ctx.state === "suspended") {
        await ctx.resume();
      }

      const masterGain = ctx.createGain();
      masterGain.gain.value = 0.0001;
      masterGain.connect(ctx.destination);

      const frequencies = [440, 523.25, 659.25];
      const startAt = ctx.currentTime + 0.02;
      frequencies.forEach((frequency, index) => {
        const osc = ctx.createOscillator();
        osc.type = index === frequencies.length - 1 ? "sine" : "triangle";
        osc.frequency.value = frequency;
        osc.connect(masterGain);
        const noteStart = startAt + (index * 0.34);
        const noteStop = noteStart + 0.22;
        osc.start(noteStart);
        osc.stop(noteStop);
        if (index === frequencies.length - 1) {
          osc.onended = () => {
            try { osc.disconnect(); } catch (error) {}
          };
        }
      });

      masterGain.gain.exponentialRampToValueAtTime(0.055, startAt + 0.02);
      masterGain.gain.exponentialRampToValueAtTime(0.016, startAt + 0.22);
      masterGain.gain.exponentialRampToValueAtTime(0.055, startAt + 0.38);
      masterGain.gain.exponentialRampToValueAtTime(0.016, startAt + 0.58);
      masterGain.gain.exponentialRampToValueAtTime(0.055, startAt + 0.72);
      masterGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.98);

      await new Promise((resolve) => {
        globalObject.setTimeout(resolve, 1020);
      });
      masterGain.disconnect();
    } finally {
      await ctx.close();
    }
  }

  // Keep the deeper routing check on /ops/ so the public kiosk can stay calm,
  // tone-based, and participant-safe while stewards still get a real live path test.
  function createAudioMonitorController({
    globalObject = globalObjectRef,
    onLevelChange = () => {},
  } = {}) {
    let audioCtx = null;
    let mediaStream = null;
    let sourceNode = null;
    let analyserNode = null;
    let monitorGainNode = null;
    let meterData = null;
    let meterFrame = 0;

    function supportsLiveMonitor() {
      return Boolean(
        globalObject.navigator?.mediaDevices?.getUserMedia
        && (globalObject.AudioContext || globalObject.webkitAudioContext),
      );
    }

    function emitLevel(level) {
      onLevelChange(Math.max(0, Math.min(1, Number(level || 0))));
    }

    function stopMeterLoop() {
      if (meterFrame) {
        globalObject.cancelAnimationFrame(meterFrame);
        meterFrame = 0;
      }
      emitLevel(0);
    }

    function startMeterLoop() {
      stopMeterLoop();

      const tick = () => {
        if (!analyserNode || !meterData) {
          emitLevel(0);
          return;
        }

        analyserNode.getByteTimeDomainData(meterData);
        let sum = 0;
        for (let index = 0; index < meterData.length; index += 1) {
          const normalized = (meterData[index] - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / meterData.length);
        emitLevel(Math.min(1, rms * 4.5));
        meterFrame = globalObject.requestAnimationFrame(tick);
      };

      meterFrame = globalObject.requestAnimationFrame(tick);
    }

    async function start() {
      if (!supportsLiveMonitor()) {
        throw new Error("This browser cannot run live operator monitor.");
      }
      if (mediaStream && audioCtx) {
        if (audioCtx.state === "suspended") {
          await audioCtx.resume();
        }
        return;
      }

      mediaStream = await globalObject.navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });

      const AudioContextCtor = globalObject.AudioContext || globalObject.webkitAudioContext;
      audioCtx = new AudioContextCtor();
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }

      sourceNode = audioCtx.createMediaStreamSource(mediaStream);
      analyserNode = audioCtx.createAnalyser();
      analyserNode.fftSize = 1024;
      analyserNode.smoothingTimeConstant = 0.86;
      meterData = new Uint8Array(analyserNode.fftSize);

      monitorGainNode = audioCtx.createGain();
      monitorGainNode.gain.value = 0.9;

      sourceNode.connect(analyserNode);
      sourceNode.connect(monitorGainNode);
      monitorGainNode.connect(audioCtx.destination);
      startMeterLoop();
    }

    async function stop() {
      stopMeterLoop();
      if (sourceNode && analyserNode) {
        try { sourceNode.disconnect(analyserNode); } catch (error) {}
      }
      if (sourceNode && monitorGainNode) {
        try { sourceNode.disconnect(monitorGainNode); } catch (error) {}
      }
      if (analyserNode) {
        try { analyserNode.disconnect(); } catch (error) {}
        analyserNode = null;
      }
      if (monitorGainNode) {
        try { monitorGainNode.disconnect(); } catch (error) {}
        monitorGainNode = null;
      }
      if (sourceNode) {
        try { sourceNode.disconnect(); } catch (error) {}
        sourceNode = null;
      }
      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
        mediaStream = null;
      }
      if (audioCtx) {
        try {
          await audioCtx.close();
        } catch (error) {}
        audioCtx = null;
      }
      meterData = null;
    }

    return {
      supportsLiveMonitor,
      isActive() {
        return Boolean(mediaStream && audioCtx);
      },
      playTone() {
        return playOperatorMonitorTone(globalObject);
      },
      start,
      stop,
    };
  }

  function meterLabelForLevel(level) {
    const numeric = Number(level || 0);
    if (numeric >= 0.2) return "Signal present";
    if (numeric >= 0.08) return "Very quiet signal";
    return "No mic signal yet.";
  }

  function renderAudioMonitorLevel(dom, level = 0) {
    if (dom.opsAudioMeterFill) {
      dom.opsAudioMeterFill.style.width = `${Math.round(Math.max(0, Math.min(1, Number(level || 0))) * 100)}%`;
    }
    if (dom.opsAudioMeterLabel) {
      dom.opsAudioMeterLabel.textContent = meterLabelForLevel(level);
    }
  }

  function renderAudioMonitorState(dom, {
    active = false,
    stateLabel = active ? "Live" : "Idle",
    statusText = "",
  } = {}) {
    if (dom.opsAudioMonitorStart) {
      dom.opsAudioMonitorStart.disabled = active;
    }
    if (dom.opsAudioMonitorStop) {
      dom.opsAudioMonitorStop.disabled = !active;
    }
    if (dom.opsAudioMonitorState) {
      dom.opsAudioMonitorState.textContent = stateLabel;
    }
    if (dom.opsAudioCheckStatus && statusText) {
      dom.opsAudioCheckStatus.textContent = statusText;
    }
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
      opsRetentionRawHeld: doc.getElementById("opsRetentionRawHeld"),
      opsRetentionRawSoon: doc.getElementById("opsRetentionRawSoon"),
      opsRetentionFossils: doc.getElementById("opsRetentionFossils"),
      opsRetentionResidue: doc.getElementById("opsRetentionResidue"),
      opsIngestRate: doc.getElementById("opsIngestRate"),
      opsIngestIpRate: doc.getElementById("opsIngestIpRate"),
      opsRevokeRate: doc.getElementById("opsRevokeRate"),
      opsRevokeIpRate: doc.getElementById("opsRevokeIpRate"),
      opsArtifactSummary: doc.getElementById("opsArtifactSummary"),
      opsMemoryColorSummary: doc.getElementById("opsMemoryColorSummary"),
      opsRetentionSummary: doc.getElementById("opsRetentionSummary"),
      opsThrottleSummary: doc.getElementById("opsThrottleSummary"),
      opsWarnings: doc.getElementById("opsWarnings"),
      opsComponents: doc.getElementById("opsComponents"),
      opsRefreshed: doc.getElementById("opsRefreshed"),
      opsControlsForm: doc.getElementById("opsControlsForm"),
      opsMaintenanceMode: doc.getElementById("opsMaintenanceMode"),
      opsIntakePaused: doc.getElementById("opsIntakePaused"),
      opsPlaybackPaused: doc.getElementById("opsPlaybackPaused"),
      opsQuieterMode: doc.getElementById("opsQuieterMode"),
      opsMoodBias: doc.getElementById("opsMoodBias"),
      opsKioskLanguageCode: doc.getElementById("opsKioskLanguageCode"),
      opsKioskAccessibilityMode: doc.getElementById("opsKioskAccessibilityMode"),
      opsKioskReducedMotion: doc.getElementById("opsKioskReducedMotion"),
      opsKioskMaxRecordingSeconds: doc.getElementById("opsKioskMaxRecordingSeconds"),
      opsControlsSave: doc.getElementById("opsControlsSave"),
      opsControlStatus: doc.getElementById("opsControlStatus"),
      opsRecentActions: doc.getElementById("opsRecentActions"),
      opsArtifactMetadata: doc.getElementById("opsArtifactMetadata"),
      opsArtifactMetadataStatus: doc.getElementById("opsArtifactMetadataStatus"),
      opsAudioTone: doc.getElementById("opsAudioTone"),
      opsAudioMonitorStart: doc.getElementById("opsAudioMonitorStart"),
      opsAudioMonitorStop: doc.getElementById("opsAudioMonitorStop"),
      opsAudioMonitorState: doc.getElementById("opsAudioMonitorState"),
      opsAudioMeterFill: doc.getElementById("opsAudioMeterFill"),
      opsAudioMeterLabel: doc.getElementById("opsAudioMeterLabel"),
      opsAudioCheckStatus: doc.getElementById("opsAudioCheckStatus"),
    };
  }

  function renderOperatorState(dom, operatorState) {
    if (!dom.opsMaintenanceMode || !dom.opsIntakePaused || !dom.opsPlaybackPaused || !dom.opsQuieterMode) {
      return;
    }
    dom.opsMaintenanceMode.checked = Boolean(operatorState.maintenance_mode);
    dom.opsIntakePaused.checked = Boolean(operatorState.intake_paused);
    dom.opsPlaybackPaused.checked = Boolean(operatorState.playback_paused);
    dom.opsQuieterMode.checked = Boolean(operatorState.quieter_mode);
    if (dom.opsMoodBias) {
      dom.opsMoodBias.value = String(operatorState.mood_bias || "");
    }
    if (dom.opsKioskLanguageCode) {
      dom.opsKioskLanguageCode.value = String(operatorState.kiosk_language_code || "");
    }
    if (dom.opsKioskAccessibilityMode) {
      dom.opsKioskAccessibilityMode.value = String(operatorState.kiosk_accessibility_mode || "");
    }
    if (dom.opsKioskReducedMotion) {
      dom.opsKioskReducedMotion.checked = Boolean(operatorState.kiosk_force_reduced_motion);
    }
    if (dom.opsKioskMaxRecordingSeconds) {
      dom.opsKioskMaxRecordingSeconds.value = String(operatorState.kiosk_max_recording_seconds || 120);
    }
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
    dom.opsRetentionRawHeld.textContent = String(payload.retention?.raw_held ?? "-");
    dom.opsRetentionRawSoon.textContent = String(payload.retention?.raw_expiring_soon ?? "-");
    dom.opsRetentionFossils.textContent = String(payload.retention?.fossil_retained ?? "-");
    dom.opsRetentionResidue.textContent = String(payload.retention?.fossil_residue_only ?? "-");
    dom.opsIngestRate.textContent = String(payload.throttles?.public_ingest?.rate || "-");
    dom.opsIngestIpRate.textContent = String(payload.throttles?.public_ingest_ip?.rate || "-");
    dom.opsRevokeRate.textContent = String(payload.throttles?.public_revoke?.rate || "-");
    dom.opsRevokeIpRate.textContent = String(payload.throttles?.public_revoke_ip?.rate || "-");
    replaceCardList(doc, dom.opsWarnings, warningCards(payload.warnings || []));
    replaceCardList(doc, dom.opsArtifactSummary, artifactSummaryCards(payload));
    replaceCardList(doc, dom.opsMemoryColorSummary, memoryColorCards(payload.memory_colors));
    replaceCardList(doc, dom.opsRetentionSummary, retentionCards(payload.retention));
    replaceCardList(doc, dom.opsThrottleSummary, throttleCards(payload.throttles));
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
      if (state.maintenance_mode) labels.push("maintenance mode");
      if (state.intake_paused) labels.push("intake paused");
      if (state.playback_paused) labels.push("playback paused");
      if (state.quieter_mode) labels.push("quieter mode");
      if (state.mood_bias) labels.push(`mood bias: ${state.mood_bias}`);
      if (state.kiosk_language_code) labels.push(`kiosk language: ${describeKioskLanguage(state.kiosk_language_code)}`);
      if (state.kiosk_accessibility_mode) labels.push("accessible kiosk");
      if (state.kiosk_force_reduced_motion) labels.push("reduced-motion kiosk");
      if (Number(state.kiosk_max_recording_seconds || 120) !== 120) {
        labels.push(`kiosk max: ${state.kiosk_max_recording_seconds}s`);
      }
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

  function renderArtifactMetadata(doc, dom, payload, saveArtifactMetadata, removeArtifactFromCirculation) {
    if (!dom.opsArtifactMetadata) return;

    const artifacts = Array.isArray(payload?.artifacts) ? payload.artifacts : [];
    if (dom.opsArtifactMetadataStatus) {
      dom.opsArtifactMetadataStatus.textContent = artifactMetadataStatusLine(payload || {});
    }

    if (!artifacts.length) {
      replaceCardList(doc, dom.opsArtifactMetadata, [{
        tagName: "article",
        className: "component-card ready",
        title: "No recent artifacts in this deployment",
        detail: "Recordings will appear here once the current deployment has active artifacts to steward.",
      }]);
      return;
    }

    const cards = artifacts.map((artifact) => {
      const card = doc.createElement("article");
      card.className = "component-card ready ops-artifact-editor";

      const head = doc.createElement("div");
      head.className = "ops-artifact-editor-head";
      const title = doc.createElement("strong");
      const stackPosition = Math.max(0, Number(artifact.stack_position || 0));
      title.textContent = stackPosition
        ? `Stack #${stackPosition} · Artifact ${artifact.id}`
        : `Artifact ${artifact.id}`;
      const meta = doc.createElement("span");
      meta.className = "ops-artifact-editor-meta";
      const createdAt = artifact.created_at ? new Date(artifact.created_at).toLocaleString() : "unknown time";
      meta.textContent = `${createdAt} · ${formatDurationMs(artifact.duration_ms)} · ${artifact.lane || "mid"} / ${artifact.density || "medium"} / ${artifact.mood || "suspended"} · heard ${artifact.play_count || 0}`;
      head.append(title, meta);

      const fields = doc.createElement("div");
      fields.className = "ops-artifact-editor-fields";

      const topicLabel = doc.createElement("label");
      topicLabel.className = "ops-login-field";
      const topicText = doc.createElement("span");
      const topicStrong = doc.createElement("strong");
      topicStrong.textContent = payload?.editable_fields?.topic_tag?.label || "Topic / category";
      const topicHint = doc.createElement("span");
      topicHint.textContent = `Used for lightweight clustering and operator trace.`;
      topicText.append(topicStrong, topicHint);
      const topicInput = doc.createElement("input");
      topicInput.type = "text";
      topicInput.value = String(artifact.topic_tag || "");
      topicInput.placeholder = payload?.editable_fields?.topic_tag?.placeholder || "entry_gate";
      topicLabel.append(topicText, topicInput);

      const lifecycleLabel = doc.createElement("label");
      lifecycleLabel.className = "ops-login-field";
      const lifecycleText = doc.createElement("span");
      const lifecycleStrong = doc.createElement("strong");
      lifecycleStrong.textContent = payload?.editable_fields?.lifecycle_status?.label || "Status";
      const lifecycleHint = doc.createElement("span");
      lifecycleHint.textContent = `Deployment presets keep stewardship legible while staying compatible with older custom values.`;
      lifecycleText.append(lifecycleStrong, lifecycleHint);
      const lifecycleInput = doc.createElement("select");
      lifecycleStatusOptions(payload?.editable_fields?.lifecycle_status, artifact.lifecycle_status).forEach((value) => {
        const option = doc.createElement("option");
        option.value = value;
        option.textContent = value || "No status";
        lifecycleInput.append(option);
      });
      lifecycleInput.value = String(artifact.lifecycle_status || "").trim().toLowerCase();
      lifecycleLabel.append(lifecycleText, lifecycleInput);

      fields.append(topicLabel, lifecycleLabel);

      const actions = doc.createElement("div");
      actions.className = "ops-artifact-editor-actions";
      const saveButton = doc.createElement("button");
      saveButton.type = "button";
      saveButton.className = "btn secondary";
      saveButton.textContent = "Save metadata";
      const removeButton = doc.createElement("button");
      removeButton.type = "button";
      removeButton.className = "btn secondary";
      removeButton.textContent = "Remove from stack";
      const status = doc.createElement("span");
      status.className = "ops-artifact-editor-status";
      status.textContent = "Ready";
      actions.append(saveButton, removeButton, status);

      saveButton.addEventListener("click", async () => {
        saveButton.disabled = true;
        removeButton.disabled = true;
        status.textContent = "Saving…";
        try {
          const updated = await saveArtifactMetadata(artifact.id, {
            topic_tag: topicInput.value,
            lifecycle_status: lifecycleInput.value,
          });
          topicInput.value = String(updated.topic_tag || "");
          const updatedStatus = String(updated.lifecycle_status || "").trim().toLowerCase();
          if (!Array.from(lifecycleInput.options).some((option) => option.value === updatedStatus)) {
            const option = doc.createElement("option");
            option.value = updatedStatus;
            option.textContent = updatedStatus || "No status";
            lifecycleInput.append(option);
          }
          lifecycleInput.value = updatedStatus;
          status.textContent = "Saved";
        } catch (error) {
          status.textContent = error.message || "Save failed";
        } finally {
          saveButton.disabled = false;
          removeButton.disabled = false;
        }
      });

      removeButton.addEventListener("click", async () => {
        const confirmed = globalObjectRef.confirm(
          `Remove artifact ${artifact.id} from the stack now? This pulls it out of playback immediately and shifts the remaining memories up.`,
        );
        if (!confirmed) {
          return;
        }
        saveButton.disabled = true;
        removeButton.disabled = true;
        status.textContent = "Removing…";
        try {
          await removeArtifactFromCirculation(artifact.id);
          status.textContent = "Removed from circulation";
          card.classList.remove("ready");
          card.classList.add("broken");
          card.querySelectorAll("input, select, button").forEach((el) => {
            el.disabled = true;
          });
        } catch (error) {
          status.textContent = error.message || "Removal failed";
          saveButton.disabled = false;
          removeButton.disabled = false;
        }
      });

      card.append(head, fields, actions);
      return card;
    });

    dom.opsArtifactMetadata.replaceChildren(...cards);
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
    const audioMonitor = createAudioMonitorController({
      onLevelChange(level) {
        renderAudioMonitorLevel(dom, level);
      },
    });
    renderOperatorState(dom, initialState);
    replaceCardList(doc, dom.opsRecentActions, actionCards([]));
    renderAudioMonitorLevel(dom, 0);
    if (!audioMonitor.supportsLiveMonitor()) {
      renderAudioMonitorState(dom, {
        active: false,
        stateLabel: "Unsupported",
        statusText: "This browser cannot run live operator monitor here. Output tone may still work if Web Audio is available.",
      });
      if (dom.opsAudioMonitorStart) {
        dom.opsAudioMonitorStart.disabled = true;
      }
    }

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

    async function saveArtifactMetadata(artifactId, values) {
      const payload = await fetchJson(fetchImpl, `/api/v1/operator/artifacts/${artifactId}/metadata`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": readCookie(doc, "csrftoken"),
        },
        body: JSON.stringify(values || {}),
      });
      await refreshControls();
      return payload.artifact || {};
    }

    async function removeArtifactFromCirculation(artifactId) {
      const payload = await fetchJson(fetchImpl, `/api/v1/operator/artifacts/${artifactId}/remove`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": readCookie(doc, "csrftoken"),
        },
        body: JSON.stringify({}),
      });
      await refreshStatus();
      await refreshControls();
      await refreshArtifacts();
      return payload;
    }

    async function refreshArtifacts() {
      try {
        const payload = await fetchJson(fetchImpl, "/api/v1/operator/artifacts", { cache: "no-store" });
        renderArtifactMetadata(doc, dom, payload, saveArtifactMetadata, removeArtifactFromCirculation);
      } catch (error) {
        if (dom.opsArtifactMetadataStatus) {
          dom.opsArtifactMetadataStatus.textContent = error.message || "Artifact metadata refresh failed.";
        }
        replaceCardList(doc, dom.opsArtifactMetadata, [{
          tagName: "article",
          className: "component-card broken",
          title: "Artifact metadata unavailable",
          detail: "Unable to load recent artifacts for metadata stewardship.",
        }]);
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
            maintenance_mode: Boolean(dom.opsMaintenanceMode?.checked),
            intake_paused: Boolean(dom.opsIntakePaused?.checked),
            playback_paused: Boolean(dom.opsPlaybackPaused?.checked),
            quieter_mode: Boolean(dom.opsQuieterMode?.checked),
            mood_bias: String(dom.opsMoodBias?.value || ""),
            kiosk_language_code: String(dom.opsKioskLanguageCode?.value || ""),
            kiosk_accessibility_mode: String(dom.opsKioskAccessibilityMode?.value || ""),
            kiosk_force_reduced_motion: Boolean(dom.opsKioskReducedMotion?.checked),
            kiosk_max_recording_seconds: Number(dom.opsKioskMaxRecordingSeconds?.value || 120),
          }),
        });
        renderControlPayload(doc, dom, payload);
        await refreshStatus();
        await refreshArtifacts();
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

    if (dom.opsAudioTone) {
      dom.opsAudioTone.addEventListener("click", async () => {
        dom.opsAudioTone.disabled = true;
        renderAudioMonitorState(dom, {
          active: audioMonitor.isActive(),
          stateLabel: audioMonitor.isActive() ? "Live" : "Idle",
          statusText: "Playing output tone through this operator machine.",
        });
        try {
          await audioMonitor.playTone();
          renderAudioMonitorState(dom, {
            active: audioMonitor.isActive(),
            stateLabel: audioMonitor.isActive() ? "Live" : "Idle",
            statusText: audioMonitor.isActive()
              ? "Tone complete. Live monitor is still running in this steward browser."
              : "Tone complete. If you also need the live mic path, start live monitor with headphones on.",
          });
        } catch (error) {
          renderAudioMonitorState(dom, {
            active: audioMonitor.isActive(),
            stateLabel: audioMonitor.isActive() ? "Live" : "Idle",
            statusText: error.message || "Output tone failed.",
          });
        } finally {
          dom.opsAudioTone.disabled = false;
        }
      });
    }

    if (dom.opsAudioMonitorStart) {
      dom.opsAudioMonitorStart.addEventListener("click", async () => {
        renderAudioMonitorState(dom, {
          active: false,
          stateLabel: "Starting",
          statusText: "Requesting microphone access for live operator monitor...",
        });
        try {
          await audioMonitor.start();
          renderAudioMonitorState(dom, {
            active: true,
            stateLabel: "Live",
            statusText: "Live monitor running only in this steward browser. Use closed headphones or very low speaker gain to avoid feedback.",
          });
        } catch (error) {
          renderAudioMonitorLevel(dom, 0);
          renderAudioMonitorState(dom, {
            active: false,
            stateLabel: "Idle",
            statusText: error.message || "Live monitor failed to start.",
          });
        }
      });
    }

    if (dom.opsAudioMonitorStop) {
      dom.opsAudioMonitorStop.addEventListener("click", async () => {
        await audioMonitor.stop();
        renderAudioMonitorLevel(dom, 0);
        renderAudioMonitorState(dom, {
          active: false,
          stateLabel: "Idle",
          statusText: "Live monitor stopped. The operator browser released the microphone.",
        });
      });
    }

    void refreshStatus();
    void refreshControls();
    void refreshArtifacts();
    const intervalId = globalObjectRef.setInterval(() => {
      void refreshStatus();
      void refreshControls();
      void refreshArtifacts();
    }, intervalMs);

    return {
      refreshStatus,
      refreshControls,
      stop() {
        void audioMonitor.stop();
        globalObjectRef.clearInterval(intervalId);
      },
    };
  }

  return {
    actionCards,
    classifyState,
    componentCards,
    createAudioMonitorController,
    renderControlPayload,
    renderAudioMonitorLevel,
    renderAudioMonitorState,
    renderError,
    renderPayload,
    artifactMetadataStatusLine,
    artifactSummaryCards,
    lifecycleStatusOptions,
    meterLabelForLevel,
    memoryColorCards,
    playOperatorMonitorTone,
    retentionCards,
    start,
    throttleCards,
    warningCards,
  };
}));
