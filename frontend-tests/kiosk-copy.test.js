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
