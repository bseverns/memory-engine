(function initMemoryEngineKioskAudio(global) {
  const WORKLET_MODULE_URL = "/static/engine/kiosk-audio-worklets.js";
  const workletLoads = new WeakMap();
  const memoryColorCatalogApi = global.MemoryEngineMemoryColorCatalog;

  const RECORDING_PROCESSING = {
    trimThreshold: 0.014,
    edgePaddingMs: 120,
    minContentMs: 700,
    targetPeak: 0.92,
    maxGain: 3.2,
    fadeMs: 16,
  };

  const QUIET_TAKE = {
    minDurationMs: 1800,
    rmsThreshold: 0.015,
    peakThreshold: 0.12,
  };

  const PLAYBACK_SMOOTHING = {
    targetPeak: 0.9,
    minGain: 0.85,
    maxGain: 2.1,
    fadeInSeconds: 0.12,
    fadeOutSeconds: 0.35,
  };
  const MEMORY_COLOR_CATALOG = memoryColorCatalogApi.getMemoryColorCatalog();
  const MEMORY_COLOR_PROFILE_ORDER = MEMORY_COLOR_CATALOG.profiles.map((profile) => profile.code);

  function normalizeMemoryColorProfile(profile, fallbackCode = memoryColorCatalogApi.getDefaultMemoryColorCode()) {
    return memoryColorCatalogApi.normalizeMemoryColorCode(profile, fallbackCode);
  }

  function memoryColorProfileSpec(profile) {
    return memoryColorCatalogApi.getMemoryColorByCode(profile);
  }

  async function ensureWorkletModule(audioContext) {
    if (!audioContext.audioWorklet) {
      throw new Error("This browser does not support AudioWorklet.");
    }
    if (!workletLoads.has(audioContext)) {
      workletLoads.set(audioContext, audioContext.audioWorklet.addModule(WORKLET_MODULE_URL));
    }
    await workletLoads.get(audioContext);
  }

  function mergeBuffers(chunks) {
    const length = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const merged = new Float32Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged;
  }

  function processRecordingSamples(samples, sampleRate) {
    if (!samples.length) {
      return { samples, note: "Choose how this take should be handled.", noteKey: "choose_mode", quietWarning: null };
    }

    const trimmed = trimSilence(
      samples,
      sampleRate,
      RECORDING_PROCESSING.trimThreshold,
      RECORDING_PROCESSING.edgePaddingMs,
      RECORDING_PROCESSING.minContentMs,
    );
    const quietWarning = analyzeTakeLevel(trimmed, sampleRate);
    const normalized = normalizeSamples(
      trimmed,
      RECORDING_PROCESSING.targetPeak,
      RECORDING_PROCESSING.maxGain,
    );
    applyFade(normalized, sampleRate, RECORDING_PROCESSING.fadeMs);

    const changedDuration = samples.length !== trimmed.length;
    let noteKey = changedDuration ? "trimmed_and_smoothed" : "smoothed";
    let note = changedDuration
      ? "Take captured. Quiet edges were trimmed and the level was smoothed."
      : "Take captured. The level was smoothed for playback.";
    if (quietWarning) {
      noteKey = "quiet_warning";
      note = "Take captured. The input stayed very quiet, so please keep or retake it before choosing a memory mode.";
    }

    return {
      samples: normalized,
      note,
      noteKey,
      quietWarning,
    };
  }

  function analyzeTakeLevel(samples, sampleRate) {
    if (!samples.length) return null;

    const durationMs = (samples.length / sampleRate) * 1000;
    if (durationMs < QUIET_TAKE.minDurationMs) {
      return null;
    }

    let peak = 0;
    let sumSquares = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const value = samples[i];
      const abs = Math.abs(value);
      peak = Math.max(peak, abs);
      sumSquares += value * value;
    }

    const rms = Math.sqrt(sumSquares / samples.length);
    if (rms >= QUIET_TAKE.rmsThreshold || peak >= QUIET_TAKE.peakThreshold) {
      return null;
    }

    return { peak, rms, durationMs };
  }

  function trimSilence(samples, sampleRate, threshold, edgePaddingMs, minContentMs) {
    const paddingSamples = Math.round((edgePaddingMs / 1000) * sampleRate);
    const minContentSamples = Math.round((minContentMs / 1000) * sampleRate);

    let start = 0;
    while (start < samples.length && Math.abs(samples[start]) < threshold) {
      start += 1;
    }

    let end = samples.length - 1;
    while (end >= 0 && Math.abs(samples[end]) < threshold) {
      end -= 1;
    }

    if (start >= end) {
      return samples.slice();
    }

    start = Math.max(0, start - paddingSamples);
    end = Math.min(samples.length, end + paddingSamples + 1);

    if ((end - start) < minContentSamples) {
      return samples.slice();
    }
    return samples.slice(start, end);
  }

  function normalizeSamples(samples, targetPeak, maxGain) {
    let peak = 0;
    for (let i = 0; i < samples.length; i += 1) {
      peak = Math.max(peak, Math.abs(samples[i]));
    }

    if (peak < 0.0001) {
      return samples.slice();
    }

    const gain = Math.min(maxGain, targetPeak / peak);
    if (Math.abs(gain - 1) < 0.02) {
      return samples.slice();
    }

    const normalized = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i += 1) {
      normalized[i] = clamp(samples[i] * gain, -1, 1);
    }
    return normalized;
  }

  function applyFade(samples, sampleRate, fadeMs) {
    const fadeSamples = Math.min(
      Math.round((fadeMs / 1000) * sampleRate),
      Math.floor(samples.length / 2),
    );

    for (let i = 0; i < fadeSamples; i += 1) {
      const gain = i / Math.max(1, fadeSamples);
      samples[i] *= gain;
      samples[samples.length - 1 - i] *= gain;
    }
  }

  function encodeWavMono16(float32Samples, sampleRate) {
    const numSamples = float32Samples.length;
    const bytesPerSample = 2;
    const blockAlign = bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = numSamples * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    function writeStr(offset, value) {
      for (let i = 0; i < value.length; i += 1) {
        view.setUint8(offset + i, value.charCodeAt(i));
      }
    }

    writeStr(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, dataSize, true);

    let pointer = 44;
    for (let i = 0; i < numSamples; i += 1) {
      const sample = Math.max(-1, Math.min(1, float32Samples[i]));
      const value = sample < 0 ? sample * 32768 : sample * 32767;
      view.setInt16(pointer, value, true);
      pointer += 2;
    }

    return new Blob([view], { type: "audio/wav" });
  }

  async function fetchArrayBuffer(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`fetch failed ${response.status}`);
    }
    return response.arrayBuffer();
  }

  function makeSoftClipCurve(amount = 18) {
    const samples = 4096;
    const curve = new Float32Array(samples);
    for (let index = 0; index < samples; index += 1) {
      const x = ((index / (samples - 1)) * 2) - 1;
      curve[index] = Math.tanh(amount * x) / Math.tanh(amount);
    }
    return curve;
  }

  function hashStringToSeed(input) {
    let hash = 2166136261;
    const text = String(input || "");
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function createSeededRandom(seed) {
    let state = (seed >>> 0) || 0x6d2b79f5;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  async function playMonitorCheckTone() {
    const AudioContextCtor = global.AudioContext || global.webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error("This browser cannot play the monitor check tone.");
    }

    const ctx = new AudioContextCtor();
    try {
      if (ctx.state === "suspended") {
        await ctx.resume();
      }

      const masterGain = ctx.createGain();
      masterGain.gain.value = 0.0001;
      masterGain.connect(ctx.destination);

      const firstOsc = ctx.createOscillator();
      firstOsc.type = "sine";
      firstOsc.frequency.value = 523.25;
      firstOsc.connect(masterGain);

      const secondOsc = ctx.createOscillator();
      secondOsc.type = "sine";
      secondOsc.frequency.value = 659.25;
      secondOsc.connect(masterGain);

      const startAt = ctx.currentTime + 0.02;
      firstOsc.start(startAt);
      firstOsc.stop(startAt + 0.34);
      secondOsc.start(startAt + 0.44);
      secondOsc.stop(startAt + 0.78);

      masterGain.gain.exponentialRampToValueAtTime(0.06, startAt + 0.02);
      masterGain.gain.exponentialRampToValueAtTime(0.018, startAt + 0.34);
      masterGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.4);
      masterGain.gain.exponentialRampToValueAtTime(0.06, startAt + 0.46);
      masterGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.8);

      await new Promise((resolve) => {
        secondOsc.onended = resolve;
      });
      masterGain.disconnect();
    } finally {
      await ctx.close();
    }
  }

  function memoryColorSeedForBuffer(buffer, profile) {
    const normalized = normalizeMemoryColorProfile(profile);
    let hash = hashStringToSeed(`${normalized}:${buffer.numberOfChannels}:${buffer.length}:${buffer.sampleRate}`);
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      const stride = Math.max(1, Math.floor(data.length / 64));
      for (let index = 0; index < data.length; index += stride) {
        const quantized = Math.max(-32768, Math.min(32767, Math.round(data[index] * 32767)));
        hash ^= quantized & 0xffff;
        hash = Math.imul(hash, 16777619) >>> 0;
      }
    }
    return hash >>> 0;
  }

  function createDreamImpulseResponse(ctx, seconds = 1.2, decay = 3.0, seed = 1) {
    const length = Math.max(1, Math.round(ctx.sampleRate * seconds));
    const channels = Math.max(1, ctx.destination?.channelCount || 1);
    const impulse = ctx.createBuffer(channels, length, ctx.sampleRate);
    const rand = createSeededRandom(seed);
    for (let channel = 0; channel < channels; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let index = 0; index < length; index += 1) {
        const fade = Math.pow(1 - (index / length), decay);
        data[index] = ((rand() * 2) - 1) * fade * 0.28;
      }
    }
    return impulse;
  }

  function buildPresenceLiftTopology(ctx, sourceNode, processing, track) {
    const highpass = track(ctx.createBiquadFilter());
    highpass.type = "highpass";
    highpass.frequency.value = Number(processing.highpass_hz || 72);
    highpass.Q.value = Number(processing.highpass_q || 0.66);

    const presence = track(ctx.createBiquadFilter());
    presence.type = "peaking";
    presence.frequency.value = Number(processing.presence_hz || 2100);
    presence.Q.value = Number(processing.presence_q || 0.8);
    presence.gain.value = Number(processing.presence_gain_db || 1.6);

    const air = track(ctx.createBiquadFilter());
    air.type = "highshelf";
    air.frequency.value = Number(processing.air_hz || 5600);
    air.gain.value = Number(processing.air_gain_db || 1.4);

    const outputGain = track(ctx.createGain());
    outputGain.gain.value = Number(processing.output_gain || 0.98);

    sourceNode.connect(highpass);
    highpass.connect(presence);
    presence.connect(air);
    air.connect(outputGain);
    return outputGain;
  }

  function buildWarmBodyTopology(ctx, sourceNode, processing, track) {
    const lowshelf = track(ctx.createBiquadFilter());
    lowshelf.type = "lowshelf";
    lowshelf.frequency.value = Number(processing.lowshelf_hz || 220);
    lowshelf.gain.value = Number(processing.lowshelf_gain_db || 4.6);

    const lowpass = track(ctx.createBiquadFilter());
    lowpass.type = "lowpass";
    lowpass.frequency.value = Number(processing.lowpass_hz || 7600);
    lowpass.Q.value = Number(processing.lowpass_q || 0.62);

    const highshelf = track(ctx.createBiquadFilter());
    highshelf.type = "highshelf";
    highshelf.frequency.value = Number(processing.highshelf_hz || 4200);
    highshelf.gain.value = Number(processing.highshelf_gain_db || -2.8);

    const compressor = track(ctx.createDynamicsCompressor());
    compressor.threshold.value = Number(processing.compressor_threshold_db || -20);
    compressor.knee.value = Number(processing.compressor_knee_db || 18);
    compressor.ratio.value = Number(processing.compressor_ratio || 2.1);
    compressor.attack.value = Number(processing.compressor_attack_s || 0.01);
    compressor.release.value = Number(processing.compressor_release_s || 0.18);

    const outputGain = track(ctx.createGain());
    outputGain.gain.value = Number(processing.output_gain || 1.02);

    sourceNode.connect(lowshelf);
    lowshelf.connect(lowpass);
    lowpass.connect(highshelf);
    highshelf.connect(compressor);
    compressor.connect(outputGain);
    return outputGain;
  }

  function buildRadioNarrowbandTopology(ctx, sourceNode, processing, track) {
    const highpass = track(ctx.createBiquadFilter());
    highpass.type = "highpass";
    highpass.frequency.value = Number(processing.highpass_hz || 290);
    highpass.Q.value = Number(processing.highpass_q || 0.9);

    const lowpass = track(ctx.createBiquadFilter());
    lowpass.type = "lowpass";
    lowpass.frequency.value = Number(processing.lowpass_hz || 3350);
    lowpass.Q.value = Number(processing.lowpass_q || 0.92);

    const mid = track(ctx.createBiquadFilter());
    mid.type = "peaking";
    mid.frequency.value = Number(processing.mid_hz || 1450);
    mid.Q.value = Number(processing.mid_q || 1.1);
    mid.gain.value = Number(processing.mid_gain_db || 3.4);

    const drive = track(ctx.createWaveShaper());
    drive.curve = makeSoftClipCurve(Number(processing.drive_amount || 9));
    drive.oversample = "2x";

    const outputGain = track(ctx.createGain());
    outputGain.gain.value = Number(processing.output_gain || 0.86);

    sourceNode.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(mid);
    mid.connect(drive);
    drive.connect(outputGain);
    return outputGain;
  }

  function buildDreamDiffuseTopology(ctx, sourceNode, processing, track, options = {}) {
    const lowpass = track(ctx.createBiquadFilter());
    lowpass.type = "lowpass";
    lowpass.frequency.value = Number(processing.lowpass_hz || 5200);
    lowpass.Q.value = Number(processing.lowpass_q || 0.5);

    const dry = track(ctx.createGain());
    dry.gain.value = Number(processing.dry_gain || 0.82);

    const wetSource = track(ctx.createGain());
    wetSource.gain.value = Number(processing.wet_source_gain || 0.38);

    const delay = track(ctx.createDelay(0.5));
    delay.delayTime.value = Number(processing.delay_s || 0.18);

    const feedback = track(ctx.createGain());
    feedback.gain.value = Number(processing.feedback_gain || 0.24);

    const convolver = track(ctx.createConvolver());
    convolver.buffer = createDreamImpulseResponse(
      ctx,
      Number(processing.impulse_seconds || 1.5),
      Number(processing.impulse_decay || 3.2),
      Number.isFinite(Number(options.seed)) ? Number(options.seed) : 1,
    );

    const wet = track(ctx.createGain());
    wet.gain.value = Number(processing.wet_gain || 0.28);

    const outputGain = track(ctx.createGain());
    outputGain.gain.value = Number(processing.output_gain || 0.96);

    sourceNode.connect(lowpass);
    lowpass.connect(dry);
    lowpass.connect(wetSource);
    wetSource.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(convolver);
    convolver.connect(wet);
    dry.connect(outputGain);
    wet.connect(outputGain);
    return outputGain;
  }

  const MEMORY_COLOR_TOPOLOGY_BUILDERS = {
    presence_lift: buildPresenceLiftTopology,
    warm_body: buildWarmBodyTopology,
    radio_narrowband: buildRadioNarrowbandTopology,
    dream_diffuse: buildDreamDiffuseTopology,
  };

  function resolveMemoryColorTopology(profile, processing) {
    const normalized = normalizeMemoryColorProfile(profile);
    const candidate = String(processing?.topology || processing?.kind || normalized || "").trim().toLowerCase();
    return MEMORY_COLOR_TOPOLOGY_BUILDERS[candidate] ? candidate : "";
  }

  function buildMemoryColorChain(ctx, sourceNode, profile, options = {}) {
    const normalized = normalizeMemoryColorProfile(profile);
    const spec = memoryColorProfileSpec(normalized);
    const processing = spec?.processing && typeof spec.processing === "object" ? spec.processing : {};
    if (!normalized) {
      return {
        output: sourceNode,
        dispose() {},
      };
    }

    const nodes = [];
    const track = (node) => {
      nodes.push(node);
      return node;
    };

    const topology = resolveMemoryColorTopology(normalized, processing);
    const buildTopology = MEMORY_COLOR_TOPOLOGY_BUILDERS[topology];
    const output = buildTopology
      ? buildTopology(ctx, sourceNode, processing, track, options)
      : sourceNode;

    return {
      output,
      dispose() {
        for (const node of nodes) {
          try {
            node.disconnect();
          } catch (error) {}
        }
      },
    };
  }

  async function renderMemoryColorPreviewBlob(blob, profile) {
    const normalized = normalizeMemoryColorProfile(profile);
    if (!normalized) {
      return blob;
    }

    const AudioContextCtor = global.AudioContext || global.webkitAudioContext;
    const OfflineAudioContextCtor = global.OfflineAudioContext || global.webkitOfflineAudioContext;
    if (!AudioContextCtor || !OfflineAudioContextCtor) {
      throw new Error("This browser cannot render a memory-colored preview.");
    }

    const decodeContext = new AudioContextCtor();
    try {
      const buffer = await decodeContext.decodeAudioData((await blob.arrayBuffer()).slice(0));
      const seed = memoryColorSeedForBuffer(buffer, normalized);
      const offlineCtx = new OfflineAudioContextCtor(
        Math.max(1, buffer.numberOfChannels),
        Math.max(1, buffer.length),
        buffer.sampleRate,
      );
      const source = offlineCtx.createBufferSource();
      source.buffer = buffer;
      const memoryColorChain = buildMemoryColorChain(offlineCtx, source, normalized, { seed });
      memoryColorChain.output.connect(offlineCtx.destination);
      source.start(0);
      const rendered = await offlineCtx.startRendering();
      memoryColorChain.dispose();
      return encodeWavMono16(rendered.getChannelData(0), rendered.sampleRate);
    } finally {
      await decodeContext.close();
    }
  }

  async function playUrlWithLightChain(url, wear, options = {}) {
    const amount = smoothstep(clamp(wear, 0, 1));
    const outputGainMultiplier = clamp(
      Number.isFinite(Number(options.outputGainMultiplier)) ? Number(options.outputGainMultiplier) : 1.0,
      0.1,
      2.0,
    );
    const arrayBuffer = await fetchArrayBuffer(url);
    const ctx = new (global.AudioContext || global.webkitAudioContext)();
    await ensureWorkletModule(ctx);
    const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const memoryColorProfile = normalizeMemoryColorProfile(options.memoryColorProfile);
    const memoryColorSeed = memoryColorProfile ? memoryColorSeedForBuffer(buffer, memoryColorProfile) : 0;
    const peak = getBufferPeak(buffer);
    const requestedStartSeconds = Math.max(0, Number(options.startMs || 0) / 1000);
    const requestedDurationSeconds = Math.max(0, Number(options.durationMs || 0) / 1000);
    const playbackStartSeconds = Math.min(Math.max(0, buffer.duration - 0.02), requestedStartSeconds);
    const availableDurationSeconds = Math.max(0.02, buffer.duration - playbackStartSeconds);
    const playbackDurationSeconds = requestedDurationSeconds > 0
      ? Math.min(availableDurationSeconds, requestedDurationSeconds)
      : availableDurationSeconds;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const memoryColorChain = buildMemoryColorChain(
      ctx,
      src,
      memoryColorProfile,
      { seed: memoryColorSeed },
    );

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = lerp(16000, 4500, amount);
    lowpass.Q.value = 0.6;

    const shelf = ctx.createBiquadFilter();
    shelf.type = "highshelf";
    shelf.frequency.value = 6000;
    shelf.gain.value = lerp(0, -10, amount);

    const bitDepth = Math.round(lerp(16, 12, amount));
    const holdN = Math.round(lerp(1, 3, amount));
    const noiseAmp = lerp(0.0, 0.004, amount);
    const dropoutProb = lerp(0.0, 0.003, amount);
    const crush = new AudioWorkletNode(ctx, "memory-engine-bitcrush", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [Math.max(1, buffer.numberOfChannels)],
      processorOptions: {
        bitDepth,
        holdN,
        noiseAmp,
        dropoutProb,
      },
    });

    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = lerp(0.05, 0.12, amount);

    const lfoGain = ctx.createGain();
    lfoGain.gain.value = lerp(0, 180, amount);
    lfo.connect(lfoGain);
    lfoGain.connect(lowpass.frequency);

    const gain = ctx.createGain();
    const normalizedGain = peak > 0.0001
      ? clamp(PLAYBACK_SMOOTHING.targetPeak / peak, PLAYBACK_SMOOTHING.minGain, PLAYBACK_SMOOTHING.maxGain)
      : 1.0;
    const fadeInSeconds = Math.min(PLAYBACK_SMOOTHING.fadeInSeconds, Math.max(0.02, playbackDurationSeconds / 4));
    const fadeOutSeconds = Math.min(PLAYBACK_SMOOTHING.fadeOutSeconds, Math.max(0.04, playbackDurationSeconds / 3));
    const releaseAt = Math.max(fadeInSeconds, playbackDurationSeconds - fadeOutSeconds);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(normalizedGain * 0.95 * outputGainMultiplier, ctx.currentTime + fadeInSeconds);
    gain.gain.setValueAtTime(normalizedGain * 0.95 * outputGainMultiplier, ctx.currentTime + releaseAt);
    gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + playbackDurationSeconds);

    memoryColorChain.output.connect(lowpass);
    lowpass.connect(shelf);
    shelf.connect(crush);
    crush.connect(gain);
    gain.connect(ctx.destination);

    lfo.start();

    return new Promise((resolve, reject) => {
      src.onended = async () => {
        try { lfo.stop(); } catch (err) {}
        try { lfo.disconnect(); } catch (err) {}
        try { lfoGain.disconnect(); } catch (err) {}
        try { crush.disconnect(); } catch (err) {}
        try { shelf.disconnect(); } catch (err) {}
        try { lowpass.disconnect(); } catch (err) {}
        try { gain.disconnect(); } catch (err) {}
        try { memoryColorChain.dispose(); } catch (err) {}
        await ctx.close();
        resolve();
      };
      try {
        src.start(0, playbackStartSeconds, playbackDurationSeconds);
      } catch (err) {
        reject(err);
      }
    });
  }

  function getBufferPeak(buffer) {
    let peak = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < data.length; i += 1) {
        peak = Math.max(peak, Math.abs(data[i]));
      }
    }
    return peak;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function smoothstep(value) {
    return value * value * (3 - 2 * value);
  }

  global.MemoryEngineKioskAudio = {
    encodeWavMono16,
    ensureWorkletModule,
    mergeBuffers,
    normalizeMemoryColorProfile,
    memoryColorSeedForBuffer,
    playMonitorCheckTone,
    playUrlWithLightChain,
    processRecordingSamples,
    renderMemoryColorPreviewBlob,
    MEMORY_COLOR_PROFILE_ORDER,
  };
}(window));
