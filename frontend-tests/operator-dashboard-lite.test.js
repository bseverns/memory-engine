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

test("recommendedTab maps incident posture to Fix Problem", () => {
  const tab = operatorLite.recommendedTab(
    { operator_state: { maintenance_mode: false }, playable: 12 },
    { state: "degraded" },
  );

  assert.equal(tab, "fix-problem");
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

test("buildArchiveCommand keeps local default and safely quotes USB paths", () => {
  assert.equal(
    operatorLite.buildArchiveCommand(""),
    "./scripts/session_close_archive.sh",
  );
  assert.equal(
    operatorLite.buildArchiveCommand("/media/steward/SESSION ARCHIVE"),
    "./scripts/session_close_archive.sh --to-usb '/media/steward/SESSION ARCHIVE'",
  );
  assert.equal(
    operatorLite.buildArchiveCommand("/media/steward/it's-safe"),
    "./scripts/session_close_archive.sh --to-usb '/media/steward/it'\\''s-safe'",
  );
});

test("buildArchiveCommandResult rejects non-absolute USB paths safely", () => {
  const result = operatorLite.buildArchiveCommandResult("SESSION_ARCHIVE");

  assert.equal(result.command, "./scripts/session_close_archive.sh");
  assert.match(result.error, /must be absolute/i);
});

test("validateUsbPath rejects control characters", () => {
  const result = operatorLite.validateUsbPath("/media/steward/SESSION\nARCHIVE");

  assert.equal(result.ok, false);
  assert.match(result.error, /unsafe control characters/i);
});

test("tab helpers normalize and parse persisted tab keys", () => {
  assert.equal(operatorLite.normalizeTabKey("FIX-PROBLEM"), "fix-problem");
  assert.equal(operatorLite.tabKeyFromHash("#ops-tab=close-session"), "close-session");
  assert.equal(operatorLite.tabKeyFromHash("#run-room"), "run-room");
  assert.equal(operatorLite.tabKeyFromHash("#unknown"), "");
  assert.deepEqual(operatorLite.TAB_KEYS, ["open-room", "run-room", "fix-problem", "close-session"]);
});
