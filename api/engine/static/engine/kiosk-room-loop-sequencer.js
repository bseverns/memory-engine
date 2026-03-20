(function initMemoryEngineRoomLoopSequencer(global) {
  function recentDensityWindow(loopHistory) {
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
    if (movement.name === "weathering" || movement.name === "gathering") {
      return "medium";
    }
    return densities[densities.length - 1] || "medium";
  }

  function chooseTargetMood({ movement, recent, currentMoodBias, loopMovementProgress }) {
    if (currentMoodBias) {
      const recentBiasCount = recent.filter((item) => item.mood === currentMoodBias).length;
      if (recentBiasCount < 2 || Math.random() < 0.72) {
        return currentMoodBias;
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

  function chooseNextScene({ roomScenes, movement, targetMood, targetDensity, loopHistory }) {
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

  global.MemoryEngineRoomLoopSequencer = {
    chooseNextScene,
    chooseTargetDensity,
    chooseTargetMood,
    recentDensityWindow,
  };
}(typeof window !== "undefined" ? window : globalThis));
