from django.core.exceptions import ImproperlyConfigured

from .base import EngineTestCase, default_runtime_config, validate_runtime_settings


class RuntimeConfigValidationTests(EngineTestCase):
    def test_runtime_config_validation_accepts_default_test_like_values(self):
        validate_runtime_settings(default_runtime_config())

    def test_runtime_config_validation_rejects_inverted_thresholds(self):
        config = default_runtime_config(
            POOL_WORN_MIN_AGE_HOURS=6.0,
            ROOM_SCARCITY_SEVERE_THRESHOLD=8,
            OPS_DISK_CRITICAL_FREE_GB=9.0,
            OPS_DISK_CRITICAL_FREE_PERCENT=16.0,
        )

        with self.assertRaises(ImproperlyConfigured) as ctx:
            validate_runtime_settings(config)

        self.assertIn("POOL_WORN_MIN_AGE_HOURS", str(ctx.exception))
        self.assertIn("ROOM_SCARCITY_SEVERE_THRESHOLD", str(ctx.exception))
        self.assertIn("OPS_DISK_CRITICAL_FREE_GB", str(ctx.exception))

    def test_runtime_config_validation_rejects_insecure_origins_under_secure_cookies(self):
        config = default_runtime_config(
            ALLOWED_HOSTS=["memory.example.com"],
            CSRF_TRUSTED_ORIGINS=["http://memory.example.com"],
            SECURE_SSL_REDIRECT=True,
            SESSION_COOKIE_SECURE=True,
            CSRF_COOKIE_SECURE=True,
        )

        with self.assertRaises(ImproperlyConfigured) as ctx:
            validate_runtime_settings(config)

        self.assertIn("https://", str(ctx.exception))

    def test_runtime_config_validation_requires_site_ambience_url_when_enabled(self):
        config = default_runtime_config(
            ROOM_TONE_SOURCE_MODE="site_ambience",
            ROOM_TONE_SOURCE_URL="",
        )

        with self.assertRaises(ImproperlyConfigured) as ctx:
            validate_runtime_settings(config)

        self.assertIn("ROOM_TONE_SOURCE_URL", str(ctx.exception))

    def test_runtime_config_validation_rejects_unknown_kiosk_language(self):
        config = default_runtime_config(KIOSK_DEFAULT_LANGUAGE_CODE="fr")

        with self.assertRaises(ImproperlyConfigured) as ctx:
            validate_runtime_settings(config)

        self.assertIn("KIOSK_DEFAULT_LANGUAGE_CODE", str(ctx.exception))
