(function initMemoryEngineRoomLoopTone(global) {
  const { sleep } = global.MemoryEngineRoomLoopPolicy;

  function defaultToneProfile() {
    return {
      highpassHz: 110,
      lowpassHz: 980,
      lfoHz: 0.025,
      lfoDepth: 65,
      noiseStep: 0.06,
      noiseDamping: 0.985,
    };
  }

  function selectedToneProfile(roomTone, profileName) {
    const profiles = roomTone.profiles || {};
    return profiles[profileName] || profiles.soft_air || defaultToneProfile();
  }

  function createToneEngine({ globalObject, config, roomTone }) {
    let roomToneCtx = null;
    let roomToneNoiseSource = null;
    let roomToneMasterGain = null;
    let roomToneLfo = null;
    let roomToneLfoGain = null;
    let roomToneMediaElement = null;
    let roomToneMediaSource = null;

    async function ensureRoomTone() {
      if (roomToneCtx && roomToneMasterGain) {
        await roomToneCtx.resume();
        if (roomToneMediaElement) {
          try { await roomToneMediaElement.play(); } catch (err) {}
        }
        return;
      }

      roomToneCtx = new (globalObject.AudioContext || globalObject.webkitAudioContext)();
      await roomToneCtx.resume();

      roomToneMasterGain = roomToneCtx.createGain();
      roomToneMasterGain.gain.value = 0.0001;
      roomToneMasterGain.connect(roomToneCtx.destination);

      if (config.roomToneSourceMode === "site_ambience" && config.roomToneSourceUrl) {
        roomToneMediaElement = new globalObject.Audio(config.roomToneSourceUrl);
        roomToneMediaElement.crossOrigin = "anonymous";
        roomToneMediaElement.loop = true;
        roomToneMediaElement.preload = "auto";
        roomToneMediaElement.volume = 1.0;
        roomToneMediaSource = roomToneCtx.createMediaElementSource(roomToneMediaElement);
        roomToneMediaSource.connect(roomToneMasterGain);
        await roomToneMediaElement.play();
        return;
      }

      const profile = selectedToneProfile(roomTone, config.roomToneProfile);
      const bufferSeconds = 2;
      const noiseBuffer = roomToneCtx.createBuffer(1, roomToneCtx.sampleRate * bufferSeconds, roomToneCtx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      let brown = 0;
      for (let i = 0; i < data.length; i += 1) {
        brown = (brown + (Math.random() * 2 - 1) * profile.noiseStep) * profile.noiseDamping;
        data[i] = brown;
      }

      roomToneNoiseSource = roomToneCtx.createBufferSource();
      roomToneNoiseSource.buffer = noiseBuffer;
      roomToneNoiseSource.loop = true;

      const highpass = roomToneCtx.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = profile.highpassHz;

      const lowpass = roomToneCtx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = profile.lowpassHz;
      lowpass.Q.value = 0.4;

      roomToneLfo = roomToneCtx.createOscillator();
      roomToneLfo.type = "sine";
      roomToneLfo.frequency.value = profile.lfoHz;

      roomToneLfoGain = roomToneCtx.createGain();
      roomToneLfoGain.gain.value = profile.lfoDepth;
      roomToneLfo.connect(roomToneLfoGain);
      roomToneLfoGain.connect(lowpass.frequency);

      roomToneNoiseSource.connect(highpass);
      highpass.connect(lowpass);
      lowpass.connect(roomToneMasterGain);

      roomToneNoiseSource.start();
      roomToneLfo.start();
    }

    function setRoomToneLevel(level, seconds) {
      const fadeSeconds = seconds === undefined ? roomTone.fadeSeconds : seconds;
      if (!roomToneCtx || !roomToneMasterGain) return;
      const now = roomToneCtx.currentTime;
      roomToneMasterGain.gain.cancelScheduledValues(now);
      roomToneMasterGain.gain.setValueAtTime(roomToneMasterGain.gain.value, now);
      roomToneMasterGain.gain.linearRampToValueAtTime(level, now + fadeSeconds);
    }

    async function stopRoomTone() {
      if (!roomToneCtx) return;

      try {
        setRoomToneLevel(0.0001, 0.6);
        await sleep(650);
      } catch (err) {}

      try { roomToneMediaElement?.pause(); } catch (err) {}
      try { roomToneNoiseSource?.stop(); } catch (err) {}
      try { roomToneLfo?.stop(); } catch (err) {}
      try { roomToneNoiseSource?.disconnect(); } catch (err) {}
      try { roomToneMediaSource?.disconnect(); } catch (err) {}
      try { roomToneLfo?.disconnect(); } catch (err) {}
      try { roomToneLfoGain?.disconnect(); } catch (err) {}
      try { roomToneMasterGain?.disconnect(); } catch (err) {}
      try { await roomToneCtx.close(); } catch (err) {}

      roomToneCtx = null;
      roomToneNoiseSource = null;
      roomToneMasterGain = null;
      roomToneLfo = null;
      roomToneLfoGain = null;
      roomToneMediaElement = null;
      roomToneMediaSource = null;
    }

    return {
      ensureRoomTone,
      setRoomToneLevel,
      stopRoomTone,
    };
  }

  global.MemoryEngineRoomLoopTone = {
    createToneEngine,
  };
}(typeof window !== "undefined" ? window : globalThis));
