(function initMemoryEnginePlaybackSurface(global) {
  const startButton = document.getElementById("btnPlaybackStart");
  const stopButton = document.getElementById("btnPlaybackStop");
  const statusEl = document.getElementById("playbackStatus");
  const autostartNote = document.getElementById("playbackAutostartNote");
  const fossilVisualsEl = document.getElementById("playbackFossilVisuals");
  const fossilVisualShell = document.getElementById("playbackVisualShell");
  const fossilFrame = document.getElementById("playbackFossilFrame");
  const fossilImage = document.getElementById("playbackFossilImage");
  const fossilFallback = document.getElementById("playbackFossilFallback");
  const fossilTitle = document.getElementById("playbackFossilTitle");
  const fossilMeta = document.getElementById("playbackFossilMeta");
  const infoButton = document.getElementById("btnPlaybackInfo");
  const infoCloseButton = document.getElementById("btnPlaybackInfoClose");
  const infoLightbox = document.getElementById("playbackInfoLightbox");
  const SURFACE_STATE_POLL_MS = 5000;

  if (!startButton || !stopButton || !statusEl || !autostartNote) {
    return;
  }

  function readKioskConfig() {
    const el = document.getElementById("kiosk-config");
    if (!el || !el.textContent) {
      return { roomFossilVisualsEnabled: false };
    }
    try {
      return JSON.parse(el.textContent);
    } catch (error) {
      return { roomFossilVisualsEnabled: false };
    }
  }

  const config = readKioskConfig();
  const fossilVisualPollMs = Number(config.roomLoopConfig?.fossilVisuals?.refreshMs || 18000);
  const roomLoopController = global.MemoryEngineRoomLoop.createController({
    startButton,
    stopButton,
    statusEl,
    playUrlWithLightChain: global.MemoryEngineKioskAudio.playUrlWithLightChain,
  });
  let autostartRequested = false;
  let surfaceStateInterval = 0;
  let fossilVisualInterval = 0;
  let fossilVisualIndex = 0;
  let infoLightboxOpen = false;

  function updateSurfaceNote(message) {
    autostartNote.textContent = message;
  }

  function renderNoFossilVisuals(message) {
    if (!fossilVisualsEl || !fossilFrame || !fossilFallback || !fossilMeta || !fossilTitle) {
      return;
    }
    fossilVisualsEl.hidden = false;
    fossilFrame.classList.add("empty");
    fossilFallback.hidden = false;
    if (fossilImage) {
      fossilImage.hidden = true;
      fossilImage.removeAttribute("src");
    }
    fossilTitle.textContent = "Ambient spectrogram drift";
    fossilMeta.textContent = message;
  }

  function renderFossilVisualsEnabled(enabled) {
    if (!fossilVisualsEl || !fossilVisualShell) {
      return;
    }
    fossilVisualsEl.hidden = !enabled;
    fossilVisualShell.classList.toggle("compact", !enabled);
  }

  function renderInfoLightbox() {
    if (!infoLightbox) return;
    infoLightbox.hidden = !infoLightboxOpen;
    infoLightbox.setAttribute("aria-hidden", infoLightboxOpen ? "false" : "true");
    if (infoButton) {
      infoButton.setAttribute("aria-expanded", infoLightboxOpen ? "true" : "false");
    }
    document.body.classList.toggle("lightbox-open", infoLightboxOpen);
  }

  function openInfoLightbox() {
    infoLightboxOpen = true;
    renderInfoLightbox();
  }

  function closeInfoLightbox() {
    infoLightboxOpen = false;
    renderInfoLightbox();
  }

  function describeFossilEntry(entry) {
    if (!entry) {
      return "Waiting for recent fossils.";
    }
    const createdAt = entry.created_at ? new Date(entry.created_at).toLocaleString() : "Unknown time";
    return `${entry.title || "Recent fossil drift"} · ${createdAt}`;
  }

  async function refreshFossilVisuals() {
    if (!config.roomFossilVisualsEnabled) {
      renderFossilVisualsEnabled(false);
      return;
    }
    renderFossilVisualsEnabled(true);
    try {
      const feedUrl = String(config.surfaceFossilFeedUrl || "").trim();
      if (!feedUrl) {
        renderNoFossilVisuals("Fossil visuals are not configured for this surface.");
        return;
      }
      const response = await fetch(feedUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Fossil visuals failed (${response.status})`);
      }
      const entries = (await response.json()).filter((entry) => entry.image_url);
      if (!entries.length) {
        renderNoFossilVisuals("No fossil spectrograms are available yet.");
        return;
      }
      fossilVisualIndex = fossilVisualIndex % entries.length;
      const entry = entries[fossilVisualIndex];
      fossilVisualIndex += 1;
      fossilFrame?.classList.remove("empty");
      if (fossilFallback) {
        fossilFallback.hidden = true;
      }
      if (fossilImage) {
        fossilImage.hidden = false;
        fossilImage.src = entry.image_url;
      }
      if (fossilTitle) {
        fossilTitle.textContent = entry.title || "Fossil drift";
      }
      if (fossilMeta) {
        fossilMeta.textContent = describeFossilEntry(entry);
      }
    } catch (error) {
      renderNoFossilVisuals("Unable to refresh fossil visuals right now.");
    }
  }

  async function refreshSurfaceState() {
    try {
      const response = await fetch("/api/v1/surface/state", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Surface state failed (${response.status})`);
      }
      const payload = await response.json();
      const operatorState = payload.operator_state || {};
      roomLoopController.setSurfaceState(operatorState);

      if (operatorState.maintenance_mode) {
        roomLoopController.stop("Playback paused for maintenance.");
        updateSurfaceNote("This node is in maintenance mode. Listening playback is intentionally offline.");
        statusEl.textContent = "Playback is offline while the steward performs maintenance.";
        return;
      }

      if (operatorState.playback_paused) {
        roomLoopController.stop("Playback paused by steward.");
        updateSurfaceNote("Playback is paused by the steward on this machine.");
        statusEl.textContent = operatorState.quieter_mode
          ? "Playback is paused by steward. Quieter mode will still apply when playback resumes."
          : "Playback is paused by steward.";
        return;
      }

      if (operatorState.quieter_mode && operatorState.mood_bias) {
        updateSurfaceNote(`Quieter mode is active, with a ${operatorState.mood_bias} mood bias on this listening surface.`);
      } else if (operatorState.quieter_mode) {
        updateSurfaceNote("Quieter mode is active on this listening surface.");
      } else if (operatorState.mood_bias) {
        updateSurfaceNote(`The steward is nudging this room toward ${operatorState.mood_bias} material.`);
      } else if (roomLoopController.isRunning()) {
        updateSurfaceNote("Playback is running here. Recording stays on the separate kiosk.");
      }

      if (autostartRequested && !roomLoopController.isRunning()) {
        requestPlaybackStart(false);
      }
    } catch (error) {
      if (!roomLoopController.isRunning()) {
        updateSurfaceNote("Unable to refresh steward controls right now.");
      }
    }
  }

  function requestPlaybackStart(userInitiated) {
    if (roomLoopController.getSurfaceState && roomLoopController.getSurfaceState().maintenance_mode) {
      updateSurfaceNote("This node is in maintenance mode. Playback will resume when the steward clears it.");
      statusEl.textContent = "Playback is offline while the steward performs maintenance.";
      return;
    }
    autostartRequested = true;
    updateSurfaceNote(
      userInitiated
        ? "Starting playback on the listening surface..."
        : "Attempting to start the room loop...",
    );

    const startPromise = roomLoopController.start();
    if (startPromise && typeof startPromise.catch === "function") {
      startPromise.catch(() => {
        if (!roomLoopController.isRunning()) {
          updateSurfaceNote("Tap Start listening once if the browser blocked audio after boot.");
        }
      });
    }

    global.setTimeout(() => {
      if (roomLoopController.isRunning()) {
        updateSurfaceNote("Playback is running here. Recording stays on the separate kiosk.");
      } else if (!userInitiated) {
        updateSurfaceNote("Tap Start listening once if the browser blocked audio after boot.");
      }
    }, 900);
  }

  startButton.addEventListener("click", () => {
    requestPlaybackStart(true);
  });

  stopButton.addEventListener("click", () => {
    autostartRequested = false;
    roomLoopController.stop("Playback paused.");
    updateSurfaceNote("Playback paused on this surface.");
  });

  infoButton?.addEventListener("click", () => {
    openInfoLightbox();
  });

  infoCloseButton?.addEventListener("click", () => {
    closeInfoLightbox();
  });

  infoLightbox?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.matches("[data-close-lightbox='true']")) {
      closeInfoLightbox();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.code === "Escape" && infoLightboxOpen) {
      event.preventDefault();
      closeInfoLightbox();
      return;
    }

    if (infoLightboxOpen) {
      return;
    }

    if (event.code === "Space" || event.code === "Enter") {
      event.preventDefault();
      requestPlaybackStart(true);
      return;
    }

    if (event.code === "Escape") {
      event.preventDefault();
      autostartRequested = false;
      roomLoopController.stop("Playback paused.");
      updateSurfaceNote("Playback paused on this surface.");
    }
  });

  global.addEventListener("beforeunload", () => {
    global.clearInterval(surfaceStateInterval);
    global.clearInterval(fossilVisualInterval);
    roomLoopController.teardown();
  });

  const params = new URLSearchParams(global.location.search);
  if (params.get("autostart") !== "0") {
    requestPlaybackStart(false);
  } else {
    autostartRequested = false;
    updateSurfaceNote("Autostart disabled for this visit. Tap Start listening when ready.");
    statusEl.textContent = "Ready to start room playback.";
  }
  renderInfoLightbox();
  void refreshSurfaceState();
  void refreshFossilVisuals();
  surfaceStateInterval = global.setInterval(() => {
    void refreshSurfaceState();
  }, SURFACE_STATE_POLL_MS);
  fossilVisualInterval = global.setInterval(() => {
    void refreshFossilVisuals();
  }, fossilVisualPollMs);
}(window));
