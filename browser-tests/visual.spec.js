const fs = require("node:fs/promises");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const SCREENSHOT_DIR = path.join(process.cwd(), "artifacts", "screenshots");

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

async function signIntoOps(page) {
  await page.goto("/ops/");
  const loginHeading = page.getByRole("heading", { name: "Steward sign-in" });
  if (await loginHeading.isVisible().catch(() => false)) {
    await page.getByLabel("Shared steward secret").fill("test-ops-secret");
    await page.getByRole("button", { name: "Open dashboard" }).click();
  }
  await expect(page.getByRole("heading", { name: "Room Memory Status" })).toBeVisible();
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
} = {}) {
  await signIntoOps(page);
  await setCheckboxState(page.locator("#opsIntakePaused"), intakePaused);
  await setCheckboxState(page.locator("#opsPlaybackPaused"), playbackPaused);
  await setCheckboxState(page.locator("#opsQuieterMode"), quieterMode);
  await page.locator("#opsControlsSave").click();

  const expectedStatus = [];
  if (intakePaused) expectedStatus.push("intake paused");
  if (playbackPaused) expectedStatus.push("playback paused");
  if (quieterMode) expectedStatus.push("quieter mode");

  if (expectedStatus.length) {
    for (const phrase of expectedStatus) {
      await expect(page.locator("#opsControlStatus")).toContainText(phrase);
    }
  } else {
    await expect(page.locator("#opsControlStatus")).toContainText("No live control overrides");
  }
}

test.describe("visual stack walkthrough", () => {
  test("captures the recording kiosk landing state", async ({ page }) => {
    await mockHealthyOpsStatus(page);
    await applyStewardControls(page, {});
    await page.goto("/kiosk/");
    await expect(page.getByRole("heading", { name: "Room Memory" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Arm microphone" })).toBeVisible();
    await saveScreenshot(page, "recording-kiosk-idle.png");
  });

  test("captures the dedicated playback surface", async ({ page }) => {
    await mockHealthyOpsStatus(page);
    await applyStewardControls(page, {});
    await page.goto("/room/?autostart=0");
    await expect(page.getByRole("heading", { name: "Room Memory" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start listening" })).toBeVisible();
    await saveScreenshot(page, "room-playback.png");
  });

  test("captures the operator dashboard in a ready state", async ({ page }) => {
    await mockHealthyOpsStatus(page);
    await page.route("**/api/v1/operator/controls", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          operator_state: {
            intake_paused: false,
            playback_paused: false,
            quieter_mode: false,
          },
          recent_actions: [],
        }),
      });
    });

    await signIntoOps(page);
    await expect(page.getByRole("heading", { name: "Room Memory Status" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ready" })).toBeVisible();
    await saveScreenshot(page, "ops-ready.png");
  });

  test("captures the operator dashboard in a degraded state", async ({ page }) => {
    await mockHealthyOpsStatus(page, {
      active: 4,
      playable: 4,
      expired: 8,
      revoked: 5,
      lanes: { fresh: 4, mid: 0, worn: 0 },
      moods: {
        clear: 4,
        hushed: 0,
        suspended: 0,
        weathered: 0,
        gathering: 0,
      },
      storage: {
        path: "/",
        state: "warning",
        total_gb: 64,
        free_gb: 5.8,
        used_percent: 90.9,
        free_percent: 9.1,
      },
      warnings: [
        {
          level: "warning",
          title: "Storage pressure is rising",
          detail: "5.8 GB free (9.1%).",
        },
        {
          level: "warning",
          title: "Fresh lane is dominating the pool",
          detail: "4 of 4 playable sounds are currently classified as fresh.",
        },
      ],
      operator_state: {
        intake_paused: true,
        playback_paused: false,
        quieter_mode: true,
      },
    });
    await page.route("**/api/v1/operator/controls", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          operator_state: {
            intake_paused: true,
            playback_paused: false,
            quieter_mode: true,
          },
          recent_actions: [
            {
              action: "quieter_mode.enabled",
              actor: "operator@test",
              detail: "quieter mode enabled",
              created_at: "2026-03-20T10:00:00Z",
            },
          ],
        }),
      });
    });

    await signIntoOps(page);
    await expect(page.getByRole("heading", { name: "Room Memory Status" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Degraded" })).toBeVisible();
    await saveScreenshot(page, "ops-degraded.png");
  });

  test("captures the recorder after a live intake pause from the steward surface", async ({ page }) => {
    await mockHealthyOpsStatus(page);
    await applyStewardControls(page, { intakePaused: true });
    await saveScreenshot(page, "ops-controls-live.png");

    const kioskPage = await page.context().newPage();
    await kioskPage.goto("/kiosk/");
    await expect(kioskPage.getByText("This recording station is resting.")).toBeVisible();
    await expect(kioskPage.getByText("Recording intake is paused by the steward.")).toBeVisible();
    await saveScreenshot(kioskPage, "recording-kiosk-intake-paused.png");

    await kioskPage.close();
    await applyStewardControls(page, {});
  });

  test("captures the listening surface after quieter mode is applied live", async ({ page }) => {
    await mockHealthyOpsStatus(page);
    await applyStewardControls(page, { quieterMode: true });

    const roomPage = await page.context().newPage();
    await roomPage.goto("/room/?autostart=0");
    await expect(roomPage.locator("#playbackAutostartNote")).toContainText("Quieter mode is active");
    await saveScreenshot(roomPage, "room-playback-quieter.png");

    await roomPage.close();
    await applyStewardControls(page, {});
  });
});
