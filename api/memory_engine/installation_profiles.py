from __future__ import annotations

DEFAULT_INSTALLATION_PROFILE = "custom"

INSTALLATION_PROFILES = {
    "custom": {
        "label": "Custom",
        "description": "No bundled behavior overrides. Use explicit env vars for tuning.",
        "defaults": {},
    },
    "quiet_gallery": {
        "label": "Quiet gallery",
        "description": "Contemplative pacing with softer tone and longer overnight breathing room.",
        "defaults": {
            "KIOSK_DEFAULT_MAX_RECORDING_SECONDS": 120,
            "ROOM_INTENSITY_PROFILE": "quiet",
            "ROOM_MOVEMENT_PRESET": "meditative",
            "ROOM_DAYPART_ENABLED": True,
            "ROOM_QUIET_HOURS_ENABLED": True,
            "ROOM_QUIET_HOURS_START_HOUR": 20,
            "ROOM_QUIET_HOURS_END_HOUR": 8,
            "ROOM_QUIET_HOURS_GAP_MULTIPLIER": 1.3,
            "ROOM_QUIET_HOURS_TONE_MULTIPLIER": 0.74,
            "ROOM_QUIET_HOURS_OUTPUT_GAIN_MULTIPLIER": 0.68,
            "ROOM_TONE_PROFILE": "soft_air",
            "ROOM_SOURCE_SLICE_MAX_SECONDS": 35,
            "ROOM_SOURCE_SLICE_REVOLUTION_SECONDS": 360,
            "ROOM_OVERLAP_CHANCE": 0.06,
            "ROOM_OVERLAP_MAX_LAYERS": 2,
            "ROOM_FOSSIL_VISUALS_ENABLED": False,
        },
    },
    "shared_lab": {
        "label": "Shared lab",
        "description": "Balanced defaults for a classroom, lab, or rehearsal install with multiple surfaces.",
        "defaults": {
            "KIOSK_DEFAULT_MAX_RECORDING_SECONDS": 180,
            "ROOM_INTENSITY_PROFILE": "balanced",
            "ROOM_MOVEMENT_PRESET": "balanced",
            "ROOM_DAYPART_ENABLED": True,
            "ROOM_QUIET_HOURS_ENABLED": False,
            "ROOM_TONE_PROFILE": "soft_air",
            "ROOM_SOURCE_SLICE_MAX_SECONDS": 45,
            "ROOM_SOURCE_SLICE_REVOLUTION_SECONDS": 300,
            "ROOM_OVERLAP_CHANCE": 0.12,
            "ROOM_OVERLAP_MAX_LAYERS": 2,
            "ROOM_FOSSIL_VISUALS_ENABLED": True,
        },
    },
    "active_exhibit": {
        "label": "Active exhibit",
        "description": "Faster pacing and more visible room motion for higher-throughput public installs.",
        "defaults": {
            "KIOSK_DEFAULT_MAX_RECORDING_SECONDS": 120,
            "ROOM_INTENSITY_PROFILE": "active",
            "ROOM_MOVEMENT_PRESET": "active",
            "ROOM_DAYPART_ENABLED": True,
            "ROOM_QUIET_HOURS_ENABLED": False,
            "ROOM_TONE_PROFILE": "warm_hiss",
            "ROOM_SCARCITY_LOW_THRESHOLD": 8,
            "ROOM_SCARCITY_SEVERE_THRESHOLD": 4,
            "ROOM_SOURCE_SLICE_MAX_SECONDS": 30,
            "ROOM_SOURCE_SLICE_REVOLUTION_SECONDS": 180,
            "ROOM_OVERLAP_CHANCE": 0.18,
            "ROOM_OVERLAP_MAX_LAYERS": 3,
            "ROOM_OVERLAP_MIN_DELAY_MS": 140,
            "ROOM_OVERLAP_MAX_DELAY_MS": 420,
            "ROOM_FOSSIL_VISUALS_ENABLED": True,
        },
    },
}


def normalize_installation_profile_name(value: str | None) -> str:
    normalized = str(value or DEFAULT_INSTALLATION_PROFILE).strip().lower().replace("-", "_")
    return normalized or DEFAULT_INSTALLATION_PROFILE


def available_installation_profiles() -> tuple[str, ...]:
    return tuple(INSTALLATION_PROFILES.keys())


def installation_profile_defaults(profile_name: str | None) -> dict:
    normalized = normalize_installation_profile_name(profile_name)
    profile = INSTALLATION_PROFILES.get(normalized) or INSTALLATION_PROFILES[DEFAULT_INSTALLATION_PROFILE]
    return dict(profile.get("defaults", {}))


def installation_profile_default(profile_name: str | None, setting_name: str, fallback):
    defaults = installation_profile_defaults(profile_name)
    return defaults.get(setting_name, fallback)
