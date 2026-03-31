const { test, expect } = require("@playwright/test");
const {
  applyStewardControls,
  mockHealthyOpsStatus,
  mockSpectrograms,
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
});
