from .settings import *  # noqa: F403,F401

# Local test profile: keep Django tests self-contained and independent from the
# compose stack unless a test explicitly opts into external services.

SECRET_KEY = "test-secret-key"
DEBUG = False

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",  # noqa: F405
        "TEST": {
            "NAME": ":memory:",
        },
    }
}

CELERY_BROKER_URL = "memory://"
CELERY_RESULT_BACKEND = "cache+memory://"
CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True
TEST_RUNNER = "memory_engine.test_runner.AppAwareDiscoverRunner"

MINIO_ENDPOINT = "http://test-minio.invalid"
MINIO_BUCKET = "test-memory"
MINIO_ACCESS_KEY = "test-access-key"
MINIO_SECRET_KEY = "test-secret-key"
