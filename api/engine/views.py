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
    )
    return {
        "roomIntensityProfile": schedule["intensityProfile"],
        "roomMovementPreset": schedule["movementPreset"],
        "roomDaypartEnabled": schedule["daypartEnabled"],
        "roomDaypartName": schedule["daypartName"],
        "roomDaypartLabel": schedule["daypartLabel"],
        "roomScarcityEnabled": bool(settings.ROOM_SCARCITY_ENABLED),
        "roomScarcityLowThreshold": int(settings.ROOM_SCARCITY_LOW_THRESHOLD),
        "roomScarcitySevereThreshold": int(settings.ROOM_SCARCITY_SEVERE_THRESHOLD),
        "roomAntiRepetitionWindowSize": int(settings.ROOM_ANTI_REPETITION_WINDOW_SIZE),
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
