const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadBrowserScript(context, relativePath) {
  const scriptPath = path.join(__dirname, "..", relativePath);
  const script = fs.readFileSync(scriptPath, "utf8");
  vm.runInNewContext(script, context, { filename: scriptPath });
}

function loadMemoryColorRuntime() {
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
  loadBrowserScript(context, "api/engine/static/engine/memory-color-catalog.js");
  loadBrowserScript(context, "api/engine/static/engine/kiosk-audio.js");
  return {
    audio: window.MemoryEngineKioskAudio,
    catalog: window.MemoryEngineMemoryColorCatalog,
  };
}

test("processRecordingSamples trims quiet edges and leaves an audible take usable", () => {
  const { audio } = loadMemoryColorRuntime();
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
  const { audio } = loadMemoryColorRuntime();
  const samples = new Float32Array(new Array(2200).fill(0.004));

  const result = audio.processRecordingSamples(samples, 1000);

  assert.ok(result.quietWarning);
  assert.match(result.note, /keep or retake/i);
});

test("encodeWavMono16 returns a blob with wav header and payload size", async () => {
  const { audio } = loadMemoryColorRuntime();
  const blob = audio.encodeWavMono16(new Float32Array([0, 0.5, -0.5]), 44100);
  const bytes = new Uint8Array(await blob.arrayBuffer());

  assert.equal(blob.type, "audio/wav");
  assert.equal(bytes.length, 44 + (3 * 2));
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...bytes.slice(8, 12)), "WAVE");
});

test("normalizeMemoryColorProfile accepts known profiles and falls back safely", () => {
  const { audio, catalog } = loadMemoryColorRuntime();
  const defaultCode = catalog.getDefaultMemoryColorCode();

  assert.equal(audio.normalizeMemoryColorProfile("Warm", defaultCode), "warm");
  assert.equal(audio.normalizeMemoryColorProfile("mystery", defaultCode), defaultCode);
  assert.equal(audio.normalizeMemoryColorProfile("", "dream"), "dream");
});

test("memoryColorSeedForBuffer is stable for the same audio and profile", () => {
  const { audio } = loadMemoryColorRuntime();
  const fakeBuffer = {
    numberOfChannels: 1,
    length: 8,
    sampleRate: 16000,
    getChannelData() {
      return new Float32Array([0, 0.1, -0.2, 0.3, -0.4, 0.2, 0.05, -0.01]);
    },
  };

  const first = audio.memoryColorSeedForBuffer(fakeBuffer, "dream");
  const second = audio.memoryColorSeedForBuffer(fakeBuffer, "dream");
  const warm = audio.memoryColorSeedForBuffer(fakeBuffer, "warm");

  assert.equal(first, second);
  assert.notEqual(first, warm);
});

test("memory color catalog utility exposes the canonical catalog and safe fallback", () => {
  const { audio, catalog } = loadMemoryColorRuntime();
  const memoryCatalog = catalog.getMemoryColorCatalog();
  const codes = memoryCatalog.profiles.map((profile) => profile.code);

  assert.ok(Array.isArray(memoryCatalog.profiles));
  assert.ok(codes.length > 0);
  assert.deepEqual(audio.MEMORY_COLOR_PROFILE_ORDER, codes);
  assert.equal(catalog.getMemoryColorByCode("mystery").code, catalog.getDefaultMemoryColorCode());
});

test("memory color catalog normalization falls back safely for malformed payloads", () => {
  const { catalog } = loadMemoryColorRuntime();
  const normalized = catalog.normalizeCatalog({
    default: "mystery",
    profiles: [
      { code: " ", labels: { en: "Ignored" } },
      { code: "afterglow", processing: { topology: "warm_body" } },
      { code: "afterglow", processing: { topology: "radio_narrowband" } },
    ],
  });

  assert.equal(normalized.default, "afterglow");
  assert.equal(normalized.profiles.length, 1);
  assert.equal(normalized.profiles[0].processing.topology, "warm_body");
});
