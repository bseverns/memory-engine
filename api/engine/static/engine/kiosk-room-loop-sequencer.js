(function initMemoryEngineRoomLoopSequencer(global) {
  function densityHistoryWindowSize(loopConfig = {}) {
    const configured = Number(loopConfig.policy?.history?.densityWindow || 4);
    return Math.max(1, Number.isFinite(configured) ? Math.floor(configured) : 4);
  }

  function sceneHistoryWindowSize(loopConfig = {}) {
    const configured = Number(loopConfig.policy?.history?.sceneWindow || 3);
    return Math.max(1, Number.isFinite(configured) ? Math.floor(configured) : 3);
  }

  function sequencerPolicy(loopConfig = {}) {
    return loopConfig.policy?.sequencer || {};
  }

  function recentDensityWindow(loopHistory, loopConfig = {}) {
    return loopHistory
      .slice(-densityHistoryWindowSize(loopConfig))
      .map((item) => item.density)
      .filter((density) => ["light", "medium", "dense"].includes(density));
  }

  function chooseTargetDensity(movement, recent, loopConfig = {}) {
    const densities = recentDensityWindow(recent, loopConfig);
    const denseCount = densities.filter((density) => density === "dense").length;
    const lightCount = densities.filter((density) => density === "light").length;

    if (denseCount >= 2) {
      return movement.denseReleaseDensity || movement.defaultDensity || "medium";
    }
    if (lightCount >= 2) {
      return movement.lightRecoveryDensity || movement.defaultDensity || "medium";
    }
    if (movement.defaultDensity) {
      return movement.defaultDensity;
    }
    return densities[densities.length - 1] || "medium";
  }

  function chooseTargetMood({ movement, recent, currentMoodBias, loopMovementProgress, loopConfig = {} }) {
    const policy = sequencerPolicy(loopConfig);
    const moodBiasRecentLimit = Number(policy.moodBiasRecentLimit || 2);
    const moodBiasHoldChance = Number(policy.moodBiasHoldChance || 0.72);
    const weatheredReleaseThreshold = Number(policy.weatheredReleaseThreshold || 2);
    const clearReleaseThreshold = Number(policy.clearReleaseThreshold || 2);
    if (currentMoodBias) {
      const recentBiasCount = recent.filter((item) => item.mood === currentMoodBias).length;
      if (recentBiasCount < moodBiasRecentLimit || Math.random() < moodBiasHoldChance) {
        return currentMoodBias;
      }
    }

    const last = recent[recent.length - 1];
    if (!last) {
      return movement.preferredMoods[0];
    }
    if (recent.filter((item) => item.mood === "weathered").length >= weatheredReleaseThreshold) {
      return "clear";
    }
    if (recent.filter((item) => item.mood === "clear").length >= clearReleaseThreshold) {
      return movement.clearReleaseMood || movement.preferredMoods[0];
    }
    if (last.density === "dense") {
      return movement.denseAfterMood || movement.preferredMoods[0];
    }
    if (last.mood === "hushed") {
      return movement.preferredMoods.find((mood) => mood !== "hushed") || movement.preferredMoods[0];
    }
    return movement.preferredMoods[loopMovementProgress % movement.preferredMoods.length];
  }

  function chooseNextScene({ roomScenes, movement, targetMood, targetDensity, loopHistory }) {
    const recent = loopHistory.slice(-sceneHistoryWindowSize(arguments[0].loopConfig || {}));
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

  global.MemoryEngineRoomLoopSequencer = {
    chooseNextScene,
    chooseTargetDensity,
    chooseTargetMood,
    recentDensityWindow,
  };
}(typeof window !== "undefined" ? window : globalThis));
