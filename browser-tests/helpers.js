const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { expect } = require("@playwright/test");

const SCREENSHOT_DIR = path.join(process.cwd(), "artifacts", "screenshots");
const MEMORY_COLOR_CATALOG_PATH = path.join(process.cwd(), "api", "engine", "memory_color_profiles.json");
const PLAYWRIGHT_OPS_SECRET = process.env.PLAYWRIGHT_OPS_SECRET || "test-ops-secret";

function loadMemoryColorCatalog() {
  return JSON.parse(fsSync.readFileSync(MEMORY_COLOR_CATALOG_PATH, "utf8"));
}

async function ensureScreenshotDir() {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
}

async function saveScreenshot(page, name) {
  await ensureScreenshotDir();
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, name),
    fullPage: true,
  });
}

function healthyNodeStatusPayload(overrides = {}) {
  const memoryColorCatalog = loadMemoryColorCatalog();
  const memoryColorCounts = Object.fromEntries(
    (memoryColorCatalog.profiles || []).map((profile, index) => [profile.code, Math.max(1, 4 - index)]),
  );
  return {
    ok: true,
    components: {
      database: { ok: true },
      redis: { ok: true },
      storage: { ok: true },
    },
    active: 14,
    playable: 12,
    expired: 3,
    revoked: 2,
    lanes: { fresh: 4, mid: 5, worn: 3 },
    moods: {
      clear: 2,
      hushed: 3,
      suspended: 3,
      weathered: 2,
      gathering: 2,
    },
    memory_colors: {
      counts: memoryColorCounts,
      catalog: memoryColorCatalog,
    },
    storage: {
      path: "/",
      state: "ready",
      total_gb: 256,
      free_gb: 148.4,
      used_percent: 42.0,
      free_percent: 58.0,
    },
    warnings: [],
    operator_state: {
      intake_paused: false,
      playback_paused: false,
      quieter_mode: false,
      mood_bias: "",
      kiosk_language_code: "",
      kiosk_accessibility_mode: "",
      kiosk_force_reduced_motion: false,
      kiosk_max_recording_seconds: 120,
    },
    ...overrides,
  };
}

async function mockHealthyOpsStatus(page, overrides = {}) {
  await page.route("**/api/v1/node/status", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(healthyNodeStatusPayload(overrides)),
    });
  });
}

async function signIntoOps(page, { surface = "bench" } = {}) {
  await page.goto("/ops/");
  const loginHeading = page.getByRole("heading", { name: "Steward sign-in" });
  if (await loginHeading.isVisible().catch(() => false)) {
    await page.getByLabel("Shared steward secret").fill(PLAYWRIGHT_OPS_SECRET);
    await page.getByRole("button", { name: "Open dashboard" }).click();
  }
  if (surface === "bench") {
    await page.goto("/ops/bench/");
    await expect(page.getByRole("heading", { name: "Room Memory Status" })).toBeVisible();
    return;
  }
  await expect(page.getByRole("heading", { name: "Room Memory Steward Surface" })).toBeVisible();
}

function fossilDataUrl(label = "Fossil Drift") {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720">
      <defs>
        <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="#1f1713"/>
          <stop offset="100%" stop-color="#3c2e25"/>
        </linearGradient>
      </defs>
      <rect width="1280" height="720" fill="url(#bg)"/>
      <g fill="none" stroke="#c9efe8" stroke-width="3" opacity="0.62">
        <path d="M40 520 C180 300 280 610 420 390 S700 120 860 350 1120 610 1240 260"/>
        <path d="M60 460 C220 220 330 600 500 330 S820 170 980 420 1140 590 1220 220" opacity="0.36"/>
      </g>
      <text x="80" y="96" fill="#f4ede3" font-size="42" font-family="Helvetica Neue, Arial, sans-serif">${label}</text>
    </svg>
  `.trim();
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

async function mockSpectrograms(target) {
  await target.route("**/api/v1/surface/fossils-url", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        feed_url: "/api/v1/surface/fossils/test-feed-token",
      }),
    });
  });
  await target.route("**/api/v1/surface/fossils/**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          created_at: "2026-03-20T14:00:00Z",
          title: "Fossil drift",
          image_url: fossilDataUrl("Fossil 18"),
        },
        {
          created_at: "2026-03-18T10:30:00Z",
          title: "Fossil drift",
          image_url: fossilDataUrl("Fossil 14"),
        },
      ]),
    });
  });
}

async function setCheckboxState(locator, checked) {
  if ((await locator.isChecked()) !== checked) {
    await locator.click();
  }
}

async function applyStewardControls(page, {
  intakePaused = false,
  playbackPaused = false,
  quieterMode = false,
  moodBias = "",
  kioskLanguageCode = "",
  kioskAccessibilityMode = "",
  kioskReducedMotion = false,
  kioskMaxRecordingSeconds = 120,
} = {}) {
  await signIntoOps(page, { surface: "bench" });
  await expect(page.locator("#opsControlStatus")).not.toContainText("Controls are loading.");
  await setCheckboxState(page.locator("#opsIntakePaused"), intakePaused);
  await setCheckboxState(page.locator("#opsPlaybackPaused"), playbackPaused);
  await setCheckboxState(page.locator("#opsQuieterMode"), quieterMode);
  await page.locator("#opsMoodBias").selectOption(moodBias);
  await page.locator("#opsKioskLanguageCode").selectOption(kioskLanguageCode);
  await page.locator("#opsKioskAccessibilityMode").selectOption(kioskAccessibilityMode);
  await setCheckboxState(page.locator("#opsKioskReducedMotion"), kioskReducedMotion);
  await page.locator("#opsKioskMaxRecordingSeconds").fill(String(kioskMaxRecordingSeconds));
  await page.locator("#opsControlsSave").click();

  const expectedStatus = [];
  if (intakePaused) expectedStatus.push("intake paused");
  if (playbackPaused) expectedStatus.push("playback paused");
  if (quieterMode) expectedStatus.push("quieter mode");
  if (moodBias) expectedStatus.push(`mood bias: ${moodBias}`);
  if (kioskLanguageCode === "es_mx_ca") expectedStatus.push("kiosk language: español");
  else if (kioskLanguageCode) expectedStatus.push(`kiosk language: ${kioskLanguageCode}`);
  if (kioskAccessibilityMode) expectedStatus.push("accessible kiosk");
  if (kioskReducedMotion) expectedStatus.push("reduced-motion kiosk");
  if (kioskMaxRecordingSeconds !== 120) expectedStatus.push(`kiosk max: ${kioskMaxRecordingSeconds}s`);

  if (expectedStatus.length) {
    for (const phrase of expectedStatus) {
      await expect(page.locator("#opsControlStatus")).toContainText(phrase);
    }
  } else {
    await expect(page.locator("#opsControlStatus")).toContainText("No live control overrides");
  }
}

module.exports = {
  applyStewardControls,
  healthyNodeStatusPayload,
  mockHealthyOpsStatus,
  mockSpectrograms,
  saveScreenshot,
  signIntoOps,
};
