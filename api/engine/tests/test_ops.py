from datetime import timedelta
from unittest.mock import patch

from django.core.cache import cache
from django.test import override_settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone

from .base import EngineTestCase, make_test_wav_bytes
from ..ops import (
    BEAT_HEARTBEAT_CACHE_KEY,
    WORKER_HEARTBEAT_CACHE_KEY,
    api_health_component_status,
    health_component_status,
    record_beat_heartbeat,
    record_worker_heartbeat,
)
from ..throttling import public_throttle_snapshots, record_throttle_denial
from ..models import ConsentManifest, Derivative, StewardAction, StewardState
from ..tasks import heartbeat_tick


class OperatorBehaviorTests(EngineTestCase):
    def setUp(self):
        super().setUp()
        cache.delete(WORKER_HEARTBEAT_CACHE_KEY)
        cache.delete(BEAT_HEARTBEAT_CACHE_KEY)
        cache.clear()

    @patch("engine.api_views.api_health_component_status")
    def test_healthz_returns_503_when_dependency_check_fails(self, health_mock):
        health_mock.return_value = (
            False,
            {
                "database": {"ok": False, "error": "down"},
                "redis": {"ok": True},
                "storage": {"ok": True},
            },
        )

        response = self.client.get("/healthz")

        self.assertEqual(response.status_code, 503)
        self.assertFalse(response.json()["ok"])

    @patch("engine.api_views.api_health_component_status")
    def test_healthz_ignores_worker_and_beat_cluster_staleness(self, health_mock):
        health_mock.return_value = (
            True,
            {
                "database": {"ok": True},
                "redis": {"ok": True},
                "storage": {"ok": True},
            },
        )

        response = self.client.get("/healthz")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])

    @patch("engine.api_views.health_component_status")
    def test_readyz_returns_503_when_cluster_worker_state_is_stale(self, health_mock):
        health_mock.return_value = (
            False,
            {
                "database": {"ok": True},
                "redis": {"ok": True},
                "storage": {"ok": True},
                "worker": {"ok": False, "error": "stale"},
                "beat": {"ok": True},
            },
        )

        response = self.client.get("/readyz")

        self.assertEqual(response.status_code, 503)
        self.assertFalse(response.json()["ok"])

    def test_operator_dashboard_requires_secret_entry(self):
        response = self.client.get("/ops/")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Steward sign-in")

    @override_settings(OPS_ALLOWED_NETWORKS=["10.0.0.0/8"])
    def test_operator_dashboard_denies_requests_outside_allowed_networks(self):
        response = self.client.get("/ops/", REMOTE_ADDR="127.0.0.1")

        self.assertEqual(response.status_code, 403)
        self.assertContains(response, "network is not allowed", status_code=403)

    @override_settings(OPS_LOGIN_MAX_ATTEMPTS=1, OPS_LOGIN_LOCKOUT_SECONDS=60)
    def test_operator_login_locks_after_failed_attempt(self):
        response = self.client.post("/ops/", {"secret": "wrong-secret"}, REMOTE_ADDR="127.0.0.1")

        self.assertEqual(response.status_code, 429)
        self.assertContains(response, "Too many failed sign-in attempts", status_code=429)

    @override_settings(OPS_LOGIN_MAX_ATTEMPTS=1, OPS_LOGIN_LOCKOUT_SECONDS=60)
    def test_operator_login_lockout_applies_to_fresh_client_from_same_ip(self):
        first_client = self.client_class()
        second_client = self.client_class()

        first = first_client.post("/ops/", {"secret": "wrong-secret"}, REMOTE_ADDR="127.0.0.1")
        second = second_client.post("/ops/", {"secret": "test-ops-secret"}, REMOTE_ADDR="127.0.0.1")

        self.assertEqual(first.status_code, 429)
        self.assertEqual(second.status_code, 429)
        self.assertContains(second, "Too many failed sign-in attempts", status_code=429)

    def test_operator_session_invalidates_when_client_binding_changes(self):
        self.client.post("/ops/", {"secret": "test-ops-secret"}, REMOTE_ADDR="127.0.0.1", HTTP_USER_AGENT="browser-a")

        response = self.client.get("/api/v1/node/status", REMOTE_ADDR="127.0.0.1", HTTP_USER_AGENT="browser-b")

        self.assertEqual(response.status_code, 403)

    def test_operator_session_survives_ip_change_when_binding_mode_is_user_agent(self):
        self.client.post("/ops/", {"secret": "test-ops-secret"}, REMOTE_ADDR="127.0.0.1", HTTP_USER_AGENT="browser-a")

        response = self.client.get("/api/v1/node/status", REMOTE_ADDR="127.0.0.2", HTTP_USER_AGENT="browser-a")

        self.assertEqual(response.status_code, 200)

    @override_settings(OPS_SESSION_BINDING_MODE="none")
    def test_operator_session_can_be_relaxed_for_trusted_single_site_installs(self):
        self.client.post("/ops/", {"secret": "test-ops-secret"}, REMOTE_ADDR="127.0.0.1", HTTP_USER_AGENT="browser-a")

        response = self.client.get("/api/v1/node/status", REMOTE_ADDR="127.0.0.2", HTTP_USER_AGENT="browser-b")

        self.assertEqual(response.status_code, 200)

    def test_operator_controls_toggle_persisted_state_and_audit(self):
        self.login_operator()

        response = self.client.post(
            "/api/v1/operator/controls",
            data={
                "maintenance_mode": True,
                "intake_paused": True,
                "playback_paused": True,
                "quieter_mode": True,
                "mood_bias": "weathered",
                "kiosk_language_code": "es_mx_ca",
                "kiosk_accessibility_mode": "large_high_contrast",
                "kiosk_force_reduced_motion": True,
                "kiosk_max_recording_seconds": 90,
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        state = StewardState.load()
        self.assertTrue(state.maintenance_mode)
        self.assertTrue(state.intake_paused)
        self.assertTrue(state.playback_paused)
        self.assertTrue(state.quieter_mode)
        self.assertEqual(state.mood_bias, "weathered")
        self.assertEqual(state.kiosk_language_code, "es_mx_ca")
        self.assertEqual(state.kiosk_accessibility_mode, "large_high_contrast")
        self.assertTrue(state.kiosk_force_reduced_motion)
        self.assertEqual(state.kiosk_max_recording_seconds, 90)
        self.assertEqual(StewardAction.objects.count(), 9)
        payload = response.json()
        self.assertTrue(payload["operator_state"]["maintenance_mode"])
        self.assertEqual(payload["operator_state"]["mood_bias"], "weathered")
        self.assertEqual(payload["operator_state"]["kiosk_language_code"], "es_mx_ca")
        self.assertEqual(payload["operator_state"]["kiosk_accessibility_mode"], "large_high_contrast")
        self.assertTrue(payload["operator_state"]["kiosk_force_reduced_motion"])
        self.assertEqual(payload["operator_state"]["kiosk_max_recording_seconds"], 90)
        self.assertTrue(payload["operator_state"]["intake_paused"])
        self.assertEqual(len(payload["changes"]), 9)

    @patch("engine.api_views.put_bytes")
    def test_intake_pause_blocks_new_audio_artifact_creation(self, put_bytes_mock):
        state = StewardState.load()
        state.intake_paused = True
        state.save(update_fields=["intake_paused"])

        upload = SimpleUploadedFile("audio.wav", make_test_wav_bytes(seconds=3.21), content_type="audio/wav")
        response = self.client.post(
            "/api/v1/artifacts/audio",
            {"file": upload, "consent_mode": "ROOM", "duration_ms": "3210"},
        )

        self.assertEqual(response.status_code, 423)
        put_bytes_mock.assert_not_called()

    @patch("engine.api_views.put_bytes")
    def test_maintenance_mode_blocks_new_audio_artifact_creation(self, put_bytes_mock):
        state = StewardState.load()
        state.maintenance_mode = True
        state.save(update_fields=["maintenance_mode"])

        upload = SimpleUploadedFile("audio.wav", make_test_wav_bytes(seconds=3.21), content_type="audio/wav")
        response = self.client.post(
            "/api/v1/artifacts/audio",
            {"file": upload, "consent_mode": "ROOM", "duration_ms": "3210"},
        )

        self.assertEqual(response.status_code, 423)
        self.assertEqual(response.json()["error"], "node is in maintenance mode")
        put_bytes_mock.assert_not_called()

    def test_playback_pause_forces_pool_next_to_hold(self):
        artifact = self.make_active_artifact(
            raw_uri="raw/only.wav",
            created_at=timezone.now() - timedelta(hours=10),
        )
        state = StewardState.load()
        state.playback_paused = True
        state.save(update_fields=["playback_paused"])

        response = self.client.get(f"/api/v1/pool/next?exclude_ids={artifact.id}")

        self.assertEqual(response.status_code, 204)

    def test_maintenance_mode_forces_pool_next_to_hold(self):
        artifact = self.make_active_artifact(
            raw_uri="raw/only.wav",
            created_at=timezone.now() - timedelta(hours=10),
        )
        state = StewardState.load()
        state.maintenance_mode = True
        state.save(update_fields=["maintenance_mode"])

        response = self.client.get(f"/api/v1/pool/next?exclude_ids={artifact.id}")

        self.assertEqual(response.status_code, 204)

    @patch("engine.api_views.health_component_status")
    def test_node_status_reports_empty_pool_warning(self, health_mock):
        health_mock.return_value = (
            True,
            {
                "database": {"ok": True},
                "redis": {"ok": True},
                "storage": {"ok": True},
            },
        )
        self.login_operator()

        response = self.client.get("/api/v1/node/status")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        titles = {warning["title"] for warning in payload["warnings"]}
        self.assertIn("No playable sounds are available", titles)
        self.assertIn("Playback pool is running low", titles)

    @patch("engine.api_views.health_component_status")
    def test_node_status_reports_lane_imbalance_warning(self, health_mock):
        health_mock.return_value = (
            True,
            {
                "database": {"ok": True},
                "redis": {"ok": True},
                "storage": {"ok": True},
            },
        )
        self.login_operator()
        consent = self.make_consent("ROOM")
        for index in range(6):
            self.make_active_artifact(
                consent=consent,
                raw_uri=f"raw/fresh-{index}.wav",
                duration_ms=3000,
                wear=0.01,
                play_count=0,
                created_at=timezone.now() - timedelta(hours=2),
            )

        response = self.client.get("/api/v1/node/status")

        self.assertEqual(response.status_code, 200)
        titles = {warning["title"] for warning in response.json()["warnings"]}
        self.assertIn("Fresh lane is dominating the pool", titles)

    @patch("engine.api_views.health_component_status")
    def test_node_status_reports_retention_summary(self, health_mock):
        health_mock.return_value = (
            True,
            {
                "database": {"ok": True},
                "redis": {"ok": True},
                "storage": {"ok": True},
            },
        )
        self.login_operator()
        room_consent = ConsentManifest.objects.create(
            json={
                "mode": "ROOM",
                "retention": {"raw_ttl_hours": 48, "derivative_ttl_days": 0},
            },
            revocation_token_hash=ConsentManifest.hash_token("ROOMTOKEN"),
        )
        fossil_consent = ConsentManifest.objects.create(
            json={
                "mode": "FOSSIL",
                "retention": {"raw_ttl_hours": 1, "derivative_ttl_days": 30},
            },
            revocation_token_hash=ConsentManifest.hash_token("FOSSILTOKEN"),
        )
        self.make_active_artifact(
            consent=room_consent,
            raw_uri="raw/room.wav",
            created_at=timezone.now() - timedelta(hours=30),
            expires_at=timezone.now() + timedelta(hours=18),
        )
        fossil = self.make_active_artifact(
            consent=fossil_consent,
            raw_uri="",
            created_at=timezone.now() - timedelta(days=2),
            expires_at=timezone.now() + timedelta(days=20),
        )
        Derivative.objects.create(
            artifact=fossil,
            kind=Derivative.KIND_ESSENCE_WAV,
            uri="derivatives/fossil/essence.wav",
            expires_at=timezone.now() + timedelta(days=20),
        )

        response = self.client.get("/api/v1/node/status")

        self.assertEqual(response.status_code, 200)
        retention = response.json()["retention"]
        self.assertEqual(retention["raw_held"], 1)
        self.assertEqual(retention["raw_expiring_soon"], 1)
        self.assertEqual(retention["fossil_retained"], 1)
        self.assertEqual(retention["fossil_residue_only"], 1)
        self.assertIsNotNone(retention["next_raw_expiry_at"])
        self.assertIsNotNone(retention["next_fossil_expiry_at"])

    def test_node_status_requires_operator_session(self):
        response = self.client.get("/api/v1/node/status")

        self.assertEqual(response.status_code, 403)

    @patch("engine.ops.s3_client")
    @patch("engine.ops.redis.Redis.from_url")
    @patch("engine.ops.connection.cursor")
    def test_health_component_status_reports_stale_worker_and_beat_heartbeats(
        self,
        cursor_mock,
        redis_from_url_mock,
        s3_client_mock,
    ):
        cursor_mock.return_value.__enter__.return_value.fetchone.return_value = (1,)
        redis_from_url_mock.return_value.ping.return_value = True
        s3_client_mock.return_value.head_bucket.return_value = {}

        ok, components = health_component_status()

        self.assertFalse(ok)
        self.assertFalse(components["worker"]["ok"])
        self.assertFalse(components["beat"]["ok"])

    @patch("engine.ops.s3_client")
    @patch("engine.ops.redis.Redis.from_url")
    @patch("engine.ops.connection.cursor")
    def test_api_health_component_status_ignores_worker_and_beat_heartbeats(
        self,
        cursor_mock,
        redis_from_url_mock,
        s3_client_mock,
    ):
        cursor_mock.return_value.__enter__.return_value.fetchone.return_value = (1,)
        redis_from_url_mock.return_value.ping.return_value = True
        s3_client_mock.return_value.head_bucket.return_value = {}

        ok, components = api_health_component_status()

        self.assertTrue(ok)
        self.assertEqual(set(components.keys()), {"database", "redis", "storage"})

    @patch("engine.ops.s3_client")
    @patch("engine.ops.redis.Redis.from_url")
    @patch("engine.ops.connection.cursor")
    def test_health_component_status_is_ok_with_fresh_worker_and_beat_heartbeats(
        self,
        cursor_mock,
        redis_from_url_mock,
        s3_client_mock,
    ):
        cursor_mock.return_value.__enter__.return_value.fetchone.return_value = (1,)
        redis_from_url_mock.return_value.ping.return_value = True
        s3_client_mock.return_value.head_bucket.return_value = {}
        record_worker_heartbeat()
        record_beat_heartbeat()

        ok, components = health_component_status()

        self.assertTrue(ok)
        self.assertTrue(components["worker"]["ok"])
        self.assertTrue(components["beat"]["ok"])

    def test_heartbeat_tick_records_worker_liveness(self):
        heartbeat_tick()

        self.assertTrue(cache.get(WORKER_HEARTBEAT_CACHE_KEY))

    @patch("engine.api_views.health_component_status")
    def test_node_status_warns_when_worker_and_beat_heartbeats_are_stale(self, health_mock):
        health_mock.return_value = (
            False,
            {
                "database": {"ok": True},
                "redis": {"ok": True},
                "storage": {"ok": True},
                "worker": {"ok": False, "error": "stale"},
                "beat": {"ok": False, "error": "stale"},
            },
        )
        self.login_operator()

        response = self.client.get("/api/v1/node/status")

        self.assertEqual(response.status_code, 200)
        titles = {warning["title"] for warning in response.json()["warnings"]}
        self.assertIn("Worker heartbeat is stale", titles)
        self.assertIn("Beat heartbeat is stale", titles)

    def test_public_throttle_snapshots_track_recent_denials(self):
        record_throttle_denial("public_ingest")
        record_throttle_denial("public_ingest_ip")

        payload = public_throttle_snapshots()

        self.assertEqual(payload["public_ingest"]["recent_denials"], 1)
        self.assertEqual(payload["public_ingest_ip"]["recent_denials"], 1)
        self.assertEqual(payload["public_ingest"]["rate"], "180/hour")

    @patch("engine.api_views.health_component_status")
    def test_node_status_warns_when_public_ingest_is_recently_throttled(self, health_mock):
        health_mock.return_value = (
            True,
            {
                "database": {"ok": True},
                "redis": {"ok": True},
                "storage": {"ok": True},
                "worker": {"ok": True},
                "beat": {"ok": True},
            },
        )
        self.login_operator()
        record_throttle_denial("public_ingest")

        response = self.client.get("/api/v1/node/status")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["throttles"]["public_ingest"]["recent_denials"], 1)
        titles = {warning["title"] for warning in response.json()["warnings"]}
        self.assertIn("Recent ingest throttling detected", titles)
