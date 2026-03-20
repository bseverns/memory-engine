(function initMemoryEngineRoomLoop(global) {
  const PERSISTENT_LOOP_WINDOW_KEY = "memory-engine-room-loop-window-v1";
  const {
    adaptiveGapMultiplier,
    loadPersistentLoopWindow,
    quietHoursActive,
    randomIntBetween,
    recentArtifactIdsForExclusion,
    rememberPersistentArtifactId,
    resolveActiveDaypart,
    resolveMovement,
    roomToneLevelFor,
    scarcityProfile,
    sleep,
  } = global.MemoryEngineRoomLoopPolicy;
  const {
    chooseNextScene,
    chooseTargetDensity,
    chooseTargetMood,
    recentDensityWindow,
  } = global.MemoryEngineRoomLoopSequencer;
  const {
    fetchLayerPayload,
    fetchPoolPayload,
    overlapAllowedForCue,
    playLayeredPayload,
    randomDelayBetween,
    toneLevelForName,
  } = global.MemoryEngineRoomLoopPlayback;
  const { createToneEngine } = global.MemoryEngineRoomLoopTone;

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
      dayparts: [],
      overlap: {
        label: "Layered return",
        densityLimit: "medium",
      },
      fossilVisuals: {
        label: "Fossil drift",
        refreshMs: 18000,
        maxItems: 12,
      },
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
      roomDaypartEnabled: true,
      roomDaypartName: "",
      roomDaypartLabel: "",
      roomQuietHoursEnabled: false,
      roomQuietHoursActive: false,
      roomQuietHoursLabel: "Quiet hours",
      roomQuietHoursStartHour: 22,
      roomQuietHoursEndHour: 6,
      roomQuietHoursGapMultiplier: 1.2,
      roomQuietHoursToneMultiplier: 0.78,
      roomQuietHoursOutputGainMultiplier: 0.72,
      roomToneProfile: "soft_air",
      roomToneSourceMode: "synthetic",
      roomToneSourceUrl: "",
      roomScarcityEnabled: true,
      roomScarcityLowThreshold: 6,
      roomScarcitySevereThreshold: 3,
      roomAntiRepetitionWindowSize: 12,
      roomOverlapChance: 0.1,
      roomOverlapMinPoolSize: 6,
      roomOverlapMaxLayers: 2,
      roomOverlapMinDelayMs: 180,
      roomOverlapMaxDelayMs: 520,
      roomOverlapGainMultiplier: 0.68,
      operatorState: {
        intake_paused: false,
        playback_paused: false,
        quieter_mode: false,
        maintenance_mode: false,
        mood_bias: "",
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

  function createController({ startButton, stopButton, statusEl, playUrlWithLightChain }) {
    const config = readKioskConfig();
    const fallbackConfig = defaultRoomLoopConfig();
    const loopConfig = config.roomLoopConfig || fallbackConfig;
    const intensityProfiles = loopConfig.intensityProfiles || fallbackConfig.intensityProfiles;
    const movementPresets = loopConfig.movementPresets || fallbackConfig.movementPresets;
    const roomScenes = loopConfig.scenes || fallbackConfig.scenes;
    const roomMovements = loopConfig.movements || fallbackConfig.movements;
    const roomTone = loopConfig.tone || fallbackConfig.tone;
    const toneEngine = createToneEngine({ globalObject: global, config, roomTone });
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
    let activeDaypartName = String(config.roomDaypartName || "");

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

    function currentMoodBias() {
      const value = String(surfaceState.mood_bias || "").toLowerCase();
      return ["clear", "hushed", "suspended", "weathered", "gathering"].includes(value) ? value : "";
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
      const quietHoursMultiplier = quietHoursActive(config) ? Number(config.roomQuietHoursGapMultiplier || 1.0) : 1.0;
      return value * quietHoursMultiplier * (quieterModeEnabled() ? 1.18 : 1.0);
    }

    function applySurfaceToneMultiplier(value) {
      const quietHoursMultiplier = quietHoursActive(config) ? Number(config.roomQuietHoursToneMultiplier || 1.0) : 1.0;
      return value * quietHoursMultiplier * (quieterModeEnabled() ? 0.72 : 1.0);
    }

    function surfaceOutputGainMultiplier() {
      const quietHoursMultiplier = quietHoursActive(config) ? Number(config.roomQuietHoursOutputGainMultiplier || 1.0) : 1.0;
      return quietHoursMultiplier * (quieterModeEnabled() ? 0.74 : 1.0);
    }

    function resolveActiveProfiles() {
      const daypart = resolveActiveDaypart(config, loopConfig, new Date());
      const intensityProfileName = daypart?.intensityProfile || config.roomIntensityProfile;
      const movementPresetName = daypart?.movementPreset || config.roomMovementPreset;
      return {
        daypart,
        intensity: intensityProfiles[intensityProfileName]
          || intensityProfiles.balanced
          || fallbackConfig.intensityProfiles.balanced,
        movementPreset: movementPresets[movementPresetName]
          || movementPresets.balanced
          || fallbackConfig.movementPresets.balanced,
      };
    }

    function daypartLabel(profiles) {
      if (!profiles.daypart) {
        return "steady";
      }
      return profiles.daypart.label || profiles.daypart.name || "steady";
    }

    function roomPostureLabel(profiles) {
      const parts = [daypartLabel(profiles)];
      if (quietHoursActive(config)) {
        parts.push(String(config.roomQuietHoursLabel || "Quiet hours"));
      }
      return parts.join(" / ");
    }

    function startLoopMovement(index, profiles = resolveActiveProfiles()) {
      loopMovementIndex = index % roomMovements.length;
      loopMovement = resolveMovement(roomMovements[loopMovementIndex], profiles.movementPreset);
      loopMovementBudget = randomIntBetween(loopMovement.minItems, loopMovement.maxItems);
      loopMovementProgress = 0;
      loopScene = null;
      loopSceneCueIndex = 0;
      activeDaypartName = profiles.daypart?.name || "";
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

    function nextLoopCue() {
      const movement = ensureLoopMovement();
      const recent = loopHistory.slice(-4);
      const targetMood = chooseTargetMood({
        movement,
        recent,
        currentMoodBias: currentMoodBias(),
        loopMovementProgress,
      });
      const targetDensity = chooseTargetDensity(movement, recent);

      if (!loopScene || loopSceneCueIndex >= loopScene.cues.length) {
        loopScene = chooseNextScene({
          roomScenes,
          movement,
          targetMood,
          targetDensity,
          loopHistory,
        });
        loopSceneCueIndex = 0;
      }

      const cue = loopScene.cues[loopSceneCueIndex];
      loopSceneCueIndex += 1;
      return {
        movement,
        scene: loopScene,
        cue: {
          ...cue,
          density: cue.density || targetDensity,
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
      persistentLoopWindow = loadPersistentLoopWindow(config, PERSISTENT_LOOP_WINDOW_KEY);
      updateButtons();
      const startingProfiles = resolveActiveProfiles();
      setStatus(`Running (${roomPostureLabel(startingProfiles)} / ${startingProfiles.intensity.name} intensity / ${startingProfiles.movementPreset.name} preset)...`);
      try {
        await toneEngine.ensureRoomTone();
      } catch (err) {
        loopRunning = false;
        updateButtons();
        setStatus("Playback could not start. Tap start once to grant audio access.");
        await toneEngine.stopRoomTone();
        return;
      }
      toneEngine.setRoomToneLevel(applySurfaceToneMultiplier(roomToneLevelFor(config, startingProfiles.intensity, roomTone.idleGain, loopKnownPoolSize)), 1.0);

      while (loopRunning) {
        const profiles = resolveActiveProfiles();
        const roomIntensity = profiles.intensity;
        try {
          if ((profiles.daypart?.name || "") !== activeDaypartName && roomMovements.length) {
            startLoopMovement(loopMovementIndex, profiles);
            setStatus(`Shifting into ${roomPostureLabel(profiles).toLowerCase()} posture...`);
          }
          if (playbackPausedBySteward()) {
            setStatus("Playback is paused by the steward.");
            toneEngine.setRoomToneLevel(0.0001, 0.8);
            await sleep(900);
            continue;
          }

          const { movement, scene, cue } = nextLoopCue();
          if (cue.pauseMs) {
            const pauseMultiplier = applySurfaceGapMultiplier(adaptiveGapMultiplier(config, roomIntensity, loopKnownPoolSize, movement, true));
            const scarcityLabel = scarcityProfile(config, loopKnownPoolSize).label;
            setStatus(
              scarcityLabel
                ? `Holding space in ${roomPostureLabel(profiles)} / ${movement.name} / ${scene.name} (${scarcityLabel} pool).`
                : `Holding space in ${roomPostureLabel(profiles)} / ${movement.name} / ${scene.name}.`,
            );
            toneEngine.setRoomToneLevel(
              applySurfaceToneMultiplier(roomToneLevelFor(config, roomIntensity, toneLevelForName(roomTone, cue.toneLevel), loopKnownPoolSize)),
              1.4,
            );
            await sleep(Math.round(cue.pauseMs * pauseMultiplier));
            continue;
          }

          const lane = cue.lane || "any";
          const density = cue.density || "any";
          const mood = cue.mood || "any";
          const excludedIds = recentArtifactIdsForExclusion(config, persistentLoopWindow);
          const recentDensities = recentDensityWindow(loopHistory);
          const primaryResult = await fetchPoolPayload({
            lane,
            density,
            mood,
            segmentVariant: `${movement.name}:${scene.name}:${loopMovementIndex}:${loopMovementProgress}:${loopSceneCueIndex}`,
            excludeIds: excludedIds,
            recentDensities,
          });
          if (primaryResult.hold) {
            loopKnownPoolSize = 0;
            setStatus(`No ${mood} ${density} memory available in ${roomPostureLabel(profiles)} / ${movement.name}. Scarcity mode is holding the room tone.`);
            toneEngine.setRoomToneLevel(applySurfaceToneMultiplier(roomToneLevelFor(config, roomIntensity, roomTone.sparseGain, loopKnownPoolSize)), 1.8);
            await sleep(Math.round(1500 * applySurfaceGapMultiplier(adaptiveGapMultiplier(config, roomIntensity, loopKnownPoolSize, movement, true))));
            continue;
          }
          if (!primaryResult.payload) {
            setStatus(`Pool error: ${primaryResult.status}`);
            toneEngine.setRoomToneLevel(applySurfaceToneMultiplier(roomToneLevelFor(config, roomIntensity, roomTone.sparseGain, loopKnownPoolSize)), 1.4);
            await sleep(1500);
            continue;
          }

          const payload = primaryResult.payload;
          loopKnownPoolSize = Number(payload.pool_size || 0);
          rememberLoopPayload(payload, scene, movement);
          persistentLoopWindow = rememberPersistentArtifactId(config, PERSISTENT_LOOP_WINDOW_KEY, persistentLoopWindow, payload.artifact_id);
          const laneLabel = payload.lane ? `${payload.lane} ${payload.density || "memory"} memory` : "memory";
          const featuredLabel = payload.featured_return ? " / featured return" : "";
          const scarcityLabel = scarcityProfile(config, loopKnownPoolSize).label;
          let layerPayload = null;
          if (Number(config.roomOverlapMaxLayers || 0) > 1 && overlapAllowedForCue({
            cue,
            poolSize: loopKnownPoolSize,
            config,
            loopConfig,
            quieterModeEnabled,
          })) {
            layerPayload = await fetchLayerPayload({
              config,
              persistentLoopWindow,
              cue,
              primaryArtifactId: payload.artifact_id,
              recentDensities,
              currentMoodBias: currentMoodBias(),
            });
            if (layerPayload) {
              rememberLoopPayload(layerPayload, scene, movement);
              persistentLoopWindow = rememberPersistentArtifactId(config, PERSISTENT_LOOP_WINDOW_KEY, persistentLoopWindow, layerPayload.artifact_id);
            }
          }
          setStatus(
            scarcityLabel
              ? `Playing ${laneLabel}${featuredLabel} in ${roomPostureLabel(profiles)} / ${movement.name} / ${scene.name}${layerPayload ? " / layered return" : ""} (${scarcityLabel} pool, wear ${payload.wear.toFixed(3)})`
              : `Playing ${laneLabel}${featuredLabel} in ${roomPostureLabel(profiles)} / ${movement.name} / ${scene.name}${layerPayload ? " / layered return" : ""} (wear ${payload.wear.toFixed(3)})`,
          );
          toneEngine.setRoomToneLevel(applySurfaceToneMultiplier(roomToneLevelFor(config, roomIntensity, roomTone.duckGain, loopKnownPoolSize)), 0.8);
          const playbackPromises = [playUrlWithLightChain(payload.audio_url, payload.wear, {
            startMs: payload.playback_start_ms,
            durationMs: payload.playback_duration_ms,
            outputGainMultiplier: surfaceOutputGainMultiplier(),
          })];
          if (layerPayload) {
            playbackPromises.push(playLayeredPayload({
              payload: layerPayload,
              delayMs: randomDelayBetween(config.roomOverlapMinDelayMs, config.roomOverlapMaxDelayMs),
              loopRunning: () => loopRunning,
              playbackPausedBySteward,
              playUrlWithLightChain,
              outputGainMultiplier: surfaceOutputGainMultiplier() * Number(config.roomOverlapGainMultiplier || 0.68),
            }));
          }
          await Promise.allSettled(playbackPromises);
          advanceLoopMovement();
          if (loopRunning) {
            const gapMultiplier = applySurfaceGapMultiplier(adaptiveGapMultiplier(config, roomIntensity, loopKnownPoolSize, movement, false));
            toneEngine.setRoomToneLevel(applySurfaceToneMultiplier(roomToneLevelFor(config, roomIntensity, roomTone.idleGain, loopKnownPoolSize)), 1.4);
            await sleep(Math.round((cue.gapMs || 900) * gapMultiplier));
          }
        } catch (err) {
          setStatus("Room loop interrupted.");
          toneEngine.setRoomToneLevel(applySurfaceToneMultiplier(roomToneLevelFor(config, roomIntensity, roomTone.sparseGain, loopKnownPoolSize)), 1.2);
          await sleep(1500);
        }
      }

      await toneEngine.stopRoomTone();
      updateButtons();
      setStatus(stopMessage);
    }

    function stop(statusMessage) {
      stopMessage = statusMessage || "Stopped";
      loopRunning = false;
      updateButtons();
      setStatus(stopMessage);
      void toneEngine.stopRoomTone();
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
