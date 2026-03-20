from django.conf import settings
from django.shortcuts import render

from .room_composer import ROOM_LOOP_CONFIG


def kiosk_view(request):
    return render(request, "engine/kiosk.html", {
        "kiosk_config": {
            "roomIntensityProfile": settings.ROOM_INTENSITY_PROFILE,
            "roomMovementPreset": settings.ROOM_MOVEMENT_PRESET,
            "roomScarcityEnabled": bool(settings.ROOM_SCARCITY_ENABLED),
            "roomScarcityLowThreshold": int(settings.ROOM_SCARCITY_LOW_THRESHOLD),
            "roomScarcitySevereThreshold": int(settings.ROOM_SCARCITY_SEVERE_THRESHOLD),
            "roomAntiRepetitionWindowSize": int(settings.ROOM_ANTI_REPETITION_WINDOW_SIZE),
            "roomLoopConfig": ROOM_LOOP_CONFIG,
        },
    })


def operator_dashboard_view(request):
    return render(request, "engine/operator_dashboard.html", {})
