import os
import sys
from pathlib import Path

from .config_validation import validate_runtime_settings

BASE_DIR = Path(__file__).resolve().parent.parent

def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}

def env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    return int(value.strip())

def env_float(name: str, default: float) -> float:
    value = os.getenv(name)
    if value is None:
        return default
    return float(value.strip())

SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "dev-secret")
DEBUG = env_bool("DJANGO_DEBUG", False)
ALLOWED_HOSTS = [h.strip() for h in os.getenv("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",") if h.strip()]
CSRF_TRUSTED_ORIGINS = [o.strip() for o in os.getenv("DJANGO_CSRF_TRUSTED_ORIGINS", "http://localhost,http://127.0.0.1").split(",") if o.strip()]
USE_X_FORWARDED_HOST = env_bool("DJANGO_USE_X_FORWARDED_HOST", True)
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = env_bool("DJANGO_SECURE_SSL_REDIRECT", False)
SESSION_COOKIE_SECURE = env_bool("DJANGO_SESSION_COOKIE_SECURE", False)
CSRF_COOKIE_SECURE = env_bool("DJANGO_CSRF_COOKIE_SECURE", False)

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "engine",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "memory_engine.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "memory_engine.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.getenv("POSTGRES_DB"),
        "USER": os.getenv("POSTGRES_USER"),
        "PASSWORD": os.getenv("POSTGRES_PASSWORD"),
        "HOST": os.getenv("POSTGRES_HOST", "db"),
        "PORT": os.getenv("POSTGRES_PORT", "5432"),
    }
}

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Celery
CELERY_BROKER_URL = os.getenv("REDIS_URL")
CELERY_RESULT_BACKEND = os.getenv("REDIS_URL")
CELERY_TIMEZONE = "UTC"
CELERY_BEAT_SCHEDULE = {
    "expire-raw-every-10-min": {
        "task": "engine.tasks.expire_raw",
        "schedule": 600.0,
    },
    "prune-derivatives-hourly": {
        "task": "engine.tasks.prune_derivatives",
        "schedule": 3600.0,
    },
}

# MinIO (S3)
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "http://minio:9000")
MINIO_BUCKET = os.getenv("MINIO_BUCKET", "memory")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY")

# Steward / operator access
OPS_SHARED_SECRET = os.getenv("OPS_SHARED_SECRET", "").strip()
OPS_SESSION_TTL_SECONDS = env_int("OPS_SESSION_TTL_SECONDS", 43200)

# Decay tuning
WEAR_EPSILON_PER_PLAY = float(os.getenv("WEAR_EPSILON_PER_PLAY", "0.005"))
POOL_PLAY_COOLDOWN_SECONDS = env_int("POOL_PLAY_COOLDOWN_SECONDS", 90)
POOL_CANDIDATE_LIMIT = env_int("POOL_CANDIDATE_LIMIT", 40)
POOL_FRESH_MAX_AGE_HOURS = env_float("POOL_FRESH_MAX_AGE_HOURS", 8.0)
POOL_FRESH_MAX_WEAR = env_float("POOL_FRESH_MAX_WEAR", 0.18)
POOL_FRESH_MAX_PLAY_COUNT = env_int("POOL_FRESH_MAX_PLAY_COUNT", 2)
POOL_WORN_MIN_AGE_HOURS = env_float("POOL_WORN_MIN_AGE_HOURS", 18.0)
POOL_WORN_MIN_WEAR = env_float("POOL_WORN_MIN_WEAR", 0.38)
POOL_WORN_MIN_PLAY_COUNT = env_int("POOL_WORN_MIN_PLAY_COUNT", 5)
POOL_FEATURED_RETURN_MIN_AGE_HOURS = env_float("POOL_FEATURED_RETURN_MIN_AGE_HOURS", 168.0)
POOL_FEATURED_RETURN_MIN_ABSENCE_HOURS = env_float("POOL_FEATURED_RETURN_MIN_ABSENCE_HOURS", 96.0)
POOL_FEATURED_RETURN_BOOST = env_float("POOL_FEATURED_RETURN_BOOST", 1.45)
POOL_DENSITY_CLUSTER_PENALTY = env_float("POOL_DENSITY_CLUSTER_PENALTY", 0.62)
POOL_DENSITY_RELEASE_BOOST = env_float("POOL_DENSITY_RELEASE_BOOST", 1.18)
RAW_TTL_HOURS_ROOM = int(os.getenv("RAW_TTL_HOURS_ROOM", "48"))
RAW_TTL_HOURS_FOSSIL = int(os.getenv("RAW_TTL_HOURS_FOSSIL", "48"))
DERIVATIVE_TTL_DAYS_FOSSIL = int(os.getenv("DERIVATIVE_TTL_DAYS_FOSSIL", "365"))

# Room loop tuning
ROOM_INTENSITY_PROFILE = os.getenv("ROOM_INTENSITY_PROFILE", "balanced").strip().lower()
ROOM_MOVEMENT_PRESET = os.getenv("ROOM_MOVEMENT_PRESET", "balanced").strip().lower()
ROOM_DAYPART_ENABLED = env_bool("ROOM_DAYPART_ENABLED", True)
ROOM_QUIET_HOURS_ENABLED = env_bool("ROOM_QUIET_HOURS_ENABLED", False)
ROOM_QUIET_HOURS_START_HOUR = env_int("ROOM_QUIET_HOURS_START_HOUR", 22)
ROOM_QUIET_HOURS_END_HOUR = env_int("ROOM_QUIET_HOURS_END_HOUR", 6)
ROOM_QUIET_HOURS_GAP_MULTIPLIER = env_float("ROOM_QUIET_HOURS_GAP_MULTIPLIER", 1.2)
ROOM_QUIET_HOURS_TONE_MULTIPLIER = env_float("ROOM_QUIET_HOURS_TONE_MULTIPLIER", 0.78)
ROOM_QUIET_HOURS_OUTPUT_GAIN_MULTIPLIER = env_float("ROOM_QUIET_HOURS_OUTPUT_GAIN_MULTIPLIER", 0.72)
ROOM_TONE_PROFILE = os.getenv("ROOM_TONE_PROFILE", "soft_air").strip().lower()
ROOM_TONE_SOURCE_MODE = os.getenv("ROOM_TONE_SOURCE_MODE", "synthetic").strip().lower()
ROOM_TONE_SOURCE_URL = os.getenv("ROOM_TONE_SOURCE_URL", "").strip()
ROOM_SCARCITY_ENABLED = env_bool("ROOM_SCARCITY_ENABLED", True)
ROOM_SCARCITY_LOW_THRESHOLD = env_int("ROOM_SCARCITY_LOW_THRESHOLD", 6)
ROOM_SCARCITY_SEVERE_THRESHOLD = env_int("ROOM_SCARCITY_SEVERE_THRESHOLD", 3)
ROOM_ANTI_REPETITION_WINDOW_SIZE = env_int("ROOM_ANTI_REPETITION_WINDOW_SIZE", 12)
ROOM_OVERLAP_CHANCE = env_float("ROOM_OVERLAP_CHANCE", 0.1)
ROOM_OVERLAP_MIN_POOL_SIZE = env_int("ROOM_OVERLAP_MIN_POOL_SIZE", 6)
ROOM_OVERLAP_MAX_LAYERS = env_int("ROOM_OVERLAP_MAX_LAYERS", 2)
ROOM_OVERLAP_MIN_DELAY_MS = env_int("ROOM_OVERLAP_MIN_DELAY_MS", 180)
ROOM_OVERLAP_MAX_DELAY_MS = env_int("ROOM_OVERLAP_MAX_DELAY_MS", 520)
ROOM_OVERLAP_GAIN_MULTIPLIER = env_float("ROOM_OVERLAP_GAIN_MULTIPLIER", 0.68)
ROOM_FOSSIL_VISUALS_ENABLED = env_bool("ROOM_FOSSIL_VISUALS_ENABLED", False)

# Operator warning thresholds
OPS_STORAGE_PATH = os.getenv("OPS_STORAGE_PATH", "/")
OPS_DISK_WARNING_FREE_GB = env_float("OPS_DISK_WARNING_FREE_GB", 8.0)
OPS_DISK_WARNING_FREE_PERCENT = env_float("OPS_DISK_WARNING_FREE_PERCENT", 15.0)
OPS_DISK_CRITICAL_FREE_GB = env_float("OPS_DISK_CRITICAL_FREE_GB", 3.0)
OPS_DISK_CRITICAL_FREE_PERCENT = env_float("OPS_DISK_CRITICAL_FREE_PERCENT", 8.0)
OPS_POOL_LOW_COUNT = env_int("OPS_POOL_LOW_COUNT", 6)
OPS_POOL_IMBALANCE_RATIO = env_float("OPS_POOL_IMBALANCE_RATIO", 0.72)
OPS_RETENTION_SOON_HOURS = env_int("OPS_RETENTION_SOON_HOURS", 24)

validate_runtime_settings(sys.modules[__name__])
