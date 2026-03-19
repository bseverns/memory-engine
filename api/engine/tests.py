from datetime import timedelta
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone

from .models import AccessEvent, Artifact, ConsentManifest, Derivative, Node
from .pool import pool_weight


class EngineBehaviorTests(TestCase):
    def make_consent(self, mode: str, token: str = "TOKEN12345") -> ConsentManifest:
        return ConsentManifest.objects.create(
            json={"mode": mode},
            revocation_token_hash=ConsentManifest.hash_token(token),
        )

    def make_active_artifact(self, *, consent=None, **overrides) -> Artifact:
        node = Node.objects.create(name="Test Node", location_hint="Lab")
        consent = consent or self.make_consent("ROOM")
        payload = {
            "node": node,
            "consent": consent,
            "status": Artifact.STATUS_ACTIVE,
            "raw_sha256": "abc123",
            "raw_uri": "raw/test.wav",
            "duration_ms": 4000,
            "expires_at": timezone.now() + timedelta(hours=24),
        }
        payload.update(overrides)
        return Artifact.objects.create(**payload)

    @patch("engine.api_views.put_bytes")
    def test_room_save_creates_active_artifact_and_revocation_token(self, put_bytes_mock):
        upload = SimpleUploadedFile("audio.wav", b"RIFFtest-room-audio", content_type="audio/wav")

        response = self.client.post(
            "/api/v1/artifacts/audio",
            {"file": upload, "consent_mode": "ROOM", "duration_ms": "3210"},
        )

        self.assertEqual(response.status_code, 201)
        artifact = Artifact.objects.get()
        self.assertEqual(artifact.status, Artifact.STATUS_ACTIVE)
        self.assertEqual(artifact.duration_ms, 3210)
        self.assertTrue(artifact.raw_uri.endswith("/audio.wav"))
        self.assertEqual(response.json()["artifact"]["id"], artifact.id)
        self.assertEqual(len(response.json()["revocation_token"]), 10)
        put_bytes_mock.assert_called_once()

    @patch("engine.api_views.generate_spectrogram.delay")
    @patch("engine.api_views.put_bytes")
    def test_fossil_save_queues_spectrogram_generation(self, put_bytes_mock, delay_mock):
        upload = SimpleUploadedFile("audio.wav", b"RIFFtest-fossil-audio", content_type="audio/wav")

        response = self.client.post(
            "/api/v1/artifacts/audio",
            {"file": upload, "consent_mode": "FOSSIL", "duration_ms": "2000"},
        )

        self.assertEqual(response.status_code, 201)
        artifact = Artifact.objects.get()
        self.assertEqual(artifact.consent.json["mode"], "FOSSIL")
        put_bytes_mock.assert_called_once()
        delay_mock.assert_called_once_with(artifact.id)

    @patch("engine.api_views.delete_key")
    @patch("engine.api_views.put_bytes")
    def test_ephemeral_audio_can_be_consumed_and_revoked(self, put_bytes_mock, delete_key_mock):
        upload = SimpleUploadedFile("audio.wav", b"RIFFtest-ephemeral", content_type="audio/wav")

        create_response = self.client.post(
            "/api/v1/ephemeral/audio",
            {"file": upload, "duration_ms": "1111"},
        )

        self.assertEqual(create_response.status_code, 201)
        payload = create_response.json()
        artifact = Artifact.objects.get(id=payload["artifact_id"])
        self.assertEqual(artifact.status, Artifact.STATUS_EPHEMERAL)
        put_bytes_mock.assert_called_once()

        consume_response = self.client.post(
            "/api/v1/ephemeral/consume",
            data={
                "artifact_id": artifact.id,
                "consume_token": payload["consume_token"],
            },
            content_type="application/json",
        )

        self.assertEqual(consume_response.status_code, 200)
        artifact.refresh_from_db()
        self.assertEqual(artifact.status, Artifact.STATUS_REVOKED)
        self.assertEqual(artifact.raw_uri, "")
        delete_key_mock.assert_called_once_with(f"ephemeral/{artifact.id}/audio.wav")

    @patch("engine.api_views.delete_key")
    def test_revoke_token_revokes_artifacts_and_derivatives(self, delete_key_mock):
        token = "ABCDEF1234"
        consent = self.make_consent("ROOM", token=token)
        artifact = self.make_active_artifact(consent=consent, raw_uri="raw/1/audio.wav")
        derivative = Derivative.objects.create(
            artifact=artifact,
            kind="spectrogram_png",
            uri="derivatives/1/spectrogram.png",
        )

        response = self.client.post(
            "/api/v1/revoke",
            data={"token": token},
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        artifact.refresh_from_db()
        self.assertEqual(artifact.status, Artifact.STATUS_REVOKED)
        self.assertEqual(artifact.raw_uri, "")
        self.assertFalse(Derivative.objects.filter(id=derivative.id).exists())
        self.assertEqual(delete_key_mock.call_count, 2)

    def test_pool_next_advances_wear_and_honors_excluded_ids_when_possible(self):
        consent = self.make_consent("ROOM")
        older = self.make_active_artifact(
            consent=consent,
            raw_uri="raw/older.wav",
            created_at=timezone.now() - timedelta(hours=12),
        )
        preferred = self.make_active_artifact(
            consent=consent,
            raw_uri="raw/preferred.wav",
            created_at=timezone.now() - timedelta(hours=10),
        )

        response = self.client.get(f"/api/v1/pool/next?exclude_ids={older.id}")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["artifact_id"], preferred.id)
        preferred.refresh_from_db()
        self.assertEqual(preferred.play_count, 1)
        self.assertGreater(preferred.wear, 0.0)
        self.assertEqual(AccessEvent.objects.filter(artifact=preferred, action="play").count(), 1)

    def test_pool_next_falls_back_to_excluded_artifact_when_pool_is_too_small(self):
        artifact = self.make_active_artifact(
            raw_uri="raw/only.wav",
            created_at=timezone.now() - timedelta(hours=10),
        )

        response = self.client.get(f"/api/v1/pool/next?exclude_ids={artifact.id}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["artifact_id"], artifact.id)

    def test_pool_next_respects_requested_lane_and_mood_when_available(self):
        consent = self.make_consent("ROOM")
        self.make_active_artifact(
            consent=consent,
            raw_uri="raw/fresh.wav",
            duration_ms=3000,
            wear=0.01,
            play_count=0,
            created_at=timezone.now() - timedelta(hours=2),
        )
        worn = self.make_active_artifact(
            consent=consent,
            raw_uri="raw/worn.wav",
            duration_ms=26000,
            wear=0.7,
            play_count=8,
            created_at=timezone.now() - timedelta(days=3),
        )

        response = self.client.get("/api/v1/pool/next?lane=worn&mood=weathered")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["artifact_id"], worn.id)
        self.assertEqual(payload["lane"], "worn")
        self.assertEqual(payload["mood"], "weathered")

    def test_pool_weight_favors_settled_material_over_brand_new_material(self):
        now = timezone.now()
        consent = self.make_consent("ROOM")
        fresh = self.make_active_artifact(
            consent=consent,
            raw_uri="raw/new.wav",
            created_at=now - timedelta(minutes=20),
            last_access_at=now - timedelta(hours=3),
        )
        settled = self.make_active_artifact(
            consent=consent,
            raw_uri="raw/settled.wav",
            created_at=now - timedelta(hours=24),
            last_access_at=now - timedelta(hours=3),
        )

        fresh_weight = pool_weight(fresh, now, cooldown_seconds=90)
        settled_weight = pool_weight(settled, now, cooldown_seconds=90)

        self.assertGreater(settled_weight, fresh_weight)

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
