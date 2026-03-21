import json
from functools import lru_cache
from pathlib import Path

MEMORY_COLOR_PROFILE_CLEAR = "clear"
MEMORY_COLOR_PROFILE_WARM = "warm"
MEMORY_COLOR_PROFILE_RADIO = "radio"
MEMORY_COLOR_PROFILE_DREAM = "dream"

MEMORY_COLOR_CATALOG_PATH = Path(__file__).with_name("memory_color_profiles.json")


@lru_cache(maxsize=1)
def memory_color_catalog():
    with MEMORY_COLOR_CATALOG_PATH.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)

    profiles = []
    seen_codes = set()
    for item in payload.get("profiles", []):
        code = str(item.get("code") or "").strip().lower()
        if not code or code in seen_codes:
            continue
        seen_codes.add(code)
        profiles.append({
            "code": code,
            "version": str(item.get("version") or "v1").strip() or "v1",
            "family": str(item.get("family") or "participant_memory_color").strip() or "participant_memory_color",
            "labels": {
                str(language or "").strip().lower(): str(label or "").strip()
                for language, label in (item.get("labels") or {}).items()
                if str(language or "").strip() and str(label or "").strip()
            },
            "descriptions": {
                str(language or "").strip().lower(): str(description or "").strip()
                for language, description in (item.get("descriptions") or {}).items()
                if str(language or "").strip() and str(description or "").strip()
            },
            "processing": item.get("processing") if isinstance(item.get("processing"), dict) else {},
        })

    default_candidate = str(payload.get("default") or MEMORY_COLOR_PROFILE_CLEAR).strip().lower()
    profile_codes = {spec["code"] for spec in profiles}
    default = default_candidate if default_candidate in profile_codes else MEMORY_COLOR_PROFILE_CLEAR

    return {
        "default": default,
        "profiles": profiles,
    }


MEMORY_COLOR_PROFILES = {
    spec["code"]: spec
    for spec in memory_color_catalog()["profiles"]
}

MEMORY_COLOR_PROFILE_ORDER = tuple(MEMORY_COLOR_PROFILES.keys())
DEFAULT_MEMORY_COLOR_PROFILE = memory_color_catalog()["default"]


def memory_color_catalog_payload() -> dict:
    catalog = memory_color_catalog()
    return {
        "default": catalog["default"],
        "profiles": [
            {
                "code": spec["code"],
                "version": spec["version"],
                "family": spec["family"],
                "labels": spec["labels"],
                "descriptions": spec["descriptions"],
                "processing": spec["processing"],
            }
            for spec in catalog["profiles"]
        ],
    }


def memory_color_profile_codes() -> tuple[str, ...]:
    return MEMORY_COLOR_PROFILE_ORDER


def memory_color_allowed_values_text() -> str:
    return ", ".join(memory_color_profile_codes())


def memory_color_validation_error_message(field_name: str = "effect_profile") -> str:
    return f"{field_name} must be one of: {memory_color_allowed_values_text()}."


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
        "label": spec["labels"].get("en") or spec["code"].title(),
        "version": spec["version"],
    }
