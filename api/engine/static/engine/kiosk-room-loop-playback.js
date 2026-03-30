(function initMemoryEngineRoomLoopPlayback(global) {
  const {
    deploymentProfile,
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
    const overlapConfig = loopConfig.overlap || {};
    const deployment = deploymentProfile(config, loopConfig);
    const quietHoursChanceMultiplier = Number(overlapConfig.quietHoursChanceMultiplier || 0.45);
    const quieterModeChanceMultiplier = Number(overlapConfig.quieterModeChanceMultiplier || 0.45);
    const deploymentChanceMultiplier = Number(deployment.overlapChanceMultiplier || 1.0);
    const baseChance = Number(config.roomOverlapChance || 0) * deploymentChanceMultiplier;
    if (poolSize < Number(config.roomOverlapMinPoolSize || 0)) {
      return false;
    }
    if (quieterModeEnabled() || quietHoursActive(config)) {
      const overlayMultiplier = quieterModeEnabled() ? quieterModeChanceMultiplier : quietHoursChanceMultiplier;
      return Math.random() < (baseChance * overlayMultiplier);
    }
    if (cue.density === "dense") {
      return false;
    }
    // Generic overlap is intentionally conservative. Deployment-specific thread
    // behavior gets its own path later instead of being hidden inside this chance roll.
    const densityLimit = String(overlapConfig.densityLimit || "medium");
    if (densityLimit === "light" && cue.density !== "light") {
      return false;
    }
    return Math.random() < baseChance;
  }

  function randomDelayBetween(min, max) {
    const start = Number.isFinite(Number(min)) ? Number(min) : 0;
    const end = Number.isFinite(Number(max)) ? Number(max) : start;
    return Math.round(start + (Math.random() * Math.max(0, end - start)));
  }

  function normalizedThreadSignal(value) {
    return String(value || "").trim().toLowerCase();
  }

  function questionChorusCompanionCount({
    threadLength = 0,
    poolSize = 0,
    maxLayers = 2,
    randomValue = Math.random(),
  } = {}) {
    if (poolSize < 3 || maxLayers <= 1) {
      return 0;
    }
    // One companion is the normal rare chorus. A second companion is reserved
    // for threads that have already demonstrated persistence in the room.
    // The extra companion can arrive as a later echo even when the overlap
    // budget only allows one simultaneous layer.
    if (threadLength >= 3 && poolSize >= 5 && maxLayers >= 2 && randomValue < 0.12) {
      return 2;
    }
    return 1;
  }

  function repairBenchProfile({
    threadLength = 0,
    cueDensity = "medium",
  } = {}) {
    const density = String(cueDensity || "medium").trim().toLowerCase() || "medium";
    if (threadLength >= 3) {
      return {
        requestDensity: "light",
        followDensity: "light",
        followDelayMinMs: 120,
        followDelayMaxMs: 240,
        gapScale: 0.48,
      };
    }
    if (threadLength >= 2) {
      return {
        requestDensity: density === "dense" ? "medium" : "light",
        followDensity: "light",
        followDelayMinMs: 150,
        followDelayMaxMs: 300,
        gapScale: 0.58,
      };
    }
    return {
      requestDensity: density === "dense" ? "medium" : density,
      followDensity: density === "dense" ? "medium" : density,
      followDelayMinMs: 220,
      followDelayMaxMs: 440,
      gapScale: 0.72,
    };
  }

  function threadFollowDecision({
    payload = {},
    cue = {},
    poolSize = 0,
    threadLength = 0,
    maxLayers = 2,
    randomValue = Math.random(),
  } = {}) {
    const signal = normalizedThreadSignal(payload.thread_signal);
    const topic = String(payload.topic_tag || "").trim().toLowerCase();
    const lifecycleStatus = String(payload.lifecycle_status || "").trim().toLowerCase();
    const density = String(payload.density || cue.density || "medium").trim().toLowerCase();

    // This helper is small on purpose: it translates a server-owned thread hint
    // into a browser composition decision without re-implementing deployment policy.
    if (signal === "question_chorus" && topic && poolSize >= 3 && density !== "dense" && randomValue < 0.24) {
      const companionCount = questionChorusCompanionCount({
        threadLength,
        poolSize,
        maxLayers,
        randomValue,
      });
      return {
        mode: "question_chorus",
        preferredTopic: topic,
        preferredLifecycleStatus: lifecycleStatus || "open",
        companionCount,
      };
    }

    if (signal === "repair_bench" && topic && poolSize >= 2 && randomValue < 0.52) {
      return {
        mode: "repair_bench",
        preferredTopic: topic,
        preferredLifecycleStatus: lifecycleStatus,
        companionCount: 0,
      };
    }

    return {
      mode: "none",
      preferredTopic: "",
      preferredLifecycleStatus: "",
      companionCount: 0,
    };
  }

  function buildPoolQuery({
    lane = "any",
    density = "any",
    mood = "any",
    segmentVariant = "",
    excludeIds = [],
    recentDensities = [],
    recentTopics = [],
    preferredTopic = "",
    preferredLifecycleStatus = "",
  }) {
    // Query fields here are the explicit browser -> API contract for playback
    // requests. Keep additions named and inspectable rather than inferred.
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
    if (recentTopics.length) {
      params.set("recent_topics", recentTopics.join(","));
    }
    if (preferredTopic) {
      params.set("preferred_topic", preferredTopic);
    }
    if (preferredLifecycleStatus) {
      params.set("preferred_lifecycle_status", preferredLifecycleStatus);
    }
    return params;
  }

  async function fetchPoolPayload(request) {
    const params = buildPoolQuery(request);
    // `204` means "hold the room" rather than "hard error". The room loop uses
    // that distinction to stay calm during scarcity or steward pauses.
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
    recentTopics,
    preferredTopic,
    preferredLifecycleStatus,
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
      recentTopics,
      preferredTopic,
      preferredLifecycleStatus,
    });
    const payload = result.payload;
    if (!payload || Number(payload.artifact_id) === Number(primaryArtifactId)) {
      return null;
    }
    return payload;
  }

  async function fetchThreadFollowPayload({
    config,
    persistentLoopWindow,
    primaryArtifactId,
    extraExcludedIds = [],
    cue,
    recentDensities,
    recentTopics,
    preferredTopic,
    preferredLifecycleStatus,
    currentMoodBias,
    segmentPrefix = "thread",
  }) {
    // Follow-on requests deliberately exclude the primary artifact (and any
    // already chosen companion) so thread behavior reads as recurrence, not duplication.
    const excludedIds = recentArtifactIdsForExclusion(config, persistentLoopWindow);
    const combinedExclusions = Array.from(new Set([
      ...excludedIds,
      Number(primaryArtifactId),
      ...extraExcludedIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0),
    ]));
    const result = await fetchPoolPayload({
      lane: cue.lane === "worn" ? "mid" : "any",
      density: cue.density === "dense" ? "medium" : (cue.density || "medium"),
      mood: cue.mood || currentMoodBias || "any",
      segmentVariant: `${segmentPrefix}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      excludeIds: combinedExclusions,
      recentDensities,
      recentTopics,
      preferredTopic,
      preferredLifecycleStatus,
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
      memoryColorProfile: payload.effect_profile,
      startMs: payload.playback_start_ms,
      durationMs: payload.playback_duration_ms,
      outputGainMultiplier,
    });
    await acknowledgeAudiblePlayback(payload.playback_ack_url);
  }

  async function playFollowPayload({
    payload,
    delayMs,
    loopRunning,
    playbackPausedBySteward,
    playUrlWithLightChain,
    outputGainMultiplier,
  }) {
    // Sequential follow-ons are kept separate from layered playback so repair
    // can feel like a notebook entry after another, not an accidental pileup.
    await sleep(Number(delayMs || 0));
    if (!loopRunning() || playbackPausedBySteward()) {
      return;
    }
    await playUrlWithLightChain(payload.audio_url, payload.wear, {
      memoryColorProfile: payload.effect_profile,
      startMs: payload.playback_start_ms,
      durationMs: payload.playback_duration_ms,
      outputGainMultiplier,
    });
    await acknowledgeAudiblePlayback(payload.playback_ack_url);
  }

  async function acknowledgeAudiblePlayback(ackUrl) {
    const url = String(ackUrl || "").trim();
    if (!url) {
      return;
    }
    try {
      await fetch(url, {
        method: "POST",
        cache: "no-store",
        keepalive: true,
      });
    } catch (error) {}
  }

  global.MemoryEngineRoomLoopPlayback = {
    acknowledgeAudiblePlayback,
    fetchLayerPayload,
    fetchPoolPayload,
    fetchThreadFollowPayload,
    overlapAllowedForCue,
    playFollowPayload,
    playLayeredPayload,
    questionChorusCompanionCount,
    randomDelayBetween,
    repairBenchProfile,
    threadFollowDecision,
    toneLevelForName,
  };
}(typeof window !== "undefined" ? window : globalThis));
