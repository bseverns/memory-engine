MEMORY_COLOR_PROFILE_CLEAR = "clear"
MEMORY_COLOR_PROFILE_WARM = "warm"
MEMORY_COLOR_PROFILE_RADIO = "radio"
MEMORY_COLOR_PROFILE_DREAM = "dream"

DEFAULT_MEMORY_COLOR_PROFILE = MEMORY_COLOR_PROFILE_CLEAR

MEMORY_COLOR_PROFILES = {
    MEMORY_COLOR_PROFILE_CLEAR: {
        "label": "Clear",
        "version": "v1",
        "family": "participant_memory_color",
    },
    MEMORY_COLOR_PROFILE_WARM: {
        "label": "Warm",
        "version": "v1",
        "family": "participant_memory_color",
    },
    MEMORY_COLOR_PROFILE_RADIO: {
        "label": "Radio",
        "version": "v1",
        "family": "participant_memory_color",
    },
    MEMORY_COLOR_PROFILE_DREAM: {
        "label": "Dream",
        "version": "v1",
        "family": "participant_memory_color",
    },
}


def normalize_memory_color_profile(value, *, default="") -> str:
    candidate = str(value or "").strip().lower()
    if not candidate:
        return str(default or "").strip().lower()
    if candidate not in MEMORY_COLOR_PROFILES:
        raise ValueError(f"Unknown memory color profile: {candidate}")
    return candidate


def memory_color_metadata(profile: str) -> dict:
    normalized = normalize_memory_color_profile(profile)
    spec = MEMORY_COLOR_PROFILES[normalized]
    return {
        "family": spec["family"],
        "profile": normalized,
        "label": spec["label"],
        "version": spec["version"],
    }
