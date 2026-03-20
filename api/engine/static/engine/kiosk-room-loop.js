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

  function daypartMatchesHour(daypart, hour) {
    const startHour = Number(daypart.startHour || 0);
    const endHour = Number(daypart.endHour || 23);
    if (startHour <= endHour) {
      return hour >= startHour && hour <= endHour;
    }
    return hour >= startHour || hour <= endHour;
  }

  function resolveActiveDaypart(config, loopConfig, date = new Date()) {
    if (!config.roomDaypartEnabled) {
      return null;
    }
    const dayparts = Array.isArray(loopConfig.dayparts) ? loopConfig.dayparts : [];
    const hour = date.getHours();
    return dayparts.find((daypart) => daypartMatchesHour(daypart, hour)) || null;
  }

  function quietHoursActive(config, date = new Date()) {
    if (!config.roomQuietHoursEnabled) {
      return false;
    }
    return daypartMatchesHour({
      startHour: config.roomQuietHoursStartHour ?? 22,
      endHour: config.roomQuietHoursEndHour ?? 6,
    }, date.getHours());
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

    let roomToneCtx = null;
    let roomToneNoiseSource = null;
    let roomToneMasterGain = null;
    let roomToneLfo = null;
    let roomToneLfoGain = null;
    let roomToneMediaElement = null;
    let roomToneMediaSource = null;

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

    function recentDensityWindow() {
      return loopHistory
        .slice(-4)
        .map((item) => item.density)
        .filter((density) => ["light", "medium", "dense"].includes(density));
    }

    function chooseTargetDensity(movement, recent) {
      const densities = recent
        .slice(-4)
        .map((item) => item.density)
        .filter((density) => ["light", "medium", "dense"].includes(density));
      const denseCount = densities.filter((density) => density === "dense").length;
      const lightCount = densities.filter((density) => density === "light").length;

      if (denseCount >= 2) {
        return movement.name === "weathering" ? "medium" : "light";
      }
      if (lightCount >= 2) {
        return movement.name === "gathering" ? "dense" : "medium";
      }
      if (movement.name === "weathering") {
        return "medium";
      }
      if (movement.name === "gathering") {
        return "medium";
      }
      return densities[densities.length - 1] || "medium";
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

    function chooseTargetMood(movement, recent) {
      const stewardMoodBias = currentMoodBias();
      if (stewardMoodBias) {
        const recentBiasCount = recent.filter((item) => item.mood === stewardMoodBias).length;
        if (recentBiasCount < 2 || Math.random() < 0.72) {
          return stewardMoodBias;
        }
      }

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

    function chooseNextScene(movement, targetMood, targetDensity) {
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

      if (targetDensity) {
        const densityCandidates = candidates.filter((scene) => scene.cues.some((cue) => cue.density === targetDensity));
        if (densityCandidates.length) {
          candidates = densityCandidates;
        }
      }

      return candidates[Math.floor(Math.random() * candidates.length)] || roomScenes[0];
    }

    function nextLoopCue() {
      const movement = ensureLoopMovement();
      const recent = loopHistory.slice(-4);
      const targetMood = chooseTargetMood(movement, recent);
      const targetDensity = chooseTargetDensity(movement, recent);

      if (!loopScene || loopSceneCueIndex >= loopScene.cues.length) {
        loopScene = chooseNextScene(movement, targetMood, targetDensity);
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

    function toneLevelForName(name) {
      if (name === "sparse") return roomTone.sparseGain;
      if (name === "duck") return roomTone.duckGain;
      return roomTone.idleGain;
    }

    function overlapAllowedForCue(cue, poolSize) {
      if (poolSize < Number(config.roomOverlapMinPoolSize || 0)) {
        return false;
      }
      if (quieterModeEnabled() || quietHoursActive(config)) {
        return Math.random() < (Number(config.roomOverlapChance || 0) * 0.45);
      }
      if (cue.density === "dense") {
        return false;
      }
      const densityLimit = String(loopConfig.overlap?.densityLimit || "medium");
      if (densityLimit === "light" && cue.density !== "light") {
        return false;
      }
      return Math.random() < Number(config.roomOverlapChance || 0);
    }

    function randomDelayBetween(min, max) {
      const start = Number.isFinite(Number(min)) ? Number(min) : 0;
      const end = Number.isFinite(Number(max)) ? Number(max) : start;
      return Math.round(start + (Math.random() * Math.max(0, end - start)));
    }

    async function fetchLayerPayload({ cue, primaryArtifactId }) {
      const excludedIds = recentArtifactIdsForExclusion(config, persistentLoopWindow);
      const combinedExclusions = Array.from(new Set([...excludedIds, Number(primaryArtifactId)]));
      const params = new URLSearchParams({
        context: "kiosk",
        lane: cue.lane === "worn" ? "mid" : "any",
        density: cue.density === "dense" ? "medium" : (cue.density || "medium"),
        mood: cue.mood || currentMoodBias() || "any",
        segment_variant: `layer:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      });
      if (combinedExclusions.length) {
        params.set("exclude_ids", combinedExclusions.join(","));
      }
      const recentDensities = recentDensityWindow();
      if (recentDensities.length) {
        params.set("recent_densities", recentDensities.join(","));
      }
      const response = await fetch(`/api/v1/pool/next?${params.toString()}`, { cache: "no-store" });
      if (response.status === 204) {
        return null;
      }
      if (!response.ok) {
        return null;
      }
      const payload = await response.json();
      if (!payload || Number(payload.artifact_id) === Number(primaryArtifactId)) {
        return null;
      }
      return payload;
    }

    async function playLayeredPayload(payload, options = {}) {
      const delayMs = Number(options.delayMs || 0);
      await sleep(delayMs);
      if (!loopRunning || playbackPausedBySteward()) {
        return;
      }
      await playUrlWithLightChain(payload.audio_url, payload.wear, {
        startMs: payload.playback_start_ms,
        durationMs: payload.playback_duration_ms,
        outputGainMultiplier: surfaceOutputGainMultiplier() * Number(config.roomOverlapGainMultiplier || 0.68),
      });
    }

    function selectedToneProfile() {
      const profiles = roomTone.profiles || {};
      return profiles[config.roomToneProfile]
        || profiles.soft_air
        || {
          highpassHz: 110,
          lowpassHz: 980,
          lfoHz: 0.025,
          lfoDepth: 65,
          noiseStep: 0.06,
          noiseDamping: 0.985,
        };
    }

    async function ensureRoomTone() {
      if (roomToneCtx && roomToneMasterGain) {
        await roomToneCtx.resume();
        if (roomToneMediaElement) {
          try { await roomToneMediaElement.play(); } catch (err) {}
        }
        return;
      }

      roomToneCtx = new (global.AudioContext || global.webkitAudioContext)();
      await roomToneCtx.resume();

      roomToneMasterGain = roomToneCtx.createGain();
      roomToneMasterGain.gain.value = 0.0001;
      roomToneMasterGain.connect(roomToneCtx.destination);

      if (config.roomToneSourceMode === "site_ambience" && config.roomToneSourceUrl) {
        roomToneMediaElement = new global.Audio(config.roomToneSourceUrl);
        roomToneMediaElement.crossOrigin = "anonymous";
        roomToneMediaElement.loop = true;
        roomToneMediaElement.preload = "auto";
        roomToneMediaElement.volume = 1.0;
        roomToneMediaSource = roomToneCtx.createMediaElementSource(roomToneMediaElement);
        roomToneMediaSource.connect(roomToneMasterGain);
        await roomToneMediaElement.play();
        return;
      }

      const profile = selectedToneProfile();
      const bufferSeconds = 2;
      const noiseBuffer = roomToneCtx.createBuffer(1, roomToneCtx.sampleRate * bufferSeconds, roomToneCtx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      let brown = 0;
      for (let i = 0; i < data.length; i += 1) {
        brown = (brown + (Math.random() * 2 - 1) * profile.noiseStep) * profile.noiseDamping;
        data[i] = brown;
      }

      roomToneNoiseSource = roomToneCtx.createBufferSource();
      roomToneNoiseSource.buffer = noiseBuffer;
      roomToneNoiseSource.loop = true;

      const highpass = roomToneCtx.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = profile.highpassHz;

      const lowpass = roomToneCtx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = profile.lowpassHz;
      lowpass.Q.value = 0.4;

      roomToneLfo = roomToneCtx.createOscillator();
      roomToneLfo.type = "sine";
      roomToneLfo.frequency.value = profile.lfoHz;

      roomToneLfoGain = roomToneCtx.createGain();
      roomToneLfoGain.gain.value = profile.lfoDepth;
      roomToneLfo.connect(roomToneLfoGain);
      roomToneLfoGain.connect(lowpass.frequency);

      roomToneNoiseSource.connect(highpass);
      highpass.connect(lowpass);
      lowpass.connect(roomToneMasterGain);

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

      try { roomToneMediaElement?.pause(); } catch (err) {}
      try { roomToneNoiseSource?.stop(); } catch (err) {}
      try { roomToneLfo?.stop(); } catch (err) {}
      try { roomToneNoiseSource?.disconnect(); } catch (err) {}
      try { roomToneMediaSource?.disconnect(); } catch (err) {}
      try { roomToneLfo?.disconnect(); } catch (err) {}
      try { roomToneLfoGain?.disconnect(); } catch (err) {}
      try { roomToneMasterGain?.disconnect(); } catch (err) {}
      try { await roomToneCtx.close(); } catch (err) {}

      roomToneCtx = null;
      roomToneNoiseSource = null;
      roomToneMasterGain = null;
      roomToneLfo = null;
      roomToneLfoGain = null;
      roomToneMediaElement = null;
      roomToneMediaSource = null;
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
      const startingProfiles = resolveActiveProfiles();
      setStatus(`Running (${roomPostureLabel(startingProfiles)} / ${startingProfiles.intensity.name} intensity / ${startingProfiles.movementPreset.name} preset)...`);
      try {
        await ensureRoomTone();
      } catch (err) {
        loopRunning = false;
        updateButtons();
        setStatus("Playback could not start. Tap start once to grant audio access.");
        await stopRoomTone();
        return;
      }
      setRoomToneLevel(applySurfaceToneMultiplier(roomToneLevelFor(config, startingProfiles.intensity, roomTone.idleGain, loopKnownPoolSize)), 1.0);

      while (loopRunning) {
        try {
          const profiles = resolveActiveProfiles();
          const roomIntensity = profiles.intensity;
          if ((profiles.daypart?.name || "") !== activeDaypartName && roomMovements.length) {
            startLoopMovement(loopMovementIndex, profiles);
            setStatus(`Shifting into ${roomPostureLabel(profiles).toLowerCase()} posture...`);
          }
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
                ? `Holding space in ${roomPostureLabel(profiles)} / ${movement.name} / ${scene.name} (${scarcityLabel} pool).`
                : `Holding space in ${roomPostureLabel(profiles)} / ${movement.name} / ${scene.name}.`,
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
            segment_variant: `${movement.name}:${scene.name}:${loopMovementIndex}:${loopMovementProgress}:${loopSceneCueIndex}`,
          });
          const recentDensities = recentDensityWindow();
          if (recentDensities.length) {
            params.set("recent_densities", recentDensities.join(","));
          }
          if (excludedIds.length) {
            params.set("exclude_ids", excludedIds.join(","));
          }
          const response = await fetch(`/api/v1/pool/next?${params.toString()}`, { cache: "no-store" });
          if (response.status === 204) {
            loopKnownPoolSize = 0;
            setStatus(`No ${mood} ${density} memory available in ${roomPostureLabel(profiles)} / ${movement.name}. Scarcity mode is holding the room tone.`);
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
          const featuredLabel = payload.featured_return ? " / featured return" : "";
          const scarcityLabel = scarcityProfile(config, loopKnownPoolSize).label;
          let layerPayload = null;
          if (Number(config.roomOverlapMaxLayers || 0) > 1 && overlapAllowedForCue(cue, loopKnownPoolSize)) {
            layerPayload = await fetchLayerPayload({
              cue,
              primaryArtifactId: payload.artifact_id,
            });
            if (layerPayload) {
              rememberLoopPayload(layerPayload, scene, movement);
              persistentLoopWindow = rememberPersistentArtifactId(config, persistentLoopWindow, layerPayload.artifact_id);
            }
          }
          setStatus(
            scarcityLabel
              ? `Playing ${laneLabel}${featuredLabel} in ${roomPostureLabel(profiles)} / ${movement.name} / ${scene.name}${layerPayload ? " / layered return" : ""} (${scarcityLabel} pool, wear ${payload.wear.toFixed(3)})`
              : `Playing ${laneLabel}${featuredLabel} in ${roomPostureLabel(profiles)} / ${movement.name} / ${scene.name}${layerPayload ? " / layered return" : ""} (wear ${payload.wear.toFixed(3)})`,
          );
          setRoomToneLevel(applySurfaceToneMultiplier(roomToneLevelFor(config, roomIntensity, roomTone.duckGain, loopKnownPoolSize)), 0.8);
          const playbackPromises = [playUrlWithLightChain(payload.audio_url, payload.wear, {
            startMs: payload.playback_start_ms,
            durationMs: payload.playback_duration_ms,
            outputGainMultiplier: surfaceOutputGainMultiplier(),
          })];
          if (layerPayload) {
            playbackPromises.push(playLayeredPayload(layerPayload, {
              delayMs: randomDelayBetween(config.roomOverlapMinDelayMs, config.roomOverlapMaxDelayMs),
            }));
          }
          await Promise.allSettled(playbackPromises);
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
