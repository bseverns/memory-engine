const { test, expect } = require("@playwright/test");
const {
  applyStewardControls,
  healthyNodeStatusPayload,
  mockHealthyOpsStatus,
  mockSpectrograms,
  saveScreenshot,
  signIntoOps,
} = require("./helpers");

async function mockOperatorDashboardFeeds(page, {
  operatorState = {
    intake_paused: false,
    playback_paused: false,
    quieter_mode: false,
    mood_bias: "",
    kiosk_language_code: "",
    kiosk_accessibility_mode: "",
    kiosk_force_reduced_motion: false,
    kiosk_max_recording_seconds: 120,
  },
  recentActions = [],
  artifacts = [],
  deployment = { code: "memory", label: "Memory Engine" },
} = {}) {
  let currentOperatorState = { ...operatorState };
  let currentRecentActions = [...recentActions];
  await page.context().route("**/api/v1/surface/state", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        operator_state: currentOperatorState,
        ingest_budget: null,
      }),
    });
  });

  await page.route("**/api/v1/operator/controls", async (route) => {
    if (route.request().method() === "POST") {
      const incoming = JSON.parse(route.request().postData() || "{}");
      currentOperatorState = {
        ...currentOperatorState,
        maintenance_mode: Boolean(incoming.maintenance_mode),
        intake_paused: Boolean(incoming.intake_paused),
        playback_paused: Boolean(incoming.playback_paused),
        quieter_mode: Boolean(incoming.quieter_mode),
        mood_bias: String(incoming.mood_bias || ""),
        kiosk_language_code: String(incoming.kiosk_language_code || ""),
        kiosk_accessibility_mode: String(incoming.kiosk_accessibility_mode || ""),
        kiosk_force_reduced_motion: Boolean(incoming.kiosk_force_reduced_motion),
        kiosk_max_recording_seconds: Number(incoming.kiosk_max_recording_seconds || 120),
      };
      currentRecentActions = [{
        action: currentOperatorState.intake_paused ? "intake_paused.enabled" : "controls.updated",
        actor: "operator@test",
        detail: currentOperatorState.intake_paused ? "intake paused enabled" : "controls updated",
        created_at: "2026-03-20T12:00:00Z",
      }, ...currentRecentActions].slice(0, 8);
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        operator_state: currentOperatorState,
        recent_actions: currentRecentActions,
      }),
    });
  });

  await page.route("**/api/v1/operator/artifacts", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        deployment,
        artifacts,
        operator_actions: {
          remove_from_circulation: {
            label: "Remove from stack",
            description: "Emergency steward action that closes the stack gap.",
          },
        },
        editable_fields: {
          topic_tag: {
            label: "Topic / category",
            placeholder: deployment.code === "repair" ? "projector" : "memory_thread",
          },
          lifecycle_status: {
            label: "Status",
            input_mode: "select",
            allow_blank: true,
            suggestions: deployment.code === "repair"
              ? ["pending", "needs_part", "fixed", "obsolete"]
              : ["open", "resolved"],
          },
        },
      }),
    });
  });
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
    await mockOperatorDashboardFeeds(page, {
      artifacts: [
        {
          id: 18,
          created_at: "2026-03-20T14:00:00Z",
          last_access_at: "2026-03-20T16:40:00Z",
          duration_ms: 3200,
          play_count: 3,
          wear: 0.12,
          deployment_kind: "memory",
          topic_tag: "memory_thread",
          lifecycle_status: "",
          lane: "mid",
          density: "medium",
          mood: "weathered",
          age_hours: 5.0,
          absence_hours: 1.3,
        },
      ],
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
    await mockOperatorDashboardFeeds(page, {
      operatorState: {
        intake_paused: true,
        playback_paused: false,
        quieter_mode: true,
        mood_bias: "weathered",
        kiosk_language_code: "",
        kiosk_accessibility_mode: "",
        kiosk_force_reduced_motion: false,
        kiosk_max_recording_seconds: 120,
      },
      recentActions: [
        {
          action: "quieter_mode.enabled",
          actor: "operator@test",
          detail: "quieter mode enabled",
          created_at: "2026-03-20T10:00:00Z",
        },
      ],
      artifacts: [
        {
          id: 22,
          created_at: "2026-03-20T13:20:00Z",
          last_access_at: "2026-03-20T14:00:00Z",
          duration_ms: 4100,
          play_count: 1,
          wear: 0.05,
          deployment_kind: "memory",
          topic_tag: "memory_thread",
          lifecycle_status: "",
          lane: "fresh",
          density: "light",
          mood: "clear",
          age_hours: 2.2,
          absence_hours: 0.7,
        },
      ],
    });

    await signIntoOps(page);
    await expect(page.getByRole("heading", { name: "Room Memory Status" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Degraded" })).toBeVisible();
    await saveScreenshot(page, "ops-degraded.png");
  });

  test("captures the recorder after a live intake pause from the steward surface", async ({ page }) => {
    await mockHealthyOpsStatus(page);
    await mockOperatorDashboardFeeds(page, {
      artifacts: [
        {
          id: 24,
          created_at: "2026-03-20T11:30:00Z",
          last_access_at: "2026-03-20T12:00:00Z",
          duration_ms: 2800,
          play_count: 2,
          wear: 0.09,
          deployment_kind: "memory",
          topic_tag: "memory_thread",
          lifecycle_status: "",
          lane: "mid",
          density: "medium",
          mood: "hushed",
          age_hours: 6.0,
          absence_hours: 2.0,
        },
      ],
    });
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

  test("captures operator stewardship with monitor and emergency removal controls", async ({ page }) => {
    await mockHealthyOpsStatus(page);
    await mockOperatorDashboardFeeds(page, {
      deployment: { code: "question", label: "Question Engine" },
      artifacts: [
        {
          id: 41,
          stack_position: 1,
          created_at: "2026-03-20T18:00:00Z",
          last_access_at: "2026-03-20T18:10:00Z",
          duration_ms: 3200,
          play_count: 2,
          wear: 0.08,
          deployment_kind: "question",
          topic_tag: "entry_gate",
          lifecycle_status: "open",
          lane: "fresh",
          density: "light",
          mood: "clear",
          age_hours: 1.4,
          absence_hours: 0.4,
        },
      ],
      recentActions: [
        {
          action: "artifact.metadata.updated",
          actor: "operator@test",
          detail: "artifact 41 metadata updated (topic entry_gate, status open)",
          created_at: "2026-03-20T18:12:00Z",
        },
      ],
    });

    await signIntoOps(page);
    await expect(page.getByRole("heading", { name: "Bring-up and recovery first" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Play output tone" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove from stack" })).toBeVisible();
    await saveScreenshot(page, "ops-stewardship.png");
  });
});
