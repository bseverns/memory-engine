const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadCopyApi() {
  const scriptPath = path.join(__dirname, "../api/engine/static/engine/kiosk-copy.js");
  const script = fs.readFileSync(scriptPath, "utf8");
  const context = { window: {} };
  vm.runInNewContext(script, context, { filename: scriptPath });
  return context.window.MemoryEngineKioskCopy;
}

test("deployment copy defaults to memory pack", () => {
  const copy = loadCopyApi();
  const base = copy.getPack("en");
  const deploymentPack = copy.getDeploymentPack("en", "memory");

  assert.equal(deploymentPack.heroTitle, base.heroTitle);
  assert.equal(copy.normalizeDeployment(""), "memory");
  assert.equal(deploymentPack.deploymentLabel, "Memory Engine");
});

test("all six deployment packs are available with mode copy", () => {
  const copy = loadCopyApi();
  const modes = ["memory", "question", "prompt", "repair", "witness", "oracle"];

  for (const deployment of modes) {
    const pack = copy.getDeploymentPack("en", deployment);
    assert.ok(pack.heroTitle);
    assert.ok(pack.btnChooseMemoryMode);
    assert.ok(pack.modes.ROOM.name);
    assert.ok(pack.modes.FOSSIL.name);
    assert.ok(pack.modes.NOSAVE.name);
  }
});

test("memory, question, prompt, and repair deployments expose prompt-pack copy", () => {
  const copy = loadCopyApi();

  for (const deployment of ["memory", "question", "prompt", "repair"]) {
    const pack = copy.getDeploymentPack("en", deployment);
    assert.ok(pack.promptPackKicker);
    assert.ok(pack.promptPackTitle);
    assert.ok(pack.promptPackLead);
    assert.equal(Array.isArray(pack.promptPackLines), true);
    assert.equal(pack.promptPackLines.length, 3);
  }
});

test("applySessionThemeFraming augments kiosk idle/review/prompt and mode copy", () => {
  const copy = loadCopyApi();
  const base = copy.getDeploymentPack("en", "memory");

  const themed = copy.applySessionThemeFraming(base, {
    session_theme_title: "Arrival and thresholds",
    session_theme_prompt: "Offer one small sound about crossing into this room.",
  });

  assert.notEqual(themed.stageIdleCopy, base.stageIdleCopy);
  assert.match(themed.stageIdleCopy, /Session theme: Arrival and thresholds/);
  assert.notEqual(themed.stageReviewCopy, base.stageReviewCopy);
  assert.match(themed.promptPackLead, /Current theme: Arrival and thresholds/);
  assert.equal(Array.isArray(themed.promptPackLines), true);
  assert.ok(themed.promptPackLines.length >= 1);
  assert.match(themed.promptPackLines[0], /Session theme cue: Arrival and thresholds/);
  assert.match(themed.modes.ROOM.reviewCopy, /Session theme: Arrival and thresholds/);
});

test("applySessionThemeFraming is a no-op when theme fields are empty", () => {
  const copy = loadCopyApi();
  const base = copy.getDeploymentPack("en", "memory");
  const themed = copy.applySessionThemeFraming(base, {
    session_theme_title: "",
    session_theme_prompt: "",
  });

  assert.equal(themed, base);
});
