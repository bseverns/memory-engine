(function initMemoryEngineKioskAudio(global) {
  const WORKLET_MODULE_URL = "/static/engine/kiosk-audio-worklets.js";
  const workletLoads = new WeakMap();

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

  const MEMORY_COLOR_PROFILE_ORDER = ["clear", "warm", "radio", "dream"];

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

  function normalizeMemoryColorProfile(profile, fallback = "") {
    const normalized = String(profile || "").trim().toLowerCase();
    if (MEMORY_COLOR_PROFILE_ORDER.includes(normalized)) {
      return normalized;
    }
    return String(fallback || "").trim().toLowerCase();
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

  function createDreamImpulseResponse(ctx, seconds = 1.2, decay = 3.0) {
    const length = Math.max(1, Math.round(ctx.sampleRate * seconds));
    const channels = Math.max(1, ctx.destination?.channelCount || 1);
    const impulse = ctx.createBuffer(channels, length, ctx.sampleRate);
    for (let channel = 0; channel < channels; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let index = 0; index < length; index += 1) {
        const fade = Math.pow(1 - (index / length), decay);
        data[index] = ((Math.random() * 2) - 1) * fade * 0.28;
      }
    }
    return impulse;
  }

  function buildMemoryColorChain(ctx, sourceNode, profile) {
    const normalized = normalizeMemoryColorProfile(profile);
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

    let output = sourceNode;

    if (normalized === "clear") {
      const highpass = track(ctx.createBiquadFilter());
      highpass.type = "highpass";
      highpass.frequency.value = 72;
      highpass.Q.value = 0.66;

      const presence = track(ctx.createBiquadFilter());
      presence.type = "peaking";
      presence.frequency.value = 2100;
      presence.Q.value = 0.8;
      presence.gain.value = 1.6;

      const air = track(ctx.createBiquadFilter());
      air.type = "highshelf";
      air.frequency.value = 5600;
      air.gain.value = 1.4;

      const outputGain = track(ctx.createGain());
      outputGain.gain.value = 0.98;

      sourceNode.connect(highpass);
      highpass.connect(presence);
      presence.connect(air);
      air.connect(outputGain);
      output = outputGain;
    } else if (normalized === "warm") {
      const lowshelf = track(ctx.createBiquadFilter());
      lowshelf.type = "lowshelf";
      lowshelf.frequency.value = 220;
      lowshelf.gain.value = 4.6;

      const lowpass = track(ctx.createBiquadFilter());
      lowpass.type = "lowpass";
      lowpass.frequency.value = 7600;
      lowpass.Q.value = 0.62;

      const highshelf = track(ctx.createBiquadFilter());
      highshelf.type = "highshelf";
      highshelf.frequency.value = 4200;
      highshelf.gain.value = -2.8;

      const compressor = track(ctx.createDynamicsCompressor());
      compressor.threshold.value = -20;
      compressor.knee.value = 18;
      compressor.ratio.value = 2.1;
      compressor.attack.value = 0.01;
      compressor.release.value = 0.18;

      const outputGain = track(ctx.createGain());
      outputGain.gain.value = 1.02;

      sourceNode.connect(lowshelf);
      lowshelf.connect(lowpass);
      lowpass.connect(highshelf);
      highshelf.connect(compressor);
      compressor.connect(outputGain);
      output = outputGain;
    } else if (normalized === "radio") {
      const highpass = track(ctx.createBiquadFilter());
      highpass.type = "highpass";
      highpass.frequency.value = 290;
      highpass.Q.value = 0.9;

      const lowpass = track(ctx.createBiquadFilter());
      lowpass.type = "lowpass";
      lowpass.frequency.value = 3350;
      lowpass.Q.value = 0.92;

      const mid = track(ctx.createBiquadFilter());
      mid.type = "peaking";
      mid.frequency.value = 1450;
      mid.Q.value = 1.1;
      mid.gain.value = 3.4;

      const drive = track(ctx.createWaveShaper());
      drive.curve = makeSoftClipCurve(9);
      drive.oversample = "2x";

      const outputGain = track(ctx.createGain());
      outputGain.gain.value = 0.86;

      sourceNode.connect(highpass);
      highpass.connect(lowpass);
      lowpass.connect(mid);
      mid.connect(drive);
      drive.connect(outputGain);
      output = outputGain;
    } else if (normalized === "dream") {
      const lowpass = track(ctx.createBiquadFilter());
      lowpass.type = "lowpass";
      lowpass.frequency.value = 5200;
      lowpass.Q.value = 0.5;

      const dry = track(ctx.createGain());
      dry.gain.value = 0.82;

      const wetSource = track(ctx.createGain());
      wetSource.gain.value = 0.38;

      const delay = track(ctx.createDelay(0.5));
      delay.delayTime.value = 0.18;

      const feedback = track(ctx.createGain());
      feedback.gain.value = 0.24;

      const convolver = track(ctx.createConvolver());
      convolver.buffer = createDreamImpulseResponse(ctx, 1.5, 3.2);

      const wet = track(ctx.createGain());
      wet.gain.value = 0.28;

      const outputGain = track(ctx.createGain());
      outputGain.gain.value = 0.96;

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
      output = outputGain;
    }

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
      const offlineCtx = new OfflineAudioContextCtor(
        Math.max(1, buffer.numberOfChannels),
        Math.max(1, buffer.length),
        buffer.sampleRate,
      );
      const source = offlineCtx.createBufferSource();
      source.buffer = buffer;
      const memoryColorChain = buildMemoryColorChain(offlineCtx, source, normalized);
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
      normalizeMemoryColorProfile(options.memoryColorProfile),
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
    playUrlWithLightChain,
    processRecordingSamples,
    renderMemoryColorPreviewBlob,
    MEMORY_COLOR_PROFILE_ORDER,
  };
}(window));
