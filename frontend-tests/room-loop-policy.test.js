const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadRoomLoopPolicy() {
  const scriptPath = path.join(__dirname, "../api/engine/static/engine/kiosk-room-loop-policy.js");
  const script = fs.readFileSync(scriptPath, "utf8");
  const context = { window: {} };
  vm.runInNewContext(script, context, { filename: scriptPath });
  return context.window.MemoryEngineRoomLoopPolicy;
}

test("question deployment shortens the anti-repetition window", () => {
  const policy = loadRoomLoopPolicy();

  const size = policy.antiRepetitionWindowSize({
    engineDeployment: "question",
    roomAntiRepetitionWindowSize: 12,
    roomLoopConfig: {
      policy: {
        activeDeployment: {
          code: "question",
          antiRepetitionWindow: 8,
        },
      },
    },
  });

  assert.equal(size, 8);
});

test("oracle deployment stretches gap timing compared with memory", () => {
  const policy = loadRoomLoopPolicy();
  const intensity = { cueGapMultiplier: 1.0, pauseGapMultiplier: 1.0, roomToneMultiplier: 1.0 };
  const movement = { gapMultiplier: 1.0 };
  const baseLoopConfig = {
    policy: {
      scarcity: {
        normal: { gapMultiplier: 1.0, pauseMultiplier: 1.0, toneMultiplier: 1.0 },
      },
      activeDeployment: {
        code: "memory",
        cueGapMultiplier: 1.0,
        pauseGapMultiplier: 1.0,
        toneGainMultiplier: 1.0,
      },
    },
  };
  const oracleLoopConfig = {
    policy: {
      scarcity: {
        normal: { gapMultiplier: 1.0, pauseMultiplier: 1.0, toneMultiplier: 1.0 },
      },
      activeDeployment: {
        code: "oracle",
        cueGapMultiplier: 1.45,
        pauseGapMultiplier: 1.7,
        toneGainMultiplier: 1.14,
      },
    },
  };

  const memoryGap = policy.adaptiveGapMultiplier({ engineDeployment: "memory" }, baseLoopConfig, intensity, 20, movement, false);
  const oracleGap = policy.adaptiveGapMultiplier({ engineDeployment: "oracle" }, oracleLoopConfig, intensity, 20, movement, false);

  assert.ok(oracleGap > memoryGap);
});

test("repair deployment lowers room-tone gain compared with memory", () => {
  const policy = loadRoomLoopPolicy();
  const intensity = { roomToneMultiplier: 1.0 };
  const memoryTone = policy.roomToneLevelFor(
    { engineDeployment: "memory" },
    {
      policy: {
        scarcity: {
          normal: { gapMultiplier: 1.0, pauseMultiplier: 1.0, toneMultiplier: 1.0 },
        },
        activeDeployment: {
          code: "memory",
          toneGainMultiplier: 1.0,
        },
      },
    },
    intensity,
    0.017,
    20,
  );
  const repairTone = policy.roomToneLevelFor(
    { engineDeployment: "repair" },
    {
      policy: {
        scarcity: {
          normal: { gapMultiplier: 1.0, pauseMultiplier: 1.0, toneMultiplier: 1.0 },
        },
        activeDeployment: {
          code: "repair",
          toneGainMultiplier: 0.82,
        },
      },
    },
    intensity,
    0.017,
    20,
  );

  assert.ok(repairTone < memoryTone);
});
