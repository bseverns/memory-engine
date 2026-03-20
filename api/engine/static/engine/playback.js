(function initMemoryEnginePlaybackSurface(global) {
  const startButton = document.getElementById("btnPlaybackStart");
  const stopButton = document.getElementById("btnPlaybackStop");
  const statusEl = document.getElementById("playbackStatus");
  const autostartNote = document.getElementById("playbackAutostartNote");
  const SURFACE_STATE_POLL_MS = 5000;

  if (!startButton || !stopButton || !statusEl || !autostartNote) {
    return;
  }

  const roomLoopController = global.MemoryEngineRoomLoop.createController({
    startButton,
    stopButton,
    statusEl,
    playUrlWithLightChain: global.MemoryEngineKioskAudio.playUrlWithLightChain,
  });
  let autostartRequested = false;
  let surfaceStateInterval = 0;

  function updateSurfaceNote(message) {
    autostartNote.textContent = message;
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

      if (operatorState.quieter_mode) {
        updateSurfaceNote("Quieter mode is active on this listening surface.");
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

  document.addEventListener("keydown", (event) => {
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
  void refreshSurfaceState();
  surfaceStateInterval = global.setInterval(() => {
    void refreshSurfaceState();
  }, SURFACE_STATE_POLL_MS);
}(window));
