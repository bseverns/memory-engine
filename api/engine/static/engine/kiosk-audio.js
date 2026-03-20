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

    src.connect(lowpass);
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
    playUrlWithLightChain,
    processRecordingSamples,
  };
}(window));
