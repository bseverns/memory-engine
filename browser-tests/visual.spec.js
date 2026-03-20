const { test, expect } = require("@playwright/test");
const {
  applyStewardControls,
  healthyNodeStatusPayload,
  mockHealthyOpsStatus,
  mockSpectrograms,
  saveScreenshot,
  signIntoOps,
} = require("./helpers");

test.describe("visual stack walkthrough", () => {
  test("captures the recording kiosk landing state", async ({ page }) => {
    await mockHealthyOpsStatus(page);
    await applyStewardControls(page, {});
    await page.goto("/kiosk/");
    await expect(page.getByRole("heading", { name: "Room Memory" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Arm microphone" })).toBeVisible();
    await saveScreenshot(page, "recording-kiosk-idle.png");
  });

  test("captures the recording kiosk in accessibility mode", async ({ page }) => {
    await mockHealthyOpsStatus(page);
    await applyStewardControls(page, {
      kioskAccessibilityMode: "large_high_contrast",
      kioskReducedMotion: true,
      kioskMaxRecordingSeconds: 90,
    });
    await page.goto("/kiosk/");
    await expect(page.locator("#maxDurationHint")).toContainText("01:30");
    await saveScreenshot(page, "recording-kiosk-accessible.png");
  });

  test("captures the recording kiosk in Spanish", async ({ page }) => {
    await mockHealthyOpsStatus(page);
    await applyStewardControls(page, {
      kioskLanguageCode: "es_mx_ca",
    });
    await page.goto("/kiosk/");
    await expect(page.getByRole("heading", { name: "Memoria de la sala" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Activar micrófono" })).toBeVisible();
    await saveScreenshot(page, "recording-kiosk-spanish.png");
  });

  test("captures the dedicated playback surface", async ({ page }) => {
    await mockHealthyOpsStatus(page);
    await mockSpectrograms(page.context());
    await applyStewardControls(page, {});
    await page.goto("/room/?autostart=0");
    await expect(page.getByRole("heading", { name: "Room Memory" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start listening" })).toBeVisible();
    await saveScreenshot(page, "room-playback.png");
  });

  test("captures the playback info lightbox", async ({ page }) => {
    await mockHealthyOpsStatus(page);
    await mockSpectrograms(page.context());
    await applyStewardControls(page, {});
    await page.goto("/room/?autostart=0");
    await page.getByRole("button", { name: "About this room" }).click();
    await expect(page.getByRole("heading", { name: "How this surface behaves" })).toBeVisible();
    await saveScreenshot(page, "room-playback-info.png");
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
            mood_bias: "",
            kiosk_language_code: "",
            kiosk_accessibility_mode: "",
            kiosk_force_reduced_motion: false,
            kiosk_max_recording_seconds: 120,
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
        mood_bias: "weathered",
        kiosk_language_code: "",
        kiosk_accessibility_mode: "",
        kiosk_force_reduced_motion: false,
        kiosk_max_recording_seconds: 120,
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
            mood_bias: "weathered",
            kiosk_language_code: "",
            kiosk_accessibility_mode: "",
            kiosk_force_reduced_motion: false,
            kiosk_max_recording_seconds: 120,
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
    await mockSpectrograms(page.context());
    await applyStewardControls(page, { quieterMode: true, moodBias: "weathered" });

    const roomPage = await page.context().newPage();
    await roomPage.goto("/room/?autostart=0");
    await expect(roomPage.locator("#playbackAutostartNote")).toContainText("Quieter mode is active");
    await saveScreenshot(roomPage, "room-playback-quieter.png");

    await roomPage.close();
    await applyStewardControls(page, {});
  });
});
