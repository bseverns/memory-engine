(function initMemoryEngineKioskCapture(global) {
  function createController({ onMeterLevel, onMicLabelChange }) {
    let audioCtx = null;
    let mediaStream = null;
    let sourceNode = null;
    let analyserNode = null;
    let recorderNode = null;
    let silentGainNode = null;
    let sampleRate = 44100;
    let meterData = null;
    let meterFrame = 0;
    let micLabel = "Microphone asleep";

    function emitMeterLevel(level) {
      if (typeof onMeterLevel === "function") {
        onMeterLevel(level);
      }
    }

    function emitMicLabel(label) {
      micLabel = label;
      if (typeof onMicLabelChange === "function") {
        onMicLabelChange(label);
      }
    }

    async function ensureReady() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("This browser does not support microphone capture.");
      }

      if (mediaStream && audioCtx) {
        await audioCtx.resume();
        return;
      }

      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      audioCtx = new (global.AudioContext || global.webkitAudioContext)();
      await audioCtx.resume();
      sampleRate = audioCtx.sampleRate;

      sourceNode = audioCtx.createMediaStreamSource(mediaStream);
      analyserNode = audioCtx.createAnalyser();
      analyserNode.fftSize = 1024;
      analyserNode.smoothingTimeConstant = 0.82;
      meterData = new Uint8Array(analyserNode.fftSize);
      sourceNode.connect(analyserNode);

      const [track] = mediaStream.getAudioTracks();
      emitMicLabel(track && track.label ? track.label : "USB microphone live");
      startMeterLoop();
    }

    function startMeterLoop() {
      cancelAnimationFrame(meterFrame);

      const tick = () => {
        if (!analyserNode || !meterData) {
          emitMeterLevel(0);
          return;
        }

        analyserNode.getByteTimeDomainData(meterData);
        let sum = 0;
        for (let i = 0; i < meterData.length; i += 1) {
          const normalized = (meterData[i] - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / meterData.length);
        emitMeterLevel(Math.min(1, rms * 4.5));
        meterFrame = global.requestAnimationFrame(tick);
      };

      meterFrame = global.requestAnimationFrame(tick);
    }

    async function startRecording({ onChunk }) {
      await ensureReady();
      await global.MemoryEngineKioskAudio.ensureWorkletModule(audioCtx);

      stopRecording();

      recorderNode = new AudioWorkletNode(audioCtx, "memory-engine-recorder", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      silentGainNode = audioCtx.createGain();
      silentGainNode.gain.value = 0;

      recorderNode.port.onmessage = (event) => {
        if (typeof onChunk !== "function") return;
        onChunk(new Float32Array(event.data));
      };

      sourceNode.connect(recorderNode);
      recorderNode.connect(silentGainNode);
      silentGainNode.connect(audioCtx.destination);
    }

    function stopRecording() {
      if (recorderNode) {
        recorderNode.port.onmessage = null;
        try { sourceNode.disconnect(recorderNode); } catch (err) {}
        try { recorderNode.disconnect(); } catch (err) {}
        recorderNode = null;
      }

      if (silentGainNode) {
        try { silentGainNode.disconnect(); } catch (err) {}
        silentGainNode = null;
      }
    }

    function playPreRollTone(config, isFinalBeat) {
      if (!audioCtx) return;

      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const now = audioCtx.currentTime;
      const attackEnd = now + config.durationSeconds;
      const releaseEnd = attackEnd + config.tailSeconds;

      osc.type = isFinalBeat ? "sine" : "triangle";
      osc.frequency.setValueAtTime(
        isFinalBeat ? config.finalFrequency : config.countdownFrequency,
        now,
      );

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(config.gain, attackEnd);
      gain.gain.exponentialRampToValueAtTime(0.0001, releaseEnd);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(releaseEnd + 0.02);

      osc.onended = () => {
        try { osc.disconnect(); } catch (err) {}
        try { gain.disconnect(); } catch (err) {}
      };
    }

    async function teardown() {
      stopRecording();
      cancelAnimationFrame(meterFrame);
      meterFrame = 0;
      emitMeterLevel(0);

      if (sourceNode) {
        try { sourceNode.disconnect(); } catch (err) {}
        sourceNode = null;
      }
      if (analyserNode) {
        try { analyserNode.disconnect(); } catch (err) {}
        analyserNode = null;
      }

      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
        mediaStream = null;
      }

      if (audioCtx) {
        try {
          await audioCtx.close();
        } catch (err) {}
        audioCtx = null;
      }

      meterData = null;
      emitMicLabel("Microphone asleep");
    }

    return {
      ensureReady,
      getMicLabel() {
        return micLabel;
      },
      getSampleRate() {
        return sampleRate;
      },
      hasLiveInput() {
        return Boolean(mediaStream);
      },
      playPreRollTone,
      startRecording,
      stopRecording,
      teardown,
    };
  }

  global.MemoryEngineKioskCapture = {
    createController,
  };
}(window));
