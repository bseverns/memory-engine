from __future__ import annotations

from django.utils import timezone


ROOM_LOOP_CONFIG = {
    "intensityProfiles": {
        "quiet": {
            "name": "quiet",
            "cueGapMultiplier": 1.24,
            "pauseGapMultiplier": 1.35,
            "roomToneMultiplier": 1.15,
        },
        "balanced": {
            "name": "balanced",
            "cueGapMultiplier": 1.0,
            "pauseGapMultiplier": 1.0,
            "roomToneMultiplier": 1.0,
        },
        "active": {
            "name": "active",
            "cueGapMultiplier": 0.82,
            "pauseGapMultiplier": 0.78,
            "roomToneMultiplier": 0.92,
        },
    },
    "movementPresets": {
        "meditative": {
            "name": "meditative",
            "movementGapMultiplier": 1.18,
            "minItemsDelta": 1,
            "maxItemsDelta": 1,
        },
        "balanced": {
            "name": "balanced",
            "movementGapMultiplier": 1.0,
            "minItemsDelta": 0,
            "maxItemsDelta": 0,
        },
        "active": {
            "name": "active",
            "movementGapMultiplier": 0.88,
            "minItemsDelta": 0,
            "maxItemsDelta": -1,
        },
    },
    "scenes": [
        {
            "name": "clearings",
            "movements": ["arrival", "release"],
            "moods": ["clear", "hushed"],
            "cues": [
                {"lane": "fresh", "density": "light", "mood": "clear", "gapMs": 950},
                {"lane": "fresh", "density": "medium", "mood": "clear", "gapMs": 1600},
                {"pauseMs": 2600, "toneLevel": "sparse"},
            ],
        },
        {
            "name": "weathered cluster",
            "movements": ["weathering"],
            "moods": ["weathered", "suspended"],
            "cues": [
                {"lane": "worn", "density": "medium", "mood": "weathered", "gapMs": 1600},
                {"lane": "worn", "density": "dense", "mood": "weathered", "gapMs": 2500},
                {"pauseMs": 3600, "toneLevel": "sparse"},
            ],
        },
        {
            "name": "suspension",
            "movements": ["arrival", "weathering"],
            "moods": ["suspended", "hushed"],
            "cues": [
                {"lane": "mid", "density": "medium", "mood": "suspended", "gapMs": 1850},
                {"pauseMs": 2200, "toneLevel": "idle"},
                {"lane": "worn", "density": "light", "mood": "hushed", "gapMs": 2100},
            ],
        },
        {
            "name": "gathering",
            "movements": ["gathering"],
            "moods": ["gathering", "clear", "suspended"],
            "cues": [
                {"lane": "fresh", "density": "medium", "mood": "clear", "gapMs": 1050},
                {"lane": "any", "density": "dense", "mood": "gathering", "gapMs": 1550},
                {"lane": "mid", "density": "medium", "mood": "suspended", "gapMs": 2200},
            ],
        },
        {
            "name": "hushed drift",
            "movements": ["arrival", "release"],
            "moods": ["hushed", "clear"],
            "cues": [
                {"lane": "mid", "density": "light", "mood": "hushed", "gapMs": 1200},
                {"pauseMs": 2800, "toneLevel": "sparse"},
                {"lane": "fresh", "density": "light", "mood": "clear", "gapMs": 1700},
            ],
        },
        {
            "name": "afterimage",
            "movements": ["weathering", "release"],
            "moods": ["weathered", "hushed", "suspended"],
            "cues": [
                {"lane": "worn", "density": "light", "mood": "weathered", "gapMs": 1700},
                {"lane": "mid", "density": "medium", "mood": "suspended", "gapMs": 2500},
                {"pauseMs": 3400, "toneLevel": "sparse"},
            ],
        },
    ],
    "movements": [
        {
            "name": "arrival",
            "minItems": 2,
            "maxItems": 3,
            "gapMultiplier": 1.15,
            "preferredMoods": ["clear", "hushed", "suspended"],
            "sceneNames": ["clearings", "hushed drift", "suspension"],
        },
        {
            "name": "gathering",
            "minItems": 3,
            "maxItems": 4,
            "gapMultiplier": 0.82,
            "preferredMoods": ["gathering", "clear", "suspended"],
            "sceneNames": ["gathering", "suspension"],
        },
        {
            "name": "weathering",
            "minItems": 2,
            "maxItems": 4,
            "gapMultiplier": 1.12,
            "preferredMoods": ["weathered", "suspended", "hushed"],
            "sceneNames": ["weathered cluster", "afterimage", "suspension"],
        },
        {
            "name": "release",
            "minItems": 2,
            "maxItems": 3,
            "gapMultiplier": 1.28,
            "preferredMoods": ["hushed", "clear", "weathered"],
            "sceneNames": ["clearings", "hushed drift", "afterimage"],
        },
    ],
    "dayparts": [
        {
            "name": "morning",
            "label": "Morning",
            "startHour": 6,
            "endHour": 11,
            "intensityProfile": "quiet",
            "movementPreset": "meditative",
        },
        {
            "name": "afternoon",
            "label": "Afternoon",
            "startHour": 12,
            "endHour": 16,
            "intensityProfile": "balanced",
            "movementPreset": "balanced",
        },
        {
            "name": "evening",
            "label": "Evening",
            "startHour": 17,
            "endHour": 21,
            "intensityProfile": "active",
            "movementPreset": "balanced",
        },
        {
            "name": "night",
            "label": "Night",
            "startHour": 22,
            "endHour": 5,
            "intensityProfile": "quiet",
            "movementPreset": "meditative",
        },
    ],
    "quietHours": {
        "label": "Quiet hours",
    },
    "tone": {
        "profiles": {
            "soft_air": {
                "name": "soft_air",
                "label": "Soft air",
                "highpassHz": 110,
                "lowpassHz": 980,
                "lfoHz": 0.025,
                "lfoDepth": 65,
                "noiseStep": 0.06,
                "noiseDamping": 0.985,
            },
            "warm_hiss": {
                "name": "warm_hiss",
                "label": "Warm hiss",
                "highpassHz": 160,
                "lowpassHz": 1550,
                "lfoHz": 0.018,
                "lfoDepth": 120,
                "noiseStep": 0.08,
                "noiseDamping": 0.978,
            },
            "low_vent": {
                "name": "low_vent",
                "label": "Low vent",
                "highpassHz": 55,
                "lowpassHz": 540,
                "lfoHz": 0.012,
                "lfoDepth": 28,
                "noiseStep": 0.035,
                "noiseDamping": 0.992,
            },
        },
        "idleGain": 0.011,
        "sparseGain": 0.017,
        "duckGain": 0.002,
        "fadeSeconds": 1.25,
    },
    "overlap": {
        "label": "Layered return",
        "densityLimit": "medium",
    },
    "fossilVisuals": {
        "label": "Fossil drift",
        "refreshMs": 18000,
        "maxItems": 12,
    },
}


def daypart_matches_hour(daypart: dict, hour: int) -> bool:
    start_hour = int(daypart.get("startHour", 0))
    end_hour = int(daypart.get("endHour", 23))
    if start_hour <= end_hour:
        return start_hour <= hour <= end_hour
    return hour >= start_hour or hour <= end_hour


def active_daypart_for_hour(hour: int, loop_config: dict | None = None) -> dict | None:
    config = loop_config or ROOM_LOOP_CONFIG
    for daypart in config.get("dayparts", []):
        if daypart_matches_hour(daypart, hour):
            return daypart
    return None


def quiet_hours_active_for_hour(hour: int, *, enabled: bool, start_hour: int, end_hour: int) -> bool:
    if not enabled:
        return False
    return daypart_matches_hour({"startHour": start_hour, "endHour": end_hour}, hour)


def room_schedule_snapshot(
    *,
    intensity_profile: str,
    movement_preset: str,
    daypart_enabled: bool,
    quiet_hours_enabled: bool = False,
    quiet_hours_start_hour: int = 22,
    quiet_hours_end_hour: int = 6,
    quiet_hours_gap_multiplier: float = 1.18,
    quiet_hours_tone_multiplier: float = 0.78,
    quiet_hours_output_gain_multiplier: float = 0.72,
    tone_profile: str = "soft_air",
    tone_source_mode: str = "synthetic",
    tone_source_url: str = "",
    now=None,
    loop_config: dict | None = None,
) -> dict:
    config = loop_config or ROOM_LOOP_CONFIG
    current_time = timezone.localtime(now or timezone.now())
    active_daypart = active_daypart_for_hour(current_time.hour, config) if daypart_enabled else None
    quiet_hours_active = quiet_hours_active_for_hour(
        current_time.hour,
        enabled=quiet_hours_enabled,
        start_hour=quiet_hours_start_hour,
        end_hour=quiet_hours_end_hour,
    )
    quiet_hours_config = config.get("quietHours", {})

    return {
        "daypartEnabled": bool(daypart_enabled),
        "daypartName": active_daypart.get("name", "") if active_daypart else "",
        "daypartLabel": active_daypart.get("label", "") if active_daypart else "",
        "intensityProfile": active_daypart.get("intensityProfile", intensity_profile) if active_daypart else intensity_profile,
        "movementPreset": active_daypart.get("movementPreset", movement_preset) if active_daypart else movement_preset,
        "quietHoursEnabled": bool(quiet_hours_enabled),
        "quietHoursActive": bool(quiet_hours_active),
        "quietHoursLabel": quiet_hours_config.get("label", "Quiet hours"),
        "quietHoursGapMultiplier": float(quiet_hours_gap_multiplier),
        "quietHoursToneMultiplier": float(quiet_hours_tone_multiplier),
        "quietHoursOutputGainMultiplier": float(quiet_hours_output_gain_multiplier),
        "roomToneProfile": str(tone_profile or "soft_air"),
        "roomToneSourceMode": str(tone_source_mode or "synthetic"),
        "roomToneSourceUrl": str(tone_source_url or "").strip(),
    }
