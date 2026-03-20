(function initMemoryEngineRoomLoop(global) {
  const PERSISTENT_LOOP_WINDOW_KEY = "memory-engine-room-loop-window-v1";

  function defaultRoomLoopConfig() {
    return {
      intensityProfiles: {
        balanced: {
          name: "balanced",
          cueGapMultiplier: 1.0,
          pauseGapMultiplier: 1.0,
          roomToneMultiplier: 1.0,
        },
      },
      movementPresets: {
        balanced: {
          name: "balanced",
          movementGapMultiplier: 1.0,
          minItemsDelta: 0,
          maxItemsDelta: 0,
        },
      },
      scenes: [],
      movements: [],
      tone: {
        idleGain: 0.011,
        sparseGain: 0.017,
        duckGain: 0.002,
        fadeSeconds: 1.25,
      },
    };
  }

  function readKioskConfig() {
    const el = document.getElementById("kiosk-config");
    const fallback = {
      roomIntensityProfile: "balanced",
      roomMovementPreset: "balanced",
      roomScarcityEnabled: true,
      roomScarcityLowThreshold: 6,
      roomScarcitySevereThreshold: 3,
      roomAntiRepetitionWindowSize: 12,
      operatorState: {
        intake_paused: false,
        playback_paused: false,
        quieter_mode: false,
        maintenance_mode: false,
      },
      roomLoopConfig: defaultRoomLoopConfig(),
    };
    if (!el || !el.textContent) {
      return fallback;
    }

    try {
      return {
        ...fallback,
        ...JSON.parse(el.textContent),
      };
    } catch (err) {
      return fallback;
    }
  }

  function antiRepetitionWindowSize(config) {
    const configured = Number(config.roomAntiRepetitionWindowSize || 0);
    return Math.max(0, Math.min(50, Number.isFinite(configured) ? Math.floor(configured) : 0));
  }

  function loadPersistentLoopWindow(config) {
    const size = antiRepetitionWindowSize(config);
    if (size <= 0 || !global.localStorage) {
      return [];
    }

    try {
      const raw = global.localStorage.getItem(PERSISTENT_LOOP_WINDOW_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((entry) => Number(entry))
        .filter((id) => Number.isInteger(id) && id > 0)
        .slice(-size);
    } catch (err) {
      return [];
    }
  }

  function savePersistentLoopWindow(config, persistentLoopWindow) {
    const size = antiRepetitionWindowSize(config);
    if (size <= 0 || !global.localStorage) {
      return;
    }

    try {
      global.localStorage.setItem(
        PERSISTENT_LOOP_WINDOW_KEY,
        JSON.stringify(persistentLoopWindow.slice(-size)),
      );
    } catch (err) {}
  }

  function recentArtifactIdsForExclusion(config, persistentLoopWindow) {
    const size = antiRepetitionWindowSize(config);
    if (size <= 0) return [];
    return persistentLoopWindow.slice(-size);
  }

  function rememberPersistentArtifactId(config, persistentLoopWindow, artifactId) {
    const size = antiRepetitionWindowSize(config);
    if (size <= 0) return persistentLoopWindow;

    const numericId = Number(artifactId);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      return persistentLoopWindow;
    }

    const next = persistentLoopWindow.filter((id) => id !== numericId);
    next.push(numericId);
    const trimmed = next.slice(-size);
    savePersistentLoopWindow(config, trimmed);
    return trimmed;
  }

  function resolveMovement(movement, movementPreset) {
    return {
      ...movement,
      minItems: Math.max(1, movement.minItems + movementPreset.minItemsDelta),
      maxItems: Math.max(
        Math.max(1, movement.minItems + movementPreset.minItemsDelta),
        movement.maxItems + movementPreset.maxItemsDelta,
      ),
      gapMultiplier: movement.gapMultiplier * movementPreset.movementGapMultiplier,
    };
  }

  function scarcityProfile(config, poolSize) {
    if (!config.roomScarcityEnabled) {
      return { gapMultiplier: 1.0, pauseMultiplier: 1.0, toneMultiplier: 1.0, label: "" };
    }
    if (poolSize <= 0 || poolSize <= config.roomScarcitySevereThreshold) {
      return { gapMultiplier: 1.8, pauseMultiplier: 2.1, toneMultiplier: 1.45, label: "scarce" };
    }
    if (poolSize <= config.roomScarcityLowThreshold) {
      return { gapMultiplier: 1.35, pauseMultiplier: 1.55, toneMultiplier: 1.2, label: "thin" };
    }
    return { gapMultiplier: 1.0, pauseMultiplier: 1.0, toneMultiplier: 1.0, label: "" };
  }

  function adaptiveGapMultiplier(config, intensity, poolSize, movement, pauseGap) {
    const scarcity = scarcityProfile(config, poolSize);
    let archiveMultiplier = 1.0;

    if (poolSize >= 40) {
      archiveMultiplier = 0.76;
    } else if (poolSize >= 24) {
      archiveMultiplier = 0.88;
    } else if (poolSize >= 12) {
      archiveMultiplier = 0.96;
    } else if (poolSize >= 8) {
      archiveMultiplier = 1.05;
    } else if (poolSize > 0) {
      archiveMultiplier = 1.18;
    }

    return (
      movement.gapMultiplier
      * intensity.cueGapMultiplier
      * archiveMultiplier
      * (pauseGap ? intensity.pauseGapMultiplier : 1.0)
      * (pauseGap ? scarcity.pauseMultiplier : scarcity.gapMultiplier)
    );
  }

  function roomToneLevelFor(config, intensity, baseLevel, poolSize) {
    const scarcity = scarcityProfile(config, poolSize);
    return baseLevel * intensity.roomToneMultiplier * scarcity.toneMultiplier;
  }

  function randomIntBetween(min, max) {
    return min + Math.floor(Math.random() * ((max - min) + 1));
  }

  function sleep(ms) {
    return new Promise((resolve) => global.setTimeout(resolve, ms));
  }

  function createController({ startButton, stopButton, statusEl, playUrlWithLightChain }) {
    const config = readKioskConfig();
    const fallbackConfig = defaultRoomLoopConfig();
    const loopConfig = config.roomLoopConfig || fallbackConfig;
    const intensityProfiles = loopConfig.intensityProfiles || fallbackConfig.intensityProfiles;
    const movementPresets = loopConfig.movementPresets || fallbackConfig.movementPresets;
    const roomScenes = loopConfig.scenes || fallbackConfig.scenes;
    const roomMovements = loopConfig.movements || fallbackConfig.movements;
    const roomTone = loopConfig.tone || fallbackConfig.tone;
    const roomIntensity = intensityProfiles[config.roomIntensityProfile]
      || intensityProfiles.balanced
      || fallbackConfig.intensityProfiles.balanced;
    const movementPreset = movementPresets[config.roomMovementPreset]
      || movementPresets.balanced
      || fallbackConfig.movementPresets.balanced;
    let surfaceState = {
      intake_paused: false,
      playback_paused: false,
      quieter_mode: false,
      maintenance_mode: false,
      ...(config.operatorState || {}),
    };

    let loopRunning = false;
    let loopScene = null;
    let loopSceneCueIndex = 0;
    let loopMovement = null;
    let loopMovementIndex = 0;
    let loopMovementBudget = 0;
    let loopMovementProgress = 0;
    let loopHistory = [];
    let loopKnownPoolSize = 0;
    let persistentLoopWindow = [];
    let stopMessage = "Stopped";

    let roomToneCtx = null;
    let roomToneNoiseSource = null;
    let roomToneMasterGain = null;
    let roomToneLfo = null;
    let roomToneLfoGain = null;

    function setStatus(message) {
      if (statusEl) {
        statusEl.textContent = message;
      }
    }

    function quieterModeEnabled() {
      return Boolean(surfaceState.quieter_mode);
    }

    function playbackPausedBySteward() {
      return Boolean(surfaceState.playback_paused);
    }

    function updateButtons() {
      if (startButton) {
        startButton.disabled = loopRunning;
      }
      if (stopButton) {
        stopButton.disabled = !loopRunning;
      }
    }

    function applySurfaceGapMultiplier(value) {
      return value * (quieterModeEnabled() ? 1.18 : 1.0);
    }

    function applySurfaceToneMultiplier(value) {
      return value * (quieterModeEnabled() ? 0.72 : 1.0);
    }

    function surfaceOutputGainMultiplier() {
      return quieterModeEnabled() ? 0.74 : 1.0;
    }

    function startLoopMovement(index) {
      loopMovementIndex = index % roomMovements.length;
      loopMovement = resolveMovement(roomMovements[loopMovementIndex], movementPreset);
      loopMovementBudget = randomIntBetween(loopMovement.minItems, loopMovement.maxItems);
      loopMovementProgress = 0;
      loopScene = null;
      loopSceneCueIndex = 0;
    }

    function ensureLoopMovement() {
      if (!loopMovement) {
        startLoopMovement(0);
      }
      return loopMovement;
    }

    function advanceLoopMovement() {
      if (!loopMovement) return;
      loopMovementProgress += 1;
      if (loopMovementProgress >= loopMovementBudget) {
        startLoopMovement(loopMovementIndex + 1);
      }
    }

    function chooseTargetMood(movement, recent) {
      const last = recent[recent.length - 1];
      if (!last) {
        return movement.preferredMoods[0];
      }
      if (recent.filter((item) => item.mood === "weathered").length >= 2) {
        return "clear";
      }
      if (recent.filter((item) => item.mood === "clear").length >= 2) {
        return movement.name === "weathering" ? "weathered" : "suspended";
      }
      if (last.density === "dense") {
        return movement.name === "gathering" ? "suspended" : "hushed";
      }
      if (last.mood === "hushed") {
        return movement.preferredMoods.find((mood) => mood !== "hushed") || movement.preferredMoods[0];
      }
      return movement.preferredMoods[loopMovementProgress % movement.preferredMoods.length];
    }

    function chooseNextScene(movement, targetMood) {
      const recent = loopHistory.slice(-3);
      const last = recent[recent.length - 1];

      let candidates = roomScenes.filter((scene) => movement.sceneNames.includes(scene.name));
      const moodCandidates = candidates.filter((scene) => scene.moods.includes(targetMood));
      if (moodCandidates.length) {
        candidates = moodCandidates;
      }
      if (last) {
        const nonRepeating = candidates.filter((scene) => scene.name !== last.scene);
        if (nonRepeating.length) {
          candidates = nonRepeating;
        }
      }

      return candidates[Math.floor(Math.random() * candidates.length)] || roomScenes[0];
    }

    function nextLoopCue() {
      const movement = ensureLoopMovement();
      const targetMood = chooseTargetMood(movement, loopHistory.slice(-4));

      if (!loopScene || loopSceneCueIndex >= loopScene.cues.length) {
        loopScene = chooseNextScene(movement, targetMood);
        loopSceneCueIndex = 0;
      }

      const cue = loopScene.cues[loopSceneCueIndex];
      loopSceneCueIndex += 1;
      return {
        movement,
        scene: loopScene,
        cue: {
          ...cue,
          mood: cue.mood || targetMood,
        },
      };
    }

    function rememberLoopPayload(payload, scene, movement) {
      loopHistory.push({
        scene: scene.name,
        movement: movement.name,
        lane: payload.lane || "any",
        density: payload.density || "medium",
        mood: payload.mood || "suspended",
      });
      loopHistory = loopHistory.slice(-6);
    }

    function toneLevelForName(name) {
      if (name === "sparse") return roomTone.sparseGain;
      if (name === "duck") return roomTone.duckGain;
      return roomTone.idleGain;
    }

    async function ensureRoomTone() {
      if (roomToneCtx && roomToneMasterGain) {
        await roomToneCtx.resume();
        return;
      }

      roomToneCtx = new (global.AudioContext || global.webkitAudioContext)();
      await roomToneCtx.resume();

      const bufferSeconds = 2;
      const noiseBuffer = roomToneCtx.createBuffer(1, roomToneCtx.sampleRate * bufferSeconds, roomToneCtx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      let brown = 0;
      for (let i = 0; i < data.length; i += 1) {
        brown = (brown + (Math.random() * 2 - 1) * 0.06) * 0.985;
        data[i] = brown;
      }

      roomToneNoiseSource = roomToneCtx.createBufferSource();
      roomToneNoiseSource.buffer = noiseBuffer;
      roomToneNoiseSource.loop = true;

      const highpass = roomToneCtx.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = 110;

      const lowpass = roomToneCtx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = 980;
      lowpass.Q.value = 0.4;

      roomToneMasterGain = roomToneCtx.createGain();
      roomToneMasterGain.gain.value = 0.0001;

      roomToneLfo = roomToneCtx.createOscillator();
      roomToneLfo.type = "sine";
      roomToneLfo.frequency.value = 0.025;

      roomToneLfoGain = roomToneCtx.createGain();
      roomToneLfoGain.gain.value = 65;
      roomToneLfo.connect(roomToneLfoGain);
      roomToneLfoGain.connect(lowpass.frequency);

      roomToneNoiseSource.connect(highpass);
      highpass.connect(lowpass);
      lowpass.connect(roomToneMasterGain);
      roomToneMasterGain.connect(roomToneCtx.destination);

      roomToneNoiseSource.start();
      roomToneLfo.start();
    }

    function setRoomToneLevel(level, seconds) {
      const fadeSeconds = seconds === undefined ? roomTone.fadeSeconds : seconds;
      if (!roomToneCtx || !roomToneMasterGain) return;
      const now = roomToneCtx.currentTime;
      roomToneMasterGain.gain.cancelScheduledValues(now);
      roomToneMasterGain.gain.setValueAtTime(roomToneMasterGain.gain.value, now);
      roomToneMasterGain.gain.linearRampToValueAtTime(level, now + fadeSeconds);
    }

    async function stopRoomTone() {
      if (!roomToneCtx) return;

      try {
        setRoomToneLevel(0.0001, 0.6);
        await sleep(650);
      } catch (err) {}

      try { roomToneNoiseSource?.stop(); } catch (err) {}
      try { roomToneLfo?.stop(); } catch (err) {}
      try { roomToneNoiseSource?.disconnect(); } catch (err) {}
      try { roomToneLfo?.disconnect(); } catch (err) {}
      try { roomToneLfoGain?.disconnect(); } catch (err) {}
      try { roomToneMasterGain?.disconnect(); } catch (err) {}
      try { await roomToneCtx.close(); } catch (err) {}

      roomToneCtx = null;
      roomToneNoiseSource = null;
      roomToneMasterGain = null;
      roomToneLfo = null;
      roomToneLfoGain = null;
    }

    async function start() {
      if (loopRunning) return;
      if (!roomScenes.length || !roomMovements.length) {
        setStatus("Room loop config is missing.");
        return;
      }
      if (playbackPausedBySteward()) {
        setStatus("Playback is paused by the steward.");
        return;
      }

      loopRunning = true;
      stopMessage = "Stopped";
      loopScene = null;
      loopSceneCueIndex = 0;
      loopMovement = null;
      loopMovementIndex = 0;
      loopMovementBudget = 0;
      loopMovementProgress = 0;
      loopHistory = [];
      loopKnownPoolSize = 0;
      persistentLoopWindow = loadPersistentLoopWindow(config);
      updateButtons();
      setStatus(`Running (${roomIntensity.name} intensity / ${movementPreset.name} preset)...`);
      try {
        await ensureRoomTone();
      } catch (err) {
        loopRunning = false;
        updateButtons();
        setStatus("Playback could not start. Tap start once to grant audio access.");
        await stopRoomTone();
        return;
      }
      setRoomToneLevel(applySurfaceToneMultiplier(roomToneLevelFor(config, roomIntensity, roomTone.idleGain, loopKnownPoolSize)), 1.0);

      while (loopRunning) {
        try {
          if (playbackPausedBySteward()) {
            setStatus("Playback is paused by the steward.");
            setRoomToneLevel(0.0001, 0.8);
            await sleep(900);
            continue;
          }

          const { movement, scene, cue } = nextLoopCue();
          if (cue.pauseMs) {
            const pauseMultiplier = applySurfaceGapMultiplier(adaptiveGapMultiplier(config, roomIntensity, loopKnownPoolSize, movement, true));
            const scarcityLabel = scarcityProfile(config, loopKnownPoolSize).label;
            setStatus(
              scarcityLabel
                ? `Holding space in ${movement.name} / ${scene.name} (${scarcityLabel} pool).`
                : `Holding space in ${movement.name} / ${scene.name}.`,
            );
            setRoomToneLevel(
              applySurfaceToneMultiplier(roomToneLevelFor(config, roomIntensity, toneLevelForName(cue.toneLevel), loopKnownPoolSize)),
              1.4,
            );
            await sleep(Math.round(cue.pauseMs * pauseMultiplier));
            continue;
          }

          const lane = cue.lane || "any";
          const density = cue.density || "any";
          const mood = cue.mood || "any";
          const excludedIds = recentArtifactIdsForExclusion(config, persistentLoopWindow);
          const params = new URLSearchParams({
            context: "kiosk",
            lane,
            density,
            mood,
          });
          if (excludedIds.length) {
            params.set("exclude_ids", excludedIds.join(","));
          }
          const response = await fetch(`/api/v1/pool/next?${params.toString()}`, { cache: "no-store" });
          if (response.status === 204) {
            loopKnownPoolSize = 0;
            setStatus(`No ${mood} ${density} memory available in ${movement.name}. Scarcity mode is holding the room tone.`);
            setRoomToneLevel(applySurfaceToneMultiplier(roomToneLevelFor(config, roomIntensity, roomTone.sparseGain, loopKnownPoolSize)), 1.8);
            await sleep(Math.round(1500 * applySurfaceGapMultiplier(adaptiveGapMultiplier(config, roomIntensity, loopKnownPoolSize, movement, true))));
            continue;
          }
          if (!response.ok) {
            setStatus(`Pool error: ${response.status}`);
            setRoomToneLevel(applySurfaceToneMultiplier(roomToneLevelFor(config, roomIntensity, roomTone.sparseGain, loopKnownPoolSize)), 1.4);
            await sleep(1500);
            continue;
          }

          const payload = await response.json();
          loopKnownPoolSize = Number(payload.pool_size || 0);
          rememberLoopPayload(payload, scene, movement);
          persistentLoopWindow = rememberPersistentArtifactId(config, persistentLoopWindow, payload.artifact_id);
          const laneLabel = payload.lane ? `${payload.lane} ${payload.density || "memory"} memory` : "memory";
          const scarcityLabel = scarcityProfile(config, loopKnownPoolSize).label;
          setStatus(
            scarcityLabel
              ? `Playing ${laneLabel} in ${movement.name} / ${scene.name} (${scarcityLabel} pool, wear ${payload.wear.toFixed(3)})`
              : `Playing ${laneLabel} in ${movement.name} / ${scene.name} (wear ${payload.wear.toFixed(3)})`,
          );
          setRoomToneLevel(applySurfaceToneMultiplier(roomToneLevelFor(config, roomIntensity, roomTone.duckGain, loopKnownPoolSize)), 0.8);
          await playUrlWithLightChain(payload.audio_url, payload.wear, {
            outputGainMultiplier: surfaceOutputGainMultiplier(),
          });
          advanceLoopMovement();
          if (loopRunning) {
            const gapMultiplier = applySurfaceGapMultiplier(adaptiveGapMultiplier(config, roomIntensity, loopKnownPoolSize, movement, false));
            setRoomToneLevel(applySurfaceToneMultiplier(roomToneLevelFor(config, roomIntensity, roomTone.idleGain, loopKnownPoolSize)), 1.4);
            await sleep(Math.round((cue.gapMs || 900) * gapMultiplier));
          }
        } catch (err) {
          setStatus("Room loop interrupted.");
          setRoomToneLevel(applySurfaceToneMultiplier(roomToneLevelFor(config, roomIntensity, roomTone.sparseGain, loopKnownPoolSize)), 1.2);
          await sleep(1500);
        }
      }

      await stopRoomTone();
      updateButtons();
      setStatus(stopMessage);
    }

    function stop(statusMessage) {
      stopMessage = statusMessage || "Stopped";
      loopRunning = false;
      updateButtons();
      setStatus(stopMessage);
      void stopRoomTone();
    }

    function teardown() {
      stop("Stopped");
    }

    if (startButton) {
      startButton.addEventListener("click", () => {
        void start();
      });
    }
    if (stopButton) {
      stopButton.addEventListener("click", () => {
        stop("Stopped");
      });
    }
    updateButtons();

    return {
      start,
      setSurfaceState(nextState = {}) {
        surfaceState = {
          ...surfaceState,
          ...nextState,
        };
      },
      getSurfaceState() {
        return { ...surfaceState };
      },
      stop,
      teardown,
      isRunning() {
        return loopRunning;
      },
    };
  }

  global.MemoryEngineRoomLoop = {
    createController,
  };
}(window));
