const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadKioskAudio() {
  const scriptPath = path.join(__dirname, "../api/engine/static/engine/kiosk-audio.js");
  const script = fs.readFileSync(scriptPath, "utf8");
  const window = {};
  const context = {
    window,
    Blob,
    ArrayBuffer,
    DataView,
    Math,
    fetch: async () => {
      throw new Error("fetch should not run in this test");
    },
  };
  vm.runInNewContext(script, context, { filename: scriptPath });
  return window.MemoryEngineKioskAudio;
}

test("processRecordingSamples trims quiet edges and leaves an audible take usable", () => {
  const audio = loadKioskAudio();
  const samples = new Float32Array([
    ...new Array(260).fill(0),
    ...new Array(900).fill(0.25),
    ...new Array(260).fill(0),
  ]);

  const result = audio.processRecordingSamples(samples, 1000);

  assert.ok(result.samples.length < samples.length);
  assert.equal(result.quietWarning, null);
  assert.match(result.note, /trimmed|smoothed/i);
});

test("processRecordingSamples flags a very quiet long take", () => {
  const audio = loadKioskAudio();
  const samples = new Float32Array(new Array(2200).fill(0.004));

  const result = audio.processRecordingSamples(samples, 1000);

  assert.ok(result.quietWarning);
  assert.match(result.note, /keep or retake/i);
});

test("encodeWavMono16 returns a blob with wav header and payload size", async () => {
  const audio = loadKioskAudio();
  const blob = audio.encodeWavMono16(new Float32Array([0, 0.5, -0.5]), 44100);
  const bytes = new Uint8Array(await blob.arrayBuffer());

  assert.equal(blob.type, "audio/wav");
  assert.equal(bytes.length, 44 + (3 * 2));
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...bytes.slice(8, 12)), "WAVE");
});

test("normalizeMemoryColorProfile accepts known profiles and falls back safely", () => {
  const audio = loadKioskAudio();

  assert.equal(audio.normalizeMemoryColorProfile("Warm", "clear"), "warm");
  assert.equal(audio.normalizeMemoryColorProfile("mystery", "clear"), "clear");
  assert.equal(audio.normalizeMemoryColorProfile("", "dream"), "dream");
});
