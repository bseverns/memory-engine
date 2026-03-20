(function initMemoryEnginePlaybackSurface(global) {
  const startButton = document.getElementById("btnPlaybackStart");
  const stopButton = document.getElementById("btnPlaybackStop");
  const statusEl = document.getElementById("playbackStatus");
  const autostartNote = document.getElementById("playbackAutostartNote");

  if (!startButton || !stopButton || !statusEl || !autostartNote) {
    return;
  }

  const roomLoopController = global.MemoryEngineRoomLoop.createController({
    startButton,
    stopButton,
    statusEl,
    playUrlWithLightChain: global.MemoryEngineKioskAudio.playUrlWithLightChain,
  });

  function updateSurfaceNote(message) {
    autostartNote.textContent = message;
  }

  function requestPlaybackStart(userInitiated) {
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
      roomLoopController.stop("Playback paused.");
      updateSurfaceNote("Playback paused on this surface.");
    }
  });

  global.addEventListener("beforeunload", () => {
    roomLoopController.teardown();
  });

  const params = new URLSearchParams(global.location.search);
  if (params.get("autostart") !== "0") {
    requestPlaybackStart(false);
  } else {
    updateSurfaceNote("Autostart disabled for this visit. Tap Start listening when ready.");
    statusEl.textContent = "Ready to start room playback.";
  }
}(window));
