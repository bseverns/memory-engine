const { test, expect } = require("@playwright/test");
const {
  applyStewardControls,
  mockHealthyOpsStatus,
  mockSpectrograms,
  signIntoOps,
} = require("./helpers");

function minimalWavBuffer({ seconds = 0.5, sampleRate = 8000 } = {}) {
  const channelCount = 1;
  const bitsPerSample = 16;
  const sampleCount = Math.max(1, Math.floor(sampleRate * seconds));
  const blockAlign = channelCount * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = sampleCount * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channelCount, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.round(Math.sin((index / sampleRate) * 2 * Math.PI * 330) * 0.2 * 32767);
    buffer.writeInt16LE(sample, 44 + (index * 2));
  }

  return buffer;
}

async function mockPlaybackLoop(page) {
  let requestCount = 0;
  await page.route("**/api/v1/pool/heard/**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.route("**/api/v1/pool/next**", async (route) => {
    requestCount += 1;
    if (requestCount > 1) {
      await route.fulfill({ status: 204, body: "" });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        artifact_id: 21,
        audio_url: "/test-audio.wav",
        playback_ack_url: "/api/v1/pool/heard/test-ack-token",
        wear: 0.12,
        lane: "mid",
        density: "medium",
        mood: "clear",
        pool_size: 7,
        featured_return: false,
        playback_start_ms: 0,
        playback_duration_ms: 400,
        playback_windowed: false,
        playback_revolution_index: 0,
      }),
    });
  });
  await page.route("**/test-audio.wav", async (route) => {
    await route.fulfill({
      contentType: "audio/wav",
      body: minimalWavBuffer(),
    });
  });
}

test.describe("browser behavior contracts", () => {
  test("operator dashboard renders the real node status payload", async ({ page }) => {
    await signIntoOps(page);

    await expect(page.locator("#opsStateLabel")).not.toHaveText("Checking...");
    await expect(page.locator("#opsComponents")).toContainText("database");
    await expect(page.locator("#opsComponents")).toContainText("redis");
    await expect(page.locator("#opsComponents")).toContainText("storage");
    await expect(page.locator("#opsComponents")).toContainText("worker");
    await expect(page.locator("#opsComponents")).not.toContainText("Unable to reach /api/v1/node/status");
    await expect(page.locator("#opsIngestRate")).toContainText("180/hour");
  });

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

    await page.getByRole("button", { name: "About this room" }).click();
    await page.keyboard.press("Escape");
    await expect(page.locator("#playbackInfoLightbox")).toHaveAttribute("aria-hidden", "true");
  });

  test("playback start and stop drive the listening controls", async ({ page }) => {
    await mockHealthyOpsStatus(page);
    await mockSpectrograms(page.context());
    await mockPlaybackLoop(page);
    await applyStewardControls(page, {});
    await page.goto("/room/?autostart=0");

    const startButton = page.getByRole("button", { name: "Start listening" });
    const stopButton = page.getByRole("button", { name: "Pause playback" });

    await expect(startButton).toBeEnabled();
    await expect(stopButton).toBeDisabled();

    await startButton.click();
    await expect(stopButton).toBeEnabled();
    await expect(startButton).toBeDisabled();
    await expect(page.locator("#playbackAutostartNote")).toContainText("Playback is running here");

    await stopButton.click();
    await expect(startButton).toBeEnabled();
    await expect(stopButton).toBeDisabled();
    await expect(page.locator("#playbackAutostartNote")).toContainText("Playback paused on this surface");
  });

  test("steward language control propagates to the kiosk surface", async ({ page }) => {
    await mockHealthyOpsStatus(page);
    await applyStewardControls(page, { kioskLanguageCode: "es_mx_ca" });

    const kioskPage = await page.context().newPage();
    await kioskPage.goto("/kiosk/");
    await expect(kioskPage.getByRole("heading", { name: "Memoria de la sala" })).toBeVisible();
    await expect(kioskPage.getByRole("button", { name: "Activar micrófono" })).toBeVisible();
    await kioskPage.close();
  });

  test("memory color review panel previews original and selected color", async ({ page }) => {
    await mockHealthyOpsStatus(page);
    await page.goto("/kiosk/");

    await page.evaluate(async () => {
      await window.MemoryEngineKioskTest.seedReviewTake({ effectProfile: "clear", seconds: 1.6 });
    });

    const allChoices = page.locator(".memory-choice");
    const catalog = await page.evaluate(() => window.MemoryEngineMemoryColorCatalog.getMemoryColorCatalog());
    const catalogProfiles = Array.isArray(catalog?.profiles) ? catalog.profiles : [];
    const defaultChoice = page.locator(`.memory-choice[data-effect-profile="${catalog.default}"]`);

    await expect(page.locator("#memoryColorPanel")).toBeVisible();
    await expect(allChoices).toHaveCount(catalogProfiles.length);
    await expect(defaultChoice).toBeVisible();
    await expect(page.locator("#btnPreviewOriginal")).toHaveAttribute("aria-pressed", "true");

    for (const profile of catalogProfiles) {
      const profileChoice = page.locator(`.memory-choice[data-effect-profile="${profile.code}"]`);
      const profileLabel = (await profileChoice.textContent() || "").trim();

      await page.evaluate(async ({ code }) => {
        await window.MemoryEngineKioskTest.selectMemoryColor(code);
      }, { code: profile.code });
      await expect(page.locator("#memoryColorStatus")).toContainText(profileLabel);

      await page.evaluate(async () => {
        await window.MemoryEngineKioskTest.chooseMemoryPreview();
      });
      await expect(page.locator("#btnPreviewColored")).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("#memoryColorStatus")).toContainText(profileLabel);

      await page.evaluate(async () => {
        await window.MemoryEngineKioskTest.chooseOriginalPreview();
      });
      await expect(page.locator("#btnPreviewOriginal")).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("#memoryColorStatus")).toContainText(profileLabel);
    }
  });

  test("kiosk monitor check opens from the idle state and closes cleanly", async ({ page }) => {
    await mockHealthyOpsStatus(page);
    await page.goto("/kiosk/");

    await expect(page.getByRole("button", { name: "Monitor check" })).toBeVisible();
    await page.getByRole("button", { name: "Monitor check" }).click();
    await expect(page.getByText("Check the listening path before anyone speaks.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Play check tone" })).toBeVisible();

    await page.keyboard.press("KeyM");
    await expect(page.getByText("When you are ready, wake the microphone.")).toBeVisible();
  });

  test("saved take receipt explains how to revoke through a steward on this node", async ({ page }) => {
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

    await page.goto("/kiosk/");
    await page.evaluate(async () => {
      await window.MemoryEngineKioskTest.seedReviewTake({ effectProfile: "clear", seconds: 1.4 });
      await window.MemoryEngineKioskTest.selectMode("ROOM");
      await window.MemoryEngineKioskTest.submitCurrentTake();
    });

    await expect(page.locator("#receiptPanel")).toBeVisible();
    await expect(page.locator("#receipt")).toContainText("NODE-KEEP-1234");
    await expect(page.locator("#receipt")).toContainText("tell a steward on this node");
    await expect(page.locator("#receipt")).toContainText("only works on this node's network");
  });

  test("steward controls propagate to kiosk and room without reload-specific hacks", async ({ page }) => {
    await mockHealthyOpsStatus(page);
    await mockSpectrograms(page.context());
    await applyStewardControls(page, {
      intakePaused: true,
      quieterMode: true,
      moodBias: "weathered",
    });

    const kioskPage = await page.context().newPage();
    await kioskPage.goto("/kiosk/");
    await expect(kioskPage.getByText("This recording station is resting.")).toBeVisible();
    await expect(kioskPage.getByText("Recording intake is paused by the steward.")).toBeVisible();

    const roomPage = await page.context().newPage();
    await roomPage.goto("/room/?autostart=0");
    await expect(roomPage.locator("#playbackAutostartNote")).toContainText("Quieter mode is active");
    await expect(roomPage.locator("#playbackAutostartNote")).toContainText("weathered");

    await kioskPage.close();
    await roomPage.close();
  });
});
