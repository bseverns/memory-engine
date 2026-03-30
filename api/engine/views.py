from django.conf import settings
from django.shortcuts import redirect
from django.shortcuts import render

from memory_engine.deployments import deployment_catalog_payload, deployment_spec

from .deployment_policy import deployment_room_loop_policy, playback_profile, room_loop_config_for_deployment
from .media_access import PURPOSE_SURFACE_FOSSILS, build_surface_token, surface_fossils_url
from .memory_color import memory_color_catalog_payload
from .operator_auth import (
    authenticate_operator_secret,
    clear_failed_operator_logins,
    end_operator_session,
    note_failed_operator_login,
    operator_allowed_networks,
    operator_login_locked_out,
    operator_request_allowed,
    operator_secret_configured,
    operator_session_active,
    start_operator_session,
)
from .room_composer import ROOM_LOOP_CONFIG, room_schedule_snapshot
from .steward import steward_state_payload


def room_surface_config():
    active_deployment = deployment_spec(getattr(settings, "ENGINE_DEPLOYMENT", "memory"))
    deployment_profile = playback_profile(active_deployment.code)
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
        "engineDeployment": active_deployment.code,
        "engineDeploymentLabel": active_deployment.label,
        "engineDeploymentParticipantNoun": active_deployment.participant_noun,
        "engineDeploymentPlaybackPolicyKey": active_deployment.playback_policy_key,
        "engineDeploymentBehaviorSummary": deployment_profile.behavior_summary,
        "engineDeploymentAfterlifeSummary": deployment_profile.afterlife_summary,
        "engineDeploymentCatalog": deployment_catalog_payload(),
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
        "roomAntiRepetitionWindowSize": deployment_profile.anti_repetition_window,
        "roomOverlapChance": float(settings.ROOM_OVERLAP_CHANCE),
        "roomOverlapMinPoolSize": int(settings.ROOM_OVERLAP_MIN_POOL_SIZE),
        "roomOverlapMaxLayers": int(settings.ROOM_OVERLAP_MAX_LAYERS),
        "roomOverlapMinDelayMs": int(settings.ROOM_OVERLAP_MIN_DELAY_MS),
        "roomOverlapMaxDelayMs": int(settings.ROOM_OVERLAP_MAX_DELAY_MS),
        "roomOverlapGainMultiplier": float(settings.ROOM_OVERLAP_GAIN_MULTIPLIER),
        "roomFossilVisualsEnabled": bool(settings.ROOM_FOSSIL_VISUALS_ENABLED),
        "surfaceFossilFeedUrl": (
            surface_fossils_url(build_surface_token(purpose=PURPOSE_SURFACE_FOSSILS))
            if bool(settings.ROOM_FOSSIL_VISUALS_ENABLED) else ""
        ),
        "surfaceFossilFeedRefreshUrl": "/api/v1/surface/fossils-url",
        "browserTestMode": bool(getattr(settings, "BROWSER_TEST_MODE", False)),
        "memoryColorCatalog": memory_color_catalog_payload(),
        "operatorState": steward_state_payload(),
        "roomLoopConfig": room_loop_config_for_deployment(ROOM_LOOP_CONFIG, active_deployment.code),
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
    allowlist_enabled = bool(operator_allowed_networks())

    if not operator_request_allowed(request):
        return render(request, "engine/operator_login.html", {
            "error": "This network is not allowed to access steward controls.",
            "operator_configured": operator_secret_configured(),
            "allowlist_enabled": allowlist_enabled,
        }, status=403)

    if request.method == "POST":
        if operator_login_locked_out(request):
            return render(request, "engine/operator_login.html", {
                "error": "Too many failed sign-in attempts. Wait before trying again.",
                "operator_configured": operator_secret_configured(),
                "allowlist_enabled": allowlist_enabled,
            }, status=429)
        secret = request.POST.get("secret", "")
        if authenticate_operator_secret(secret):
            clear_failed_operator_logins(request)
            start_operator_session(request)
            return redirect("operator-dashboard")
        note_failed_operator_login(request)
        status_code = 429 if operator_login_locked_out(request) else 403
        return render(request, "engine/operator_login.html", {
            "error": "Too many failed sign-in attempts. Wait before trying again."
            if status_code == 429 else "The steward secret did not match.",
            "operator_configured": operator_secret_configured(),
            "allowlist_enabled": allowlist_enabled,
        }, status=status_code)

    if not operator_session_active(request):
        return render(request, "engine/operator_login.html", {
            "error": "",
            "operator_configured": operator_secret_configured(),
            "allowlist_enabled": allowlist_enabled,
        }, status=503 if not operator_secret_configured() else 200)

    active_deployment = deployment_spec(getattr(settings, "ENGINE_DEPLOYMENT", "memory"))
    deployment_profile = playback_profile(active_deployment.code)
    return render(request, "engine/operator_dashboard.html", {
        "operator_state": steward_state_payload(),
        "engine_deployment": {
            "code": active_deployment.code,
            "label": active_deployment.label,
            "description": active_deployment.short_description,
            "ops_note": active_deployment.ops_note,
            "playback_policy_key": active_deployment.playback_policy_key,
            "behavior_summary": deployment_profile.behavior_summary,
            "afterlife_summary": deployment_profile.afterlife_summary,
            "tuning_source": deployment_profile.tuning_source,
            "room_loop_policy": deployment_room_loop_policy(active_deployment.code),
        },
    })


def operator_logout_view(request):
    if request.method == "POST":
        end_operator_session(request)
    return redirect("operator-dashboard")
