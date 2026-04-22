const test = require("node:test");
const assert = require("node:assert/strict");

const operatorDashboard = require("../api/engine/static/engine/operator-dashboard.js");

class FakeElement {
  constructor(tag = "div", ownerDocument = null) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.className = "";
    this.textContent = "";
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.placeholder = "";
    this.style = {};
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  get options() {
    return this.children;
  }
}

class FakeDocument {
  constructor() {
    this.nodes = new Map();
    this.cookie = "csrftoken=test-token";
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  getElementById(id) {
    return this.nodes.get(id) || null;
  }

  set(id, node = null) {
    const value = node || new FakeElement("div", this);
    value.ownerDocument = this;
    this.nodes.set(id, value);
    return value;
  }
}

test("classifyState returns ready when dependencies and warnings are clear", () => {
  const state = operatorDashboard.classifyState({
    components: {
      database: { ok: true },
      redis: { ok: true },
      storage: { ok: true },
    },
    warnings: [],
  });

  assert.deepEqual(state, {
    state: "ready",
    title: "Ready",
    summary: "All tracked dependencies are healthy. The node should be ready for capture and playback.",
  });
});

test("classifyState prioritizes database failure as broken", () => {
  const state = operatorDashboard.classifyState({
    components: {
      database: { ok: false, error: "down" },
      redis: { ok: true },
    },
    warnings: [{ level: "warning", detail: "pool low" }],
  });

  assert.equal(state.state, "broken");
  assert.match(state.summary, /database check failed/i);
});

test("warningCards yields a default ready card when there are no warnings", () => {
  const cards = operatorDashboard.warningCards([]);

  assert.equal(cards.length, 1);
  assert.equal(cards[0].className, "component-card ready");
  assert.equal(cards[0].title, "No current warnings");
});

test("actionCards formats recent steward changes", () => {
  const cards = operatorDashboard.actionCards([
    {
      action: "intake_paused.enabled",
      actor: "operator@127.0.0.1",
      detail: "intake paused enabled",
      created_at: "2026-03-20T10:00:00Z",
    },
  ]);

  assert.equal(cards.length, 1);
  assert.equal(cards[0].title, "intake paused enabled");
  assert.match(cards[0].detail, /operator@127\.0\.0\.1/);
});

test("retentionCards summarize upcoming raw and fossil retention edges", () => {
  const cards = operatorDashboard.retentionCards({
    soon_window_hours: 24,
    raw_expiring_soon: 2,
    next_raw_expiry_at: "2026-03-21T10:00:00Z",
    next_fossil_expiry_at: "2026-04-01T12:00:00Z",
  });

  assert.equal(cards.length, 3);
  assert.equal(cards[0].title, "Raw audio expiring in 24h");
  assert.match(cards[0].detail, /2 recording/);
});

test("artifactSummaryCards summarize totals, lanes, and dominant moods", () => {
  const cards = operatorDashboard.artifactSummaryCards({
    active: 12,
    playable: 9,
    expired: 2,
    revoked: 1,
    lanes: {
      fresh: 3,
      mid: 4,
      worn: 2,
    },
    moods: {
      clear: 1,
      hushed: 4,
      suspended: 0,
      weathered: 3,
      gathering: 1,
    },
  });

  assert.equal(cards.length, 4);
  assert.equal(cards[0].title, "Active deployment");
  assert.match(cards[0].detail, /memory/i);
  assert.equal(cards[1].title, "Archive totals");
  assert.match(cards[1].detail, /12 active/);
  assert.equal(cards[2].title, "Lane balance");
  assert.match(cards[2].detail, /fresh 3/);
  assert.equal(cards[3].title, "Dominant moods");
  assert.match(cards[3].detail, /hushed 4/);
  assert.match(cards[3].detail, /weathered 3/);
});

test("artifactMetadataStatusLine summarizes deployment-scoped metadata editing", () => {
  const line = operatorDashboard.artifactMetadataStatusLine({
    deployment: { label: "Question Engine" },
    artifacts: [{ id: 1 }, { id: 2 }],
    editable_fields: {
      lifecycle_status: {
        suggestions: ["open", "pending", "answered", "resolved"],
      },
    },
  });

  assert.match(line, /Question Engine/);
  assert.match(line, /2 stacked artifact/);
  assert.match(line, /closes the gap automatically/);
  assert.match(line, /Status picker presets/);
  assert.match(line, /open, pending, answered, resolved/);
});

test("lifecycleStatusOptions preserves blanks, suggestions, and older custom values", () => {
  const options = operatorDashboard.lifecycleStatusOptions(
    {
      allow_blank: true,
      suggestions: ["pending", "needs_part", "fixed", "obsolete"],
    },
    "escalated",
  );

  assert.deepEqual(options, ["", "pending", "needs_part", "fixed", "obsolete", "escalated"]);
});

test("meterLabelForLevel distinguishes idle, quiet, and healthy live monitor input", () => {
  assert.equal(operatorDashboard.meterLabelForLevel(0), "No mic signal yet.");
  assert.equal(operatorDashboard.meterLabelForLevel(0.1), "Very quiet signal");
  assert.equal(operatorDashboard.meterLabelForLevel(0.3), "Signal present");
});

test("createAudioMonitorController reports unsupported when browser audio APIs are absent", () => {
  const controller = operatorDashboard.createAudioMonitorController({
    globalObject: {},
  });

  assert.equal(controller.supportsLiveMonitor(), false);
  assert.equal(controller.isActive(), false);
});

test("componentCards, throttleCards, and memoryColorCards summarize defaults and active values", () => {
  const componentFallback = operatorDashboard.componentCards(null);
  assert.equal(componentFallback[0].title, undefined);
  assert.match(componentFallback[0].detail, /No dependency data/i);

  const componentCards = operatorDashboard.componentCards({
    database: { ok: true, detail: "ok" },
    worker: { ok: false, error: "stale" },
  });
  assert.equal(componentCards.length, 2);
  assert.equal(componentCards[0].className, "component-card ready");
  assert.equal(componentCards[1].className, "component-card broken");

  const throttleFallback = operatorDashboard.throttleCards(null);
  assert.equal(throttleFallback[0].title, "Throttle data unavailable");

  const throttleCards = operatorDashboard.throttleCards({
    public_ingest: { recent_denials: 2, window_seconds: 1800 },
    public_ingest_ip: { recent_denials: 1 },
    public_revoke: { recent_denials: 0 },
    public_revoke_ip: { recent_denials: 1 },
  });
  assert.equal(throttleCards.length, 3);
  assert.equal(throttleCards[0].title, "Recent ingest denials");
  assert.match(throttleCards[0].detail, /2 kiosk-level and 1 IP-level/);

  const colorFallback = operatorDashboard.memoryColorCards(null);
  assert.equal(colorFallback[0].title, "Memory color data unavailable");

  const colorCards = operatorDashboard.memoryColorCards({
    counts: { clear: 2, warm: 0 },
    catalog: {
      profiles: [
        { code: "clear", labels: { en: "Clear" } },
        { code: "warm", labels: { en: "Warm" } },
      ],
    },
  });
  assert.equal(colorCards.length, 2);
  assert.equal(colorCards[0].className, "component-card ready");
  assert.equal(colorCards[1].className, "component-card degraded");
});

test("archiveReadinessLine and render monitor helpers keep status text legible", () => {
  const line = operatorDashboard.archiveReadinessLine({
    components: {
      database: { ok: true },
      redis: { ok: true },
      storage: { ok: true },
    },
    warnings: [{ level: "warning", detail: "pool low" }],
    operator_state: {
      maintenance_mode: true,
      intake_paused: true,
      playback_paused: false,
    },
  });
  assert.match(line, /node is degraded/i);
  assert.match(line, /maintenance mode active/i);

  const dom = {
    opsAudioMonitorStart: new FakeElement("button"),
    opsAudioMonitorStop: new FakeElement("button"),
    opsAudioMonitorState: new FakeElement("div"),
    opsAudioCheckStatus: new FakeElement("div"),
    opsAudioMeterFill: new FakeElement("div"),
    opsAudioMeterLabel: new FakeElement("div"),
  };
  operatorDashboard.renderAudioMonitorState(dom, {
    active: true,
    stateLabel: "Live",
    statusText: "monitor active",
  });
  assert.equal(dom.opsAudioMonitorStart.disabled, true);
  assert.equal(dom.opsAudioMonitorStop.disabled, false);
  assert.equal(dom.opsAudioMonitorState.textContent, "Live");
  assert.equal(dom.opsAudioCheckStatus.textContent, "monitor active");

  operatorDashboard.renderAudioMonitorLevel(dom, 0.24);
  assert.equal(dom.opsAudioMeterFill.style.width, "24%");
  assert.equal(dom.opsAudioMeterLabel.textContent, "Signal present");
});

test("renderPayload and renderControlPayload update DOM summaries and control labels", () => {
  const doc = new FakeDocument();
  const dom = {
    opsStateBadge: doc.set("opsStateBadge"),
    opsStateLabel: doc.set("opsStateLabel"),
    opsSummary: doc.set("opsSummary"),
    opsActive: doc.set("opsActive"),
    opsPlayable: doc.set("opsPlayable"),
    opsExpired: doc.set("opsExpired"),
    opsRevoked: doc.set("opsRevoked"),
    opsFresh: doc.set("opsFresh"),
    opsMid: doc.set("opsMid"),
    opsWorn: doc.set("opsWorn"),
    opsStorage: doc.set("opsStorage"),
    opsRetentionRawHeld: doc.set("opsRetentionRawHeld"),
    opsRetentionRawSoon: doc.set("opsRetentionRawSoon"),
    opsRetentionFossils: doc.set("opsRetentionFossils"),
    opsRetentionResidue: doc.set("opsRetentionResidue"),
    opsIngestRate: doc.set("opsIngestRate"),
    opsIngestIpRate: doc.set("opsIngestIpRate"),
    opsRevokeRate: doc.set("opsRevokeRate"),
    opsRevokeIpRate: doc.set("opsRevokeIpRate"),
    opsWarnings: doc.set("opsWarnings"),
    opsArtifactSummary: doc.set("opsArtifactSummary"),
    opsMemoryColorSummary: doc.set("opsMemoryColorSummary"),
    opsRetentionSummary: doc.set("opsRetentionSummary"),
    opsThrottleSummary: doc.set("opsThrottleSummary"),
    opsComponents: doc.set("opsComponents"),
    opsRefreshed: doc.set("opsRefreshed"),
    opsArchiveReadiness: doc.set("opsArchiveReadiness"),
    opsMaintenanceMode: doc.set("opsMaintenanceMode"),
    opsIntakePaused: doc.set("opsIntakePaused"),
    opsPlaybackPaused: doc.set("opsPlaybackPaused"),
    opsQuieterMode: doc.set("opsQuieterMode"),
    opsMoodBias: doc.set("opsMoodBias"),
    opsSessionThemeTitle: doc.set("opsSessionThemeTitle"),
    opsSessionThemePrompt: doc.set("opsSessionThemePrompt"),
    opsDeploymentFocusTopic: doc.set("opsDeploymentFocusTopic"),
    opsDeploymentFocusStatus: doc.set("opsDeploymentFocusStatus"),
    opsKioskLanguageCode: doc.set("opsKioskLanguageCode"),
    opsKioskAccessibilityMode: doc.set("opsKioskAccessibilityMode"),
    opsKioskReducedMotion: doc.set("opsKioskReducedMotion"),
    opsKioskMaxRecordingSeconds: doc.set("opsKioskMaxRecordingSeconds"),
    opsSessionFramingStatus: doc.set("opsSessionFramingStatus"),
    opsRecentActions: doc.set("opsRecentActions"),
    opsControlStatus: doc.set("opsControlStatus"),
  };

  operatorDashboard.renderPayload(doc, dom, {
    components: {
      database: { ok: true },
      redis: { ok: true },
      storage: { ok: true },
    },
    warnings: [{ level: "warning", title: "storage", detail: "low disk" }],
    active: 14,
    playable: 12,
    expired: 1,
    revoked: 2,
    lanes: { fresh: 4, mid: 5, worn: 3 },
    moods: { clear: 1, hushed: 2, weathered: 1 },
    storage: { free_gb: 148.4 },
    retention: {
      raw_held: 7,
      raw_expiring_soon: 2,
      fossil_retained: 6,
      fossil_residue_only: 1,
      soon_window_hours: 24,
    },
    throttles: {
      public_ingest: { rate: "180/hour", recent_denials: 0, window_seconds: 3600 },
      public_ingest_ip: { rate: "120/hour", recent_denials: 0 },
      public_revoke: { rate: "60/hour", recent_denials: 0 },
      public_revoke_ip: { rate: "30/hour", recent_denials: 0 },
    },
    memory_colors: {
      counts: { clear: 2 },
      catalog: {
        profiles: [{ code: "clear", labels: { en: "Clear" } }],
      },
    },
    operator_state: {
      maintenance_mode: false,
      intake_paused: false,
      playback_paused: false,
      quieter_mode: false,
    },
  });

  assert.equal(dom.opsStateLabel.textContent, "Degraded");
  assert.equal(dom.opsActive.textContent, "14");
  assert.match(dom.opsArchiveReadiness.textContent, /Archive cue:/);
  assert.equal(Array.isArray(dom.opsWarnings.children), true);
  assert.equal(Array.isArray(dom.opsComponents.children), true);

  operatorDashboard.renderControlPayload(doc, dom, {
    operator_state: {
      maintenance_mode: true,
      intake_paused: true,
      playback_paused: false,
      quieter_mode: true,
      mood_bias: "weathered",
      session_theme_title: "Arrival",
      session_theme_prompt: "One line",
      deployment_focus_topic: "entry_gate",
      deployment_focus_status: "open",
      kiosk_language_code: "es_mx_ca",
      kiosk_accessibility_mode: "large_high_contrast",
      kiosk_force_reduced_motion: true,
      kiosk_max_recording_seconds: 90,
    },
    deployment_controls: {
      deployment: { label: "Question Engine" },
      topic: { placeholder: "entry_gate" },
      status: {
        suggestions: ["open", "pending", "resolved"],
        allow_blank: true,
      },
    },
    recent_actions: [{
      detail: "controls updated",
      actor: "operator@test",
      created_at: "2026-03-20T10:00:00Z",
    }],
  });

  assert.equal(dom.opsMaintenanceMode.checked, true);
  assert.equal(dom.opsDeploymentFocusTopic.placeholder, "entry_gate");
  assert.equal(dom.opsDeploymentFocusStatus.value, "open");
  assert.match(dom.opsSessionFramingStatus.textContent, /Session framing active/i);
  assert.match(dom.opsControlStatus.textContent, /Active controls:/);
  assert.equal(Array.isArray(dom.opsRecentActions.children), true);
});

test("renderError marks the status surface broken with fallback cards", () => {
  const doc = new FakeDocument();
  const dom = {
    opsStateBadge: doc.set("opsStateBadge"),
    opsStateLabel: doc.set("opsStateLabel"),
    opsSummary: doc.set("opsSummary"),
    opsWarnings: doc.set("opsWarnings"),
    opsComponents: doc.set("opsComponents"),
    opsRefreshed: doc.set("opsRefreshed"),
  };

  operatorDashboard.renderError(doc, dom, new Error("network down"));

  assert.equal(dom.opsStateBadge.textContent, "broken");
  assert.equal(dom.opsStateLabel.textContent, "Broken");
  assert.match(dom.opsSummary.textContent, /network down/i);
  assert.equal(dom.opsRefreshed.textContent, "Last refresh failed");
  assert.equal(Array.isArray(dom.opsWarnings.children), true);
  assert.equal(Array.isArray(dom.opsComponents.children), true);
});
