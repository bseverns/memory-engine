(function initMemoryEngineKioskView(global) {
  function flowStateToStepIndex(state, FLOW) {
    if ([FLOW.IDLE, FLOW.MONITOR, FLOW.ARMING, FLOW.ARMED, FLOW.ERROR].includes(state)) return 0;
    if ([FLOW.COUNTDOWN, FLOW.RECORDING].includes(state)) return 1;
    if ([FLOW.REVIEW, FLOW.SUBMITTING].includes(state)) return 2;
    return 3;
  }

  function applyStaticCopy(ctx) {
    const copy = ctx.currentCopy();
    ctx.document.documentElement.lang = copy.htmlLang;
    ctx.document.title = copy.documentTitle;
    if (ctx.heroEyebrow) ctx.heroEyebrow.textContent = copy.heroEyebrow;
    if (ctx.heroTitle) ctx.heroTitle.textContent = copy.heroTitle;
    if (ctx.heroSub) ctx.heroSub.textContent = copy.heroSub;
    if (ctx.meterLabel) ctx.meterLabel.textContent = copy.meterLabel;
    if (ctx.elapsedLabel) ctx.elapsedLabel.textContent = copy.timerElapsed;
    if (ctx.remainingLabel) ctx.remainingLabel.textContent = copy.timerRemaining;
    if (ctx.shortcutReset) ctx.shortcutReset.textContent = copy.resetShortcut;
    if (ctx.privacyHint) ctx.privacyHint.textContent = copy.privacyHint;
    if (ctx.quietTakeKicker) ctx.quietTakeKicker.textContent = copy.quietTakeKicker;
    if (ctx.quietTakeTitle) ctx.quietTakeTitle.textContent = copy.quietTakeTitle;
    if (ctx.btnQuietKeep) ctx.btnQuietKeep.textContent = copy.quietTakeKeep;
    if (ctx.btnQuietRetake) ctx.btnQuietRetake.textContent = copy.quietTakeRetake;
    if (ctx.reviewTimeoutHint) ctx.reviewTimeoutHint.textContent = copy.reviewTimeoutHint;
    if (ctx.receiptKicker) ctx.receiptKicker.textContent = copy.receiptKicker;
    if (ctx.receiptTitle) ctx.receiptTitle.textContent = copy.receiptTitle;
    if (ctx.memoryColorKicker) ctx.memoryColorKicker.textContent = copy.memoryColorKicker;
    if (ctx.memoryColorTitle) ctx.memoryColorTitle.textContent = copy.memoryColorTitle;
    if (ctx.btnPreviewOriginal) ctx.btnPreviewOriginal.textContent = copy.previewOriginal;
    if (ctx.btnPreviewColored) ctx.btnPreviewColored.textContent = copy.previewColored;
    if (ctx.countdownKicker) ctx.countdownKicker.textContent = copy.countdownKicker;
    if (ctx.footerCopy) ctx.footerCopy.textContent = copy.footerCopy;
    for (const [mode, els] of ctx.choiceCopyEls.entries()) {
      const modeStrings = copy.modes[mode];
      if (!modeStrings) continue;
      if (els.title) els.title.textContent = modeStrings.name;
      if (els.copy) els.copy.textContent = modeStrings.optionCopy;
    }
    for (const choice of ctx.memoryChoices) {
      const profileStrings = ctx.memoryProfileCopy(String(choice.dataset.effectProfile || "").trim().toLowerCase());
      if (!profileStrings) continue;
      choice.textContent = profileStrings.name;
    }
  }

  function updateOperatorNotice(ctx) {
    if (!ctx.operatorNotice) return;
    if (!ctx.intakePaused()) {
      ctx.operatorNotice.hidden = true;
      ctx.operatorNotice.textContent = "";
      return;
    }

    ctx.operatorNotice.hidden = false;
    const copy = ctx.currentCopy();
    if (ctx.surfaceState.maintenance_mode) {
      ctx.operatorNotice.textContent = copy.operatorMaintenance;
      return;
    }
    ctx.operatorNotice.textContent = ctx.flowState === ctx.FLOW.REVIEW && ctx.wavBlob
      ? copy.operatorPausedReview
      : copy.operatorPausedIdle;
  }

  function updateBudgetNotice(ctx) {
    if (!ctx.budgetNotice) return;
    const budget = ctx.surfaceState.ingest_budget || null;
    if (!budget || ctx.intakePaused()) {
      ctx.budgetNotice.hidden = true;
      ctx.budgetNotice.textContent = "";
      ctx.budgetNotice.classList.remove("warning");
      return;
    }

    if (!budget.low && !budget.exhausted) {
      ctx.budgetNotice.hidden = true;
      ctx.budgetNotice.textContent = "";
      ctx.budgetNotice.classList.remove("warning");
      return;
    }

    const copy = ctx.currentCopy();
    const remaining = Number(budget.effective_remaining || 0);
    const resetInSeconds = Number(budget.effective_reset_in_seconds || 0);
    ctx.budgetNotice.hidden = false;
    ctx.budgetNotice.classList.toggle("warning", true);
    ctx.budgetNotice.textContent = budget.exhausted
      ? ctx.formatCopy(copy.budgetExhausted, {
        duration: ctx.formatDuration(resetInSeconds * 1000),
      })
      : ctx.formatCopy(copy.budgetLow, {
        remaining: String(remaining),
        duration: ctx.formatDuration(resetInSeconds * 1000),
      });
  }

  function updateStepper(ctx) {
    const activeIndex = flowStateToStepIndex(ctx.flowState, ctx.FLOW);
    ctx.stepEls.forEach((stepEl, index) => {
      stepEl.classList.toggle("active", index === activeIndex);
      stepEl.classList.toggle("completed", index < activeIndex);
    });
  }

  function updateReviewTimeoutPanel(ctx) {
    const visible = ctx.flowState === ctx.FLOW.REVIEW && ctx.reviewDeadlineTs > 0;
    ctx.reviewTimeoutPanel.hidden = !visible;
    if (!visible) {
      ctx.reviewTimeoutChip.classList.remove("warning");
      ctx.reviewTimeoutFill.style.width = "100%";
      return;
    }

    const remainingMs = Math.max(0, ctx.reviewDeadlineTs - ctx.performance.now());
    const progress = Math.max(0, Math.min(1, remainingMs / ctx.REVIEW_IDLE_TIMEOUT_MS));
    ctx.reviewTimeoutChip.textContent = ctx.formatCopy(ctx.currentCopy().reviewResetsIn, {
      duration: ctx.formatDuration(remainingMs),
    });
    ctx.reviewTimeoutChip.classList.toggle("warning", remainingMs <= 20000);
    ctx.reviewTimeoutFill.style.width = `${progress * 100}%`;
  }

  function updateQuietTakePanel(ctx) {
    const visible = ctx.flowState === ctx.FLOW.REVIEW && ctx.quietTakeNeedsDecision;
    ctx.quietTakePanel.hidden = !visible;
    if (!visible) return;

    const copy = ctx.currentCopy();
    ctx.quietTakeCopy.textContent = ctx.quietTakeAnalysis
      ? copy.quietTakeCopyMeasured
      : copy.quietTakeCopyDefault;
  }

  function updateAttractPanel(ctx) {
    if (!ctx.attractPanel || !ctx.attractLead || ctx.attractSteps.length === 0) return;
    const visible = ctx.flowState === ctx.FLOW.IDLE;
    ctx.attractPanel.hidden = !visible;
    if (!visible) return;

    const copy = ctx.currentCopy();
    const messages = [
      copy.shortcutArm,
      copy.stageIdleCopy,
      copy.stageArmedCopy,
    ];
    const activeIndex = ctx.shouldReduceMotion() ? 0 : (ctx.attractStepIndex % messages.length);
    ctx.attractLead.textContent = messages[activeIndex];
    ctx.attractSteps.forEach((step, index) => {
      step.classList.toggle("active", index === activeIndex);
    });
  }

  function updateModePanel(ctx) {
    const copy = ctx.currentCopy();
    const visible = [ctx.FLOW.REVIEW, ctx.FLOW.SUBMITTING].includes(ctx.flowState);
    if (ctx.modePanel) {
      ctx.modePanel.hidden = !visible;
    }
    const interactive = ctx.flowState === ctx.FLOW.REVIEW && !ctx.quietTakeNeedsDecision;
    ctx.modePanel.classList.toggle("locked", !interactive);
    ctx.choices.forEach((choice) => {
      choice.disabled = !interactive;
    });

    if (!visible) {
      ctx.selectionHint.textContent = copy.selectionUnlocked;
    } else if (ctx.flowState === ctx.FLOW.REVIEW && ctx.quietTakeNeedsDecision) {
      ctx.selectionHint.textContent = copy.selectionKeepOrRetake;
    } else if (!ctx.selectedMode) {
      ctx.selectionHint.textContent = copy.selectionPressChoice;
    } else {
      ctx.selectionHint.textContent = ctx.formatCopy(copy.selectionSelected, { name: ctx.modeCopy(ctx.selectedMode).name });
    }

    if (ctx.intakePaused()) {
      ctx.selectionHint.textContent = copy.selectionPaused;
    }

    const canSubmit = ctx.flowState === ctx.FLOW.REVIEW && !!ctx.wavBlob && !!ctx.selectedMode && !ctx.intakePaused();
    ctx.btnSubmit.disabled = !canSubmit;
    ctx.btnSubmit.textContent = ctx.selectedMode ? ctx.modeCopy(ctx.selectedMode).submitLabel : copy.submitSelection;
  }

  function updateMemoryColorPanel(ctx) {
    if (!ctx.memoryColorPanel) return;
    const copy = ctx.currentCopy();
    const visible = [ctx.FLOW.REVIEW, ctx.FLOW.SUBMITTING].includes(ctx.flowState) && !!ctx.wavBlob;
    ctx.memoryColorPanel.hidden = !visible;
    if (!visible) {
      return;
    }

    const profileCopy = ctx.memoryProfileCopy(ctx.selectedEffectProfile);
    const interactive = ctx.flowState === ctx.FLOW.REVIEW && !ctx.quietTakeNeedsDecision;
    ctx.memoryColorPanel.classList.toggle("locked", !interactive);
    ctx.memoryColorHint.textContent = profileCopy?.description || copy.memoryColorHint;

    ctx.memoryChoices.forEach((choice) => {
      const profile = String(choice.dataset.effectProfile || "").trim().toLowerCase();
      choice.disabled = !interactive;
      choice.classList.toggle("selected", profile === ctx.selectedEffectProfile);
      choice.setAttribute("aria-pressed", profile === ctx.selectedEffectProfile ? "true" : "false");
    });

    const originalSelected = ctx.previewSourceMode !== "memory";
    const coloredSelected = ctx.previewSourceMode === "memory";
    const timingSuffix = (
      ctx.lastMemoryColorPreviewProfile === ctx.selectedEffectProfile
      && ctx.lastMemoryColorPreviewRenderMs >= ctx.memoryColorPreviewTimingNoteThresholdMs
    )
      ? ctx.formatCopy(copy.memoryColorStatusTimingSuffix, {
        duration: (ctx.lastMemoryColorPreviewRenderMs / 1000).toLocaleString(copy.locale, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }),
      })
      : "";
    ctx.btnPreviewOriginal.disabled = !interactive;
    ctx.btnPreviewColored.disabled = !interactive || (ctx.memoryColorPreviewRendering && coloredSelected);
    ctx.btnPreviewOriginal.classList.toggle("selected", originalSelected);
    ctx.btnPreviewColored.classList.toggle("selected", coloredSelected);
    ctx.btnPreviewOriginal.setAttribute("aria-pressed", originalSelected ? "true" : "false");
    ctx.btnPreviewColored.setAttribute("aria-pressed", coloredSelected ? "true" : "false");

    if (ctx.memoryColorPreviewRendering && coloredSelected) {
      ctx.memoryColorStatus.textContent = copy.memoryColorStatusRendering;
      return;
    }

    if (ctx.memoryColorPreviewError) {
      ctx.memoryColorStatus.textContent = copy.memoryColorStatusUnavailable;
      return;
    }

    if (coloredSelected && ctx.memoryColorPreviewAvailable(ctx.selectedEffectProfile)) {
      ctx.memoryColorStatus.textContent = ctx.formatCopy(copy.memoryColorStatusPreviewing, {
        name: profileCopy?.name || ctx.selectedEffectProfile,
      }) + timingSuffix;
      return;
    }

    if (profileCopy) {
      ctx.memoryColorStatus.textContent = ctx.formatCopy(copy.memoryColorStatusSelected, {
        name: profileCopy.name,
      }) + timingSuffix;
      return;
    }

    ctx.memoryColorStatus.textContent = copy.memoryColorStatusOriginal;
  }

  function updateReceiptPanel(ctx) {
    if (!ctx.receiptPanel) return;
    ctx.receiptPanel.hidden = !ctx.hasReceipt;
  }

  function updateButtons(ctx) {
    const copy = ctx.currentCopy();
    let primaryLabel = copy.btnArm;
    let primaryDisabled = false;
    let secondaryLabel = copy.btnMonitorCheck;
    let secondaryDisabled = false;
    let nextPrimaryAction = ctx.actions.armMicrophone;
    let nextSecondaryAction = ctx.actions.openMonitorCheck;

    if (ctx.flowState === ctx.FLOW.ARMING) {
      primaryLabel = copy.btnArming;
      primaryDisabled = true;
      secondaryLabel = copy.btnPleaseWait;
      secondaryDisabled = true;
    } else if (ctx.flowState === ctx.FLOW.MONITOR) {
      primaryLabel = copy.btnPlayMonitorCheck;
      nextPrimaryAction = ctx.actions.runMonitorCheck;
      secondaryLabel = copy.btnReturnToMic;
      nextSecondaryAction = ctx.actions.closeMonitorCheck;
      secondaryDisabled = false;
    } else if (ctx.flowState === ctx.FLOW.ARMED) {
      primaryLabel = copy.btnStartRecording;
      nextPrimaryAction = ctx.actions.startRecording;
      secondaryLabel = copy.btnDisarm;
      nextSecondaryAction = ctx.actions.disarmToIdle;
      secondaryDisabled = false;
    } else if (ctx.flowState === ctx.FLOW.COUNTDOWN) {
      primaryLabel = copy.btnStartingSoon;
      primaryDisabled = true;
      secondaryLabel = copy.btnCancelCountdown;
      nextSecondaryAction = ctx.actions.cancelCountdown;
      secondaryDisabled = false;
    } else if (ctx.flowState === ctx.FLOW.RECORDING) {
      primaryLabel = copy.btnStopRecording;
      nextPrimaryAction = ctx.actions.stopRecording;
      secondaryLabel = copy.btnCancelTake;
      nextSecondaryAction = ctx.actions.cancelCurrentTake;
      secondaryDisabled = false;
    } else if (ctx.flowState === ctx.FLOW.REVIEW) {
      if (ctx.quietTakeNeedsDecision) {
        primaryLabel = copy.quietTakeKeep;
        nextPrimaryAction = ctx.actions.acknowledgeQuietTake;
        primaryDisabled = !ctx.wavBlob;
        secondaryLabel = copy.quietTakeRetake;
        nextSecondaryAction = ctx.actions.recordAgain;
      } else {
        primaryLabel = ctx.selectedMode ? ctx.modeCopy(ctx.selectedMode).submitLabel : copy.btnChooseMemoryMode;
        nextPrimaryAction = ctx.actions.submitCurrentTake;
        primaryDisabled = !ctx.selectedMode || !ctx.wavBlob;
        secondaryLabel = copy.btnRecordAgain;
        nextSecondaryAction = ctx.actions.recordAgain;
      }
      secondaryDisabled = false;
    } else if (ctx.flowState === ctx.FLOW.SUBMITTING) {
      primaryLabel = copy.btnSubmitting;
      primaryDisabled = true;
      secondaryLabel = copy.btnPleaseWait;
      secondaryDisabled = true;
    } else if (ctx.flowState === ctx.FLOW.COMPLETE) {
      primaryLabel = copy.btnStartAnother;
      nextPrimaryAction = ctx.actions.startFreshSession;
      secondaryLabel = copy.btnStartOver;
      secondaryDisabled = true;
    } else if (ctx.flowState === ctx.FLOW.ERROR) {
      primaryLabel = copy.btnTryMicAgain;
      nextPrimaryAction = ctx.actions.armMicrophone;
      secondaryLabel = copy.btnStartOver;
      nextSecondaryAction = ctx.actions.startFreshSession;
      secondaryDisabled = false;
    }

    if (ctx.intakePaused() && ![ctx.FLOW.RECORDING, ctx.FLOW.SUBMITTING, ctx.FLOW.COMPLETE].includes(ctx.flowState)) {
      primaryDisabled = true;
      if (ctx.flowState === ctx.FLOW.IDLE || ctx.flowState === ctx.FLOW.ERROR) {
        primaryLabel = copy.btnRecordingPaused;
      } else if (ctx.flowState === ctx.FLOW.REVIEW) {
        primaryLabel = copy.btnSubmissionPaused;
        secondaryLabel = copy.btnResetSession;
        nextSecondaryAction = ctx.actions.startFreshSession;
        secondaryDisabled = false;
      }
    }

    ctx.setPrimaryAction(nextPrimaryAction);
    ctx.setSecondaryAction(nextSecondaryAction);
    ctx.btnPrimary.textContent = primaryLabel;
    ctx.btnPrimary.disabled = primaryDisabled;
    ctx.btnSecondary.textContent = secondaryLabel;
    ctx.btnSecondary.disabled = secondaryDisabled;
  }

  function setMeterLevel(ctx, level) {
    ctx.meterFill.style.width = `${Math.max(0, Math.min(100, level * 100))}%`;
  }

  function setMicCheckStatus(ctx, text, tone) {
    ctx.micCheckStatus.textContent = text;
    ctx.micCheckStatus.classList.remove("good", "quiet");
    ctx.micCheckStatus.classList.add(tone === "good" ? "good" : "quiet");
  }

  function updateStage(ctx) {
    const copy = ctx.currentCopy();
    const hasMic = ctx.captureController.hasLiveInput();
    const maxRecordingMs = ctx.recordingLimitMs();
    const elapsedMs = ctx.flowState === ctx.FLOW.RECORDING ? (ctx.performance.now() - ctx.recStartTs) : ctx.durationMs;
    const remainingMs = ctx.flowState === ctx.FLOW.RECORDING
      ? Math.max(0, maxRecordingMs - elapsedMs)
      : Math.max(0, maxRecordingMs - ctx.durationMs);
    ctx.recTimer.textContent = ctx.formatDuration(elapsedMs);
    ctx.remainingTimer.textContent = ctx.formatDuration(remainingMs);
    ctx.maxDurationHint.textContent = ctx.formatCopy(copy.maxDuration, { duration: ctx.formatDuration(maxRecordingMs) });

    if (ctx.intakePaused() && ctx.flowState === ctx.FLOW.IDLE) {
      ctx.stageBadge.textContent = ctx.maintenanceMode() ? copy.badgeMaintenance : copy.badgePaused;
      ctx.stageTitle.textContent = ctx.maintenanceMode()
        ? copy.stageMaintenanceIdleTitle
        : copy.stagePausedIdleTitle;
      ctx.stageCopy.textContent = ctx.maintenanceMode()
        ? copy.stageMaintenanceIdleCopy
        : copy.stagePausedIdleCopy;
      ctx.micStatus.textContent = copy.micAsleep;
      ctx.recStatus.textContent = ctx.maintenanceMode() ? copy.recMaintenance : copy.recPaused;
      ctx.shortcutHint.textContent = ctx.maintenanceMode() ? copy.shortcutOffline : copy.shortcutPaused;
      ctx.meterText.textContent = copy.meterWaitingResume;
      setMicCheckStatus(ctx, copy.micCheckAsleep, "quiet");
      setMeterLevel(ctx, 0);
    } else if (ctx.flowState === ctx.FLOW.IDLE) {
      ctx.stageBadge.textContent = copy.badgeNotArmed;
      ctx.stageTitle.textContent = copy.stageIdleTitle;
      ctx.stageCopy.textContent = copy.stageIdleCopy;
      ctx.micStatus.textContent = copy.micAsleep;
      ctx.recStatus.textContent = copy.recNotArmed;
      ctx.shortcutHint.textContent = copy.shortcutArm;
      ctx.meterText.textContent = copy.meterWaitingMic;
      setMicCheckStatus(ctx, copy.micCheckUnavailable, "quiet");
      setMeterLevel(ctx, 0);
    } else if (ctx.flowState === ctx.FLOW.MONITOR) {
      ctx.stageBadge.textContent = copy.badgeMonitor;
      ctx.stageTitle.textContent = copy.stageMonitorTitle;
      ctx.stageCopy.textContent = copy.stageMonitorCopy;
      ctx.micStatus.textContent = copy.micMonitor;
      ctx.recStatus.textContent = copy.recMonitor;
      ctx.shortcutHint.textContent = copy.shortcutMonitorPlay;
      ctx.meterText.textContent = copy.meterMonitor;
      setMicCheckStatus(ctx, copy.micCheckMonitor, "good");
      setMeterLevel(ctx, 0);
    } else if (ctx.flowState === ctx.FLOW.ARMING) {
      ctx.stageBadge.textContent = copy.badgeArming;
      ctx.stageTitle.textContent = copy.stageArmingTitle;
      ctx.stageCopy.textContent = copy.stageArmingCopy;
      ctx.micStatus.textContent = copy.micRequesting;
      ctx.recStatus.textContent = copy.recWaitingMicAccess;
      ctx.shortcutHint.textContent = copy.micRequesting;
      ctx.meterText.textContent = copy.meterRequestingAccess;
      setMicCheckStatus(ctx, copy.micCheckStarting, "quiet");
    } else if (ctx.flowState === ctx.FLOW.ARMED) {
      ctx.stageBadge.textContent = ctx.intakePaused() ? (ctx.maintenanceMode() ? copy.badgeMaintenance : copy.badgePaused) : copy.badgeReady;
      ctx.stageTitle.textContent = ctx.intakePaused()
        ? (ctx.maintenanceMode() ? copy.stageArmedMaintenanceTitle : copy.stageArmedPausedTitle)
        : copy.stageArmedTitle;
      ctx.stageCopy.textContent = ctx.intakePaused()
        ? (ctx.maintenanceMode()
          ? copy.stageArmedMaintenanceCopy
          : copy.stageArmedPausedCopy)
        : copy.stageArmedCopy;
      ctx.micStatus.textContent = ctx.micLabel;
      ctx.recStatus.textContent = ctx.intakePaused()
        ? (ctx.maintenanceMode() ? copy.recMaintenance : copy.recPaused)
        : copy.recStandingBy;
      ctx.shortcutHint.textContent = ctx.intakePaused()
        ? (ctx.maintenanceMode() ? copy.shortcutOffline : copy.shortcutPaused)
        : copy.shortcutStart;
      ctx.meterText.textContent = hasMic ? copy.meterListeningRoom : copy.meterMicUnavailable;
    } else if (ctx.flowState === ctx.FLOW.COUNTDOWN) {
      ctx.stageBadge.textContent = copy.badgeGetReady;
      ctx.stageTitle.textContent = copy.stageCountdownTitle;
      ctx.stageCopy.textContent = copy.stageCountdownCopy;
      ctx.micStatus.textContent = ctx.micLabel;
      ctx.recStatus.textContent = copy.recCountdown;
      ctx.shortcutHint.textContent = copy.shortcutCancelCountdown;
      ctx.meterText.textContent = copy.meterListeningRoom;
    } else if (ctx.flowState === ctx.FLOW.RECORDING) {
      ctx.stageBadge.textContent = copy.badgeRecording;
      ctx.stageTitle.textContent = copy.stageRecordingTitle;
      ctx.stageCopy.textContent = copy.stageRecordingCopy;
      ctx.micStatus.textContent = ctx.micLabel;
      ctx.recStatus.textContent = copy.recRecording;
      ctx.shortcutHint.textContent = copy.shortcutStop;
      ctx.meterText.textContent = copy.meterRecordingSignal;
    } else if (ctx.flowState === ctx.FLOW.REVIEW) {
      if (ctx.quietTakeNeedsDecision) {
        ctx.stageBadge.textContent = copy.badgeQuietTake;
        ctx.stageTitle.textContent = copy.stageQuietTitle;
        ctx.stageCopy.textContent = copy.stageQuietCopy;
      } else {
        ctx.stageBadge.textContent = ctx.intakePaused() ? (ctx.maintenanceMode() ? copy.badgeMaintenance : copy.badgePaused) : copy.badgeReview;
        ctx.stageTitle.textContent = ctx.intakePaused()
          ? (ctx.maintenanceMode() ? copy.stageReviewMaintenanceTitle : copy.stageReviewPausedTitle)
          : (ctx.selectedMode ? ctx.formatCopy(copy.stageReadyTo, { label: ctx.modeCopy(ctx.selectedMode).submitLabel.toLowerCase() }) : copy.stageReviewTitle);
        ctx.stageCopy.textContent = ctx.intakePaused()
          ? (ctx.maintenanceMode()
            ? copy.stageReviewMaintenanceCopy
            : copy.stageReviewPausedCopy)
          : (ctx.selectedMode
            ? ctx.modeCopy(ctx.selectedMode).reviewCopy
            : copy.stageReviewCopy);
      }
      ctx.micStatus.textContent = hasMic ? ctx.micLabel : copy.micAsleep;
      ctx.recStatus.textContent = ctx.quietTakeNeedsDecision ? copy.recQuietInput : (ctx.wavBlob ? copy.recTakeCaptured : copy.recNoTake);
      ctx.shortcutHint.textContent = ctx.quietTakeNeedsDecision
        ? copy.shortcutKeepQuiet
        : (ctx.intakePaused()
          ? (ctx.maintenanceMode() ? copy.shortcutOffline : copy.shortcutPausedSubmit)
          : (ctx.selectedMode ? copy.shortcutSubmit : copy.shortcutModeChoice));
      ctx.meterText.textContent = ctx.quietTakeNeedsDecision ? copy.meterPreviewTake : (hasMic ? copy.meterMicStillArmed : copy.meterMicAsleep);
      setMicCheckStatus(
        ctx,
        ctx.quietTakeNeedsDecision ? copy.micCheckQuietWarning : (hasMic ? copy.micCheckComplete : copy.micCheckAsleep),
        ctx.quietTakeNeedsDecision ? "quiet" : (hasMic ? "good" : "quiet"),
      );
    } else if (ctx.flowState === ctx.FLOW.SUBMITTING) {
      ctx.stageBadge.textContent = copy.badgeSaving;
      ctx.stageTitle.textContent = copy.stageSavingTitle;
      ctx.stageCopy.textContent = copy.stageSavingCopy;
      ctx.micStatus.textContent = copy.micAsleep;
      ctx.recStatus.textContent = copy.recSubmitting;
      ctx.shortcutHint.textContent = copy.shortcutSubmitting;
      ctx.meterText.textContent = copy.meterMicAsleep;
      setMicCheckStatus(ctx, copy.micCheckAsleep, "quiet");
      setMeterLevel(ctx, 0);
    } else if (ctx.flowState === ctx.FLOW.COMPLETE) {
      ctx.stageBadge.textContent = copy.badgeFinished;
      ctx.stageTitle.textContent = ctx.selectedMode ? ctx.modeCopy(ctx.selectedMode).completeTitle : copy.stageCompleteFallback;
      ctx.stageCopy.textContent = copy.stageCompleteCopy;
      ctx.micStatus.textContent = copy.micAsleep;
      ctx.recStatus.textContent = copy.recComplete;
      ctx.shortcutHint.textContent = copy.shortcutStartAnother;
      ctx.meterText.textContent = copy.meterMicAsleep;
      setMicCheckStatus(ctx, copy.micCheckAsleep, "quiet");
      setMeterLevel(ctx, 0);
    } else if (ctx.flowState === ctx.FLOW.ERROR) {
      ctx.stageBadge.textContent = copy.badgeMicIssue;
      ctx.stageTitle.textContent = copy.stageErrorTitle;
      ctx.stageCopy.textContent = ctx.lastErrorMessage || copy.stageErrorCopyFallback;
      ctx.micStatus.textContent = copy.micUnavailable;
      ctx.recStatus.textContent = copy.recMicError;
      ctx.shortcutHint.textContent = copy.shortcutTryAgain;
      ctx.meterText.textContent = copy.meterMicUnavailable;
      setMicCheckStatus(ctx, copy.micCheckUnavailable, "quiet");
      setMeterLevel(ctx, 0);
    }
  }

  function handleMeterLevel(ctx, boosted) {
    const copy = ctx.currentCopy();
    setMeterLevel(ctx, boosted);

    if (ctx.flowState === ctx.FLOW.ARMED) {
      ctx.meterText.textContent = boosted > ctx.MIC_SIGNAL_THRESHOLD ? copy.meterSignalDetected : copy.meterWaitingVoice;
      setMicCheckStatus(
        ctx,
        boosted > ctx.MIC_SIGNAL_THRESHOLD ? copy.micCheckWeHearYou : copy.micCheckSpeakLouder,
        boosted > ctx.MIC_SIGNAL_THRESHOLD ? "good" : "quiet",
      );
    } else if (ctx.flowState === ctx.FLOW.COUNTDOWN) {
      ctx.meterText.textContent = boosted > ctx.MIC_SIGNAL_THRESHOLD ? copy.meterSignalDetected : copy.meterListeningClosely;
      setMicCheckStatus(
        ctx,
        boosted > ctx.MIC_SIGNAL_THRESHOLD ? copy.micCheckWeHearYou : copy.micCheckSpeakLouder,
        boosted > ctx.MIC_SIGNAL_THRESHOLD ? "good" : "quiet",
      );
    } else if (ctx.flowState === ctx.FLOW.RECORDING) {
      ctx.meterText.textContent = boosted > ctx.MIC_SIGNAL_THRESHOLD ? copy.meterRecordingSignal : copy.meterListeningClosely;
      setMicCheckStatus(
        ctx,
        boosted > ctx.MIC_SIGNAL_THRESHOLD ? copy.micCheckHealthy : copy.micCheckVeryQuiet,
        boosted > ctx.MIC_SIGNAL_THRESHOLD ? "good" : "quiet",
      );
    }
  }

  function render(ctx) {
    applyStaticCopy(ctx);
    ctx.document.body.dataset.state = ctx.flowState;
    ctx.document.body.classList.toggle("a11y-mode", ctx.accessibilityModeEnabled());
    ctx.document.body.classList.toggle("reduced-motion-mode", ctx.shouldReduceMotion());
    ctx.countdownOverlay.hidden = ctx.flowState !== ctx.FLOW.COUNTDOWN;
    updateStepper(ctx);
    updateModePanel(ctx);
    updateMemoryColorPanel(ctx);
    updateReceiptPanel(ctx);
    updateButtons(ctx);
    updateStage(ctx);
    updateQuietTakePanel(ctx);
    updateReviewTimeoutPanel(ctx);
    updateAttractPanel(ctx);
    updateOperatorNotice(ctx);
    updateBudgetNotice(ctx);
  }

  global.MemoryEngineKioskView = {
    applyStaticCopy,
    flowStateToStepIndex,
    handleMeterLevel,
    render,
    setMeterLevel,
    setMicCheckStatus,
    updateAttractPanel,
    updateBudgetNotice,
    updateButtons,
    updateModePanel,
    updateMemoryColorPanel,
    updateOperatorNotice,
    updateQuietTakePanel,
    updateReceiptPanel,
    updateReviewTimeoutPanel,
    updateStage,
    updateStepper,
  };
}(typeof window !== "undefined" ? window : globalThis));
