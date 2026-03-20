import os
from pathlib import Path

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
RAW_TTL_HOURS_ROOM = int(os.getenv("RAW_TTL_HOURS_ROOM", "48"))
RAW_TTL_HOURS_FOSSIL = int(os.getenv("RAW_TTL_HOURS_FOSSIL", "48"))
DERIVATIVE_TTL_DAYS_FOSSIL = int(os.getenv("DERIVATIVE_TTL_DAYS_FOSSIL", "365"))

# Room loop tuning
ROOM_INTENSITY_PROFILE = os.getenv("ROOM_INTENSITY_PROFILE", "balanced").strip().lower()
ROOM_MOVEMENT_PRESET = os.getenv("ROOM_MOVEMENT_PRESET", "balanced").strip().lower()
ROOM_SCARCITY_ENABLED = env_bool("ROOM_SCARCITY_ENABLED", True)
ROOM_SCARCITY_LOW_THRESHOLD = env_int("ROOM_SCARCITY_LOW_THRESHOLD", 6)
ROOM_SCARCITY_SEVERE_THRESHOLD = env_int("ROOM_SCARCITY_SEVERE_THRESHOLD", 3)
ROOM_ANTI_REPETITION_WINDOW_SIZE = env_int("ROOM_ANTI_REPETITION_WINDOW_SIZE", 12)

# Operator warning thresholds
OPS_STORAGE_PATH = os.getenv("OPS_STORAGE_PATH", "/")
OPS_DISK_WARNING_FREE_GB = env_float("OPS_DISK_WARNING_FREE_GB", 8.0)
OPS_DISK_WARNING_FREE_PERCENT = env_float("OPS_DISK_WARNING_FREE_PERCENT", 15.0)
OPS_DISK_CRITICAL_FREE_GB = env_float("OPS_DISK_CRITICAL_FREE_GB", 3.0)
OPS_DISK_CRITICAL_FREE_PERCENT = env_float("OPS_DISK_CRITICAL_FREE_PERCENT", 8.0)
OPS_POOL_LOW_COUNT = env_int("OPS_POOL_LOW_COUNT", 6)
OPS_POOL_IMBALANCE_RATIO = env_float("OPS_POOL_IMBALANCE_RATIO", 0.72)
