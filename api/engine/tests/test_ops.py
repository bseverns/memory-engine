from datetime import timedelta
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone

from .base import EngineTestCase
from ..models import ConsentManifest, Derivative, StewardAction, StewardState


class OperatorBehaviorTests(EngineTestCase):
    @patch("engine.api_views.health_component_status")
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

    def test_operator_dashboard_requires_secret_entry(self):
        response = self.client.get("/ops/")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Steward sign-in")

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

        upload = SimpleUploadedFile("audio.wav", b"RIFFtest-room-audio", content_type="audio/wav")
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

        upload = SimpleUploadedFile("audio.wav", b"RIFFtest-room-audio", content_type="audio/wav")
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
