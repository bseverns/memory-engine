/**
 * Guided kiosk flow
 * - Explicit microphone states: idle -> armed -> recording -> review -> done
 * - Large on-screen prompts + keyboard shortcuts for kiosk deployment
 * - Recording/upload endpoints remain unchanged
 */

const FLOW = {
  IDLE: "idle",
  MONITOR: "monitor",
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
const memoryColorPanel = document.getElementById("memoryColorPanel");
const memoryChoiceContainer = memoryColorPanel?.querySelector(".memory-color-choices") || null;
const memoryColorKicker = document.getElementById("memoryColorKicker");
const memoryColorTitle = document.getElementById("memoryColorTitle");
const memoryColorHint = document.getElementById("memoryColorHint");
const memoryColorStatus = document.getElementById("memoryColorStatus");
const btnPreviewOriginal = document.getElementById("btnPreviewOriginal");
const btnPreviewColored = document.getElementById("btnPreviewColored");
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
const budgetNotice = document.getElementById("budgetNotice");
const promptPackPanel = document.getElementById("promptPackPanel");
const promptPackKicker = document.getElementById("promptPackKicker");
const promptPackTitle = document.getElementById("promptPackTitle");
const promptPackLead = document.getElementById("promptPackLead");
const promptPackList = document.getElementById("promptPackList");
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
let memoryChoices = [];

let flowState = FLOW.IDLE;
let primaryAction = null;
let secondaryAction = null;
let lastErrorMessage = "";
let micLabel = "Microphone asleep";

let selectedMode = null;
let selectedEffectProfile = "clear";
let wavBlob = null;
let durationMs = 0;
let previewUrl = "";
let previewSourceMode = "original";
let memoryColorPreviewRendering = false;
let memoryColorPreviewError = false;
let memoryColorRenderToken = 0;
let lastMemoryColorPreviewRenderMs = 0;
let lastMemoryColorPreviewProfile = "";
const memoryColorPreviewUrls = new Map();
const MEMORY_COLOR_PREVIEW_TIMING_NOTE_MS = 350;

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
const PUBLIC_CLIENT_STORAGE_KEY = "memory-engine-public-client-id-v1";

const kioskCopyApi = window.MemoryEngineKioskCopy;
const kioskView = window.MemoryEngineKioskView;
const memoryColorCatalogApi = window.MemoryEngineMemoryColorCatalog;

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
  playMonitorCheckTone,
  processRecordingSamples,
  renderMemoryColorPreviewBlob,
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
const ENGINE_DEPLOYMENT = String(kioskConfig.engineDeployment || "memory");

function buildMemoryChoiceButton(profile) {
  const choice = document.createElement("button");
  choice.type = "button";
  choice.className = "memory-choice";
  choice.dataset.effectProfile = profile.code;
  choice.textContent = profile.labels.en || profile.code;
  return choice;
}

const memoryColorCatalog = memoryColorCatalogApi.getMemoryColorCatalog();
const memoryColorProfileMap = new Map(memoryColorCatalog.profiles.map((profile) => [profile.code, profile]));
if (memoryChoiceContainer) {
  memoryChoices = memoryColorCatalog.profiles.map(buildMemoryChoiceButton);
  memoryChoiceContainer.replaceChildren(...memoryChoices);
}

selectedEffectProfile = memoryColorCatalogApi.getDefaultMemoryColorCode();

let surfaceState = {
  intake_paused: false,
  playback_paused: false,
  quieter_mode: false,
  maintenance_mode: false,
  kiosk_language_code: "",
  kiosk_accessibility_mode: "",
  kiosk_force_reduced_motion: false,
  kiosk_max_recording_seconds: DEFAULT_MAX_RECORDING_SECONDS,
  ingest_budget: null,
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

function withSessionThemeFraming(basePack) {
  return kioskCopyApi.applySessionThemeFraming(basePack, surfaceState);
}

function currentCopy() {
  const deploymentPack = kioskCopyApi.getDeploymentPack(currentLanguageCode(), ENGINE_DEPLOYMENT);
  return withSessionThemeFraming(deploymentPack);
}

function formatCopy(template, values = {}) {
  return kioskCopyApi.formatMessage(template, values);
}

function modeCopy(mode) {
  return currentCopy().modes[mode];
}

function memoryProfileCopy(profile = selectedEffectProfile) {
  const normalized = memoryColorCatalogApi.normalizeMemoryColorCode(profile, memoryColorCatalog.default);
  const spec = memoryColorProfileMap.get(normalized) || memoryColorProfileMap.get(memoryColorCatalog.default);
  if (!spec) {
    return {
      code: normalized || memoryColorCatalog.default,
      name: normalized || "Clear",
      description: currentCopy().memoryColorHint,
    };
  }
  const languageCode = currentLanguageCode();
  return {
    code: spec.code,
    name: spec.labels[languageCode] || spec.labels[DEFAULT_LANGUAGE_CODE] || spec.labels.en || spec.code,
    description: spec.descriptions[languageCode] || spec.descriptions[DEFAULT_LANGUAGE_CODE] || spec.descriptions.en || currentCopy().memoryColorHint,
  };
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

function publicClientId() {
  try {
    const existing = String(window.localStorage.getItem(PUBLIC_CLIENT_STORAGE_KEY) || "").trim();
    if (existing) {
      return existing;
    }
    const generated = `kiosk-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    window.localStorage.setItem(PUBLIC_CLIENT_STORAGE_KEY, generated);
    return generated;
  } catch (error) {
    return `kiosk-${Date.now().toString(36)}`;
  }
}

function publicClientHeaders() {
  return {
    "X-Memory-Client-Id": publicClientId(),
  };
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

function buildViewContext() {
  return {
    FLOW,
    MIC_SIGNAL_THRESHOLD,
    REVIEW_IDLE_TIMEOUT_MS,
    performance,
    document,
    captureController,
    flowState,
    selectedMode,
    selectedEffectProfile,
    memoryColorProfiles: memoryColorCatalog.profiles,
    previewSourceMode,
    memoryColorPreviewRendering,
    memoryColorPreviewError,
    lastMemoryColorPreviewRenderMs,
    lastMemoryColorPreviewProfile,
    memoryColorPreviewTimingNoteThresholdMs: MEMORY_COLOR_PREVIEW_TIMING_NOTE_MS,
    wavBlob,
    durationMs,
    recStartTs,
    reviewDeadlineTs,
    quietTakeNeedsDecision,
    quietTakeAnalysis,
    hasReceipt,
    attractStepIndex,
    lastErrorMessage,
    micLabel,
    surfaceState,
    btnPrimary,
    btnSecondary,
    btnSubmit,
    btnQuietKeep,
    btnQuietRetake,
    stageBadge,
    stageTitle,
    stageCopy,
    shortcutHint,
    micStatus,
    micCheckStatus,
    recStatus,
    recTimer,
    remainingTimer,
    maxDurationHint,
    meterText,
    meterFill,
    submitStatus,
    selectionHint,
    receiptPanel,
    memoryColorPanel,
    memoryColorKicker,
    memoryColorTitle,
    memoryColorHint,
    memoryColorStatus,
    btnPreviewOriginal,
    btnPreviewColored,
    reviewTimeoutPanel,
    reviewTimeoutChip,
    reviewTimeoutFill,
    quietTakePanel,
    quietTakeCopy,
    attractPanel,
    attractLead,
    operatorNotice,
    budgetNotice,
    promptPackPanel,
    promptPackKicker,
    promptPackTitle,
    promptPackLead,
    promptPackList,
    heroEyebrow,
    heroTitle,
    heroSub,
    meterLabel,
    elapsedLabel,
    remainingLabel,
    shortcutReset,
    privacyHint,
    quietTakeKicker,
    quietTakeTitle,
    reviewTimeoutHint,
    receiptKicker,
    receiptTitle,
    countdownKicker,
    footerCopy,
    choiceCopyEls,
    memoryChoices,
    countdownOverlay,
    modePanel,
    choices,
    stepEls,
    attractSteps,
    currentCopy,
    formatCopy,
    modeCopy,
    memoryProfileCopy,
    recordingLimitMs,
    accessibilityModeEnabled,
    shouldReduceMotion,
    intakePaused,
    maintenanceMode,
    memoryColorPreviewAvailable(profile) {
      return memoryColorPreviewUrls.has(memoryColorCatalogApi.normalizeMemoryColorCode(profile, memoryColorCatalog.default));
    },
    formatDuration,
    actions: {
      acknowledgeQuietTake,
      armMicrophone,
      chooseMemoryPreview,
      chooseOriginalPreview,
      cancelCountdown,
      cancelCurrentTake,
      closeMonitorCheck,
      disarmToIdle,
      openMonitorCheck,
      recordAgain,
      runMonitorCheck,
      selectEffectProfile,
      startFreshSession,
      startRecording,
      stopRecording,
      submitCurrentTake,
    },
    setPrimaryAction(nextAction) {
      primaryAction = nextAction;
    },
    setSecondaryAction(nextAction) {
      secondaryAction = nextAction;
    },
  };
}

function render() {
  kioskView.render(buildViewContext());
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

function updateOperatorNotice() { kioskView.updateOperatorNotice(buildViewContext()); }
function updateStepper() { kioskView.updateStepper(buildViewContext()); }

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
  kioskView.updateReviewTimeoutPanel(buildViewContext());
}

function noteReviewActivity() {
  if (flowState !== FLOW.REVIEW) return;
  resetReviewDeadline();
  updateReviewTimeoutPanel();
}

function updateQuietTakePanel() { kioskView.updateQuietTakePanel(buildViewContext()); }

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

function updateAttractPanel() { kioskView.updateAttractPanel(buildViewContext()); }
function updateModePanel() { kioskView.updateModePanel(buildViewContext()); }
function updateReceiptPanel() { kioskView.updateReceiptPanel(buildViewContext()); }
function updateButtons() { kioskView.updateButtons(buildViewContext()); }
function updateStage() { kioskView.updateStage(buildViewContext()); }
function setMeterLevel(level) { kioskView.setMeterLevel(buildViewContext(), level); }
function handleMeterLevel(boosted) { kioskView.handleMeterLevel(buildViewContext(), boosted); }
function setMicCheckStatus(text, tone) { kioskView.setMicCheckStatus(buildViewContext(), text, tone); }

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

function revokeMemoryColorPreviewUrls() {
  for (const url of memoryColorPreviewUrls.values()) {
    try {
      URL.revokeObjectURL(url);
    } catch (error) {}
  }
  memoryColorPreviewUrls.clear();
}

function currentPreviewSourceUrl() {
  if (previewSourceMode === "memory") {
    return memoryColorPreviewUrls.get(selectedEffectProfile) || "";
  }
  return previewUrl;
}

function applyPreviewSource() {
  const targetUrl = currentPreviewSourceUrl();
  if (!targetUrl) {
    return;
  }
  if (preview.getAttribute("src") === targetUrl && !preview.hidden) {
    return;
  }
  preview.pause();
  preview.src = targetUrl;
  preview.hidden = false;
  preview.load();
}

async function ensureMemoryColorPreview(profile) {
  const normalized = memoryColorCatalogApi.normalizeMemoryColorCode(profile, memoryColorCatalog.default);
  if (!wavBlob) return "";
  if (memoryColorPreviewUrls.has(normalized)) {
    return memoryColorPreviewUrls.get(normalized) || "";
  }

  const renderToken = ++memoryColorRenderToken;
  const renderStartedAt = performance.now();
  memoryColorPreviewRendering = true;
  memoryColorPreviewError = false;
  render();
  try {
    const coloredBlob = await renderMemoryColorPreviewBlob(wavBlob, normalized);
    if (renderToken !== memoryColorRenderToken) {
      return memoryColorPreviewUrls.get(normalized) || "";
    }
    const coloredUrl = URL.createObjectURL(coloredBlob);
    memoryColorPreviewUrls.set(normalized, coloredUrl);
    memoryColorPreviewRendering = false;
    memoryColorPreviewError = false;
    lastMemoryColorPreviewRenderMs = Math.max(0, performance.now() - renderStartedAt);
    lastMemoryColorPreviewProfile = normalized;
    if (previewSourceMode === "memory" && selectedEffectProfile === normalized) {
      applyPreviewSource();
    }
    render();
    return coloredUrl;
  } catch (error) {
    if (renderToken !== memoryColorRenderToken) {
      return "";
    }
    memoryColorPreviewRendering = false;
    memoryColorPreviewError = true;
    lastMemoryColorPreviewRenderMs = 0;
    lastMemoryColorPreviewProfile = "";
    if (previewSourceMode === "memory" && selectedEffectProfile === normalized) {
      previewSourceMode = "original";
      applyPreviewSource();
    }
    render();
    return "";
  }
}

async function chooseOriginalPreview() {
  if (!wavBlob) return;
  previewSourceMode = "original";
  applyPreviewSource();
  noteReviewActivity();
  render();
}

async function chooseMemoryPreview() {
  if (!wavBlob) return;
  previewSourceMode = "memory";
  applyPreviewSource();
  noteReviewActivity();
  render();
  const readyUrl = await ensureMemoryColorPreview(selectedEffectProfile);
  if (!readyUrl && previewSourceMode === "memory") {
    previewSourceMode = "original";
    applyPreviewSource();
    render();
  }
}

async function selectEffectProfile(profile) {
  if (![FLOW.REVIEW, FLOW.SUBMITTING, FLOW.COMPLETE].includes(flowState)) return;
  if (flowState === FLOW.SUBMITTING || quietTakeNeedsDecision) return;
  const normalized = memoryColorCatalogApi.normalizeMemoryColorCode(profile, "");
  if (!normalized) return;
  selectedEffectProfile = normalized;
  memoryColorPreviewError = false;
  if (previewSourceMode === "memory") {
    preview.pause();
    preview.removeAttribute("src");
    preview.load();
    await ensureMemoryColorPreview(normalized);
    applyPreviewSource();
  } else {
    void ensureMemoryColorPreview(normalized);
  }
  noteReviewActivity();
  render();
}

function clearPreview() {
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = "";
  }
  revokeMemoryColorPreviewUrls();
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
  selectedEffectProfile = memoryColorCatalog.default;
  previewSourceMode = "original";
  memoryColorPreviewRendering = false;
  memoryColorPreviewError = false;
  lastMemoryColorPreviewRenderMs = 0;
  lastMemoryColorPreviewProfile = "";
  memoryColorRenderToken += 1;
  choices.forEach((choice) => choice.classList.remove("selected"));
  memoryChoices.forEach((choice) => choice.classList.remove("selected"));
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
  selectedEffectProfile = memoryColorCatalog.default;
  previewSourceMode = "original";
  memoryColorPreviewRendering = false;
  memoryColorPreviewError = false;
  lastMemoryColorPreviewRenderMs = 0;
  lastMemoryColorPreviewProfile = "";
  previewUrl = URL.createObjectURL(wavBlob);
  preview.src = previewUrl;
  preview.hidden = false;
  quietTakeNeedsDecision = !!processed.quietWarning;
  quietTakeAnalysis = processed.quietWarning;
  submitStatus.textContent = processingNoteForKey(processed.noteKey, processed.note);

  setFlowState(FLOW.REVIEW);
  void ensureMemoryColorPreview(selectedEffectProfile);
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
    await refreshSurfaceState();
    setFlowState(FLOW.COMPLETE);
  } catch (err) {
    await refreshSurfaceState();
    submitStatus.textContent = describeSubmitError(err);
    setFlowState(FLOW.REVIEW);
  }
}

async function submitSave(mode) {
  const form = new FormData();
  form.append("file", wavBlob, "audio.wav");
  form.append("consent_mode", mode);
  form.append("duration_ms", String(durationMs));
  form.append("effect_profile", selectedEffectProfile);

  const res = await fetch("/api/v1/artifacts/audio", {
    method: "POST",
    body: form,
    headers: publicClientHeaders(),
  });
  if (!res.ok) {
    throw await requestJsonError(res, `Save failed (${res.status})`);
  }

  const payload = await res.json();
  const copy = currentCopy();
  submitStatus.textContent = modeCopy(mode).completeStatus;
  setReceiptHtml(`
    <div><strong>${copy.receiptCodeLabel}</strong><span class="token">${payload.revocation_token}</span></div>
    <div class="muted">${copy.receiptCodeHelp}</div>
    <div class="muted">${copy.receiptGuideLine}</div>
    <div class="muted">${copy.receiptLocalOnlyLine}</div>
    <div class="muted">${formatCopy(copy.receiptExpiryLabel, { date: localizedDateTime(payload.artifact.expires_at) })}</div>
  `);
}

async function submitNoSave() {
  const form = new FormData();
  form.append("file", wavBlob, "audio.wav");
  form.append("duration_ms", String(durationMs));
  form.append("effect_profile", selectedEffectProfile);

  const res = await fetch("/api/v1/ephemeral/audio", {
    method: "POST",
    body: form,
    headers: publicClientHeaders(),
  });
  if (!res.ok) {
    throw await requestJsonError(res, `Playback failed (${res.status})`);
  }

  const payload = await res.json();
  submitStatus.textContent = currentCopy().nosavePlaying;
  setReceiptText(currentCopy().nosaveReceipt);

  await playUrlWithLightChain(payload.play_url, 0.0, {
    memoryColorProfile: selectedEffectProfile,
  });

  submitStatus.textContent = modeCopy("NOSAVE").completeStatus;
}

async function disarmToIdle() {
  countdownToken += 1;
  await teardownMicrophone();
  clearTakeData();
  setFlowState(FLOW.IDLE, { errorMessage: "" });
}

async function openMonitorCheck() {
  countdownToken += 1;
  await teardownMicrophone();
  clearTakeData();
  setFlowState(FLOW.MONITOR, { errorMessage: "" });
}

function closeMonitorCheck() {
  setFlowState(FLOW.IDLE, { errorMessage: "" });
}

async function runMonitorCheck() {
  await playMonitorCheckTone();
  const spokePrompt = await playMonitorSpeechPrompt();
  setMicCheckStatus(
    spokePrompt ? currentCopy().micCheckPromptComplete : currentCopy().micCheckComplete,
    "good",
  );
  meterText.textContent = spokePrompt
    ? currentCopy().meterMonitorPrompt
    : currentCopy().meterMonitor;
}

async function playMonitorSpeechPrompt() {
  const speechSynthesisApi = window.speechSynthesis;
  const SpeechSynthesisUtteranceCtor = window.SpeechSynthesisUtterance;
  const promptText = String(currentCopy().monitorSpeechPrompt || "").trim();
  if (!speechSynthesisApi || !SpeechSynthesisUtteranceCtor || !promptText) {
    return false;
  }

  return await new Promise((resolve) => {
    let settled = false;
    let timeoutId = 0;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      resolve(Boolean(value));
    };

    const utterance = new SpeechSynthesisUtteranceCtor(promptText);
    utterance.lang = currentCopy().htmlLang || "en";
    utterance.rate = 0.96;
    utterance.pitch = 1.0;
    utterance.volume = 0.88;
    utterance.onend = () => finish(true);
    utterance.onerror = () => finish(false);

    timeoutId = window.setTimeout(() => finish(false), 6500);
    try {
      speechSynthesisApi.cancel();
      speechSynthesisApi.speak(utterance);
    } catch (error) {
      finish(false);
    }
  });
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
  if (err && (err.status === 429 || /429/.test(err.message || ""))) {
    const budget = surfaceState.ingest_budget || {};
    const resetInSeconds = Number(budget.effective_reset_in_seconds || 0);
    if (resetInSeconds > 0) {
      return formatCopy(currentCopy().submitErrorBusyUntil, {
        duration: formatDuration(resetInSeconds * 1000),
      });
    }
    return currentCopy().submitErrorBusy;
  }
  return err && err.message ? err.message : currentCopy().submitErrorFallback;
}

async function requestJsonError(res, fallbackMessage) {
  let detail = "";
  try {
    const payload = await res.json();
    detail = String(payload.error || payload.detail || "").trim();
  } catch (error) {}
  const err = new Error(detail || fallbackMessage || `Request failed (${res.status})`);
  err.status = res.status;
  return err;
}

async function refreshSurfaceState() {
  try {
    const response = await fetch("/api/v1/surface/state", {
      cache: "no-store",
      headers: publicClientHeaders(),
    });
    if (!response.ok) {
      throw new Error(`surface state failed (${response.status})`);
    }
    const payload = await response.json();
    surfaceState = {
      ...surfaceState,
      ...(payload.operator_state || {}),
    };
    if (payload.ingest_budget) {
      surfaceState.ingest_budget = payload.ingest_budget;
    }
    render();
  } catch (err) {}
}

btnPrimary.addEventListener("click", () => runAction(primaryAction));
btnSecondary.addEventListener("click", () => runAction(secondaryAction));
btnSubmit.addEventListener("click", () => runAction(submitCurrentTake));
btnQuietKeep.addEventListener("click", () => runAction(acknowledgeQuietTake));
btnQuietRetake.addEventListener("click", () => runAction(recordAgain));
btnPreviewOriginal.addEventListener("click", () => {
  void chooseOriginalPreview();
});
btnPreviewColored.addEventListener("click", () => {
  void chooseMemoryPreview();
});

choices.forEach((choice) => {
  choice.addEventListener("click", () => selectMode(choice.dataset.mode));
});
memoryChoiceContainer?.addEventListener("click", (event) => {
  const choice = event.target instanceof Element
    ? event.target.closest(".memory-choice")
    : null;
  if (!choice) return;
  void selectEffectProfile(choice.dataset.effectProfile);
});

preview.addEventListener("play", noteReviewActivity);
preview.addEventListener("seeking", noteReviewActivity);
preview.addEventListener("pause", noteReviewActivity);
reducedMotionMediaQuery?.addEventListener?.("change", render);

document.addEventListener("pointerdown", noteReviewActivity, true);
document.addEventListener("focusin", noteReviewActivity, true);

document.addEventListener("keydown", (event) => {
  noteReviewActivity();
  // Keep kiosk shortcuts stable. They now serve both ordinary keyboard fallback
  // and the Leonardo HID button path documented in docs/HANDS_FREE_CONTROLS.md.
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

  if (event.code === "KeyM" && [FLOW.IDLE, FLOW.MONITOR, FLOW.ARMED, FLOW.ERROR].includes(flowState)) {
    event.preventDefault();
    if (flowState === FLOW.MONITOR) {
      runAction(closeMonitorCheck);
    } else {
      runAction(openMonitorCheck);
    }
    return;
  }

  if (shouldIgnoreShortcut(event.target)) return;

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

function generateTestTakeBlob({ seconds = 1.4, sampleRate = 16000 } = {}) {
  const frameCount = Math.max(1, Math.floor(sampleRate * seconds));
  const samples = new Float32Array(frameCount);
  for (let index = 0; index < frameCount; index += 1) {
    const time = index / sampleRate;
    samples[index] = (
      (Math.sin(2 * Math.PI * 220 * time) * 0.18)
      + (Math.sin(2 * Math.PI * 330 * time) * 0.07)
    );
  }
  return {
    sampleRate,
    samples,
    wav: encodeWavMono16(samples, sampleRate),
  };
}

async function seedReviewTakeForBrowserTests(options = {}) {
  clearTakeData();
  await teardownMicrophone();
  const seeded = generateTestTakeBlob({
    seconds: Number(options.seconds || 1.4),
    sampleRate: Number(options.sampleRate || 16000),
  });
  wavBlob = seeded.wav;
  durationMs = Math.round((seeded.samples.length / seeded.sampleRate) * 1000);
  selectedEffectProfile = memoryColorCatalogApi.normalizeMemoryColorCode(options.effectProfile, memoryColorCatalog.default) || memoryColorCatalog.default;
  previewSourceMode = "original";
  memoryColorPreviewRendering = false;
  memoryColorPreviewError = false;
  lastMemoryColorPreviewRenderMs = 0;
  lastMemoryColorPreviewProfile = "";
  previewUrl = URL.createObjectURL(wavBlob);
  preview.src = previewUrl;
  preview.hidden = false;
  quietTakeNeedsDecision = false;
  quietTakeAnalysis = null;
  submitStatus.textContent = "";
  setFlowState(FLOW.REVIEW);
  void ensureMemoryColorPreview(selectedEffectProfile);
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

if (kioskConfig.browserTestMode) {
  window.MemoryEngineKioskTest = {
    async seedReviewTake(options = {}) {
      await seedReviewTakeForBrowserTests(options);
    },
    async selectMemoryColor(profile) {
      await selectEffectProfile(profile);
    },
    async chooseMemoryPreview() {
      await chooseMemoryPreview();
    },
    async chooseOriginalPreview() {
      await chooseOriginalPreview();
    },
    async selectMode(mode) {
      await selectMode(mode);
    },
    async submitCurrentTake() {
      await submitCurrentTake();
    },
    async openMonitorCheck() {
      await openMonitorCheck();
    },
    async runMonitorCheck() {
      await runMonitorCheck();
    },
    currentFlowState() {
      return flowState;
    },
  };
}

render();
