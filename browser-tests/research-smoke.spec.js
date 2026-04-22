const { test, expect } = require("@playwright/test");
const { applyStewardControls, signIntoOps } = require("./helpers");

async function submitSavedTake(page, effectProfile) {
  await page.goto("/kiosk/");
  await page.evaluate(async () => {
    await window.MemoryEngineKioskTest.seedReviewTake({ effectProfile: "clear", seconds: 1.8 });
  });

  const artifactSubmit = page.waitForResponse((response) => (
    response.url().includes("/api/v1/artifacts/audio")
    && response.request().method() === "POST"
  ));

  await page.evaluate(async ({ code }) => {
    await window.MemoryEngineKioskTest.selectMemoryColor(code);
    await window.MemoryEngineKioskTest.chooseMemoryPreview();
    await window.MemoryEngineKioskTest.selectMode("ROOM");
    await window.MemoryEngineKioskTest.submitCurrentTake();
  }, { code: effectProfile });

  const artifactResponse = await artifactSubmit;
  expect(artifactResponse.ok()).toBeTruthy();
  const artifactPayload = await artifactResponse.json();
  await expect(page.locator("#receiptPanel")).toBeVisible();
  return artifactPayload;
}

test.describe("compose-backed research smoke", () => {
  test("proves submit, revoke, room playback, ops visibility, remove-from-stack, and audit trail", async ({ browser, request, baseURL }) => {
    const healthResponse = await request.get(`${baseURL}/healthz`);
    expect(healthResponse.ok()).toBeTruthy();

    const readinessResponse = await request.get(`${baseURL}/readyz`);
    expect(readinessResponse.ok()).toBeTruthy();

    const opsPage = await browser.newPage();
    await signIntoOps(opsPage);
    await applyStewardControls(opsPage, {});

    const catalog = await opsPage.evaluate(async () => {
      const response = await fetch("/api/v1/operator/artifact-summary", { credentials: "same-origin" });
      const payload = await response.json();
      return payload.memory_colors?.catalog || { profiles: [], default: "clear" };
    });
    const chosenProfile = catalog.profiles.find((profile) => profile.code !== catalog.default) || catalog.profiles[0];
    expect(chosenProfile).toBeTruthy();
    const chosenLabel = chosenProfile.labels?.en || chosenProfile.code;

    const beforeSummary = await opsPage.evaluate(async () => {
      const response = await fetch("/api/v1/operator/artifact-summary", { credentials: "same-origin" });
      return response.json();
    });

    const firstKioskPage = await browser.newPage();
    const firstArtifactPayload = await submitSavedTake(firstKioskPage, chosenProfile.code);
    expect(firstArtifactPayload.artifact.effect_profile).toBe(chosenProfile.code);
    expect(firstArtifactPayload.revocation_token).toBeTruthy();

    const firstArtifactId = Number(firstArtifactPayload.artifact.id);
    expect(firstArtifactId).toBeGreaterThan(0);

    const roomPage = await browser.newPage();
    await roomPage.goto("/room/?autostart=0");
    await roomPage.evaluate(() => window.MemoryEnginePlaybackTest?.reset?.());
    await roomPage.getByRole("button", { name: "Start listening" }).click();
    await roomPage.waitForFunction(() => window.MemoryEnginePlaybackTest?.calls?.length > 0);
    const playbackCall = await roomPage.evaluate(() => window.MemoryEnginePlaybackTest.calls[0]);
    expect(playbackCall.options.memoryColorProfile).toBe(chosenProfile.code);
    await roomPage.close();

    await expect(opsPage.locator("#opsMemoryColorSummary")).toContainText(chosenLabel);

    const afterFirstSummary = await opsPage.evaluate(async () => {
      const response = await fetch("/api/v1/operator/artifact-summary", { credentials: "same-origin" });
      return response.json();
    });

    const beforeCount = Number(beforeSummary.memory_colors?.counts?.[chosenProfile.code] || 0);
    const afterCount = Number(afterFirstSummary.memory_colors?.counts?.[chosenProfile.code] || 0);
    expect(afterCount).toBeGreaterThanOrEqual(beforeCount + 1);

    const revokePage = await browser.newPage();
    await revokePage.goto(`/revoke/?token=${firstArtifactPayload.revocation_token}`);
    await revokePage.getByRole("button", { name: "Revoke with this code" }).click();
    await expect(revokePage.locator("#revokeStatus")).toContainText("removed from this node");
    await revokePage.close();

    const afterRevokeSummary = await opsPage.evaluate(async () => {
      const response = await fetch("/api/v1/operator/artifact-summary", { credentials: "same-origin" });
      return response.json();
    });
    expect(Number(afterRevokeSummary.revoked || 0)).toBeGreaterThanOrEqual(Number(beforeSummary.revoked || 0) + 1);

    await firstKioskPage.close();

    const secondKioskPage = await browser.newPage();
    const secondArtifactPayload = await submitSavedTake(secondKioskPage, chosenProfile.code);
    const secondArtifactId = Number(secondArtifactPayload.artifact.id);
    expect(secondArtifactId).toBeGreaterThan(0);
    await secondKioskPage.close();

    const removePayload = await opsPage.evaluate(async ({ artifactId }) => {
      const response = await fetch(`/api/v1/operator/artifacts/${artifactId}/remove`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      return {
        status: response.status,
        body: await response.json(),
      };
    }, { artifactId: secondArtifactId });

    expect(removePayload.status).toBe(200);
    expect(removePayload.body.ok).toBeTruthy();
    expect(Number(removePayload.body.artifact_id)).toBe(secondArtifactId);

    const recentArtifacts = await opsPage.evaluate(async () => {
      const response = await fetch("/api/v1/operator/artifacts?limit=12", { credentials: "same-origin" });
      return response.json();
    });
    const removedStillPresent = (recentArtifacts.artifacts || []).some((artifact) => Number(artifact.id) === secondArtifactId);
    expect(removedStillPresent).toBeFalsy();

    const controlsPayload = await opsPage.evaluate(async () => {
      const response = await fetch("/api/v1/operator/controls", { credentials: "same-origin" });
      return response.json();
    });
    const hasRemovalAudit = (controlsPayload.recent_actions || []).some((action) => (
      action.action === "artifact.removed_from_circulation"
      && Number(action.payload?.artifact_id || 0) === secondArtifactId
    ));
    expect(hasRemovalAudit).toBeTruthy();

    await opsPage.close();
  });
});
