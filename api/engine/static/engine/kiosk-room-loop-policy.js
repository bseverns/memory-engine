(function initMemoryEngineRoomLoopPolicy(global) {
  function historyPolicy(loopConfig = {}) {
    return loopConfig.policy?.history || {};
  }

  function loopHistoryWindowSize(loopConfig = {}) {
    const configured = Number(historyPolicy(loopConfig).loopWindow || 6);
    return Math.max(1, Number.isFinite(configured) ? Math.floor(configured) : 6);
  }

  function densityHistoryWindowSize(loopConfig = {}) {
    const configured = Number(historyPolicy(loopConfig).densityWindow || 4);
    return Math.max(1, Number.isFinite(configured) ? Math.floor(configured) : 4);
  }

  function sceneHistoryWindowSize(loopConfig = {}) {
    const configured = Number(historyPolicy(loopConfig).sceneWindow || 3);
    return Math.max(1, Number.isFinite(configured) ? Math.floor(configured) : 3);
  }

  function scarcityConfig(loopConfig = {}) {
    return loopConfig.policy?.scarcity || {};
  }

  function archiveGapTiers(loopConfig = {}) {
    const tiers = Array.isArray(loopConfig.policy?.archiveGapTiers) ? loopConfig.policy.archiveGapTiers : [];
    return tiers
      .map((tier) => ({
        minPoolSize: Number(tier.minPoolSize || 0),
        multiplier: Number(tier.multiplier || 1.0),
      }))
      .filter((tier) => Number.isFinite(tier.minPoolSize) && Number.isFinite(tier.multiplier))
      .sort((a, b) => b.minPoolSize - a.minPoolSize);
  }

  function surfaceOverlayConfig(loopConfig = {}) {
    return loopConfig.policy?.surfaceOverlays || {};
  }

  function antiRepetitionWindowSize(config) {
    const configured = Number(config.roomAntiRepetitionWindowSize || 0);
    return Math.max(0, Math.min(50, Number.isFinite(configured) ? Math.floor(configured) : 0));
  }

  function loadPersistentLoopWindow(config, storageKey) {
    const size = antiRepetitionWindowSize(config);
    if (size <= 0 || !global.localStorage) {
      return [];
    }

    try {
      const raw = global.localStorage.getItem(storageKey);
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

  function savePersistentLoopWindow(config, storageKey, persistentLoopWindow) {
    const size = antiRepetitionWindowSize(config);
    if (size <= 0 || !global.localStorage) {
      return;
    }

    try {
      global.localStorage.setItem(
        storageKey,
        JSON.stringify(persistentLoopWindow.slice(-size)),
      );
    } catch (err) {}
  }

  function recentArtifactIdsForExclusion(config, persistentLoopWindow) {
    const size = antiRepetitionWindowSize(config);
    if (size <= 0) return [];
    return persistentLoopWindow.slice(-size);
  }

  function rememberPersistentArtifactId(config, storageKey, persistentLoopWindow, artifactId) {
    const size = antiRepetitionWindowSize(config);
    if (size <= 0) return persistentLoopWindow;

    const numericId = Number(artifactId);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      return persistentLoopWindow;
    }

    const next = persistentLoopWindow.filter((id) => id !== numericId);
    next.push(numericId);
    const trimmed = next.slice(-size);
    savePersistentLoopWindow(config, storageKey, trimmed);
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

  function scarcityProfile(config, loopConfig, poolSize) {
    const configured = scarcityConfig(loopConfig);
    const normal = configured.normal || {
      gapMultiplier: 1.0,
      pauseMultiplier: 1.0,
      toneMultiplier: 1.0,
      label: "",
    };
    const low = configured.low || {
      gapMultiplier: 1.35,
      pauseMultiplier: 1.55,
      toneMultiplier: 1.2,
      label: "thin",
    };
    const severe = configured.severe || {
      gapMultiplier: 1.8,
      pauseMultiplier: 2.1,
      toneMultiplier: 1.45,
      label: "scarce",
    };
    if (!config.roomScarcityEnabled) {
      return normal;
    }
    if (poolSize <= 0 || poolSize <= config.roomScarcitySevereThreshold) {
      return severe;
    }
    if (poolSize <= config.roomScarcityLowThreshold) {
      return low;
    }
    return normal;
  }

  function archiveGapMultiplier(loopConfig, poolSize) {
    for (const tier of archiveGapTiers(loopConfig)) {
      if (poolSize >= tier.minPoolSize) {
        return tier.multiplier;
      }
    }
    return 1.0;
  }

  function adaptiveGapMultiplier(config, loopConfig, intensity, poolSize, movement, pauseGap) {
    const scarcity = scarcityProfile(config, loopConfig, poolSize);
    let archiveMultiplier = 1.0;
    if (poolSize > 0) {
      archiveMultiplier = archiveGapMultiplier(loopConfig, poolSize);
    }

    return (
      movement.gapMultiplier
      * intensity.cueGapMultiplier
      * archiveMultiplier
      * (pauseGap ? intensity.pauseGapMultiplier : 1.0)
      * (pauseGap ? scarcity.pauseMultiplier : scarcity.gapMultiplier)
    );
  }

  function roomToneLevelFor(config, loopConfig, intensity, baseLevel, poolSize) {
    const scarcity = scarcityProfile(config, loopConfig, poolSize);
    return baseLevel * intensity.roomToneMultiplier * scarcity.toneMultiplier;
  }

  function surfaceOverlayMultiplier(loopConfig, overlayName, fieldName, fallback = 1.0) {
    const value = Number(surfaceOverlayConfig(loopConfig)?.[overlayName]?.[fieldName] || fallback);
    return Number.isFinite(value) ? value : fallback;
  }

  function randomIntBetween(min, max) {
    return min + Math.floor(Math.random() * ((max - min) + 1));
  }

  function sleep(ms) {
    return new Promise((resolve) => global.setTimeout(resolve, ms));
  }

  global.MemoryEngineRoomLoopPolicy = {
    adaptiveGapMultiplier,
    antiRepetitionWindowSize,
    densityHistoryWindowSize,
    daypartMatchesHour,
    loadPersistentLoopWindow,
    loopHistoryWindowSize,
    quietHoursActive,
    randomIntBetween,
    recentArtifactIdsForExclusion,
    rememberPersistentArtifactId,
    resolveActiveDaypart,
    resolveMovement,
    roomToneLevelFor,
    savePersistentLoopWindow,
    sceneHistoryWindowSize,
    scarcityProfile,
    sleep,
    surfaceOverlayMultiplier,
  };
}(typeof window !== "undefined" ? window : globalThis));
