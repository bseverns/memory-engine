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
});

test("question and repair deployment overrides are available as placeholders", () => {
  const copy = loadCopyApi();
  const question = copy.getDeploymentPack("en", "question");
  const repair = copy.getDeploymentPack("en", "repair");

  assert.match(question.heroTitle, /Question/i);
  assert.match(question.btnChooseMemoryMode, /question mode/i);
  assert.match(repair.heroTitle, /Repair/i);
  assert.match(repair.btnChooseMemoryMode, /repair mode/i);
});
