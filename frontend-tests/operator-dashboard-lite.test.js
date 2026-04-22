const test = require("node:test");
const assert = require("node:assert/strict");

const operatorLite = require("../api/engine/static/engine/operator-dashboard-lite.js");

test("classifyState returns ready when no failed components or warnings", () => {
  const state = operatorLite.classifyState({
    components: {
      database: { ok: true },
      redis: { ok: true },
      storage: { ok: true },
    },
    warnings: [],
  });

  assert.equal(state.state, "ready");
  assert.equal(state.title, "Ready");
});

test("classifyState returns broken on hard dependency failure", () => {
  const state = operatorLite.classifyState({
    components: {
      database: { ok: false, error: "down" },
      redis: { ok: true },
      storage: { ok: true },
    },
    warnings: [],
  });

  assert.equal(state.state, "broken");
  assert.equal(state.title, "Broken");
});

test("recommendedStage chooses incident for degraded or maintenance posture", () => {
  assert.equal(
    operatorLite.recommendedStage(
      { operator_state: { maintenance_mode: true }, playable: 12 },
      { state: "ready" },
    ),
    "incident",
  );
  assert.equal(
    operatorLite.recommendedStage(
      { operator_state: { maintenance_mode: false }, playable: 12 },
      { state: "degraded" },
    ),
    "incident",
  );
});

test("nextActionText favors calm live guidance when healthy and unpaused", () => {
  const text = operatorLite.nextActionText(
    {
      operator_state: {
        maintenance_mode: false,
        intake_paused: false,
        playback_paused: false,
      },
      warnings: [],
      playable: 5,
    },
    { state: "ready" },
  );

  assert.match(text, /Open `\/kiosk\/` and `\/room\/`/);
});

test("buildArchiveCommand keeps local default and adds quoted USB path when provided", () => {
  assert.equal(
    operatorLite.buildArchiveCommand(""),
    "./scripts/session_close_archive.sh",
  );
  assert.equal(
    operatorLite.buildArchiveCommand("/media/steward/SESSION_ARCHIVE"),
    "./scripts/session_close_archive.sh --to-usb \"/media/steward/SESSION_ARCHIVE\"",
  );
});
