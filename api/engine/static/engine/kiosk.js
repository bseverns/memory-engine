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
const heroEyebrow = document.getElementById("heroEyebrow");
const heroTitle = document.getElementById("heroTitle");
const heroSub = document.getElementById("heroSub");
const meterLabel = document.getElementById("meterLabel");
const elapsedLabel = document.getElementById("elapsedLabel");
const remainingLabel = document.getElementById("remainingLabel");
const shortcutReset = document.getElementById("shortcutReset");
const privacyHint = document.getElementById("privacyHint");
const quietTakeKicker = document.getElementById("quietTakeKicker");
const quietTakeTitle = document.getElementById("quietTakeTitle");
const reviewTimeoutHint = document.getElementById("reviewTimeoutHint");
const receiptKicker = document.getElementById("receiptKicker");
const receiptTitle = document.getElementById("receiptTitle");
const countdownKicker = document.getElementById("countdownKicker");
const footerCopy = document.getElementById("footerCopy");
const attractSteps = Array.from(document.querySelectorAll(".attract-step"));
const stepEls = Array.from(document.querySelectorAll(".step"));
const choices = Array.from(document.querySelectorAll(".choice"));
const choiceCopyEls = new Map(choices.map((choice) => [choice.dataset.mode, {
  title: choice.querySelector(".choice-title"),
  copy: choice.querySelector(".choice-copy"),
}]));

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
const MIC_SIGNAL_THRESHOLD = 0.07;
const REVIEW_IDLE_TIMEOUT_MS = 90000;
const ATTRACT_ROTATE_MS = 3600;
const SURFACE_STATE_POLL_MS = 5000;

const kioskCopyApi = window.MemoryEngineKioskCopy;

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
const DEFAULT_LANGUAGE_CODE = String(kioskConfig.kioskLanguageCode || "en");
const DEFAULT_MAX_RECORDING_SECONDS = Number(kioskConfig.kioskMaxRecordingSeconds || 120);
let surfaceState = {
  intake_paused: false,
  playback_paused: false,
  quieter_mode: false,
  maintenance_mode: false,
  kiosk_language_code: "",
  kiosk_accessibility_mode: "",
  kiosk_force_reduced_motion: false,
  kiosk_max_recording_seconds: DEFAULT_MAX_RECORDING_SECONDS,
  ...(kioskConfig.operatorState || {}),
};
let surfaceStateInterval = 0;
const reducedMotionMediaQuery = window.matchMedia
  ? window.matchMedia("(prefers-reduced-motion: reduce)")
  : null;

const captureController = window.MemoryEngineKioskCapture.createController({
  onMeterLevel: handleMeterLevel,
  onMicLabelChange(nextLabel) {
    micLabel = nextLabel;
  },
});

function currentLanguageCode() {
  return kioskCopyApi.resolveLanguageCode(surfaceState.kiosk_language_code, DEFAULT_LANGUAGE_CODE);
}

function currentCopy() {
  return kioskCopyApi.getPack(currentLanguageCode());
}

function formatCopy(template, values = {}) {
  return kioskCopyApi.formatMessage(template, values);
}

function modeCopy(mode) {
  return currentCopy().modes[mode];
}

function localizedDateTime(value) {
  return new Date(value).toLocaleString(currentCopy().locale);
}

function processingNoteForKey(noteKey, fallback = "") {
  const copy = currentCopy();
  const map = {
    choose_mode: copy.processingNoteChoose,
    trimmed_and_smoothed: copy.processingNoteTrimmed,
    smoothed: copy.processingNoteSmoothed,
    quiet_warning: copy.processingNoteQuiet,
  };
  return map[noteKey] || fallback;
}

function setFlowState(nextState, options = {}) {
  const previousState = flowState;
  flowState = nextState;
  if (options.errorMessage !== undefined) {
    lastErrorMessage = options.errorMessage;
  }
  syncReviewTimeout(previousState, nextState);
  render();
}

function applyStaticCopy() {
  const copy = currentCopy();
  document.documentElement.lang = copy.htmlLang;
  document.title = copy.documentTitle;
  if (heroEyebrow) heroEyebrow.textContent = copy.heroEyebrow;
  if (heroTitle) heroTitle.textContent = copy.heroTitle;
  if (heroSub) heroSub.textContent = copy.heroSub;
  if (meterLabel) meterLabel.textContent = copy.meterLabel;
  if (elapsedLabel) elapsedLabel.textContent = copy.timerElapsed;
  if (remainingLabel) remainingLabel.textContent = copy.timerRemaining;
  if (shortcutReset) shortcutReset.textContent = copy.resetShortcut;
  if (privacyHint) privacyHint.textContent = copy.privacyHint;
  if (quietTakeKicker) quietTakeKicker.textContent = copy.quietTakeKicker;
  if (quietTakeTitle) quietTakeTitle.textContent = copy.quietTakeTitle;
  if (btnQuietKeep) btnQuietKeep.textContent = copy.quietTakeKeep;
  if (btnQuietRetake) btnQuietRetake.textContent = copy.quietTakeRetake;
  if (reviewTimeoutHint) reviewTimeoutHint.textContent = copy.reviewTimeoutHint;
  if (receiptKicker) receiptKicker.textContent = copy.receiptKicker;
  if (receiptTitle) receiptTitle.textContent = copy.receiptTitle;
  if (countdownKicker) countdownKicker.textContent = copy.countdownKicker;
  if (footerCopy) footerCopy.textContent = copy.footerCopy;
  for (const [mode, els] of choiceCopyEls.entries()) {
    const modeStrings = copy.modes[mode];
    if (!modeStrings) continue;
    if (els.title) els.title.textContent = modeStrings.name;
    if (els.copy) els.copy.textContent = modeStrings.optionCopy;
  }
}

function render() {
  applyStaticCopy();
  document.body.dataset.state = flowState;
  document.body.classList.toggle("a11y-mode", accessibilityModeEnabled());
  document.body.classList.toggle("reduced-motion-mode", shouldReduceMotion());
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

function recordingLimitMs() {
  const configuredSeconds = Number(surfaceState.kiosk_max_recording_seconds || DEFAULT_MAX_RECORDING_SECONDS);
  const clampedSeconds = Math.max(30, Math.min(300, Number.isFinite(configuredSeconds) ? configuredSeconds : DEFAULT_MAX_RECORDING_SECONDS));
  return clampedSeconds * 1000;
}

function accessibilityModeEnabled() {
  return String(surfaceState.kiosk_accessibility_mode || "").toLowerCase() === "large_high_contrast";
}

function shouldReduceMotion() {
  return Boolean(surfaceState.kiosk_force_reduced_motion || reducedMotionMediaQuery?.matches);
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
  const copy = currentCopy();
  if (surfaceState.maintenance_mode) {
    operatorNotice.textContent = copy.operatorMaintenance;
    return;
  }
  operatorNotice.textContent = flowState === FLOW.REVIEW && wavBlob
    ? copy.operatorPausedReview
    : copy.operatorPausedIdle;
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
    submitStatus.textContent = currentCopy().reviewTimedOut;
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
  reviewTimeoutChip.textContent = formatCopy(currentCopy().reviewResetsIn, {
    duration: formatDuration(remainingMs),
  });
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

  const copy = currentCopy();
  quietTakeCopy.textContent = quietTakeAnalysis
    ? copy.quietTakeCopyMeasured
    : copy.quietTakeCopyDefault;
}

function startAttractLoop() {
  if (attractInterval || !attractPanel || attractSteps.length === 0) return;
  attractInterval = window.setInterval(() => {
    if (shouldReduceMotion()) {
      return;
    }
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

  const copy = currentCopy();
  const messages = [
    copy.shortcutArm,
    copy.stageIdleCopy,
    copy.stageArmedCopy,
  ];
  const activeIndex = shouldReduceMotion() ? 0 : (attractStepIndex % messages.length);
  attractLead.textContent = messages[activeIndex];
  attractSteps.forEach((step, index) => {
    step.classList.toggle("active", index === activeIndex);
  });
}

function updateModePanel() {
  const copy = currentCopy();
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
    selectionHint.textContent = copy.selectionUnlocked;
  } else if (flowState === FLOW.REVIEW && quietTakeNeedsDecision) {
    selectionHint.textContent = copy.selectionKeepOrRetake;
  } else if (!selectedMode) {
    selectionHint.textContent = copy.selectionPressChoice;
  } else {
    selectionHint.textContent = formatCopy(copy.selectionSelected, { name: modeCopy(selectedMode).name });
  }

  if (intakePaused()) {
    selectionHint.textContent = copy.selectionPaused;
  }

  const canSubmit = flowState === FLOW.REVIEW && !!wavBlob && !!selectedMode && !intakePaused();
  btnSubmit.disabled = !canSubmit;
  btnSubmit.textContent = selectedMode ? modeCopy(selectedMode).submitLabel : copy.submitSelection;
}

function updateReceiptPanel() {
  if (!receiptPanel) return;
  receiptPanel.hidden = !hasReceipt;
}

function updateButtons() {
  const copy = currentCopy();
  let primaryLabel = copy.btnArm;
  let primaryDisabled = false;
  let secondaryLabel = copy.btnStartOver;
  let secondaryDisabled = true;

  primaryAction = armMicrophone;
  secondaryAction = startFreshSession;

  if (flowState === FLOW.ARMING) {
    primaryLabel = copy.btnArming;
    primaryDisabled = true;
    secondaryLabel = copy.btnPleaseWait;
    secondaryDisabled = true;
  } else if (flowState === FLOW.ARMED) {
    primaryLabel = copy.btnStartRecording;
    primaryAction = startRecording;
    secondaryLabel = copy.btnDisarm;
    secondaryAction = disarmToIdle;
    secondaryDisabled = false;
  } else if (flowState === FLOW.COUNTDOWN) {
    primaryLabel = copy.btnStartingSoon;
    primaryDisabled = true;
    secondaryLabel = copy.btnCancelCountdown;
    secondaryAction = cancelCountdown;
    secondaryDisabled = false;
  } else if (flowState === FLOW.RECORDING) {
    primaryLabel = copy.btnStopRecording;
    primaryAction = stopRecording;
    secondaryLabel = copy.btnCancelTake;
    secondaryAction = cancelCurrentTake;
    secondaryDisabled = false;
  } else if (flowState === FLOW.REVIEW) {
    if (quietTakeNeedsDecision) {
      primaryLabel = copy.quietTakeKeep;
      primaryAction = acknowledgeQuietTake;
      primaryDisabled = !wavBlob;
      secondaryLabel = copy.quietTakeRetake;
      secondaryAction = recordAgain;
    } else {
      primaryLabel = selectedMode ? modeCopy(selectedMode).submitLabel : copy.btnChooseMemoryMode;
      primaryAction = submitCurrentTake;
      primaryDisabled = !selectedMode || !wavBlob;
      secondaryLabel = copy.btnRecordAgain;
      secondaryAction = recordAgain;
    }
    secondaryDisabled = false;
  } else if (flowState === FLOW.SUBMITTING) {
    primaryLabel = copy.btnSubmitting;
    primaryDisabled = true;
    secondaryLabel = copy.btnPleaseWait;
    secondaryDisabled = true;
  } else if (flowState === FLOW.COMPLETE) {
    primaryLabel = copy.btnStartAnother;
    primaryAction = startFreshSession;
    secondaryLabel = copy.btnStartOver;
    secondaryDisabled = true;
  } else if (flowState === FLOW.ERROR) {
    primaryLabel = copy.btnTryMicAgain;
    primaryAction = armMicrophone;
    secondaryLabel = copy.btnStartOver;
    secondaryAction = startFreshSession;
    secondaryDisabled = false;
  }

  if (intakePaused() && ![FLOW.RECORDING, FLOW.SUBMITTING, FLOW.COMPLETE].includes(flowState)) {
    primaryDisabled = true;
    if (flowState === FLOW.IDLE || flowState === FLOW.ERROR) {
      primaryLabel = copy.btnRecordingPaused;
    } else if (flowState === FLOW.REVIEW) {
      primaryLabel = copy.btnSubmissionPaused;
      secondaryLabel = copy.btnResetSession;
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
  const copy = currentCopy();
  const hasMic = captureController.hasLiveInput();
  const maxRecordingMs = recordingLimitMs();
  const elapsedMs = flowState === FLOW.RECORDING ? (performance.now() - recStartTs) : durationMs;
  const remainingMs = flowState === FLOW.RECORDING
    ? Math.max(0, maxRecordingMs - elapsedMs)
    : Math.max(0, maxRecordingMs - durationMs);
  recTimer.textContent = formatDuration(elapsedMs);
  remainingTimer.textContent = formatDuration(remainingMs);
  maxDurationHint.textContent = formatCopy(copy.maxDuration, { duration: formatDuration(maxRecordingMs) });

  if (intakePaused() && flowState === FLOW.IDLE) {
    stageBadge.textContent = maintenanceMode() ? copy.badgeMaintenance : copy.badgePaused;
    stageTitle.textContent = maintenanceMode()
      ? copy.stageMaintenanceIdleTitle
      : copy.stagePausedIdleTitle;
    stageCopy.textContent = maintenanceMode()
      ? copy.stageMaintenanceIdleCopy
      : copy.stagePausedIdleCopy;
    micStatus.textContent = copy.micAsleep;
    recStatus.textContent = maintenanceMode() ? copy.recMaintenance : copy.recPaused;
    shortcutHint.textContent = maintenanceMode() ? copy.shortcutOffline : copy.shortcutPaused;
    meterText.textContent = copy.meterWaitingResume;
    setMicCheckStatus(copy.micCheckAsleep, "quiet");
    setMeterLevel(0);
  } else if (flowState === FLOW.IDLE) {
    stageBadge.textContent = copy.badgeNotArmed;
    stageTitle.textContent = copy.stageIdleTitle;
    stageCopy.textContent = copy.stageIdleCopy;
    micStatus.textContent = copy.micAsleep;
    recStatus.textContent = copy.recNotArmed;
    shortcutHint.textContent = copy.shortcutArm;
    meterText.textContent = copy.meterWaitingMic;
    setMicCheckStatus(copy.micCheckUnavailable, "quiet");
    setMeterLevel(0);
  } else if (flowState === FLOW.ARMING) {
    stageBadge.textContent = copy.badgeArming;
    stageTitle.textContent = copy.stageArmingTitle;
    stageCopy.textContent = copy.stageArmingCopy;
    micStatus.textContent = copy.micRequesting;
    recStatus.textContent = copy.recWaitingMicAccess;
    shortcutHint.textContent = copy.micRequesting;
    meterText.textContent = copy.meterRequestingAccess;
    setMicCheckStatus(copy.micCheckStarting, "quiet");
  } else if (flowState === FLOW.ARMED) {
    stageBadge.textContent = intakePaused() ? (maintenanceMode() ? copy.badgeMaintenance : copy.badgePaused) : copy.badgeReady;
    stageTitle.textContent = intakePaused()
      ? (maintenanceMode() ? copy.stageArmedMaintenanceTitle : copy.stageArmedPausedTitle)
      : copy.stageArmedTitle;
    stageCopy.textContent = intakePaused()
      ? (maintenanceMode()
        ? copy.stageArmedMaintenanceCopy
        : copy.stageArmedPausedCopy)
      : copy.stageArmedCopy;
    micStatus.textContent = micLabel;
    recStatus.textContent = intakePaused()
      ? (maintenanceMode() ? copy.recMaintenance : copy.recPaused)
      : copy.recStandingBy;
    shortcutHint.textContent = intakePaused()
      ? (maintenanceMode() ? copy.shortcutOffline : copy.shortcutPaused)
      : copy.shortcutStart;
    meterText.textContent = hasMic ? copy.meterListeningRoom : copy.meterMicUnavailable;
  } else if (flowState === FLOW.COUNTDOWN) {
    stageBadge.textContent = copy.badgeGetReady;
    stageTitle.textContent = copy.stageCountdownTitle;
    stageCopy.textContent = copy.stageCountdownCopy;
    micStatus.textContent = micLabel;
    recStatus.textContent = copy.recCountdown;
    shortcutHint.textContent = copy.shortcutCancelCountdown;
    meterText.textContent = copy.meterListeningRoom;
  } else if (flowState === FLOW.RECORDING) {
    stageBadge.textContent = copy.badgeRecording;
    stageTitle.textContent = copy.stageRecordingTitle;
    stageCopy.textContent = copy.stageRecordingCopy;
    micStatus.textContent = micLabel;
    recStatus.textContent = copy.recRecording;
    shortcutHint.textContent = copy.shortcutStop;
    meterText.textContent = copy.meterRecordingSignal;
  } else if (flowState === FLOW.REVIEW) {
    if (quietTakeNeedsDecision) {
      stageBadge.textContent = copy.badgeQuietTake;
      stageTitle.textContent = copy.stageQuietTitle;
      stageCopy.textContent = copy.stageQuietCopy;
    } else {
      stageBadge.textContent = intakePaused() ? (maintenanceMode() ? copy.badgeMaintenance : copy.badgePaused) : copy.badgeReview;
      stageTitle.textContent = intakePaused()
        ? (maintenanceMode() ? copy.stageReviewMaintenanceTitle : copy.stageReviewPausedTitle)
        : (selectedMode ? formatCopy(copy.stageReadyTo, { label: modeCopy(selectedMode).submitLabel.toLowerCase() }) : copy.stageReviewTitle);
      stageCopy.textContent = intakePaused()
        ? (maintenanceMode()
          ? copy.stageReviewMaintenanceCopy
          : copy.stageReviewPausedCopy)
        : (selectedMode
          ? modeCopy(selectedMode).reviewCopy
          : copy.stageReviewCopy);
    }
    micStatus.textContent = hasMic ? micLabel : copy.micAsleep;
    recStatus.textContent = quietTakeNeedsDecision ? copy.recQuietInput : (wavBlob ? copy.recTakeCaptured : copy.recNoTake);
    shortcutHint.textContent = quietTakeNeedsDecision
      ? copy.shortcutKeepQuiet
      : (intakePaused()
        ? (maintenanceMode() ? copy.shortcutOffline : copy.shortcutPausedSubmit)
        : (selectedMode ? copy.shortcutSubmit : copy.shortcutModeChoice));
    meterText.textContent = quietTakeNeedsDecision ? copy.meterPreviewTake : (hasMic ? copy.meterMicStillArmed : copy.meterMicAsleep);
    setMicCheckStatus(
      quietTakeNeedsDecision ? copy.micCheckQuietWarning : (hasMic ? copy.micCheckComplete : copy.micCheckAsleep),
      quietTakeNeedsDecision ? "quiet" : (hasMic ? "good" : "quiet"),
    );
  } else if (flowState === FLOW.SUBMITTING) {
    stageBadge.textContent = copy.badgeSaving;
    stageTitle.textContent = copy.stageSavingTitle;
    stageCopy.textContent = copy.stageSavingCopy;
    micStatus.textContent = copy.micAsleep;
    recStatus.textContent = copy.recSubmitting;
    shortcutHint.textContent = copy.shortcutSubmitting;
    meterText.textContent = copy.meterMicAsleep;
    setMicCheckStatus(copy.micCheckAsleep, "quiet");
    setMeterLevel(0);
  } else if (flowState === FLOW.COMPLETE) {
    stageBadge.textContent = copy.badgeFinished;
    stageTitle.textContent = selectedMode ? modeCopy(selectedMode).completeTitle : copy.stageCompleteFallback;
    stageCopy.textContent = copy.stageCompleteCopy;
    micStatus.textContent = copy.micAsleep;
    recStatus.textContent = copy.recComplete;
    shortcutHint.textContent = copy.shortcutStartAnother;
    meterText.textContent = copy.meterMicAsleep;
    setMicCheckStatus(copy.micCheckAsleep, "quiet");
    setMeterLevel(0);
  } else if (flowState === FLOW.ERROR) {
    stageBadge.textContent = copy.badgeMicIssue;
    stageTitle.textContent = copy.stageErrorTitle;
    stageCopy.textContent = lastErrorMessage || copy.stageErrorCopyFallback;
    micStatus.textContent = copy.micUnavailable;
    recStatus.textContent = copy.recMicError;
    shortcutHint.textContent = copy.shortcutTryAgain;
    meterText.textContent = copy.meterMicUnavailable;
    setMicCheckStatus(copy.micCheckUnavailable, "quiet");
    setMeterLevel(0);
  }
}

function setMeterLevel(level) {
  meterFill.style.width = `${Math.max(0, Math.min(100, level * 100))}%`;
}

function handleMeterLevel(boosted) {
  const copy = currentCopy();
  setMeterLevel(boosted);

  if (flowState === FLOW.ARMED) {
    meterText.textContent = boosted > MIC_SIGNAL_THRESHOLD ? copy.meterSignalDetected : copy.meterWaitingVoice;
    setMicCheckStatus(
      boosted > MIC_SIGNAL_THRESHOLD ? copy.micCheckWeHearYou : copy.micCheckSpeakLouder,
      boosted > MIC_SIGNAL_THRESHOLD ? "good" : "quiet",
    );
  } else if (flowState === FLOW.COUNTDOWN) {
    meterText.textContent = boosted > MIC_SIGNAL_THRESHOLD ? copy.meterSignalDetected : copy.meterListeningClosely;
    setMicCheckStatus(
      boosted > MIC_SIGNAL_THRESHOLD ? copy.micCheckWeHearYou : copy.micCheckSpeakLouder,
      boosted > MIC_SIGNAL_THRESHOLD ? "good" : "quiet",
    );
  } else if (flowState === FLOW.RECORDING) {
    meterText.textContent = boosted > MIC_SIGNAL_THRESHOLD ? copy.meterRecordingSignal : copy.meterListeningClosely;
    setMicCheckStatus(
      boosted > MIC_SIGNAL_THRESHOLD ? copy.micCheckHealthy : copy.micCheckVeryQuiet,
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
  const copy = currentCopy();
  countdownToken += 1;
  const localToken = countdownToken;
  const countdownSeconds = shouldReduceMotion() ? 1 : PRE_ROLL_SECONDS;
  setFlowState(FLOW.COUNTDOWN);
  countdownValue.textContent = String(countdownSeconds);
  countdownLabel.textContent = shouldReduceMotion()
    ? copy.countdownSoon
    : copy.countdownMoment;

  const tick = (secondsLeft) => {
    if (localToken !== countdownToken || flowState !== FLOW.COUNTDOWN) return;
    countdownValue.textContent = String(secondsLeft);
    countdownLabel.textContent = shouldReduceMotion()
      ? (secondsLeft > 1 ? copy.countdownSoon : copy.countdownNow)
      : (secondsLeft > 1 ? copy.countdownMoment : copy.countdownNow);
    if (!shouldReduceMotion()) {
      captureController.playPreRollTone(PRE_ROLL_TONE, secondsLeft <= 1);
    }

    if (secondsLeft <= 1) {
      runAction(beginRecordingCapture);
      return;
    }

    window.setTimeout(() => tick(secondsLeft - 1), 1000);
  };

  clearTakeData();
  window.setTimeout(() => tick(countdownSeconds), 0);
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
    remainingTimer.textContent = formatDuration(Math.max(0, recordingLimitMs() - elapsed));
    if (elapsed >= recordingLimitMs()) {
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
  submitStatus.textContent = processingNoteForKey(processed.noteKey, processed.note);

  setFlowState(FLOW.REVIEW);
}

function cancelCurrentTake() {
  if (flowState !== FLOW.RECORDING) return;
  stopRecordingNodes();
  clearTakeData({ clearReceipt: false });
  submitStatus.textContent = currentCopy().takeDiscarded;
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
  submitStatus.textContent = currentCopy().quietTakeKept;
  noteReviewActivity();
  render();
}

async function submitCurrentTake() {
  if (!wavBlob || !selectedMode || flowState !== FLOW.REVIEW) {
    return;
  }
  if (intakePaused()) {
    throw new Error(currentCopy().submitErrorPaused);
  }

  submitStatus.textContent = currentCopy().submitQueued;
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
  const copy = currentCopy();
  submitStatus.textContent = modeCopy(mode).completeStatus;
  setReceiptHtml(`
    <div><strong>${copy.receiptCodeLabel}</strong><span class="token">${payload.revocation_token}</span></div>
    <div class="muted">${copy.receiptCodeHelp}</div>
    <div class="muted">${formatCopy(copy.receiptExpiryLabel, { date: localizedDateTime(payload.artifact.expires_at) })}</div>
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
  submitStatus.textContent = currentCopy().nosavePlaying;
  setReceiptText(currentCopy().nosaveReceipt);

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

  submitStatus.textContent = modeCopy("NOSAVE").completeStatus;
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
  if (!(mode in currentCopy().modes) || flowState === FLOW.SUBMITTING || quietTakeNeedsDecision) return;

  selectedMode = mode;
  choices.forEach((choice) => {
    choice.classList.toggle("selected", choice.dataset.mode === mode);
  });

  if (flowState === FLOW.REVIEW) {
    submitStatus.textContent = formatCopy(currentCopy().selectionSelected, { name: modeCopy(mode).name });
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
  const copy = currentCopy();
  if (!err || !err.name) return copy.stageErrorCopyFallback;
  if (err.name === "NotAllowedError") return copy.micErrorDenied;
  if (err.name === "NotFoundError") return copy.micErrorMissing;
  if (err.name === "NotReadableError") return copy.micErrorBusy;
  return err.message || copy.stageErrorCopyFallback;
}

function describeSubmitError(err) {
  if (err && /423/.test(err.message || "")) {
    return surfaceState.maintenance_mode
      ? currentCopy().submitErrorMaintenance
      : currentCopy().submitErrorPaused;
  }
  return err && err.message ? err.message : currentCopy().submitErrorFallback;
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
reducedMotionMediaQuery?.addEventListener?.("change", render);

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
    setFlowState(FLOW.ERROR, { errorMessage: err.message || currentCopy().unexpectedError });
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
