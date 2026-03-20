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
