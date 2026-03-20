from django.conf import settings
from django.shortcuts import redirect
from django.shortcuts import render

from .operator_auth import (
    authenticate_operator_secret,
    end_operator_session,
    operator_secret_configured,
    operator_session_active,
    start_operator_session,
)
from .room_composer import ROOM_LOOP_CONFIG, room_schedule_snapshot
from .steward import steward_state_payload


def room_surface_config():
    schedule = room_schedule_snapshot(
        intensity_profile=settings.ROOM_INTENSITY_PROFILE,
        movement_preset=settings.ROOM_MOVEMENT_PRESET,
        daypart_enabled=bool(settings.ROOM_DAYPART_ENABLED),
        quiet_hours_enabled=bool(settings.ROOM_QUIET_HOURS_ENABLED),
        quiet_hours_start_hour=int(settings.ROOM_QUIET_HOURS_START_HOUR),
        quiet_hours_end_hour=int(settings.ROOM_QUIET_HOURS_END_HOUR),
        quiet_hours_gap_multiplier=float(settings.ROOM_QUIET_HOURS_GAP_MULTIPLIER),
        quiet_hours_tone_multiplier=float(settings.ROOM_QUIET_HOURS_TONE_MULTIPLIER),
        quiet_hours_output_gain_multiplier=float(settings.ROOM_QUIET_HOURS_OUTPUT_GAIN_MULTIPLIER),
        tone_profile=settings.ROOM_TONE_PROFILE,
        tone_source_mode=settings.ROOM_TONE_SOURCE_MODE,
        tone_source_url=settings.ROOM_TONE_SOURCE_URL,
    )
    return {
        "kioskLanguageCode": str(getattr(settings, "KIOSK_DEFAULT_LANGUAGE_CODE", "en")),
        "kioskMaxRecordingSeconds": int(getattr(settings, "KIOSK_DEFAULT_MAX_RECORDING_SECONDS", 120)),
        "roomIntensityProfile": schedule["intensityProfile"],
        "roomMovementPreset": schedule["movementPreset"],
        "roomDaypartEnabled": schedule["daypartEnabled"],
        "roomDaypartName": schedule["daypartName"],
        "roomDaypartLabel": schedule["daypartLabel"],
        "roomQuietHoursEnabled": schedule["quietHoursEnabled"],
        "roomQuietHoursActive": schedule["quietHoursActive"],
        "roomQuietHoursLabel": schedule["quietHoursLabel"],
        "roomQuietHoursStartHour": int(settings.ROOM_QUIET_HOURS_START_HOUR),
        "roomQuietHoursEndHour": int(settings.ROOM_QUIET_HOURS_END_HOUR),
        "roomQuietHoursGapMultiplier": schedule["quietHoursGapMultiplier"],
        "roomQuietHoursToneMultiplier": schedule["quietHoursToneMultiplier"],
        "roomQuietHoursOutputGainMultiplier": schedule["quietHoursOutputGainMultiplier"],
        "roomToneProfile": schedule["roomToneProfile"],
        "roomToneSourceMode": schedule["roomToneSourceMode"],
        "roomToneSourceUrl": schedule["roomToneSourceUrl"],
        "roomScarcityEnabled": bool(settings.ROOM_SCARCITY_ENABLED),
        "roomScarcityLowThreshold": int(settings.ROOM_SCARCITY_LOW_THRESHOLD),
        "roomScarcitySevereThreshold": int(settings.ROOM_SCARCITY_SEVERE_THRESHOLD),
        "roomAntiRepetitionWindowSize": int(settings.ROOM_ANTI_REPETITION_WINDOW_SIZE),
        "roomOverlapChance": float(settings.ROOM_OVERLAP_CHANCE),
        "roomOverlapMinPoolSize": int(settings.ROOM_OVERLAP_MIN_POOL_SIZE),
        "roomOverlapMaxLayers": int(settings.ROOM_OVERLAP_MAX_LAYERS),
        "roomOverlapMinDelayMs": int(settings.ROOM_OVERLAP_MIN_DELAY_MS),
        "roomOverlapMaxDelayMs": int(settings.ROOM_OVERLAP_MAX_DELAY_MS),
        "roomOverlapGainMultiplier": float(settings.ROOM_OVERLAP_GAIN_MULTIPLIER),
        "roomFossilVisualsEnabled": bool(settings.ROOM_FOSSIL_VISUALS_ENABLED),
        "operatorState": steward_state_payload(),
        "roomLoopConfig": ROOM_LOOP_CONFIG,
    }


def kiosk_view(request):
    return render(request, "engine/kiosk.html", {
        "kiosk_config": room_surface_config(),
    })


def playback_view(request):
    return render(request, "engine/playback.html", {
        "kiosk_config": room_surface_config(),
    })


def operator_dashboard_view(request):
    if request.method == "POST":
        secret = request.POST.get("secret", "")
        if authenticate_operator_secret(secret):
            start_operator_session(request)
            return redirect("operator-dashboard")
        return render(request, "engine/operator_login.html", {
            "error": "The steward secret did not match.",
            "operator_configured": operator_secret_configured(),
        }, status=403)

    if not operator_session_active(request):
        return render(request, "engine/operator_login.html", {
            "error": "",
            "operator_configured": operator_secret_configured(),
        }, status=503 if not operator_secret_configured() else 200)

    return render(request, "engine/operator_dashboard.html", {
        "operator_state": steward_state_payload(),
    })


def operator_logout_view(request):
    if request.method == "POST":
        end_operator_session(request)
    return redirect("operator-dashboard")
