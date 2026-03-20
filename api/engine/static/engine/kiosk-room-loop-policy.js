(function initMemoryEngineRoomLoopPolicy(global) {
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

  global.MemoryEngineRoomLoopPolicy = {
    adaptiveGapMultiplier,
    antiRepetitionWindowSize,
    daypartMatchesHour,
    loadPersistentLoopWindow,
    quietHoursActive,
    randomIntBetween,
    recentArtifactIdsForExclusion,
    rememberPersistentArtifactId,
    resolveActiveDaypart,
    resolveMovement,
    roomToneLevelFor,
    savePersistentLoopWindow,
    scarcityProfile,
    sleep,
  };
}(typeof window !== "undefined" ? window : globalThis));
