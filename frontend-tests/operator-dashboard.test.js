const test = require("node:test");
const assert = require("node:assert/strict");

const operatorDashboard = require("../api/engine/static/engine/operator-dashboard.js");

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
  assert.match(line, /2 recent artifact/);
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
