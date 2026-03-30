from pathlib import Path
from django.core.exceptions import ImproperlyConfigured

from memory_engine.deployments import DEFAULT_ENGINE_DEPLOYMENT, available_engine_deployments, deployment_catalog_payload
from memory_engine.installation_profiles import installation_profile_default

from .base import EngineTestCase, default_runtime_config, validate_runtime_settings


class RuntimeConfigValidationTests(EngineTestCase):
    def test_runtime_config_validation_accepts_default_test_like_values(self):
        validate_runtime_settings(default_runtime_config())

    def test_runtime_config_validation_accepts_all_supported_engine_deployments(self):
        for deployment in available_engine_deployments():
            validate_runtime_settings(default_runtime_config(ENGINE_DEPLOYMENT=deployment))

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

    def test_runtime_config_validation_rejects_unknown_installation_profile(self):
        config = default_runtime_config(INSTALLATION_PROFILE="unknown_profile")

        with self.assertRaises(ImproperlyConfigured) as ctx:
            validate_runtime_settings(config)

        self.assertIn("INSTALLATION_PROFILE", str(ctx.exception))

    def test_runtime_config_validation_rejects_unknown_engine_deployment(self):
        config = default_runtime_config(ENGINE_DEPLOYMENT="mystery")

        with self.assertRaises(ImproperlyConfigured) as ctx:
            validate_runtime_settings(config)

        self.assertIn("ENGINE_DEPLOYMENT", str(ctx.exception))

    def test_runtime_config_validation_rejects_invalid_operator_allowlist_entry(self):
        config = default_runtime_config(OPS_ALLOWED_NETWORKS=["not-a-cidr"])

        with self.assertRaises(ImproperlyConfigured) as ctx:
            validate_runtime_settings(config)

        self.assertIn("OPS_ALLOWED_NETWORKS", str(ctx.exception))

    def test_runtime_config_validation_rejects_unknown_operator_session_binding_mode(self):
        config = default_runtime_config(OPS_SESSION_BINDING_MODE="mystery")

        with self.assertRaises(ImproperlyConfigured) as ctx:
            validate_runtime_settings(config)

        self.assertIn("OPS_SESSION_BINDING_MODE", str(ctx.exception))

    def test_runtime_config_validation_rejects_invalid_cache_url_scheme(self):
        config = default_runtime_config(CACHE_URL="memcached://cache:11211")

        with self.assertRaises(ImproperlyConfigured) as ctx:
            validate_runtime_settings(config)

        self.assertIn("CACHE_URL", str(ctx.exception))

    def test_runtime_config_validation_requires_shared_cache_outside_debug(self):
        config = default_runtime_config(CACHE_URL="", ALLOW_LOCAL_MEMORY_CACHE=False)

        with self.assertRaises(ImproperlyConfigured) as ctx:
            validate_runtime_settings(config)

        self.assertIn("Shared cache is required", str(ctx.exception))

    def test_runtime_config_validation_rejects_inverted_queue_thresholds(self):
        config = default_runtime_config(
            OPS_QUEUE_DEPTH_WARNING=50,
            OPS_QUEUE_DEPTH_CRITICAL=20,
        )

        with self.assertRaises(ImproperlyConfigured) as ctx:
            validate_runtime_settings(config)

        self.assertIn("OPS_QUEUE_DEPTH_WARNING", str(ctx.exception))

    def test_runtime_config_validation_rejects_unknown_operator_lockout_scope(self):
        config = default_runtime_config(OPS_LOGIN_LOCKOUT_SCOPE="mystery")

        with self.assertRaises(ImproperlyConfigured) as ctx:
            validate_runtime_settings(config)

        self.assertIn("OPS_LOGIN_LOCKOUT_SCOPE", str(ctx.exception))


    def test_engine_deployment_catalog_includes_planned_modes(self):
        self.assertEqual(DEFAULT_ENGINE_DEPLOYMENT, "memory")
        self.assertEqual(
            available_engine_deployments(),
            ("memory", "question", "prompt", "repair", "witness", "oracle"),
        )
        catalog = deployment_catalog_payload()
        self.assertEqual(len(catalog), 6)
        self.assertTrue(all(item.get("copyCatalogKey") for item in catalog))
        self.assertTrue(all(item.get("playbackPolicyKey") for item in catalog))

    def test_installation_profile_defaults_return_expected_values(self):
        self.assertEqual(
            installation_profile_default("shared_lab", "KIOSK_DEFAULT_MAX_RECORDING_SECONDS", 120),
            180,
        )
        self.assertEqual(
            installation_profile_default("active-exhibit", "ROOM_TONE_PROFILE", "soft_air"),
            "warm_hiss",
        )

    def test_installation_profile_defaults_fall_back_to_explicit_default_for_custom_profile(self):
        self.assertEqual(
            installation_profile_default("custom", "ROOM_TONE_PROFILE", "soft_air"),
            "soft_air",
        )

    def test_env_example_mentions_engine_deployment_and_supported_modes(self):
        env_example = Path(__file__).resolve().parents[3] / ".env.example"
        payload = env_example.read_text(encoding="utf-8")
        self.assertIn("ENGINE_DEPLOYMENT=memory", payload)
        self.assertIn("memory, question, prompt, repair, witness, oracle", payload)
