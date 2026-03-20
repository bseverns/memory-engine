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
    reviewCopy: "The raw recording expires in about 48 hours. A spectrogram image and a low-storage audio residue may remain locally for longer.",
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
const btnQuietKeep = document.getElementById("btnQuietKeep");
const btnQuietRetake = document.getElementById("btnQuietRetake");

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
const receiptPanel = document.getElementById("receiptPanel");
const receipt = document.getElementById("receipt");
const preview = document.getElementById("preview");
const loopStatus = document.getElementById("loopStatus");
const modePanel = document.getElementById("modePanel");
const countdownOverlay = document.getElementById("countdownOverlay");
const countdownValue = document.getElementById("countdownValue");
const countdownLabel = document.getElementById("countdownLabel");
const quietTakePanel = document.getElementById("quietTakePanel");
const quietTakeCopy = document.getElementById("quietTakeCopy");
const reviewTimeoutPanel = document.getElementById("reviewTimeoutPanel");
const reviewTimeoutChip = document.getElementById("reviewTimeoutChip");
const reviewTimeoutFill = document.getElementById("reviewTimeoutFill");
const attractPanel = document.getElementById("attractPanel");
const attractLead = document.getElementById("attractLead");
const operatorNotice = document.getElementById("operatorNotice");
const attractSteps = Array.from(document.querySelectorAll(".attract-step"));
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

let buffers = [];
let recStartTs = 0;
let timerInterval = 0;
let countdownToken = 0;
let reviewTimeoutInterval = 0;
let reviewDeadlineTs = 0;
let quietTakeNeedsDecision = false;
let quietTakeAnalysis = null;
let hasReceipt = false;
let attractStepIndex = 0;
let attractInterval = 0;
const PRE_ROLL_SECONDS = 3;
const MAX_RECORDING_MS = 120000;
const MIC_SIGNAL_THRESHOLD = 0.07;
const REVIEW_IDLE_TIMEOUT_MS = 90000;
const ATTRACT_ROTATE_MS = 3600;
const SURFACE_STATE_POLL_MS = 5000;

const ATTRACT_MESSAGES = [
  "Tap Arm microphone or press Space to begin.",
  "Nothing records until you choose to start.",
  "Check the meter first, then make the take when you are ready.",
];

const PRE_ROLL_TONE = {
  gain: 0.04,
  durationSeconds: 0.12,
  tailSeconds: 0.18,
  countdownFrequency: 523.25,
  finalFrequency: 659.25,
};

const {
  encodeWavMono16,
  mergeBuffers,
  playUrlWithLightChain,
  processRecordingSamples,
} = window.MemoryEngineKioskAudio;

function readKioskConfig() {
  const el = document.getElementById("kiosk-config");
  if (!el || !el.textContent) {
    return {};
  }
  try {
    return JSON.parse(el.textContent);
  } catch (err) {
    return {};
  }
}

const kioskConfig = readKioskConfig();
let surfaceState = {
  intake_paused: false,
  playback_paused: false,
  quieter_mode: false,
  maintenance_mode: false,
  ...(kioskConfig.operatorState || {}),
};
let surfaceStateInterval = 0;

const captureController = window.MemoryEngineKioskCapture.createController({
  onMeterLevel: handleMeterLevel,
  onMicLabelChange(nextLabel) {
    micLabel = nextLabel;
  },
});

function setFlowState(nextState, options = {}) {
  const previousState = flowState;
  flowState = nextState;
  if (options.errorMessage !== undefined) {
    lastErrorMessage = options.errorMessage;
  }
  syncReviewTimeout(previousState, nextState);
  render();
}

function render() {
  document.body.dataset.state = flowState;
  countdownOverlay.hidden = flowState !== FLOW.COUNTDOWN;
  updateStepper();
  updateModePanel();
  updateReceiptPanel();
  updateButtons();
  updateStage();
  updateQuietTakePanel();
  updateReviewTimeoutPanel();
  updateAttractPanel();
  updateOperatorNotice();
}

function intakePaused() {
  return Boolean(surfaceState.intake_paused || surfaceState.maintenance_mode);
}

function maintenanceMode() {
  return Boolean(surfaceState.maintenance_mode);
}

function updateOperatorNotice() {
  if (!operatorNotice) return;
  if (!intakePaused()) {
    operatorNotice.hidden = true;
    operatorNotice.textContent = "";
    return;
  }

  operatorNotice.hidden = false;
  if (surfaceState.maintenance_mode) {
    operatorNotice.textContent = "This node is in maintenance mode. Recording and room playback are resting until the steward returns it to service.";
    return;
  }
  operatorNotice.textContent = flowState === FLOW.REVIEW && wavBlob
    ? "Recording intake is paused by the steward. New submissions are temporarily on hold."
    : "Recording intake is paused by the steward. This station is resting until intake resumes.";
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

function syncReviewTimeout(previousState, nextState) {
  if (nextState === FLOW.REVIEW) {
    resetReviewDeadline();
    if (!reviewTimeoutInterval) {
      reviewTimeoutInterval = window.setInterval(tickReviewTimeout, 250);
    }
    return;
  }

  if (previousState === FLOW.REVIEW || reviewTimeoutInterval) {
    window.clearInterval(reviewTimeoutInterval);
    reviewTimeoutInterval = 0;
    reviewDeadlineTs = 0;
  }
}

function resetReviewDeadline() {
  reviewDeadlineTs = performance.now() + REVIEW_IDLE_TIMEOUT_MS;
}

function tickReviewTimeout() {
  if (flowState !== FLOW.REVIEW) return;

  if (!preview.paused && !preview.ended) {
    resetReviewDeadline();
  }

  if (performance.now() >= reviewDeadlineTs) {
    window.clearInterval(reviewTimeoutInterval);
    reviewTimeoutInterval = 0;
    reviewDeadlineTs = 0;
    preview.pause();
    submitStatus.textContent = "Review timed out. The kiosk reset for the next person.";
    runAction(startFreshSession);
    return;
  }

  updateReviewTimeoutPanel();
}

function updateReviewTimeoutPanel() {
  const visible = flowState === FLOW.REVIEW && reviewDeadlineTs > 0;
  reviewTimeoutPanel.hidden = !visible;
  if (!visible) {
    reviewTimeoutChip.classList.remove("warning");
    reviewTimeoutFill.style.width = "100%";
    return;
  }

  const remainingMs = Math.max(0, reviewDeadlineTs - performance.now());
  const progress = Math.max(0, Math.min(1, remainingMs / REVIEW_IDLE_TIMEOUT_MS));
  reviewTimeoutChip.textContent = `Review resets in ${formatDuration(remainingMs)}`;
  reviewTimeoutChip.classList.toggle("warning", remainingMs <= 20000);
  reviewTimeoutFill.style.width = `${progress * 100}%`;
}

function noteReviewActivity() {
  if (flowState !== FLOW.REVIEW) return;
  resetReviewDeadline();
  updateReviewTimeoutPanel();
}

function updateQuietTakePanel() {
  const visible = flowState === FLOW.REVIEW && quietTakeNeedsDecision;
  quietTakePanel.hidden = !visible;
  if (!visible) return;

  quietTakeCopy.textContent = quietTakeAnalysis
    ? "The take made it through, but the microphone level stayed very soft. Keep it if that softness is intentional, or retake it before choosing a memory mode."
    : "Listen back. If the softness is intentional, keep it. Otherwise retake it before choosing how the room should remember it.";
}

function startAttractLoop() {
  if (attractInterval || !attractPanel || attractSteps.length === 0) return;
  attractInterval = window.setInterval(() => {
    attractStepIndex = (attractStepIndex + 1) % attractSteps.length;
    if (flowState === FLOW.IDLE) {
      updateAttractPanel();
    }
  }, ATTRACT_ROTATE_MS);
}

function updateAttractPanel() {
  if (!attractPanel || !attractLead || attractSteps.length === 0) return;
  const visible = flowState === FLOW.IDLE;
  attractPanel.hidden = !visible;
  if (!visible) return;

  attractLead.textContent = ATTRACT_MESSAGES[attractStepIndex % ATTRACT_MESSAGES.length];
  attractSteps.forEach((step, index) => {
    step.classList.toggle("active", index === attractStepIndex);
  });
}

function updateModePanel() {
  const visible = [FLOW.REVIEW, FLOW.SUBMITTING].includes(flowState);
  if (modePanel) {
    modePanel.hidden = !visible;
  }
  const interactive = flowState === FLOW.REVIEW && !quietTakeNeedsDecision;
  modePanel.classList.toggle("locked", !interactive);
  choices.forEach((choice) => {
    choice.disabled = !interactive;
  });

  if (!visible) {
    selectionHint.textContent = "Unlocked after recording";
  } else if (flowState === FLOW.REVIEW && quietTakeNeedsDecision) {
    selectionHint.textContent = "Keep or retake before choosing";
  } else if (!selectedMode) {
    selectionHint.textContent = "Press 1, 2, or 3 to choose";
  } else {
    selectionHint.textContent = `Selected: ${MODE_COPY[selectedMode].name}`;
  }

  if (intakePaused()) {
    selectionHint.textContent = "Intake is paused by the steward";
  }

  const canSubmit = flowState === FLOW.REVIEW && !!wavBlob && !!selectedMode && !intakePaused();
  btnSubmit.disabled = !canSubmit;
  btnSubmit.textContent = selectedMode ? MODE_COPY[selectedMode].submitLabel : "Submit selection";
}

function updateReceiptPanel() {
  if (!receiptPanel) return;
  receiptPanel.hidden = !hasReceipt;
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
    if (quietTakeNeedsDecision) {
      primaryLabel = "Keep this take";
      primaryAction = acknowledgeQuietTake;
      primaryDisabled = !wavBlob;
      secondaryLabel = "Retake";
      secondaryAction = recordAgain;
    } else {
      primaryLabel = selectedMode ? MODE_COPY[selectedMode].submitLabel : "Choose a memory mode";
      primaryAction = submitCurrentTake;
      primaryDisabled = !selectedMode || !wavBlob;
      secondaryLabel = "Record again";
      secondaryAction = recordAgain;
    }
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

  if (intakePaused() && ![FLOW.RECORDING, FLOW.SUBMITTING, FLOW.COMPLETE].includes(flowState)) {
    primaryDisabled = true;
    if (flowState === FLOW.IDLE || flowState === FLOW.ERROR) {
      primaryLabel = "Recording paused";
    } else if (flowState === FLOW.REVIEW) {
      primaryLabel = "Submission paused";
      secondaryLabel = "Reset session";
      secondaryAction = startFreshSession;
      secondaryDisabled = false;
    }
  }

  btnPrimary.textContent = primaryLabel;
  btnPrimary.disabled = primaryDisabled;
  btnSecondary.textContent = secondaryLabel;
  btnSecondary.disabled = secondaryDisabled;
}

function updateStage() {
  const hasMic = captureController.hasLiveInput();
  const elapsedMs = flowState === FLOW.RECORDING ? (performance.now() - recStartTs) : durationMs;
  const remainingMs = flowState === FLOW.RECORDING
    ? Math.max(0, MAX_RECORDING_MS - elapsedMs)
    : Math.max(0, MAX_RECORDING_MS - durationMs);
  recTimer.textContent = formatDuration(elapsedMs);
  remainingTimer.textContent = formatDuration(remainingMs);
  maxDurationHint.textContent = `Max ${formatDuration(MAX_RECORDING_MS)}`;

  if (intakePaused() && flowState === FLOW.IDLE) {
    stageBadge.textContent = maintenanceMode() ? "Maintenance" : "Paused";
    stageTitle.textContent = maintenanceMode()
      ? "This recording station is offline for maintenance."
      : "This recording station is resting.";
    stageCopy.textContent = maintenanceMode()
      ? "A steward has taken this node out of service for a while. Recording will return when maintenance mode is cleared."
      : "A steward has paused intake for a while. Nothing new will be recorded until intake resumes.";
    micStatus.textContent = "Microphone asleep";
    recStatus.textContent = maintenanceMode() ? "Node in maintenance mode" : "Recording intake paused";
    shortcutHint.textContent = maintenanceMode() ? "Node temporarily offline" : "Recording is paused by the steward";
    meterText.textContent = "Waiting for intake to resume";
    setMicCheckStatus("Mic check asleep", "quiet");
    setMeterLevel(0);
  } else if (flowState === FLOW.IDLE) {
    stageBadge.textContent = "Not armed";
    stageTitle.textContent = "When you are ready, wake the microphone.";
    stageCopy.textContent = "Nothing records until you begin. Take a breath, notice the room, and start only when it feels right.";
    micStatus.textContent = "Microphone asleep";
    recStatus.textContent = "Microphone not armed";
    shortcutHint.textContent = "Space or Enter: arm microphone";
    meterText.textContent = "Waiting for microphone";
    setMicCheckStatus("Mic check unavailable", "quiet");
    setMeterLevel(0);
  } else if (flowState === FLOW.ARMING) {
    stageBadge.textContent = "Arming";
    stageTitle.textContent = "Allow the microphone, then settle.";
    stageCopy.textContent = "The screen will stay still and wait. Recording does not begin until you choose it.";
    micStatus.textContent = "Requesting microphone access";
    recStatus.textContent = "Waiting for microphone access";
    shortcutHint.textContent = "Microphone request in progress";
    meterText.textContent = "Requesting access";
    setMicCheckStatus("Mic check starting up", "quiet");
  } else if (flowState === FLOW.ARMED) {
    stageBadge.textContent = intakePaused() ? (maintenanceMode() ? "Maintenance" : "Paused") : "Ready";
    stageTitle.textContent = intakePaused()
      ? (maintenanceMode() ? "This node is offline for maintenance." : "The steward has paused recording intake.")
      : "You are ready, but not yet recording.";
    stageCopy.textContent = intakePaused()
      ? (maintenanceMode()
        ? "This take can be reset, but recording cannot begin until the node returns to service."
        : "This take can be reset, but a new recording cannot begin until intake resumes.")
      : "Speak a little if you want to watch the meter. Begin when the moment feels settled.";
    micStatus.textContent = micLabel;
    recStatus.textContent = intakePaused()
      ? (maintenanceMode() ? "Node in maintenance mode" : "Recording intake paused")
      : "Standing by";
    shortcutHint.textContent = intakePaused()
      ? (maintenanceMode() ? "Node temporarily offline" : "Recording is paused by the steward")
      : "Space or Enter: start recording";
    meterText.textContent = hasMic ? "Listening for room sound" : "Microphone unavailable";
  } else if (flowState === FLOW.COUNTDOWN) {
    stageBadge.textContent = "Get ready";
    stageTitle.textContent = "Take a breath.";
    stageCopy.textContent = "Recording begins in a moment. You can still cancel if you need more time.";
    micStatus.textContent = micLabel;
    recStatus.textContent = "Countdown in progress";
    shortcutHint.textContent = "Escape: cancel countdown";
    meterText.textContent = "Listening for room sound";
  } else if (flowState === FLOW.RECORDING) {
    stageBadge.textContent = "Recording";
    stageTitle.textContent = "Speak when you are ready.";
    stageCopy.textContent = "Stop whenever you feel complete. The take also ends automatically when the timer reaches zero.";
    micStatus.textContent = micLabel;
    recStatus.textContent = "Recording in progress";
    shortcutHint.textContent = "Space or Enter: stop recording";
    meterText.textContent = "Live microphone signal";
  } else if (flowState === FLOW.REVIEW) {
    if (quietTakeNeedsDecision) {
      stageBadge.textContent = "Quiet take";
      stageTitle.textContent = "This take arrived very softly.";
      stageCopy.textContent = "Listen once. Keep it if that softness is right, or retake it before choosing what happens next.";
    } else {
      stageBadge.textContent = intakePaused() ? (maintenanceMode() ? "Maintenance" : "Paused") : "Review";
      stageTitle.textContent = intakePaused()
        ? (maintenanceMode() ? "This take is waiting while the node is offline." : "This take is waiting while intake is paused.")
        : (selectedMode ? `Ready to ${MODE_COPY[selectedMode].submitLabel.toLowerCase()}.` : "Listen back, then choose what follows.");
      stageCopy.textContent = intakePaused()
        ? (maintenanceMode()
          ? "A steward put this node into maintenance mode before the take was submitted. Reset for the next person after the node returns to service."
          : "A steward paused intake before this take was submitted. You can keep the screen open or reset for the next person once intake resumes.")
        : (selectedMode
          ? MODE_COPY[selectedMode].reviewCopy
          : "Use the preview if you want. Then choose 1, 2, or 3 for the next step.");
    }
    micStatus.textContent = hasMic ? micLabel : "Microphone asleep";
    recStatus.textContent = quietTakeNeedsDecision ? "Very quiet input detected" : (wavBlob ? "Take captured" : "No take captured");
    shortcutHint.textContent = quietTakeNeedsDecision
      ? "Space or Enter: keep this take"
      : (intakePaused()
        ? (maintenanceMode() ? "Node temporarily offline" : "Submission is paused by the steward")
        : (selectedMode ? "Space or Enter: submit selection" : "Press 1, 2, or 3 to choose a memory mode"));
    meterText.textContent = quietTakeNeedsDecision ? "Preview this take before deciding" : (hasMic ? "Microphone still armed" : "Microphone asleep");
    setMicCheckStatus(
      quietTakeNeedsDecision ? "Quiet take warning" : (hasMic ? "Mic check complete" : "Mic check asleep"),
      quietTakeNeedsDecision ? "quiet" : (hasMic ? "good" : "quiet"),
    );
  } else if (flowState === FLOW.SUBMITTING) {
    stageBadge.textContent = "Saving";
    stageTitle.textContent = "Please hold for a moment.";
    stageCopy.textContent = "The kiosk is finishing this session and will only show something to keep if this take produced one.";
    micStatus.textContent = "Microphone asleep";
    recStatus.textContent = "Submitting";
    shortcutHint.textContent = "Submitting current take";
    meterText.textContent = "Microphone asleep";
    setMicCheckStatus("Mic check asleep", "quiet");
    setMeterLevel(0);
  } else if (flowState === FLOW.COMPLETE) {
    stageBadge.textContent = "Finished";
    stageTitle.textContent = selectedMode ? MODE_COPY[selectedMode].completeTitle : "Session complete.";
    stageCopy.textContent = "The microphone is asleep again. Begin another recording whenever the next person is ready.";
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

function handleMeterLevel(boosted) {
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
}

function setMicCheckStatus(text, tone) {
  micCheckStatus.textContent = text;
  micCheckStatus.classList.remove("good", "quiet");
  micCheckStatus.classList.add(tone === "good" ? "good" : "quiet");
}

function setReceiptText(text) {
  receipt.textContent = text;
  receipt.classList.add("muted");
  hasReceipt = true;
}

function setReceiptHtml(html) {
  receipt.innerHTML = html;
  receipt.classList.remove("muted");
  hasReceipt = true;
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
  quietTakeNeedsDecision = false;
  quietTakeAnalysis = null;
  clearPreview();
  submitStatus.textContent = "";
  if (clearReceipt) {
    receipt.textContent = "";
    receipt.classList.add("muted");
    hasReceipt = false;
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
  if (intakePaused()) return;

  roomLoopController.stop("Room loop paused for recording.");
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
  await captureController.ensureReady();
  micLabel = captureController.getMicLabel();
}

async function startRecording() {
  if (flowState !== FLOW.ARMED) return;
  if (intakePaused()) return;

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
    captureController.playPreRollTone(PRE_ROLL_TONE, secondsLeft <= 1);

    if (secondsLeft <= 1) {
      runAction(beginRecordingCapture);
      return;
    }

    window.setTimeout(() => tick(secondsLeft - 1), 1000);
  };

  clearTakeData();
  window.setTimeout(() => tick(PRE_ROLL_SECONDS), 0);
}

async function beginRecordingCapture() {
  if (flowState !== FLOW.COUNTDOWN) return;

  submitStatus.textContent = "";
  buffers = [];
  recStartTs = performance.now();

  await captureController.startRecording({
    onChunk(chunk) {
      buffers.push(chunk);
    },
  });

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
  if (flowState !== FLOW.RECORDING) return;

  stopRecordingNodes();

  const rawData = mergeBuffers(buffers);
  const sampleRate = captureController.getSampleRate();
  const processed = processRecordingSamples(rawData, sampleRate);

  durationMs = Math.round((processed.samples.length / sampleRate) * 1000);
  wavBlob = encodeWavMono16(processed.samples, sampleRate);
  previewUrl = URL.createObjectURL(wavBlob);
  preview.src = previewUrl;
  preview.hidden = false;
  quietTakeNeedsDecision = !!processed.quietWarning;
  quietTakeAnalysis = processed.quietWarning;
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
  if (captureController.hasLiveInput()) {
    setFlowState(FLOW.ARMED);
    return;
  }
  await armMicrophone();
}

function acknowledgeQuietTake() {
  if (flowState !== FLOW.REVIEW || !quietTakeNeedsDecision) return;
  quietTakeNeedsDecision = false;
  submitStatus.textContent = "Quiet take kept. Choose how the room should remember it.";
  noteReviewActivity();
  render();
}

async function submitCurrentTake() {
  if (!wavBlob || !selectedMode || flowState !== FLOW.REVIEW) {
    return;
  }
  if (intakePaused()) {
    throw new Error("Recording intake is paused by the steward right now.");
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
  roomLoopController.stop();
  await teardownMicrophone();
  clearTakeData();
  setFlowState(FLOW.IDLE, { errorMessage: "" });
}

function selectMode(mode) {
  if (![FLOW.REVIEW, FLOW.SUBMITTING, FLOW.COMPLETE].includes(flowState)) return;
  if (!(mode in MODE_COPY) || flowState === FLOW.SUBMITTING || quietTakeNeedsDecision) return;

  selectedMode = mode;
  choices.forEach((choice) => {
    choice.classList.toggle("selected", choice.dataset.mode === mode);
  });

  if (flowState === FLOW.REVIEW) {
    submitStatus.textContent = `${MODE_COPY[mode].name} selected.`;
    noteReviewActivity();
  }
  render();
}

function stopRecordingNodes() {
  window.clearInterval(timerInterval);
  timerInterval = 0;
  captureController.stopRecording();
}

async function teardownMicrophone() {
  stopRecordingNodes();
  await captureController.teardown();
  setMeterLevel(0);
  micLabel = captureController.getMicLabel();
}

function describeMicError(err) {
  if (!err || !err.name) return "Check that the USB microphone is connected, then try again.";
  if (err.name === "NotAllowedError") return "Browser access to the microphone was denied. Allow it and try again.";
  if (err.name === "NotFoundError") return "No microphone was found. Check the USB microphone connection.";
  if (err.name === "NotReadableError") return "The microphone is busy or unavailable. Reconnect it and try again.";
  return err.message || "Check that the USB microphone is connected, then try again.";
}

function describeSubmitError(err) {
  if (err && /423/.test(err.message || "")) {
    return surfaceState.maintenance_mode
      ? "This node is in maintenance mode right now."
      : "Recording intake is paused by the steward right now.";
  }
  return err && err.message ? err.message : "Something went wrong while submitting the take.";
}

async function refreshSurfaceState() {
  try {
    const response = await fetch("/api/v1/surface/state", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`surface state failed (${response.status})`);
    }
    const payload = await response.json();
    surfaceState = {
      ...surfaceState,
      ...(payload.operator_state || {}),
    };
    render();
  } catch (err) {}
}

btnPrimary.addEventListener("click", () => runAction(primaryAction));
btnSecondary.addEventListener("click", () => runAction(secondaryAction));
btnSubmit.addEventListener("click", () => runAction(submitCurrentTake));
btnQuietKeep.addEventListener("click", () => runAction(acknowledgeQuietTake));
btnQuietRetake.addEventListener("click", () => runAction(recordAgain));

choices.forEach((choice) => {
  choice.addEventListener("click", () => selectMode(choice.dataset.mode));
});

preview.addEventListener("play", noteReviewActivity);
preview.addEventListener("seeking", noteReviewActivity);
preview.addEventListener("pause", noteReviewActivity);

document.addEventListener("pointerdown", noteReviewActivity, true);
document.addEventListener("focusin", noteReviewActivity, true);

document.addEventListener("keydown", (event) => {
  noteReviewActivity();
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

  if (flowState === FLOW.REVIEW && !quietTakeNeedsDecision && ["Digit1", "Digit2", "Digit3", "Numpad1", "Numpad2", "Numpad3"].includes(event.code)) {
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

const roomLoopController = window.MemoryEngineRoomLoop.createController({
  startButton: btnLoop,
  stopButton: btnLoopStop,
  statusEl: loopStatus,
  playUrlWithLightChain,
});

window.addEventListener("beforeunload", () => {
  window.clearInterval(attractInterval);
  window.clearInterval(reviewTimeoutInterval);
  window.clearInterval(surfaceStateInterval);
  roomLoopController.teardown();
  teardownMicrophone();
});

hasReceipt = false;
startAttractLoop();
void refreshSurfaceState();
surfaceStateInterval = window.setInterval(() => {
  void refreshSurfaceState();
}, SURFACE_STATE_POLL_MS);
render();
