import io
from datetime import timedelta
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone

from .base import EngineTestCase
from ..models import AccessEvent, Artifact, ConsentManifest, Derivative, StewardAction


class ArtifactBehaviorTests(EngineTestCase):
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

    @patch("engine.api_views.generate_essence_audio.delay")
    @patch("engine.api_views.generate_spectrogram.delay")
    @patch("engine.api_views.put_bytes")
    def test_fossil_save_queues_derivative_generation(self, put_bytes_mock, delay_mock, essence_mock):
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
        essence_mock.assert_called_once_with(artifact.id)

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
            kind=Derivative.KIND_SPECTROGRAM_PNG,
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
        self.assertTrue(StewardAction.objects.filter(action="revocation.completed").exists())

    @patch("engine.api_views.stream_key")
    def test_blob_proxy_uses_essence_derivative_when_raw_is_gone(self, stream_key_mock):
        consent = self.make_consent("FOSSIL")
        artifact = self.make_active_artifact(consent=consent, raw_uri="")
        Derivative.objects.create(
            artifact=artifact,
            kind=Derivative.KIND_ESSENCE_WAV,
            uri="derivatives/1/essence.wav",
            expires_at=timezone.now() + timedelta(days=30),
        )
        stream_key_mock.return_value = (io.BytesIO(b"RIFFessence"), "audio/wav")

        response = self.client.get(f"/api/v1/blob/{artifact.id}/raw")

        self.assertEqual(response.status_code, 200)
        stream_key_mock.assert_called_once_with("derivatives/1/essence.wav")

    @patch("engine.tasks.delete_key")
    def test_fossil_artifact_stays_active_on_essence_after_raw_expiry(self, delete_key_mock):
        from ..tasks import expire_raw

        consent = ConsentManifest.objects.create(
            json={
                "mode": "FOSSIL",
                "retention": {"raw_ttl_hours": 1, "derivative_ttl_days": 30},
            },
            revocation_token_hash=ConsentManifest.hash_token("TOKEN12345"),
        )
        artifact = self.make_active_artifact(
            consent=consent,
            raw_uri="raw/fossil.wav",
            created_at=timezone.now() - timedelta(hours=2),
            expires_at=timezone.now() + timedelta(days=30),
        )
        Derivative.objects.create(
            artifact=artifact,
            kind=Derivative.KIND_ESSENCE_WAV,
            uri="derivatives/fossil/essence.wav",
            expires_at=timezone.now() + timedelta(days=30),
        )

        expire_raw()

        artifact.refresh_from_db()
        self.assertEqual(artifact.status, Artifact.STATUS_ACTIVE)
        self.assertEqual(artifact.raw_uri, "")
        delete_key_mock.assert_called_once_with("raw/fossil.wav")

    def test_pool_next_can_select_essence_only_fossil(self):
        consent = ConsentManifest.objects.create(
            json={
                "mode": "FOSSIL",
                "retention": {"raw_ttl_hours": 1, "derivative_ttl_days": 30},
            },
            revocation_token_hash=ConsentManifest.hash_token("TOKEN12345"),
        )
        artifact = self.make_active_artifact(
            consent=consent,
            raw_uri="",
            created_at=timezone.now() - timedelta(days=2),
            expires_at=timezone.now() + timedelta(days=10),
        )
        Derivative.objects.create(
            artifact=artifact,
            kind=Derivative.KIND_ESSENCE_WAV,
            uri="derivatives/fossil/essence.wav",
            expires_at=timezone.now() + timedelta(days=10),
        )

        response = self.client.get("/api/v1/pool/next")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["artifact_id"], artifact.id)

    @patch("engine.api_views.stream_key")
    def test_spectrogram_list_and_blob_proxy_expose_public_visual_url(self, stream_key_mock):
        artifact = self.make_active_artifact(
            raw_uri="raw/fossil.wav",
            created_at=timezone.now() - timedelta(days=3),
        )
        Derivative.objects.create(
            artifact=artifact,
            kind=Derivative.KIND_SPECTROGRAM_PNG,
            uri="derivatives/fossil/spectrogram.png",
            expires_at=timezone.now() + timedelta(days=30),
        )
        stream_key_mock.return_value = (io.BytesIO(b"PNG"), "image/png")

        listing = self.client.get("/api/v1/derivatives/spectrograms")

        self.assertEqual(listing.status_code, 200)
        self.assertEqual(listing.json()[0]["image_url"], f"/api/v1/blob/{artifact.id}/spectrogram")

        blob = self.client.get(f"/api/v1/blob/{artifact.id}/spectrogram")

        self.assertEqual(blob.status_code, 200)
        stream_key_mock.assert_called_once_with("derivatives/fossil/spectrogram.png")

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
