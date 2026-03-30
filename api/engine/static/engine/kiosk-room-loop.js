(function initMemoryEngineRoomLoop(global) {
  const PERSISTENT_LOOP_WINDOW_KEY = "memory-engine-room-loop-window-v1";
  const {
    adaptiveGapMultiplier,
    densityHistoryWindowSize,
    loadPersistentLoopWindow,
    loopHistoryWindowSize,
    quietHoursActive,
    randomIntBetween,
    recentArtifactIdsForExclusion,
    rememberPersistentArtifactId,
    resolveActiveDaypart,
    resolveMovement,
    roomToneLevelFor,
    sceneHistoryWindowSize,
    scarcityProfile,
    sleep,
    surfaceOverlayMultiplier,
  } = global.MemoryEngineRoomLoopPolicy;
  const {
    chooseNextScene,
    chooseTargetDensity,
    chooseTargetMood,
    recentDensityWindow,
  } = global.MemoryEngineRoomLoopSequencer;
  const {
    acknowledgeAudiblePlayback,
    fetchLayerPayload,
    fetchPoolPayload,
    fetchThreadFollowPayload,
    overlapAllowedForCue,
    playFollowPayload,
    playLayeredPayload,
    randomDelayBetween,
    repairBenchProfile,
    threadFollowDecision,
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
        quietHoursChanceMultiplier: 0.45,
        quieterModeChanceMultiplier: 0.45,
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
      policy: {
        activeDeployment: {
          code: "memory",
          behaviorSummary: "Weathered room-memory with fresh-to-worn oscillation and featured returns.",
          afterlifeSummary: "Patina builds gradually; older absent material can feel newly arrived again.",
          tuningSource: "Shared pool weighting + default room loop movement and wear.",
          antiRepetitionWindow: 12,
          cueGapMultiplier: 1.0,
          pauseGapMultiplier: 1.0,
          toneGainMultiplier: 1.0,
          overlapChanceMultiplier: 1.0,
          wearMultiplier: 1.0,
          featuredReturnMultiplier: 1.0,
          topicClusterBoost: 1.0,
        },
        history: {
          densityWindow: 4,
          sceneWindow: 3,
          loopWindow: 6,
        },
        sequencer: {
          weatheredReleaseThreshold: 2,
          clearReleaseThreshold: 2,
          moodBiasHoldChance: 0.72,
          moodBiasRecentLimit: 2,
        },
        scarcity: {
          normal: { gapMultiplier: 1.0, pauseMultiplier: 1.0, toneMultiplier: 1.0, label: "" },
          low: { gapMultiplier: 1.35, pauseMultiplier: 1.55, toneMultiplier: 1.2, label: "thin" },
          severe: { gapMultiplier: 1.8, pauseMultiplier: 2.1, toneMultiplier: 1.45, label: "scarce" },
        },
        archiveGapTiers: [
          { minPoolSize: 40, multiplier: 0.76 },
          { minPoolSize: 24, multiplier: 0.88 },
          { minPoolSize: 12, multiplier: 0.96 },
          { minPoolSize: 8, multiplier: 1.05 },
          { minPoolSize: 1, multiplier: 1.18 },
        ],
        surfaceOverlays: {
          quieterMode: {
            gapMultiplier: 1.18,
            toneMultiplier: 0.72,
            outputGainMultiplier: 0.74,
          },
        },
      },
    };
  }

  function readKioskConfig() {
    const el = document.getElementById("kiosk-config");
    const fallback = {
      roomIntensityProfile: "balanced",
      roomMovementPreset: "balanced",
      engineDeployment: "memory",
      engineDeploymentParticipantNoun: "memory",
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
    const deploymentNoun = String(config.engineDeploymentParticipantNoun || "memory");
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
      const quieterModeMultiplier = quieterModeEnabled()
        ? surfaceOverlayMultiplier(loopConfig, "quieterMode", "gapMultiplier", 1.18)
        : 1.0;
      return value * quietHoursMultiplier * quieterModeMultiplier;
    }

    function applySurfaceToneMultiplier(value) {
      const quietHoursMultiplier = quietHoursActive(config) ? Number(config.roomQuietHoursToneMultiplier || 1.0) : 1.0;
      const quieterModeMultiplier = quieterModeEnabled()
        ? surfaceOverlayMultiplier(loopConfig, "quieterMode", "toneMultiplier", 0.72)
        : 1.0;
      return value * quietHoursMultiplier * quieterModeMultiplier;
    }

    function surfaceOutputGainMultiplier() {
      const quietHoursMultiplier = quietHoursActive(config) ? Number(config.roomQuietHoursOutputGainMultiplier || 1.0) : 1.0;
      const quieterModeMultiplier = quieterModeEnabled()
        ? surfaceOverlayMultiplier(loopConfig, "quieterMode", "outputGainMultiplier", 0.74)
        : 1.0;
      return quietHoursMultiplier * quieterModeMultiplier;
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
      const recent = loopHistory.slice(-densityHistoryWindowSize(loopConfig));
      const targetMood = chooseTargetMood({
        movement,
        recent,
        currentMoodBias: currentMoodBias(),
        loopMovementProgress,
        loopConfig,
      });
      const targetDensity = chooseTargetDensity(movement, recent, loopConfig);

      if (!loopScene || loopSceneCueIndex >= loopScene.cues.length) {
        loopScene = chooseNextScene({
          roomScenes,
          movement,
          targetMood,
          targetDensity,
          loopHistory,
          loopConfig,
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
        topic: payload.topic_tag || "",
        lifecycleStatus: payload.lifecycle_status || "",
      });
      loopHistory = loopHistory.slice(-loopHistoryWindowSize(loopConfig));
    }

    function normalizedLifecycleStatus(value) {
      return String(value || "").trim().toLowerCase();
    }

    function normalizedTopicTag(value) {
      return String(value || "").trim().toLowerCase();
    }

    function unresolvedLifecycleStatus(value) {
      return ["", "open", "unresolved", "pending"].includes(normalizedLifecycleStatus(value));
    }

    function resolvedLifecycleStatus(value) {
      return ["answered", "resolved", "closed", "complete", "completed", "fixed", "obsolete"].includes(normalizedLifecycleStatus(value));
    }

    function recentLoopTopics() {
      return loopHistory
        .map((item) => String(item.topic || "").trim().toLowerCase())
        .filter((topic) => Boolean(topic))
        .slice(-3);
    }

    function activeDeploymentCode() {
      return String(config.engineDeployment || "memory").trim().toLowerCase();
    }

    function repeatedRecentTopic(entries) {
      const counts = new Map();
      entries.forEach((entry) => {
        const topic = normalizedTopicTag(entry.topic);
        if (!topic) {
          return;
        }
        counts.set(topic, (counts.get(topic) || 0) + 1);
      });
      for (const entry of entries) {
        const topic = normalizedTopicTag(entry.topic);
        if (topic && (counts.get(topic) || 0) >= 2) {
          return topic;
        }
      }
      return "";
    }

    function preferredQuestionThread() {
      // Question tries to sustain an unresolved line of inquiry for a short
      // span, but only from what the room has actually been playing recently.
      const recentEntries = loopHistory.slice(-5).reverse();
      const unresolvedEntries = recentEntries.filter((entry) => unresolvedLifecycleStatus(entry.lifecycleStatus));
      const repeatedTopic = repeatedRecentTopic(unresolvedEntries);
      if (repeatedTopic) {
        const source = unresolvedEntries.find((entry) => normalizedTopicTag(entry.topic) === repeatedTopic) || {};
        return {
          preferredTopic: repeatedTopic,
          preferredLifecycleStatus: normalizedLifecycleStatus(source.lifecycleStatus) || "open",
          threadLength: unresolvedEntries.filter((entry) => normalizedTopicTag(entry.topic) === repeatedTopic).length,
        };
      }

      const topicalUnresolved = unresolvedEntries.find((entry) => Boolean(normalizedTopicTag(entry.topic)));
      if (topicalUnresolved) {
        const topic = normalizedTopicTag(topicalUnresolved.topic);
        return {
          preferredTopic: topic,
          preferredLifecycleStatus: normalizedLifecycleStatus(topicalUnresolved.lifecycleStatus) || "open",
          threadLength: unresolvedEntries.filter((entry) => normalizedTopicTag(entry.topic) === topic).length,
        };
      }

      if (unresolvedEntries.length) {
        return {
          preferredTopic: "",
          preferredLifecycleStatus: normalizedLifecycleStatus(unresolvedEntries[0].lifecycleStatus) || "open",
          threadLength: unresolvedEntries.length,
        };
      }

      return { preferredTopic: "", preferredLifecycleStatus: "", threadLength: 0 };
    }

    function preferredRepairThread() {
      // Repair treats the recent loop like a bench notebook: if there is still
      // an actionable topic in flight, prefer keeping that practical thread alive.
      const recentEntries = loopHistory.slice(-5).reverse();
      const actionableEntry = recentEntries.find((entry) => {
        const topic = normalizedTopicTag(entry.topic);
        return topic && !resolvedLifecycleStatus(entry.lifecycleStatus);
      });
      if (actionableEntry) {
        const topic = normalizedTopicTag(actionableEntry.topic);
        return {
          preferredTopic: topic,
          preferredLifecycleStatus: normalizedLifecycleStatus(actionableEntry.lifecycleStatus),
          threadLength: recentEntries.filter((entry) => normalizedTopicTag(entry.topic) === topic && !resolvedLifecycleStatus(entry.lifecycleStatus)).length,
        };
      }

      const topicalEntry = recentEntries.find((entry) => Boolean(normalizedTopicTag(entry.topic)));
      if (topicalEntry) {
        const topic = normalizedTopicTag(topicalEntry.topic);
        return {
          preferredTopic: topic,
          preferredLifecycleStatus: "",
          threadLength: recentEntries.filter((entry) => normalizedTopicTag(entry.topic) === topic).length,
        };
      }

      return { preferredTopic: "", preferredLifecycleStatus: "", threadLength: 0 };
    }

    function preferredThreadHint() {
      const deploymentCode = activeDeploymentCode();
      if (deploymentCode === "question") {
        return preferredQuestionThread();
      }
      if (deploymentCode === "repair") {
        return preferredRepairThread();
      }
      return { preferredTopic: "", preferredLifecycleStatus: "", threadLength: 0 };
    }

    function threadModeLabel(mode) {
      if (mode === "question_chorus") {
        return " / question chorus";
      }
      if (mode === "repair_bench") {
        return " / bench return";
      }
      return "";
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
      toneEngine.setRoomToneLevel(applySurfaceToneMultiplier(roomToneLevelFor(config, loopConfig, startingProfiles.intensity, roomTone.idleGain, loopKnownPoolSize)), 1.0);

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
            const pauseMultiplier = applySurfaceGapMultiplier(adaptiveGapMultiplier(config, loopConfig, roomIntensity, loopKnownPoolSize, movement, true));
            const scarcityLabel = scarcityProfile(config, loopConfig, loopKnownPoolSize).label;
            setStatus(
              scarcityLabel
                ? `Holding space in ${roomPostureLabel(profiles)} / ${movement.name} / ${scene.name} (${scarcityLabel} pool).`
                : `Holding space in ${roomPostureLabel(profiles)} / ${movement.name} / ${scene.name}.`,
            );
            toneEngine.setRoomToneLevel(
              applySurfaceToneMultiplier(roomToneLevelFor(config, loopConfig, roomIntensity, toneLevelForName(roomTone, cue.toneLevel), loopKnownPoolSize)),
              1.4,
            );
            await sleep(Math.round(cue.pauseMs * pauseMultiplier));
            continue;
          }

          const lane = cue.lane || "any";
          const density = cue.density || "any";
          const mood = cue.mood || "any";
          const excludedIds = recentArtifactIdsForExclusion(config, persistentLoopWindow);
          const recentDensities = recentDensityWindow(loopHistory, loopConfig);
          const recentTopics = recentLoopTopics();
          const threadHint = preferredThreadHint();
          const primaryResult = await fetchPoolPayload({
            lane,
            density,
            mood,
            segmentVariant: `${movement.name}:${scene.name}:${loopMovementIndex}:${loopMovementProgress}:${loopSceneCueIndex}`,
            excludeIds: excludedIds,
            recentDensities,
            recentTopics,
            preferredTopic: threadHint.preferredTopic,
            preferredLifecycleStatus: threadHint.preferredLifecycleStatus,
          });
          if (primaryResult.hold) {
            loopKnownPoolSize = 0;
            setStatus(`No ${mood} ${density} ${deploymentNoun} available in ${roomPostureLabel(profiles)} / ${movement.name}. Scarcity mode is holding the room tone.`);
            toneEngine.setRoomToneLevel(applySurfaceToneMultiplier(roomToneLevelFor(config, loopConfig, roomIntensity, roomTone.sparseGain, loopKnownPoolSize)), 1.8);
            await sleep(Math.round(1500 * applySurfaceGapMultiplier(adaptiveGapMultiplier(config, loopConfig, roomIntensity, loopKnownPoolSize, movement, true))));
            continue;
          }
          if (!primaryResult.payload) {
            setStatus(`Pool error: ${primaryResult.status}`);
            toneEngine.setRoomToneLevel(applySurfaceToneMultiplier(roomToneLevelFor(config, loopConfig, roomIntensity, roomTone.sparseGain, loopKnownPoolSize)), 1.4);
            await sleep(1500);
            continue;
          }

          const payload = primaryResult.payload;
          loopKnownPoolSize = Number(payload.pool_size || 0);
          rememberLoopPayload(payload, scene, movement);
          persistentLoopWindow = rememberPersistentArtifactId(config, PERSISTENT_LOOP_WINDOW_KEY, persistentLoopWindow, payload.artifact_id);
          const laneLabel = payload.lane ? `${payload.lane} ${payload.density || "room"} ${deploymentNoun}` : deploymentNoun;
          const featuredLabel = payload.featured_return ? " / featured return" : "";
          const scarcityLabel = scarcityProfile(config, loopConfig, loopKnownPoolSize).label;
          const threadDecision = threadFollowDecision({
            payload,
            cue,
            poolSize: loopKnownPoolSize,
            threadLength: threadHint.threadLength,
            maxLayers: Number(config.roomOverlapMaxLayers || 0),
          });
          const layerPayloads = [];
          const followPayloads = [];
          const overlapMaxLayers = Number(config.roomOverlapMaxLayers || 0);
          if (threadDecision.mode === "question_chorus" && Number(config.roomOverlapMaxLayers || 0) > 1) {
            // Question chorus is a special case: use the extra layer slot for a
            // same-thread return instead of the normal generic overlap chance.
            // Once a question topic has proven persistent, let a later echo
            // extend the chorus so the room feels actively haunted, not merely layered.
            const requestedCompanions = Math.max(1, Number(threadDecision.companionCount || 1));
            const layeredCompanions = Math.min(requestedCompanions, Math.max(0, overlapMaxLayers - 1));
            const companionIds = [];
            for (let index = 0; index < requestedCompanions; index += 1) {
              const companionPayload = await fetchThreadFollowPayload({
                config,
                persistentLoopWindow,
                cue,
                primaryArtifactId: payload.artifact_id,
                extraExcludedIds: companionIds,
                recentDensities,
                recentTopics,
                preferredTopic: threadDecision.preferredTopic,
                preferredLifecycleStatus: threadDecision.preferredLifecycleStatus,
                currentMoodBias: currentMoodBias(),
                segmentPrefix: `question-chorus-${index + 1}`,
              });
              if (!companionPayload) {
                break;
              }
              rememberLoopPayload(companionPayload, scene, movement);
              persistentLoopWindow = rememberPersistentArtifactId(
                config,
                PERSISTENT_LOOP_WINDOW_KEY,
                persistentLoopWindow,
                companionPayload.artifact_id,
              );
              companionIds.push(companionPayload.artifact_id);
              if (index < layeredCompanions) {
                layerPayloads.push(companionPayload);
              } else {
                followPayloads.push({
                  payload: companionPayload,
                  delayMs: randomDelayBetween(140, 260),
                  outputGainMultiplier: surfaceOutputGainMultiplier() * 0.84,
                  gapScale: 0.82,
                });
              }
            }
          } else if (threadDecision.mode !== "repair_bench" && Number(config.roomOverlapMaxLayers || 0) > 1 && overlapAllowedForCue({
            cue,
            poolSize: loopKnownPoolSize,
            config,
            loopConfig,
            quieterModeEnabled,
          })) {
            const layerPayload = await fetchLayerPayload({
              config,
              persistentLoopWindow,
              cue,
              primaryArtifactId: payload.artifact_id,
              recentDensities,
              recentTopics,
              preferredTopic: String(payload.topic_tag || threadHint.preferredTopic || "").trim().toLowerCase(),
              preferredLifecycleStatus: normalizedLifecycleStatus(payload.lifecycle_status || threadHint.preferredLifecycleStatus),
              currentMoodBias: currentMoodBias(),
            });
            if (layerPayload) {
              rememberLoopPayload(layerPayload, scene, movement);
              persistentLoopWindow = rememberPersistentArtifactId(config, PERSISTENT_LOOP_WINDOW_KEY, persistentLoopWindow, layerPayload.artifact_id);
              layerPayloads.push(layerPayload);
            }
          }
          if (threadDecision.mode === "repair_bench") {
            // Repair follow-ons should read as a short practical sequence, not a
            // thicker wall of sound, so they happen after the main cue instead
            // of competing with the generic overlap path.
            const benchProfile = repairBenchProfile({
              threadLength: threadHint.threadLength,
              cueDensity: cue.density,
            });
            const followPayload = await fetchThreadFollowPayload({
              config,
              persistentLoopWindow,
              cue: {
                ...cue,
                density: benchProfile.requestDensity,
              },
              primaryArtifactId: payload.artifact_id,
              extraExcludedIds: layerPayloads.map((item) => item.artifact_id),
              recentDensities,
              recentTopics,
              preferredTopic: threadDecision.preferredTopic,
              preferredLifecycleStatus: threadDecision.preferredLifecycleStatus,
              currentMoodBias: currentMoodBias(),
              segmentPrefix: "repair-bench",
            });
            if (followPayload) {
              rememberLoopPayload(followPayload, scene, movement);
              persistentLoopWindow = rememberPersistentArtifactId(config, PERSISTENT_LOOP_WINDOW_KEY, persistentLoopWindow, followPayload.artifact_id);
              followPayloads.push({
                payload: followPayload,
                delayMs: randomDelayBetween(benchProfile.followDelayMinMs, benchProfile.followDelayMaxMs),
                outputGainMultiplier: surfaceOutputGainMultiplier() * 0.92,
                gapScale: benchProfile.gapScale,
              });
            }
          }
          setStatus(
            scarcityLabel
              ? `Playing ${laneLabel}${featuredLabel} in ${roomPostureLabel(profiles)} / ${movement.name} / ${scene.name}${layerPayloads.length ? " / layered return" : ""}${threadModeLabel(threadDecision.mode)} (${scarcityLabel} pool, wear ${payload.wear.toFixed(3)})`
              : `Playing ${laneLabel}${featuredLabel} in ${roomPostureLabel(profiles)} / ${movement.name} / ${scene.name}${layerPayloads.length ? " / layered return" : ""}${threadModeLabel(threadDecision.mode)} (wear ${payload.wear.toFixed(3)})`,
          );
          toneEngine.setRoomToneLevel(applySurfaceToneMultiplier(roomToneLevelFor(config, loopConfig, roomIntensity, roomTone.duckGain, loopKnownPoolSize)), 0.8);
          const playbackPromises = [(async () => {
            await playUrlWithLightChain(payload.audio_url, payload.wear, {
              memoryColorProfile: payload.effect_profile,
              startMs: payload.playback_start_ms,
              durationMs: payload.playback_duration_ms,
              outputGainMultiplier: surfaceOutputGainMultiplier(),
            });
            await acknowledgeAudiblePlayback(payload.playback_ack_url);
          })()];
          if (layerPayloads.length) {
            layerPayloads.forEach((layerPayload) => {
              playbackPromises.push(playLayeredPayload({
                payload: layerPayload,
                delayMs: randomDelayBetween(config.roomOverlapMinDelayMs, config.roomOverlapMaxDelayMs),
                loopRunning: () => loopRunning,
                playbackPausedBySteward,
                playUrlWithLightChain,
                outputGainMultiplier: surfaceOutputGainMultiplier() * Number(config.roomOverlapGainMultiplier || 0.68),
              }));
            });
          }
          await Promise.allSettled(playbackPromises);
          for (const followPayload of followPayloads) {
            await playFollowPayload({
              payload: followPayload.payload,
              delayMs: followPayload.delayMs,
              loopRunning: () => loopRunning,
              playbackPausedBySteward,
              playUrlWithLightChain,
              outputGainMultiplier: followPayload.outputGainMultiplier,
            });
          }
          advanceLoopMovement();
          if (loopRunning) {
            const gapMultiplier = applySurfaceGapMultiplier(adaptiveGapMultiplier(config, loopConfig, roomIntensity, loopKnownPoolSize, movement, false));
            toneEngine.setRoomToneLevel(applySurfaceToneMultiplier(roomToneLevelFor(config, loopConfig, roomIntensity, roomTone.idleGain, loopKnownPoolSize)), 1.4);
            const followGapScale = followPayloads.reduce((scale, item) => Math.min(scale, Number(item.gapScale || 1.0)), 1.0);
            await sleep(Math.round((cue.gapMs || 900) * gapMultiplier * followGapScale));
          }
        } catch (err) {
          setStatus("Room loop interrupted.");
          toneEngine.setRoomToneLevel(applySurfaceToneMultiplier(roomToneLevelFor(config, loopConfig, roomIntensity, roomTone.sparseGain, loopKnownPoolSize)), 1.2);
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
