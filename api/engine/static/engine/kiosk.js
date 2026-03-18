/**
 * Guided kiosk flow
 * - Explicit microphone states: idle -> armed -> recording -> review -> done
 * - Large on-screen prompts + keyboard shortcuts for kiosk deployment
 * - Recording/upload endpoints remain unchanged
 */

const FLOW = {
  IDLE: "idle",
  ARMING: "arming",
  ARMED: "armed",
  COUNTDOWN: "countdown",
  RECORDING: "recording",
  REVIEW: "review",
  SUBMITTING: "submitting",
  COMPLETE: "complete",
  ERROR: "error",
};

const MODE_COPY = {
  ROOM: {
    name: "Room Memory",
    submitLabel: "Save to room memory",
    reviewCopy: "Stored on this device for about 48 hours and replayed in the room with gentle wear over time.",
    completeTitle: "Saved to this room.",
    completeStatus: "Saved locally.",
  },
  FOSSIL: {
    name: "Fossil Only",
    submitLabel: "Save as a fossil",
    reviewCopy: "The raw recording expires in about 48 hours. A spectrogram image may remain locally for longer.",
    completeTitle: "Saved as a local fossil.",
    completeStatus: "Saved locally as a fossil.",
  },
  NOSAVE: {
    name: "Don't Save",
    submitLabel: "Play once, then discard",
    reviewCopy: "The recording will play once immediately and then be discarded.",
    completeTitle: "Played once and discarded.",
    completeStatus: "Discarded after playback.",
  },
};

const btnPrimary = document.getElementById("btnPrimary");
const btnSecondary = document.getElementById("btnSecondary");
const btnSubmit = document.getElementById("btnSubmit");
const btnLoop = document.getElementById("btnLoop");
const btnLoopStop = document.getElementById("btnLoopStop");

const stageBadge = document.getElementById("stageBadge");
const stageTitle = document.getElementById("stageTitle");
const stageCopy = document.getElementById("stageCopy");
const shortcutHint = document.getElementById("shortcutHint");
const micStatus = document.getElementById("micStatus");
const micCheckStatus = document.getElementById("micCheckStatus");
const recStatus = document.getElementById("recStatus");
const recTimer = document.getElementById("recTimer");
const remainingTimer = document.getElementById("remainingTimer");
const maxDurationHint = document.getElementById("maxDurationHint");
const meterText = document.getElementById("meterText");
const meterFill = document.getElementById("meterFill");
const submitStatus = document.getElementById("submitStatus");
const selectionHint = document.getElementById("selectionHint");
const receipt = document.getElementById("receipt");
const preview = document.getElementById("preview");
const loopStatus = document.getElementById("loopStatus");
const modePanel = document.getElementById("modePanel");
const countdownOverlay = document.getElementById("countdownOverlay");
const countdownValue = document.getElementById("countdownValue");
const countdownLabel = document.getElementById("countdownLabel");
const stepEls = Array.from(document.querySelectorAll(".step"));
const choices = Array.from(document.querySelectorAll(".choice"));

let flowState = FLOW.IDLE;
let primaryAction = null;
let secondaryAction = null;
let lastErrorMessage = "";
let micLabel = "Microphone asleep";

let selectedMode = null;
let wavBlob = null;
let durationMs = 0;
let previewUrl = "";

let audioCtx = null;
let mediaStream = null;
let sourceNode = null;
let analyserNode = null;
let procNode = null;
let silentGainNode = null;
let buffers = [];
let sampleRate = 44100;
let recStartTs = 0;
let meterData = null;
let meterFrame = 0;
let timerInterval = 0;
let countdownToken = 0;

let loopRunning = false;
let loopScene = null;
let loopSceneCueIndex = 0;
let loopMovement = null;
let loopMovementIndex = 0;
let loopMovementBudget = 0;
let loopMovementProgress = 0;
let loopHistory = [];
let roomToneCtx = null;
let roomToneNoiseSource = null;
let roomToneMasterGain = null;
let roomToneLfo = null;
let roomToneLfoGain = null;
const PRE_ROLL_SECONDS = 3;
const MAX_RECORDING_MS = 120000;
const MIC_SIGNAL_THRESHOLD = 0.07;

const RECORDING_PROCESSING = {
  trimThreshold: 0.014,
  edgePaddingMs: 120,
  minContentMs: 700,
  targetPeak: 0.92,
  maxGain: 3.2,
  fadeMs: 16,
};

const PRE_ROLL_TONE = {
  gain: 0.04,
  durationSeconds: 0.12,
  tailSeconds: 0.18,
  countdownFrequency: 523.25,
  finalFrequency: 659.25,
};

const PLAYBACK_SMOOTHING = {
  targetPeak: 0.9,
  minGain: 0.85,
  maxGain: 2.1,
  fadeInSeconds: 0.12,
  fadeOutSeconds: 0.35,
  betweenLoopItemsMs: 900,
};

// These scene templates are the browser-side "room composer." They do not pick
// specific artifacts; they ask the backend for a kind of memory, then shape the
// pacing with pauses and lane shifts.
const ROOM_SCENES = [
  {
    name: "clearings",
    movements: ["arrival", "release"],
    moods: ["clear", "hushed"],
    cues: [
      { lane: "fresh", density: "light", mood: "clear", gapMs: 950 },
      { lane: "fresh", density: "medium", mood: "clear", gapMs: 1600 },
      { pauseMs: 2600, toneLevel: "sparse" },
    ],
  },
  {
    name: "weathered cluster",
    movements: ["weathering"],
    moods: ["weathered", "suspended"],
    cues: [
      { lane: "worn", density: "medium", mood: "weathered", gapMs: 1600 },
      { lane: "worn", density: "dense", mood: "weathered", gapMs: 2500 },
      { pauseMs: 3600, toneLevel: "sparse" },
    ],
  },
  {
    name: "suspension",
    movements: ["arrival", "weathering"],
    moods: ["suspended", "hushed"],
    cues: [
      { lane: "mid", density: "medium", mood: "suspended", gapMs: 1850 },
      { pauseMs: 2200, toneLevel: "idle" },
      { lane: "worn", density: "light", mood: "hushed", gapMs: 2100 },
    ],
  },
  {
    name: "gathering",
    movements: ["gathering"],
    moods: ["gathering", "clear", "suspended"],
    cues: [
      { lane: "fresh", density: "medium", mood: "clear", gapMs: 1050 },
      { lane: "any", density: "dense", mood: "gathering", gapMs: 1550 },
      { lane: "mid", density: "medium", mood: "suspended", gapMs: 2200 },
    ],
  },
  {
    name: "hushed drift",
    movements: ["arrival", "release"],
    moods: ["hushed", "clear"],
    cues: [
      { lane: "mid", density: "light", mood: "hushed", gapMs: 1200 },
      { pauseMs: 2800, toneLevel: "sparse" },
      { lane: "fresh", density: "light", mood: "clear", gapMs: 1700 },
    ],
  },
  {
    name: "afterimage",
    movements: ["weathering", "release"],
    moods: ["weathered", "hushed", "suspended"],
    cues: [
      { lane: "worn", density: "light", mood: "weathered", gapMs: 1700 },
      { lane: "mid", density: "medium", mood: "suspended", gapMs: 2500 },
      { pauseMs: 3400, toneLevel: "sparse" },
    ],
  },
];

// Movements are the longer-form pacing arc above the per-scene logic. The loop
// spends a few memories in one movement before shifting, which lets the room
// gather, weather, and release over a longer span.
const ROOM_MOVEMENTS = [
  {
    name: "arrival",
    minItems: 2,
    maxItems: 3,
    gapMultiplier: 1.15,
    preferredMoods: ["clear", "hushed", "suspended"],
    sceneNames: ["clearings", "hushed drift", "suspension"],
  },
  {
    name: "gathering",
    minItems: 3,
    maxItems: 4,
    gapMultiplier: 0.82,
    preferredMoods: ["gathering", "clear", "suspended"],
    sceneNames: ["gathering", "suspension"],
  },
  {
    name: "weathering",
    minItems: 2,
    maxItems: 4,
    gapMultiplier: 1.12,
    preferredMoods: ["weathered", "suspended", "hushed"],
    sceneNames: ["weathered cluster", "afterimage", "suspension"],
  },
  {
    name: "release",
    minItems: 2,
    maxItems: 3,
    gapMultiplier: 1.28,
    preferredMoods: ["hushed", "clear", "weathered"],
    sceneNames: ["clearings", "hushed drift", "afterimage"],
  },
];

const ROOM_TONE = {
  idleGain: 0.011,
  sparseGain: 0.017,
  duckGain: 0.002,
  fadeSeconds: 1.25,
};

function setFlowState(nextState, options = {}) {
  flowState = nextState;
  if (options.errorMessage !== undefined) {
    lastErrorMessage = options.errorMessage;
  }
  render();
}

function render() {
  document.body.dataset.state = flowState;
  countdownOverlay.hidden = flowState !== FLOW.COUNTDOWN;
  updateStepper();
  updateModePanel();
  updateButtons();
  updateStage();
}

function updateStepper() {
  const activeIndex = flowStateToStepIndex(flowState);
  stepEls.forEach((stepEl, index) => {
    stepEl.classList.toggle("active", index === activeIndex);
    stepEl.classList.toggle("completed", index < activeIndex);
  });
}

function flowStateToStepIndex(state) {
  if ([FLOW.IDLE, FLOW.ARMING, FLOW.ARMED, FLOW.ERROR].includes(state)) return 0;
  if ([FLOW.COUNTDOWN, FLOW.RECORDING].includes(state)) return 1;
  if ([FLOW.REVIEW, FLOW.SUBMITTING].includes(state)) return 2;
  return 3;
}

function updateModePanel() {
  const visible = [FLOW.REVIEW, FLOW.SUBMITTING, FLOW.COMPLETE].includes(flowState);
  const interactive = flowState === FLOW.REVIEW;
  modePanel.classList.toggle("locked", !interactive);
  choices.forEach((choice) => {
    choice.disabled = !interactive;
  });

  if (!visible) {
    selectionHint.textContent = "Unlocked after recording";
  } else if (flowState === FLOW.COMPLETE && selectedMode) {
    selectionHint.textContent = `Completed: ${MODE_COPY[selectedMode].name}`;
  } else if (!selectedMode) {
    selectionHint.textContent = "Press 1, 2, or 3 to choose";
  } else {
    selectionHint.textContent = `Selected: ${MODE_COPY[selectedMode].name}`;
  }

  const canSubmit = flowState === FLOW.REVIEW && !!wavBlob && !!selectedMode;
  btnSubmit.disabled = !canSubmit;
  btnSubmit.textContent = selectedMode ? MODE_COPY[selectedMode].submitLabel : "Submit selection";
}

function updateButtons() {
  let primaryLabel = "Arm microphone";
  let primaryDisabled = false;
  let secondaryLabel = "Start over";
  let secondaryDisabled = true;

  primaryAction = armMicrophone;
  secondaryAction = startFreshSession;

  if (flowState === FLOW.ARMING) {
    primaryLabel = "Arming microphone";
    primaryDisabled = true;
    secondaryLabel = "Please wait";
    secondaryDisabled = true;
  } else if (flowState === FLOW.ARMED) {
    primaryLabel = "Start recording";
    primaryAction = startRecording;
    secondaryLabel = "Disarm microphone";
    secondaryAction = disarmToIdle;
    secondaryDisabled = false;
  } else if (flowState === FLOW.COUNTDOWN) {
    primaryLabel = "Starting soon";
    primaryDisabled = true;
    secondaryLabel = "Cancel countdown";
    secondaryAction = cancelCountdown;
    secondaryDisabled = false;
  } else if (flowState === FLOW.RECORDING) {
    primaryLabel = "Stop recording";
    primaryAction = stopRecording;
    secondaryLabel = "Cancel take";
    secondaryAction = cancelCurrentTake;
    secondaryDisabled = false;
  } else if (flowState === FLOW.REVIEW) {
    primaryLabel = selectedMode ? MODE_COPY[selectedMode].submitLabel : "Choose a memory mode";
    primaryAction = submitCurrentTake;
    primaryDisabled = !selectedMode || !wavBlob;
    secondaryLabel = "Record again";
    secondaryAction = recordAgain;
    secondaryDisabled = false;
  } else if (flowState === FLOW.SUBMITTING) {
    primaryLabel = "Submitting";
    primaryDisabled = true;
    secondaryLabel = "Please wait";
    secondaryDisabled = true;
  } else if (flowState === FLOW.COMPLETE) {
    primaryLabel = "Start another recording";
    primaryAction = startFreshSession;
    secondaryLabel = "Start over";
    secondaryDisabled = true;
  } else if (flowState === FLOW.ERROR) {
    primaryLabel = "Try microphone again";
    primaryAction = armMicrophone;
    secondaryLabel = "Start over";
    secondaryAction = startFreshSession;
    secondaryDisabled = false;
  }

  btnPrimary.textContent = primaryLabel;
  btnPrimary.disabled = primaryDisabled;
  btnSecondary.textContent = secondaryLabel;
  btnSecondary.disabled = secondaryDisabled;
}

function updateStage() {
  const hasMic = !!mediaStream;
  const elapsedMs = flowState === FLOW.RECORDING ? (performance.now() - recStartTs) : durationMs;
  const remainingMs = flowState === FLOW.RECORDING
    ? Math.max(0, MAX_RECORDING_MS - elapsedMs)
    : Math.max(0, MAX_RECORDING_MS - durationMs);
  recTimer.textContent = formatDuration(elapsedMs);
  remainingTimer.textContent = formatDuration(remainingMs);
  maxDurationHint.textContent = `Max ${formatDuration(MAX_RECORDING_MS)}`;

  if (flowState === FLOW.IDLE) {
    stageBadge.textContent = "Not armed";
    stageTitle.textContent = "Settle in before you begin.";
    stageCopy.textContent = "Arm the microphone when you are ready. Once it is live, you can check the level meter, take a breath, and begin when it feels right.";
    micStatus.textContent = "Microphone asleep";
    recStatus.textContent = "Microphone not armed";
    shortcutHint.textContent = "Space or Enter: arm microphone";
    meterText.textContent = "Waiting for microphone";
    setMicCheckStatus("Mic check unavailable", "quiet");
    setMeterLevel(0);
  } else if (flowState === FLOW.ARMING) {
    stageBadge.textContent = "Arming";
    stageTitle.textContent = "Allow the microphone, then get comfortable.";
    stageCopy.textContent = "The kiosk will stay quiet and wait for you. Recording does not begin until you choose to start.";
    micStatus.textContent = "Requesting microphone access";
    recStatus.textContent = "Waiting for microphone access";
    shortcutHint.textContent = "Microphone request in progress";
    meterText.textContent = "Requesting access";
    setMicCheckStatus("Mic check starting up", "quiet");
  } else if (flowState === FLOW.ARMED) {
    stageBadge.textContent = "Ready";
    stageTitle.textContent = "You are armed, but not recording yet.";
    stageCopy.textContent = "Watch the level meter to confirm the USB microphone is live. When you feel settled, start the recording.";
    micStatus.textContent = micLabel;
    recStatus.textContent = "Standing by";
    shortcutHint.textContent = "Space or Enter: start recording";
    meterText.textContent = hasMic ? "Listening for room sound" : "Microphone unavailable";
  } else if (flowState === FLOW.COUNTDOWN) {
    stageBadge.textContent = "Get ready";
    stageTitle.textContent = "Take a breath. Recording starts in a moment.";
    stageCopy.textContent = "The microphone is live, but capture has not started yet. Let the countdown finish or cancel it if you want to reset.";
    micStatus.textContent = micLabel;
    recStatus.textContent = "Countdown in progress";
    shortcutHint.textContent = "Escape: cancel countdown";
    meterText.textContent = "Listening for room sound";
  } else if (flowState === FLOW.RECORDING) {
    stageBadge.textContent = "Recording";
    stageTitle.textContent = "Speak when you are ready.";
    stageCopy.textContent = "Press Space, Enter, or Stop when you want to finish. The take stops automatically when the remaining timer reaches zero.";
    micStatus.textContent = micLabel;
    recStatus.textContent = "Recording in progress";
    shortcutHint.textContent = "Space or Enter: stop recording";
    meterText.textContent = "Live microphone signal";
  } else if (flowState === FLOW.REVIEW) {
    stageBadge.textContent = "Review";
    stageTitle.textContent = selectedMode ? `Ready to ${MODE_COPY[selectedMode].submitLabel.toLowerCase()}.` : "Listen back, then choose what happens next.";
    stageCopy.textContent = selectedMode
      ? MODE_COPY[selectedMode].reviewCopy
      : "Use the audio preview if you want. Then choose 1, 2, or 3 to decide how the room should remember this take.";
    micStatus.textContent = mediaStream ? micLabel : "Microphone asleep";
    recStatus.textContent = wavBlob ? "Take captured" : "No take captured";
    shortcutHint.textContent = selectedMode ? "Space or Enter: submit selection" : "Press 1, 2, or 3 to choose a memory mode";
    meterText.textContent = mediaStream ? "Microphone still armed" : "Microphone asleep";
    setMicCheckStatus(mediaStream ? "Mic check complete" : "Mic check asleep", mediaStream ? "good" : "quiet");
  } else if (flowState === FLOW.SUBMITTING) {
    stageBadge.textContent = "Saving";
    stageTitle.textContent = "Please hold on for a moment.";
    stageCopy.textContent = "The kiosk is finishing this session and will show a receipt if there is one to keep.";
    micStatus.textContent = "Microphone asleep";
    recStatus.textContent = "Submitting";
    shortcutHint.textContent = "Submitting current take";
    meterText.textContent = "Microphone asleep";
    setMicCheckStatus("Mic check asleep", "quiet");
    setMeterLevel(0);
  } else if (flowState === FLOW.COMPLETE) {
    stageBadge.textContent = "Finished";
    stageTitle.textContent = selectedMode ? MODE_COPY[selectedMode].completeTitle : "Session complete.";
    stageCopy.textContent = "The microphone is asleep again. Start another recording whenever the next person is ready.";
    micStatus.textContent = "Microphone asleep";
    recStatus.textContent = "Session complete";
    shortcutHint.textContent = "Space or Enter: start another recording";
    meterText.textContent = "Microphone asleep";
    setMicCheckStatus("Mic check asleep", "quiet");
    setMeterLevel(0);
  } else if (flowState === FLOW.ERROR) {
    stageBadge.textContent = "Microphone issue";
    stageTitle.textContent = "The kiosk could not reach the microphone.";
    stageCopy.textContent = lastErrorMessage || "Check that the USB microphone is connected, then try again.";
    micStatus.textContent = "Microphone unavailable";
    recStatus.textContent = "Microphone error";
    shortcutHint.textContent = "Space or Enter: try again";
    meterText.textContent = "Microphone unavailable";
    setMicCheckStatus("Mic check unavailable", "quiet");
    setMeterLevel(0);
  }
}

function setMeterLevel(level) {
  meterFill.style.width = `${Math.max(0, Math.min(100, level * 100))}%`;
}

function setMicCheckStatus(text, tone) {
  micCheckStatus.textContent = text;
  micCheckStatus.classList.remove("good", "quiet");
  micCheckStatus.classList.add(tone === "good" ? "good" : "quiet");
}

function setReceiptText(text) {
  receipt.textContent = text;
  receipt.classList.add("muted");
}

function setReceiptHtml(html) {
  receipt.innerHTML = html;
  receipt.classList.remove("muted");
}

function clearPreview() {
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = "";
  }
  preview.pause();
  preview.removeAttribute("src");
  preview.load();
  preview.hidden = true;
}

function clearTakeData({ clearReceipt = true } = {}) {
  wavBlob = null;
  durationMs = 0;
  buffers = [];
  clearPreview();
  submitStatus.textContent = "";
  if (clearReceipt) {
    setReceiptText("No receipt yet.");
  }
  selectedMode = null;
  choices.forEach((choice) => choice.classList.remove("selected"));
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

async function armMicrophone() {
  if (flowState === FLOW.ARMING || flowState === FLOW.RECORDING || flowState === FLOW.SUBMITTING) return;

  stopLoopPlayback("Room loop paused for recording.");
  clearTakeData();
  setFlowState(FLOW.ARMING, { errorMessage: "" });

  try {
    await ensureMicrophoneReady();
    setFlowState(FLOW.ARMED);
  } catch (err) {
    await teardownMicrophone();
    setFlowState(FLOW.ERROR, { errorMessage: describeMicError(err) });
  }
}

async function ensureMicrophoneReady() {
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

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  await audioCtx.resume();

  sampleRate = audioCtx.sampleRate;
  sourceNode = audioCtx.createMediaStreamSource(mediaStream);
  analyserNode = audioCtx.createAnalyser();
  analyserNode.fftSize = 1024;
  analyserNode.smoothingTimeConstant = 0.82;
  meterData = new Uint8Array(analyserNode.fftSize);

  sourceNode.connect(analyserNode);

  const [track] = mediaStream.getAudioTracks();
  micLabel = track && track.label ? track.label : "USB microphone live";
  startMeterLoop();
}

function startMeterLoop() {
  cancelAnimationFrame(meterFrame);

  const tick = () => {
    if (!analyserNode || !meterData) {
      setMeterLevel(0);
      return;
    }

    analyserNode.getByteTimeDomainData(meterData);
    let sum = 0;
    for (let i = 0; i < meterData.length; i += 1) {
      const normalized = (meterData[i] - 128) / 128;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / meterData.length);
    const boosted = Math.min(1, rms * 4.5);
    setMeterLevel(boosted);

    if (flowState === FLOW.ARMED) {
      meterText.textContent = boosted > MIC_SIGNAL_THRESHOLD ? "Signal detected" : "Waiting for a voice";
      setMicCheckStatus(
        boosted > MIC_SIGNAL_THRESHOLD ? "Mic check: we hear you" : "Mic check: speak a little louder",
        boosted > MIC_SIGNAL_THRESHOLD ? "good" : "quiet",
      );
    } else if (flowState === FLOW.COUNTDOWN) {
      meterText.textContent = boosted > MIC_SIGNAL_THRESHOLD ? "Signal detected" : "Listening closely";
      setMicCheckStatus(
        boosted > MIC_SIGNAL_THRESHOLD ? "Mic check: we hear you" : "Mic check: speak a little louder",
        boosted > MIC_SIGNAL_THRESHOLD ? "good" : "quiet",
      );
    } else if (flowState === FLOW.RECORDING) {
      meterText.textContent = boosted > MIC_SIGNAL_THRESHOLD ? "Recording signal" : "Listening closely";
      setMicCheckStatus(
        boosted > MIC_SIGNAL_THRESHOLD ? "Mic check: signal is healthy" : "Mic check: very quiet input",
        boosted > MIC_SIGNAL_THRESHOLD ? "good" : "quiet",
      );
    }

    meterFrame = window.requestAnimationFrame(tick);
  };

  meterFrame = window.requestAnimationFrame(tick);
}

async function startRecording() {
  if (flowState !== FLOW.ARMED) return;

  await ensureMicrophoneReady();
  startCountdown();
}

function startCountdown() {
  countdownToken += 1;
  const localToken = countdownToken;
  setFlowState(FLOW.COUNTDOWN);
  countdownValue.textContent = String(PRE_ROLL_SECONDS);
  countdownLabel.textContent = "Recording starts in a moment.";

  const tick = (secondsLeft) => {
    if (localToken !== countdownToken || flowState !== FLOW.COUNTDOWN) return;
    countdownValue.textContent = String(secondsLeft);
    countdownLabel.textContent = secondsLeft > 1
      ? "Recording starts in a moment."
      : "Recording starts now.";
    playPreRollTone(secondsLeft <= 1);

    if (secondsLeft <= 1) {
      beginRecordingCapture();
      return;
    }

    window.setTimeout(() => tick(secondsLeft - 1), 1000);
  };

  clearTakeData();
  window.setTimeout(() => tick(PRE_ROLL_SECONDS), 0);
}

function playPreRollTone(isFinalBeat = false) {
  if (!audioCtx) return;

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const now = audioCtx.currentTime;
  const attackEnd = now + PRE_ROLL_TONE.durationSeconds;
  const releaseEnd = attackEnd + PRE_ROLL_TONE.tailSeconds;

  osc.type = isFinalBeat ? "sine" : "triangle";
  osc.frequency.setValueAtTime(
    isFinalBeat ? PRE_ROLL_TONE.finalFrequency : PRE_ROLL_TONE.countdownFrequency,
    now,
  );

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(PRE_ROLL_TONE.gain, attackEnd);
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

function beginRecordingCapture() {
  if (flowState !== FLOW.COUNTDOWN) return;

  submitStatus.textContent = "";
  buffers = [];
  recStartTs = performance.now();

  procNode = audioCtx.createScriptProcessor(4096, 1, 1);
  silentGainNode = audioCtx.createGain();
  silentGainNode.gain.value = 0;

  sourceNode.connect(procNode);
  procNode.connect(silentGainNode);
  silentGainNode.connect(audioCtx.destination);

  procNode.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    buffers.push(new Float32Array(input));
  };

  window.clearInterval(timerInterval);
  timerInterval = window.setInterval(() => {
    const elapsed = performance.now() - recStartTs;
    recTimer.textContent = formatDuration(elapsed);
    remainingTimer.textContent = formatDuration(Math.max(0, MAX_RECORDING_MS - elapsed));
    if (elapsed >= MAX_RECORDING_MS) {
      stopRecording();
    }
  }, 150);

  setFlowState(FLOW.RECORDING);
}

function cancelCountdown() {
  if (flowState !== FLOW.COUNTDOWN) return;
  countdownToken += 1;
  setFlowState(FLOW.ARMED);
}

function stopRecording() {
  if (flowState !== FLOW.RECORDING || !audioCtx) return;

  stopRecordingNodes();

  const rawData = mergeBuffers(buffers);
  const processed = processRecordingSamples(rawData, sampleRate);

  durationMs = Math.round((processed.samples.length / sampleRate) * 1000);
  wavBlob = encodeWavMono16(processed.samples, sampleRate);
  previewUrl = URL.createObjectURL(wavBlob);
  preview.src = previewUrl;
  preview.hidden = false;
  submitStatus.textContent = processed.note;

  setFlowState(FLOW.REVIEW);
}

function cancelCurrentTake() {
  if (flowState !== FLOW.RECORDING) return;
  stopRecordingNodes();
  clearTakeData({ clearReceipt: false });
  submitStatus.textContent = "Take discarded. The microphone is still armed.";
  setFlowState(FLOW.ARMED);
}

async function recordAgain() {
  clearTakeData();
  if (mediaStream) {
    setFlowState(FLOW.ARMED);
    return;
  }
  await armMicrophone();
}

async function submitCurrentTake() {
  if (!wavBlob || !selectedMode || flowState !== FLOW.REVIEW) {
    return;
  }

  submitStatus.textContent = "Submitting...";
  setFlowState(FLOW.SUBMITTING);
  await teardownMicrophone();

  try {
    if (selectedMode === "NOSAVE") {
      await submitNoSave();
    } else {
      await submitSave(selectedMode);
    }
    setFlowState(FLOW.COMPLETE);
  } catch (err) {
    submitStatus.textContent = describeSubmitError(err);
    setFlowState(FLOW.REVIEW);
  }
}

async function submitSave(mode) {
  const form = new FormData();
  form.append("file", wavBlob, "audio.wav");
  form.append("consent_mode", mode);
  form.append("duration_ms", String(durationMs));

  const res = await fetch("/api/v1/artifacts/audio", { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(`Save failed (${res.status})`);
  }

  const payload = await res.json();
  submitStatus.textContent = MODE_COPY[mode].completeStatus;
  setReceiptHtml(`
    <div><strong>Revocation code</strong><span class="token">${payload.revocation_token}</span></div>
    <div class="muted">Keep this code. A steward can revoke it later on this node.</div>
    <div class="muted">Raw expires at: ${new Date(payload.artifact.expires_at).toLocaleString()}</div>
  `);
}

async function submitNoSave() {
  const form = new FormData();
  form.append("file", wavBlob, "audio.wav");
  form.append("duration_ms", String(durationMs));

  const res = await fetch("/api/v1/ephemeral/audio", { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(`Playback failed (${res.status})`);
  }

  const payload = await res.json();
  submitStatus.textContent = "Playing once, then discarding.";
  setReceiptText("This recording is being played once and then removed from the device.");

  await playUrlWithLightChain(payload.play_url, 0.0);

  const consumeRes = await fetch("/api/v1/ephemeral/consume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      artifact_id: payload.artifact_id,
      consume_token: payload.consume_token,
    }),
  });
  if (!consumeRes.ok) {
    throw new Error(`Discard failed (${consumeRes.status})`);
  }

  submitStatus.textContent = MODE_COPY.NOSAVE.completeStatus;
}

async function disarmToIdle() {
  countdownToken += 1;
  await teardownMicrophone();
  clearTakeData();
  setFlowState(FLOW.IDLE, { errorMessage: "" });
}

async function startFreshSession() {
  countdownToken += 1;
  stopLoopPlayback();
  await teardownMicrophone();
  clearTakeData();
  setFlowState(FLOW.IDLE, { errorMessage: "" });
}

function selectMode(mode) {
  if (![FLOW.REVIEW, FLOW.SUBMITTING, FLOW.COMPLETE].includes(flowState)) return;
  if (!(mode in MODE_COPY) || flowState === FLOW.SUBMITTING) return;

  selectedMode = mode;
  choices.forEach((choice) => {
    choice.classList.toggle("selected", choice.dataset.mode === mode);
  });

  if (flowState === FLOW.REVIEW) {
    submitStatus.textContent = `${MODE_COPY[mode].name} selected.`;
  }
  render();
}

function stopRecordingNodes() {
  window.clearInterval(timerInterval);
  timerInterval = 0;

  if (procNode) {
    procNode.onaudioprocess = null;
    try { sourceNode.disconnect(procNode); } catch (err) {}
    try { procNode.disconnect(); } catch (err) {}
    procNode = null;
  }

  if (silentGainNode) {
    try { silentGainNode.disconnect(); } catch (err) {}
    silentGainNode = null;
  }
}

async function teardownMicrophone() {
  stopRecordingNodes();
  cancelAnimationFrame(meterFrame);
  meterFrame = 0;
  setMeterLevel(0);

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
  micLabel = "Microphone asleep";
}

function describeMicError(err) {
  if (!err || !err.name) return "Check that the USB microphone is connected, then try again.";
  if (err.name === "NotAllowedError") return "Browser access to the microphone was denied. Allow it and try again.";
  if (err.name === "NotFoundError") return "No microphone was found. Check the USB microphone connection.";
  if (err.name === "NotReadableError") return "The microphone is busy or unavailable. Reconnect it and try again.";
  return err.message || "Check that the USB microphone is connected, then try again.";
}

function describeSubmitError(err) {
  return err && err.message ? err.message : "Something went wrong while submitting the take.";
}

btnPrimary.addEventListener("click", () => runAction(primaryAction));
btnSecondary.addEventListener("click", () => runAction(secondaryAction));
btnSubmit.addEventListener("click", () => runAction(submitCurrentTake));

choices.forEach((choice) => {
  choice.addEventListener("click", () => selectMode(choice.dataset.mode));
});

document.addEventListener("keydown", (event) => {
  if (shouldIgnoreShortcut(event.target)) return;

  if (event.code === "Escape") {
    event.preventDefault();
    if (flowState === FLOW.COUNTDOWN) {
      cancelCountdown();
    } else if (flowState === FLOW.RECORDING) {
      cancelCurrentTake();
    } else {
      runAction(startFreshSession);
    }
    return;
  }

  if (flowState === FLOW.REVIEW && ["Digit1", "Digit2", "Digit3", "Numpad1", "Numpad2", "Numpad3"].includes(event.code)) {
    event.preventDefault();
    const codeToMode = {
      Digit1: "ROOM",
      Numpad1: "ROOM",
      Digit2: "FOSSIL",
      Numpad2: "FOSSIL",
      Digit3: "NOSAVE",
      Numpad3: "NOSAVE",
    };
    selectMode(codeToMode[event.code]);
    return;
  }

  if (event.code === "Space" || event.code === "Enter") {
    event.preventDefault();
    if (flowState === FLOW.REVIEW && selectedMode) {
      runAction(submitCurrentTake);
      return;
    }
    if (btnPrimary.disabled) return;
    runAction(primaryAction);
  }
});

function shouldIgnoreShortcut(target) {
  if (!target) return false;
  return Boolean(target.closest("input, textarea, select, audio, button"));
}

function runAction(action) {
  if (typeof action !== "function") return;
  Promise.resolve(action()).catch((err) => {
    setFlowState(FLOW.ERROR, { errorMessage: err.message || "Unexpected kiosk error." });
  });
}

function randomIntBetween(min, max) {
  return min + Math.floor(Math.random() * ((max - min) + 1));
}

function startLoopMovement(index = 0) {
  loopMovementIndex = index % ROOM_MOVEMENTS.length;
  loopMovement = ROOM_MOVEMENTS[loopMovementIndex];
  loopMovementBudget = randomIntBetween(loopMovement.minItems, loopMovement.maxItems);
  loopMovementProgress = 0;
  loopScene = null;
  loopSceneCueIndex = 0;
}

function ensureLoopMovement() {
  if (!loopMovement) {
    startLoopMovement(0);
  }
  return loopMovement;
}

function advanceLoopMovement() {
  if (!loopMovement) return;
  loopMovementProgress += 1;
  if (loopMovementProgress >= loopMovementBudget) {
    startLoopMovement(loopMovementIndex + 1);
  }
}

function chooseTargetMood(movement, recent) {
  const last = recent[recent.length - 1];

  if (!last) {
    return movement.preferredMoods[0];
  }
  // The target mood reacts to the immediate past, but within the larger movement
  // so the room can counterbalance itself without losing the longer arc.
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

function chooseNextScene(movement, targetMood) {
  const recent = loopHistory.slice(-3);
  const last = recent[recent.length - 1];

  let candidates = ROOM_SCENES.filter((scene) => movement.sceneNames.includes(scene.name));
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

  return candidates[Math.floor(Math.random() * candidates.length)] || ROOM_SCENES[0];
}

function nextLoopCue() {
  const movement = ensureLoopMovement();
  const targetMood = chooseTargetMood(movement, loopHistory.slice(-4));

  if (!loopScene || loopSceneCueIndex >= loopScene.cues.length) {
    loopScene = chooseNextScene(movement, targetMood);
    loopSceneCueIndex = 0;
  }

  const cue = loopScene.cues[loopSceneCueIndex];
  loopSceneCueIndex += 1;
  return {
    movement,
    scene: loopScene,
    cue: {
      ...cue,
      mood: cue.mood || targetMood,
    },
  };
}

function rememberLoopPayload(payload, scene, movement) {
  // Keep a short memory of what the audience just heard so scene selection can
  // respond without turning into a rigid script.
  loopHistory.push({
    scene: scene.name,
    movement: movement.name,
    lane: payload.lane || "any",
    density: payload.density || "medium",
    mood: payload.mood || "suspended",
  });
  loopHistory = loopHistory.slice(-6);
}

function toneLevelForName(name) {
  if (name === "sparse") return ROOM_TONE.sparseGain;
  if (name === "duck") return ROOM_TONE.duckGain;
  return ROOM_TONE.idleGain;
}

btnLoop.addEventListener("click", async () => {
  loopRunning = true;
  loopScene = null;
  loopSceneCueIndex = 0;
  loopMovement = null;
  loopMovementIndex = 0;
  loopMovementBudget = 0;
  loopMovementProgress = 0;
  loopHistory = [];
  btnLoop.disabled = true;
  btnLoopStop.disabled = false;
  loopStatus.textContent = "Running...";
  await ensureRoomTone();
  setRoomToneLevel(ROOM_TONE.idleGain, 1.0);

  while (loopRunning) {
    try {
      const { movement, scene, cue } = nextLoopCue();
      if (cue.pauseMs) {
        // Some cues deliberately do nothing except hold the room tone. Those
        // gaps are part of the composition, not a fallback for missing content.
        loopStatus.textContent = `Holding space in ${movement.name} / ${scene.name}.`;
        setRoomToneLevel(toneLevelForName(cue.toneLevel), 1.4);
        await sleep(Math.round(cue.pauseMs * (movement.gapMultiplier || 1)));
        continue;
      }

      const lane = cue.lane || "any";
      const density = cue.density || "any";
      const mood = cue.mood || "any";
      const params = new URLSearchParams({
        context: "kiosk",
        lane,
        density,
        mood,
      });
      const response = await fetch(`/api/v1/pool/next?${params.toString()}`, { cache: "no-store" });
      if (response.status === 204) {
        loopStatus.textContent = `No ${mood} ${density} memory available in ${movement.name}. Holding the room tone.`;
        setRoomToneLevel(ROOM_TONE.sparseGain, 1.8);
        await sleep(1500);
        continue;
      }
      if (!response.ok) {
        loopStatus.textContent = `Pool error: ${response.status}`;
        setRoomToneLevel(ROOM_TONE.sparseGain, 1.4);
        await sleep(1500);
        continue;
      }

      const payload = await response.json();
      rememberLoopPayload(payload, scene, movement);
      const laneLabel = payload.lane ? `${payload.lane} ${payload.density || "memory"} memory` : "memory";
      loopStatus.textContent = `Playing ${laneLabel} in ${movement.name} / ${scene.name} (wear ${payload.wear.toFixed(3)})`;
      setRoomToneLevel(ROOM_TONE.duckGain, 0.8);
      await playUrlWithLightChain(payload.audio_url, payload.wear);
      advanceLoopMovement();
      if (loopRunning) {
        setRoomToneLevel(ROOM_TONE.idleGain, 1.4);
        await sleep(Math.round((cue.gapMs || PLAYBACK_SMOOTHING.betweenLoopItemsMs) * (movement.gapMultiplier || 1)));
      }
    } catch (err) {
      loopStatus.textContent = "Room loop interrupted.";
      setRoomToneLevel(ROOM_TONE.sparseGain, 1.2);
      await sleep(1500);
    }
  }

  stopRoomTone();
  loopStatus.textContent = "Stopped";
});

btnLoopStop.addEventListener("click", () => {
  stopLoopPlayback();
  stopRoomTone();
});

function stopLoopPlayback(statusMessage = "Stopped") {
  if (!loopRunning) return;
  loopRunning = false;
  btnLoop.disabled = false;
  btnLoopStop.disabled = true;
  loopStatus.textContent = statusMessage;
  stopRoomTone();
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function ensureRoomTone() {
  if (roomToneCtx && roomToneMasterGain) {
    await roomToneCtx.resume();
    return;
  }

  roomToneCtx = new (window.AudioContext || window.webkitAudioContext)();
  await roomToneCtx.resume();

  const bufferSeconds = 2;
  const noiseBuffer = roomToneCtx.createBuffer(1, roomToneCtx.sampleRate * bufferSeconds, roomToneCtx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  let brown = 0;
  // Brown-ish noise plus slow filter drift reads more like HVAC / room breath
  // than a bright synthetic noise floor.
  for (let i = 0; i < data.length; i += 1) {
    brown = (brown + (Math.random() * 2 - 1) * 0.06) * 0.985;
    data[i] = brown;
  }

  roomToneNoiseSource = roomToneCtx.createBufferSource();
  roomToneNoiseSource.buffer = noiseBuffer;
  roomToneNoiseSource.loop = true;

  const highpass = roomToneCtx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 110;

  const lowpass = roomToneCtx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 980;
  lowpass.Q.value = 0.4;

  roomToneMasterGain = roomToneCtx.createGain();
  roomToneMasterGain.gain.value = 0.0001;

  roomToneLfo = roomToneCtx.createOscillator();
  roomToneLfo.type = "sine";
  roomToneLfo.frequency.value = 0.025;

  roomToneLfoGain = roomToneCtx.createGain();
  roomToneLfoGain.gain.value = 65;
  roomToneLfo.connect(roomToneLfoGain);
  roomToneLfoGain.connect(lowpass.frequency);

  roomToneNoiseSource.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(roomToneMasterGain);
  roomToneMasterGain.connect(roomToneCtx.destination);

  roomToneNoiseSource.start();
  roomToneLfo.start();
}

function setRoomToneLevel(level, seconds = ROOM_TONE.fadeSeconds) {
  if (!roomToneCtx || !roomToneMasterGain) return;
  const now = roomToneCtx.currentTime;
  roomToneMasterGain.gain.cancelScheduledValues(now);
  roomToneMasterGain.gain.setValueAtTime(roomToneMasterGain.gain.value, now);
  roomToneMasterGain.gain.linearRampToValueAtTime(level, now + seconds);
}

async function stopRoomTone() {
  if (!roomToneCtx) return;

  try {
    setRoomToneLevel(0.0001, 0.6);
    await sleep(650);
  } catch (err) {}

  try { roomToneNoiseSource?.stop(); } catch (err) {}
  try { roomToneLfo?.stop(); } catch (err) {}
  try { roomToneNoiseSource?.disconnect(); } catch (err) {}
  try { roomToneLfo?.disconnect(); } catch (err) {}
  try { roomToneLfoGain?.disconnect(); } catch (err) {}
  try { roomToneMasterGain?.disconnect(); } catch (err) {}
  try { await roomToneCtx.close(); } catch (err) {}

  roomToneCtx = null;
  roomToneNoiseSource = null;
  roomToneMasterGain = null;
  roomToneLfo = null;
  roomToneLfoGain = null;
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

function processRecordingSamples(samples, sr) {
  if (!samples.length) {
    return { samples, note: "Choose how this take should be handled." };
  }

  const trimmed = trimSilence(
    samples,
    sr,
    RECORDING_PROCESSING.trimThreshold,
    RECORDING_PROCESSING.edgePaddingMs,
    RECORDING_PROCESSING.minContentMs,
  );
  const normalized = normalizeSamples(trimmed, RECORDING_PROCESSING.targetPeak, RECORDING_PROCESSING.maxGain);
  applyFade(normalized, sr, RECORDING_PROCESSING.fadeMs);

  const changedDuration = samples.length !== trimmed.length;
  const note = changedDuration
    ? "Take captured. Quiet edges were trimmed and the level was smoothed."
    : "Take captured. The level was smoothed for playback.";

  return {
    samples: normalized,
    note,
  };
}

function trimSilence(samples, sr, threshold, edgePaddingMs, minContentMs) {
  const paddingSamples = Math.round((edgePaddingMs / 1000) * sr);
  const minContentSamples = Math.round((minContentMs / 1000) * sr);

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

function applyFade(samples, sr, fadeMs) {
  const fadeSamples = Math.min(
    Math.round((fadeMs / 1000) * sr),
    Math.floor(samples.length / 2),
  );

  for (let i = 0; i < fadeSamples; i += 1) {
    const gain = i / Math.max(1, fadeSamples);
    samples[i] *= gain;
    samples[samples.length - 1 - i] *= gain;
  }
}

function encodeWavMono16(float32Samples, sr) {
  const numSamples = float32Samples.length;
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const byteRate = sr * blockAlign;
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
  view.setUint32(24, sr, true);
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

async function playUrlWithLightChain(url, wear) {
  const amount = smoothstep(clamp(wear, 0, 1));
  const arrayBuffer = await fetchArrayBuffer(url);
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
  const peak = getBufferPeak(buffer);

  const src = ctx.createBufferSource();
  src.buffer = buffer;

  // The playback chain turns accumulated wear into subtle audible patina rather
  // than obvious lo-fi effects: less air, a little grain, slight instability.
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = lerp(16000, 4500, amount);
  lowpass.Q.value = 0.6;

  const shelf = ctx.createBiquadFilter();
  shelf.type = "highshelf";
  shelf.frequency.value = 6000;
  shelf.gain.value = lerp(0, -10, amount);

  const crush = ctx.createScriptProcessor(1024, 1, 1);
  const bitDepth = Math.round(lerp(16, 12, amount));
  const step = Math.pow(0.5, bitDepth);
  const holdN = Math.round(lerp(1, 3, amount));
  const noiseAmp = lerp(0.0, 0.004, amount);
  const dropoutProb = lerp(0.0, 0.003, amount);

  let holdCounter = 0;
  let held = 0.0;

  crush.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const output = event.outputBuffer.getChannelData(0);

    for (let i = 0; i < input.length; i += 1) {
      if (holdCounter === 0) {
        held = input[i];
      }
      holdCounter = (holdCounter + 1) % holdN;

      let sample = Math.round(held / step) * step;
      if (Math.random() < dropoutProb) sample = 0.0;
      sample += (Math.random() * 2 - 1) * noiseAmp;
      output[i] = sample;
    }
  };

  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = lerp(0.05, 0.12, amount);

  const lfoGain = ctx.createGain();
  lfoGain.gain.value = lerp(0, 180, amount);
  lfo.connect(lfoGain);
  lfoGain.connect(lowpass.frequency);

  const gain = ctx.createGain();
  // Normalize contributions toward a shared room level, then fade the edges so
  // back-to-back playback feels placed in space instead of hard-cut together.
  const normalizedGain = peak > 0.0001
    ? clamp(PLAYBACK_SMOOTHING.targetPeak / peak, PLAYBACK_SMOOTHING.minGain, PLAYBACK_SMOOTHING.maxGain)
    : 1.0;
  const fadeInSeconds = Math.min(PLAYBACK_SMOOTHING.fadeInSeconds, Math.max(0.02, buffer.duration / 4));
  const fadeOutSeconds = Math.min(PLAYBACK_SMOOTHING.fadeOutSeconds, Math.max(0.04, buffer.duration / 3));
  const releaseAt = Math.max(fadeInSeconds, buffer.duration - fadeOutSeconds);
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(normalizedGain * 0.95, ctx.currentTime + fadeInSeconds);
  gain.gain.setValueAtTime(normalizedGain * 0.95, ctx.currentTime + releaseAt);
  gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + buffer.duration);

  src.connect(lowpass);
  lowpass.connect(shelf);
  shelf.connect(crush);
  crush.connect(gain);
  gain.connect(ctx.destination);

  lfo.start();

  return new Promise((resolve) => {
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
    src.start();
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

window.addEventListener("beforeunload", () => {
  stopLoopPlayback();
  stopRoomTone();
  teardownMicrophone();
});

setReceiptText("No receipt yet.");
render();
