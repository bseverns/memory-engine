(function initMemoryEngineRoomLoopPlayback(global) {
  const {
    quietHoursActive,
    recentArtifactIdsForExclusion,
    sleep,
  } = global.MemoryEngineRoomLoopPolicy;

  function toneLevelForName(roomTone, name) {
    if (name === "sparse") return roomTone.sparseGain;
    if (name === "duck") return roomTone.duckGain;
    return roomTone.idleGain;
  }

  function overlapAllowedForCue({ cue, poolSize, config, loopConfig, quieterModeEnabled }) {
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

  function buildPoolQuery({
    lane = "any",
    density = "any",
    mood = "any",
    segmentVariant = "",
    excludeIds = [],
    recentDensities = [],
  }) {
    const params = new URLSearchParams({
      context: "kiosk",
      lane,
      density,
      mood,
      segment_variant: segmentVariant,
    });
    if (excludeIds.length) {
      params.set("exclude_ids", excludeIds.join(","));
    }
    if (recentDensities.length) {
      params.set("recent_densities", recentDensities.join(","));
    }
    return params;
  }

  async function fetchPoolPayload(request) {
    const params = buildPoolQuery(request);
    const response = await fetch(`/api/v1/pool/next?${params.toString()}`, { cache: "no-store" });
    if (response.status === 204) {
      return { hold: true, status: 204, payload: null };
    }
    if (!response.ok) {
      return { hold: false, status: response.status, payload: null };
    }
    return { hold: false, status: response.status, payload: await response.json() };
  }

  async function fetchLayerPayload({
    config,
    persistentLoopWindow,
    primaryArtifactId,
    cue,
    recentDensities,
    currentMoodBias,
  }) {
    const excludedIds = recentArtifactIdsForExclusion(config, persistentLoopWindow);
    const combinedExclusions = Array.from(new Set([...excludedIds, Number(primaryArtifactId)]));
    const result = await fetchPoolPayload({
      lane: cue.lane === "worn" ? "mid" : "any",
      density: cue.density === "dense" ? "medium" : (cue.density || "medium"),
      mood: cue.mood || currentMoodBias || "any",
      segmentVariant: `layer:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      excludeIds: combinedExclusions,
      recentDensities,
    });
    const payload = result.payload;
    if (!payload || Number(payload.artifact_id) === Number(primaryArtifactId)) {
      return null;
    }
    return payload;
  }

  async function playLayeredPayload({
    payload,
    delayMs,
    loopRunning,
    playbackPausedBySteward,
    playUrlWithLightChain,
    outputGainMultiplier,
  }) {
    await sleep(Number(delayMs || 0));
    if (!loopRunning() || playbackPausedBySteward()) {
      return;
    }
    await playUrlWithLightChain(payload.audio_url, payload.wear, {
      startMs: payload.playback_start_ms,
      durationMs: payload.playback_duration_ms,
      outputGainMultiplier,
    });
  }

  global.MemoryEngineRoomLoopPlayback = {
    fetchLayerPayload,
    fetchPoolPayload,
    overlapAllowedForCue,
    playLayeredPayload,
    randomDelayBetween,
    toneLevelForName,
  };
}(typeof window !== "undefined" ? window : globalThis));
