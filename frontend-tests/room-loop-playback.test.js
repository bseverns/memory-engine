const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadRoomLoopPlayback() {
  const scriptPath = path.join(__dirname, "../api/engine/static/engine/kiosk-room-loop-playback.js");
  const script = fs.readFileSync(scriptPath, "utf8");
  const context = {
    window: {
      fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
      MemoryEngineRoomLoopPolicy: {
        deploymentProfile() {
          return { overlapChanceMultiplier: 1.0 };
        },
        quietHoursActive() {
          return false;
        },
        recentArtifactIdsForExclusion() {
          return [];
        },
        sleep() {
          return Promise.resolve();
        },
      },
    },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    URLSearchParams,
  };
  vm.runInNewContext(script, context, { filename: scriptPath });
  return context.window.MemoryEngineRoomLoopPlayback;
}

test("threadFollowDecision enables a rare question chorus when an unresolved threaded question is in play", () => {
  const playback = loadRoomLoopPlayback();

  const decision = playback.threadFollowDecision({
    payload: {
      thread_signal: "question_chorus",
      topic_tag: "entry_gate",
      lifecycle_status: "open",
      density: "medium",
    },
    cue: { density: "medium" },
    poolSize: 5,
    threadLength: 2,
    maxLayers: 2,
    randomValue: 0.1,
  });

  assert.equal(decision.mode, "question_chorus");
  assert.equal(decision.preferredTopic, "entry_gate");
  assert.equal(decision.preferredLifecycleStatus, "open");
  assert.equal(decision.companionCount, 1);
});

test("threadFollowDecision can request a second question chorus companion for a sustained thread", () => {
  const playback = loadRoomLoopPlayback();

  const decision = playback.threadFollowDecision({
    payload: {
      thread_signal: "question_chorus",
      topic_tag: "entry_gate",
      lifecycle_status: "open",
      density: "medium",
    },
    cue: { density: "medium" },
    poolSize: 5,
    threadLength: 3,
    maxLayers: 2,
    randomValue: 0.1,
  });

  assert.equal(decision.mode, "question_chorus");
  assert.equal(decision.companionCount, 2);
});

test("threadFollowDecision suppresses question chorus for dense material", () => {
  const playback = loadRoomLoopPlayback();

  const decision = playback.threadFollowDecision({
    payload: {
      thread_signal: "question_chorus",
      topic_tag: "entry_gate",
      lifecycle_status: "open",
      density: "dense",
    },
    cue: { density: "dense" },
    poolSize: 5,
    randomValue: 0.1,
  });

  assert.equal(decision.mode, "none");
});

test("threadFollowDecision enables repair bench returns more readily for practical threaded material", () => {
  const playback = loadRoomLoopPlayback();

  const decision = playback.threadFollowDecision({
    payload: {
      thread_signal: "repair_bench",
      topic_tag: "projector",
      lifecycle_status: "needs_part",
      density: "medium",
    },
    cue: { density: "medium" },
    poolSize: 3,
    randomValue: 0.2,
  });

  assert.equal(decision.mode, "repair_bench");
  assert.equal(decision.preferredTopic, "projector");
  assert.equal(decision.preferredLifecycleStatus, "needs_part");
  assert.equal(decision.companionCount, 0);
});

test("repairBenchProfile lightens density and tightens the gap for longer repair threads", () => {
  const playback = loadRoomLoopPlayback();

  const profile = playback.repairBenchProfile({
    threadLength: 3,
    cueDensity: "medium",
  });

  assert.equal(profile.requestDensity, "light");
  assert.equal(profile.followDensity, "light");
  assert.equal(profile.followDelayMinMs, 120);
  assert.equal(profile.followDelayMaxMs, 240);
  assert.equal(profile.gapScale, 0.48);
});
