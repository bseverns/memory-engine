const { test, expect } = require("@playwright/test");
const {
  applyStewardControls,
  mockHealthyOpsStatus,
  mockSpectrograms,
  signIntoOps,
} = require("./helpers");

test.describe("default browser check lane", () => {
  test("playback info lightbox opens and closes cleanly", async ({ page }) => {
    await mockHealthyOpsStatus(page);
    await mockSpectrograms(page.context());
    await applyStewardControls(page, {});
    await page.goto("/room/?autostart=0");

    await page.getByRole("button", { name: "About this room" }).click();
    await expect(page.getByRole("heading", { name: "How this surface behaves" })).toBeVisible();
    await expect(page.locator("#playbackInfoLightbox")).toHaveAttribute("aria-hidden", "false");

    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.locator("#playbackInfoLightbox")).toHaveAttribute("aria-hidden", "true");
  });

  test("kiosk monitor check opens from the idle state and closes cleanly", async ({ page }) => {
    await mockHealthyOpsStatus(page);
    await applyStewardControls(page, {});
    await page.goto("/kiosk/");

    await expect(page.getByRole("button", { name: "Monitor check" })).toBeVisible();
    await page.getByRole("button", { name: "Monitor check" }).click();
    await expect(page.getByText("Check the listening path before anyone speaks.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Play check tone" })).toBeVisible();

    await page.keyboard.press("KeyM");
    await expect(page.getByText("When you are ready, wake the microphone.")).toBeVisible();
  });

  test("saved take receipt explains the participant-facing revoke path on this node", async ({ page }) => {
    await mockHealthyOpsStatus(page);
    await page.route("**/api/v1/artifacts/audio", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          revocation_token: "NODE-KEEP-1234",
          artifact: {
            expires_at: "2026-04-02T12:00:00Z",
          },
        }),
      });
    });

    await applyStewardControls(page, {});
    await page.goto("/kiosk/");
    await page.evaluate(async () => {
      await window.MemoryEngineKioskTest.seedReviewTake({ effectProfile: "clear", seconds: 1.4 });
      await window.MemoryEngineKioskTest.selectMode("ROOM");
      await window.MemoryEngineKioskTest.submitCurrentTake();
    });

    await expect(page.locator("#receiptPanel")).toBeVisible();
    await expect(page.locator("#receipt")).toContainText("NODE-KEEP-1234");
    await expect(page.locator("#receipt")).toContainText("open /revoke/ on this node's network");
    await expect(page.locator("#receipt")).toContainText("only works on this node's network");
  });

  test("public revocation page submits a receipt code without opening steward controls", async ({ page }) => {
    let submittedToken = "";
    await page.route("**/api/v1/revoke", async (route) => {
      const payload = route.request().postDataJSON();
      submittedToken = payload.token;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, revoked_artifacts: 1 }),
      });
    });

    await page.goto("/revoke/?token=node-keep-1234");
    await expect(page.getByRole("heading", { name: "Remove a saved recording" })).toBeVisible();
    await expect(page.getByLabel("Revocation code")).toHaveValue("NODE-KEEP-1234");

    await page.getByRole("button", { name: "Revoke with this code" }).click();

    await expect(page.locator("#revokeStatus")).toContainText("Recording removed");
    await expect(page.locator("#revokeStatus")).toContainText("removed from this node");
    expect(submittedToken).toBe("NODE-KEEP-1234");
  });

  test("ops artifact cards expose quick status actions for question threads", async ({ page }) => {
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

    await page.route("**/api/v1/operator/artifacts", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          deployment: { code: "question", label: "Question Engine" },
          artifacts: [{
            id: 41,
            stack_position: 1,
            created_at: "2026-03-30T18:00:00Z",
            last_access_at: "2026-03-30T18:10:00Z",
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
            quick_status_actions: [
              { value: "answered", label: "Mark answered" },
              { value: "resolved", label: "Mark resolved" },
            ],
          }],
          operator_actions: {
            remove_from_circulation: {
              label: "Remove from stack",
              description: "Emergency steward action.",
            },
          },
          editable_fields: {
            topic_tag: {
              label: "Topic / category",
              placeholder: "entry_gate",
            },
            lifecycle_status: {
              label: "Status",
              input_mode: "select",
              allow_blank: true,
              suggestions: ["open", "pending", "answered", "resolved"],
            },
          },
        }),
      });
    });

    let submittedStatus = "";
    await page.route("**/api/v1/operator/artifacts/41/metadata", async (route) => {
      submittedStatus = route.request().postDataJSON().lifecycle_status;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          artifact: {
            id: 41,
            stack_position: 1,
            created_at: "2026-03-30T18:00:00Z",
            last_access_at: "2026-03-30T18:10:00Z",
            duration_ms: 3200,
            play_count: 2,
            wear: 0.08,
            deployment_kind: "question",
            topic_tag: "entry_gate",
            lifecycle_status: "answered",
            lane: "fresh",
            density: "light",
            mood: "clear",
            age_hours: 1.4,
            absence_hours: 0.4,
            quick_status_actions: [
              { value: "resolved", label: "Mark resolved" },
            ],
          },
          changed_fields: ["lifecycle_status"],
        }),
      });
    });

    await signIntoOps(page);
    const artifactCard = page.locator(".ops-artifact-editor").filter({ hasText: "Artifact 41" });
    await expect(artifactCard.getByRole("button", { name: "Mark answered" })).toBeVisible();
    await artifactCard.getByRole("button", { name: "Mark answered" }).click();

    await expect(artifactCard).toContainText("Marked answered");
    expect(submittedStatus).toBe("answered");
  });
});
