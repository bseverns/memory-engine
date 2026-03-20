from __future__ import annotations

from django.core.exceptions import ImproperlyConfigured


def validate_runtime_settings(settings_obj) -> None:
    errors: list[str] = []

    allowed_hosts = list(getattr(settings_obj, "ALLOWED_HOSTS", []) or [])
    csrf_trusted_origins = list(getattr(settings_obj, "CSRF_TRUSTED_ORIGINS", []) or [])
    minio_endpoint = str(getattr(settings_obj, "MINIO_ENDPOINT", "") or "").strip()

    if not allowed_hosts:
        errors.append("ALLOWED_HOSTS must not be empty.")

    if not csrf_trusted_origins:
        errors.append("CSRF_TRUSTED_ORIGINS must not be empty.")

    for origin in csrf_trusted_origins:
        if not (origin.startswith("http://") or origin.startswith("https://")):
            errors.append(f"CSRF trusted origin '{origin}' must start with http:// or https://.")

    secure_cookies_enabled = any([
        bool(getattr(settings_obj, "SECURE_SSL_REDIRECT", False)),
        bool(getattr(settings_obj, "SESSION_COOKIE_SECURE", False)),
        bool(getattr(settings_obj, "CSRF_COOKIE_SECURE", False)),
    ])
    if secure_cookies_enabled:
        for origin in csrf_trusted_origins:
            if origin.startswith("https://"):
                continue
            if origin in {"http://localhost", "http://127.0.0.1"}:
                continue
            errors.append(
                "Secure cookie settings require production CSRF trusted origins to use https:// "
                f"(got '{origin}').",
            )

    if not (minio_endpoint.startswith("http://") or minio_endpoint.startswith("https://")):
        errors.append("MINIO_ENDPOINT must start with http:// or https://.")

    ensure_positive(errors, settings_obj, "WEAR_EPSILON_PER_PLAY", upper_bound=1.0)
    ensure_non_negative(errors, settings_obj, "POOL_PLAY_COOLDOWN_SECONDS")
    ensure_positive(errors, settings_obj, "POOL_CANDIDATE_LIMIT")
    ensure_positive(errors, settings_obj, "POOL_FRESH_MAX_AGE_HOURS")
    ensure_positive(errors, settings_obj, "POOL_WORN_MIN_AGE_HOURS")
    ensure_positive(errors, settings_obj, "RAW_TTL_HOURS_ROOM")
    ensure_positive(errors, settings_obj, "RAW_TTL_HOURS_FOSSIL")
    ensure_positive(errors, settings_obj, "DERIVATIVE_TTL_DAYS_FOSSIL")
    ensure_between(errors, settings_obj, "ROOM_QUIET_HOURS_START_HOUR", 0, 23)
    ensure_between(errors, settings_obj, "ROOM_QUIET_HOURS_END_HOUR", 0, 23)
    ensure_positive(errors, settings_obj, "ROOM_QUIET_HOURS_GAP_MULTIPLIER")
    ensure_between(errors, settings_obj, "ROOM_QUIET_HOURS_TONE_MULTIPLIER", 0.0, 1.5, inclusive_min=False)
    ensure_between(errors, settings_obj, "ROOM_QUIET_HOURS_OUTPUT_GAIN_MULTIPLIER", 0.0, 1.0, inclusive_min=False)
    ensure_non_negative(errors, settings_obj, "ROOM_SCARCITY_SEVERE_THRESHOLD")
    ensure_non_negative(errors, settings_obj, "ROOM_SCARCITY_LOW_THRESHOLD")
    ensure_between(errors, settings_obj, "ROOM_ANTI_REPETITION_WINDOW_SIZE", 0, 50)
    ensure_positive(errors, settings_obj, "OPS_SESSION_TTL_SECONDS")
    ensure_non_negative(errors, settings_obj, "OPS_POOL_LOW_COUNT")
    ensure_between(errors, settings_obj, "OPS_POOL_IMBALANCE_RATIO", 0.0, 1.0, inclusive_min=False, inclusive_max=False)
    ensure_non_negative(errors, settings_obj, "OPS_DISK_CRITICAL_FREE_GB")
    ensure_non_negative(errors, settings_obj, "OPS_DISK_WARNING_FREE_GB")
    ensure_between(errors, settings_obj, "OPS_DISK_CRITICAL_FREE_PERCENT", 0.0, 100.0)
    ensure_between(errors, settings_obj, "OPS_DISK_WARNING_FREE_PERCENT", 0.0, 100.0)
    ensure_positive(errors, settings_obj, "OPS_RETENTION_SOON_HOURS")

    fresh_max_age = float(getattr(settings_obj, "POOL_FRESH_MAX_AGE_HOURS", 0.0))
    worn_min_age = float(getattr(settings_obj, "POOL_WORN_MIN_AGE_HOURS", 0.0))
    if worn_min_age <= fresh_max_age:
        errors.append("POOL_WORN_MIN_AGE_HOURS must be greater than POOL_FRESH_MAX_AGE_HOURS.")

    scarcity_severe = int(getattr(settings_obj, "ROOM_SCARCITY_SEVERE_THRESHOLD", 0))
    scarcity_low = int(getattr(settings_obj, "ROOM_SCARCITY_LOW_THRESHOLD", 0))
    if scarcity_severe > scarcity_low:
        errors.append("ROOM_SCARCITY_SEVERE_THRESHOLD must be less than or equal to ROOM_SCARCITY_LOW_THRESHOLD.")

    disk_critical_gb = float(getattr(settings_obj, "OPS_DISK_CRITICAL_FREE_GB", 0.0))
    disk_warning_gb = float(getattr(settings_obj, "OPS_DISK_WARNING_FREE_GB", 0.0))
    if disk_critical_gb > disk_warning_gb:
        errors.append("OPS_DISK_CRITICAL_FREE_GB must be less than or equal to OPS_DISK_WARNING_FREE_GB.")

    disk_critical_percent = float(getattr(settings_obj, "OPS_DISK_CRITICAL_FREE_PERCENT", 0.0))
    disk_warning_percent = float(getattr(settings_obj, "OPS_DISK_WARNING_FREE_PERCENT", 0.0))
    if disk_critical_percent > disk_warning_percent:
        errors.append("OPS_DISK_CRITICAL_FREE_PERCENT must be less than or equal to OPS_DISK_WARNING_FREE_PERCENT.")

    if errors:
        raise ImproperlyConfigured("Invalid runtime configuration:\n- " + "\n- ".join(errors))


def ensure_positive(errors: list[str], settings_obj, name: str, *, upper_bound: float | None = None) -> None:
    value = float(getattr(settings_obj, name))
    if value <= 0:
        errors.append(f"{name} must be greater than 0.")
    if upper_bound is not None and value > upper_bound:
        errors.append(f"{name} must be less than or equal to {upper_bound}.")


def ensure_non_negative(errors: list[str], settings_obj, name: str) -> None:
    value = float(getattr(settings_obj, name))
    if value < 0:
        errors.append(f"{name} must be greater than or equal to 0.")


def ensure_between(
    errors: list[str],
    settings_obj,
    name: str,
    lower: float,
    upper: float,
    *,
    inclusive_min: bool = True,
    inclusive_max: bool = True,
) -> None:
    value = float(getattr(settings_obj, name))
    if inclusive_min:
        min_ok = value >= lower
    else:
        min_ok = value > lower
    if inclusive_max:
        max_ok = value <= upper
    else:
        max_ok = value < upper
    if not (min_ok and max_ok):
        left = "[" if inclusive_min else "("
        right = "]" if inclusive_max else ")"
        errors.append(f"{name} must be within {left}{lower}, {upper}{right}.")
