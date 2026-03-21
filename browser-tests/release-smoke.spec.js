const { test, expect } = require("@playwright/test");
const { applyStewardControls, signIntoOps } = require("./helpers");

test.describe("compose-backed release smoke", () => {
  test("boots the stack and proves kiosk, room, and ops stay aligned", async ({ browser, page, request, baseURL }) => {
    const healthResponse = await request.get(`${baseURL}/healthz`);
    expect(healthResponse.ok()).toBeTruthy();

    const readinessResponse = await request.get(`${baseURL}/readyz`);
    expect(readinessResponse.ok()).toBeTruthy();

    const opsPage = await browser.newPage();
    await signIntoOps(opsPage);
    await applyStewardControls(opsPage, {});
    const kioskPage = await browser.newPage();
    await kioskPage.goto("/kiosk/");
    await kioskPage.evaluate(async () => {
      await window.MemoryEngineKioskTest.seedReviewTake({ effectProfile: "clear", seconds: 1.8 });
    });

    const catalog = await kioskPage.evaluate(() => window.MemoryEngineMemoryColorCatalog.getMemoryColorCatalog());
    const chosenProfile = catalog.profiles.find((profile) => profile.code !== catalog.default) || catalog.profiles[0];
    const chosenLabel = chosenProfile.labels?.en || chosenProfile.code;
    const beforeSummary = await opsPage.evaluate(async () => {
      const response = await fetch("/api/v1/operator/artifact-summary", { credentials: "same-origin" });
      return response.json();
    });

    const artifactSubmit = kioskPage.waitForResponse((response) => (
      response.url().includes("/api/v1/artifacts/audio")
      && response.request().method() === "POST"
    ));

    await kioskPage.evaluate(async ({ code }) => {
      await window.MemoryEngineKioskTest.selectMemoryColor(code);
      await window.MemoryEngineKioskTest.chooseMemoryPreview();
    }, { code: chosenProfile.code });

    await kioskPage.evaluate(async () => {
      await window.MemoryEngineKioskTest.selectMode("ROOM");
      await window.MemoryEngineKioskTest.submitCurrentTake();
    });

    const artifactResponse = await artifactSubmit;
    expect(artifactResponse.ok()).toBeTruthy();
    const artifactPayload = await artifactResponse.json();
    expect(artifactPayload.artifact.effect_profile).toBe(chosenProfile.code);
    await expect(kioskPage.locator("#receiptPanel")).toBeVisible();
    await kioskPage.close();

    const roomPage = await browser.newPage();
    await roomPage.goto("/room/?autostart=0");
    await roomPage.evaluate(() => window.MemoryEnginePlaybackTest?.reset?.());

    await roomPage.getByRole("button", { name: "Start listening" }).click();
    await roomPage.waitForFunction(() => window.MemoryEnginePlaybackTest?.calls?.length > 0);
    const playbackCall = await roomPage.evaluate(() => window.MemoryEnginePlaybackTest.calls[0]);
    expect(playbackCall.options.memoryColorProfile).toBe(chosenProfile.code);
    await roomPage.close();

    await expect(opsPage.locator("#opsMemoryColorSummary")).toContainText(chosenLabel);
    const afterSummary = await opsPage.evaluate(async () => {
      const response = await fetch("/api/v1/operator/artifact-summary", { credentials: "same-origin" });
      return response.json();
    });
    const beforeCount = Number(beforeSummary.memory_colors?.counts?.[chosenProfile.code] || 0);
    const afterCount = Number(afterSummary.memory_colors?.counts?.[chosenProfile.code] || 0);
    expect(afterCount).toBeGreaterThanOrEqual(beforeCount + 1);
    await opsPage.close();
  });
});
