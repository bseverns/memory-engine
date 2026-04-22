const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadRoomLoopFocusHelpers() {
  const scriptPath = path.join(__dirname, "../api/engine/static/engine/kiosk-room-loop.js");
  const script = fs.readFileSync(scriptPath, "utf8");
  const context = {
    window: {
      MemoryEngineRoomLoopPolicy: {
        adaptiveGapMultiplier: () => 1,
        densityHistoryWindowSize: () => 4,
        loadPersistentLoopWindow: () => [],
        loopHistoryWindowSize: () => 6,
        quietHoursActive: () => false,
        randomIntBetween: () => 1,
        recentArtifactIdsForExclusion: () => [],
        rememberPersistentArtifactId: (_config, _key, windowIds) => windowIds || [],
        resolveActiveDaypart: () => null,
        resolveMovement: (movement) => movement || { name: "steady", minItems: 1, maxItems: 1 },
        roomToneLevelFor: (_config, _loopConfig, _intensity, fallback) => fallback || 0.01,
        sceneHistoryWindowSize: () => 3,
        scarcityProfile: () => ({ label: "", gapMultiplier: 1.0, pauseMultiplier: 1.0, toneMultiplier: 1.0 }),
        sleep: () => Promise.resolve(),
        surfaceOverlayMultiplier: (_cfg, _name, _field, fallback) => fallback || 1.0,
      },
      MemoryEngineRoomLoopSequencer: {
        chooseNextScene: () => ({ name: "scene", cues: [{ gapMs: 900 }] }),
        chooseTargetDensity: () => "medium",
        chooseTargetMood: () => "clear",
        recentDensityWindow: () => [],
      },
      MemoryEngineRoomLoopPlayback: {
        acknowledgeAudiblePlayback: () => Promise.resolve(),
        fetchLayerPayload: () => Promise.resolve(null),
        fetchPoolPayload: () => Promise.resolve(null),
        fetchThreadFollowPayload: () => Promise.resolve(null),
        overlapAllowedForCue: () => false,
        playFollowPayload: () => Promise.resolve(),
        playLayeredPayload: () => Promise.resolve(),
        randomDelayBetween: () => 120,
        repairBenchProfile: () => ({
          requestDensity: "light",
          followDensity: "light",
          followDelayMinMs: 120,
          followDelayMaxMs: 240,
          gapScale: 0.48,
        }),
        threadFollowDecision: () => ({ mode: "none", preferredTopic: "", preferredLifecycleStatus: "", companionCount: 0 }),
        toneLevelForName: () => 0.01,
      },
      MemoryEngineRoomLoopTone: {
        createToneEngine: () => ({
          setRoomToneLevel: () => {},
          stopRoomTone: () => Promise.resolve(),
        }),
      },
    },
  };

  vm.runInNewContext(script, context, { filename: scriptPath });
  return context.window.MemoryEngineRoomLoop.__test;
}

test("question deployment consumes operator topic/status focus hints", () => {
  const helpers = loadRoomLoopFocusHelpers();
  const hint = helpers.applyOperatorFocusHintToThreadHint({
    baseHint: { preferredTopic: "old_topic", preferredLifecycleStatus: "open", threadLength: 1 },
    deploymentCode: "question",
    surfaceState: {
      deployment_focus_topic: "entry_gate",
      deployment_focus_status: "open",
    },
    loopHistory: [
      { topic: "entry_gate" },
      { topic: "other" },
      { topic: "entry_gate" },
    ],
  });

  assert.equal(hint.preferredTopic, "entry_gate");
  assert.equal(hint.preferredLifecycleStatus, "open");
  assert.equal(hint.threadLength, 2);
});

test("repair deployment consumes status-only focus hint as advisory", () => {
  const helpers = loadRoomLoopFocusHelpers();
  const hint = helpers.applyOperatorFocusHintToThreadHint({
    baseHint: { preferredTopic: "projector", preferredLifecycleStatus: "pending", threadLength: 2 },
    deploymentCode: "repair",
    surfaceState: {
      deployment_focus_topic: "",
      deployment_focus_status: "needs_part",
    },
    loopHistory: [{ topic: "projector" }],
  });

  assert.equal(hint.preferredTopic, "projector");
  assert.equal(hint.preferredLifecycleStatus, "needs_part");
  assert.equal(hint.threadLength, 2);
});

test("non-thread deployments ignore operator focus hints", () => {
  const helpers = loadRoomLoopFocusHelpers();
  const hint = helpers.applyOperatorFocusHintToThreadHint({
    baseHint: { preferredTopic: "threshold", preferredLifecycleStatus: "open", threadLength: 3 },
    deploymentCode: "memory",
    surfaceState: {
      deployment_focus_topic: "entry_gate",
      deployment_focus_status: "resolved",
    },
    loopHistory: [{ topic: "entry_gate" }],
  });

  assert.equal(hint.preferredTopic, "threshold");
  assert.equal(hint.preferredLifecycleStatus, "open");
  assert.equal(hint.threadLength, 3);
});
