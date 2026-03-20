import io
from datetime import timedelta
from unittest.mock import patch

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone

from .base import EngineTestCase, make_test_wav_bytes
from ..media_access import (
    PURPOSE_POOL_AUDIO,
    PURPOSE_POOL_HEARD,
    PURPOSE_SPECTROGRAM_IMAGE,
    PURPOSE_SURFACE_FOSSILS,
    build_media_token,
    build_surface_token,
)
from ..models import AccessEvent, Artifact, ConsentManifest, Derivative, StewardAction
from ..throttling import public_ingest_budget_snapshot


class ArtifactBehaviorTests(EngineTestCase):
    @patch("engine.api_views.put_bytes")
    def test_room_save_creates_active_artifact_and_revocation_token(self, put_bytes_mock):
        upload = SimpleUploadedFile("audio.wav", make_test_wav_bytes(seconds=3.21), content_type="audio/wav")

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
        upload = SimpleUploadedFile("audio.wav", make_test_wav_bytes(seconds=2.0), content_type="audio/wav")

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

    @patch("engine.api_views.stream_key")
    @patch("engine.api_views.delete_key")
    @patch("engine.api_views.put_bytes")
    def test_ephemeral_audio_can_be_consumed_and_revoked(self, put_bytes_mock, delete_key_mock, stream_key_mock):
        upload = SimpleUploadedFile("audio.wav", make_test_wav_bytes(seconds=1.111), content_type="audio/wav")
        stream_key_mock.return_value = (io.BytesIO(b"RIFFtest-ephemeral"), "audio/wav")

        create_response = self.client.post(
            "/api/v1/ephemeral/audio",
            {"file": upload, "duration_ms": "1111"},
        )

        self.assertEqual(create_response.status_code, 201)
        payload = create_response.json()
        artifact = Artifact.objects.get(id=payload["artifact_id"])
        self.assertEqual(artifact.status, Artifact.STATUS_EPHEMERAL)
        put_bytes_mock.assert_called_once()

        consume_response = self.client.get(payload["play_url"])

        self.assertEqual(consume_response.status_code, 200)
        artifact.refresh_from_db()
        self.assertEqual(artifact.status, Artifact.STATUS_REVOKED)
        self.assertEqual(artifact.raw_uri, "")
        stream_key_mock.assert_called_once_with(f"ephemeral/{artifact.id}/audio.wav")
        delete_key_mock.assert_called_once_with(f"ephemeral/{artifact.id}/audio.wav")

    @patch("engine.api_views.put_bytes")
    def test_room_save_rejects_non_wav_upload(self, put_bytes_mock):
        upload = SimpleUploadedFile("audio.raw", b"not-a-wav", content_type="application/octet-stream")

        response = self.client.post(
            "/api/v1/artifacts/audio",
            {"file": upload, "consent_mode": "ROOM"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("RIFF/WAVE", response.json()["error"])
        put_bytes_mock.assert_not_called()

    @patch("engine.api_views.put_bytes")
    def test_room_save_rejects_stereo_wav(self, put_bytes_mock):
        import wave

        stereo_bytes = io.BytesIO()
        with wave.open(stereo_bytes, "wb") as wav_file:
            wav_file.setnchannels(2)
            wav_file.setsampwidth(2)
            wav_file.setframerate(8000)
            wav_file.writeframes((b"\x00\x00\x00\x00") * 200)
        upload = SimpleUploadedFile("audio.wav", stereo_bytes.getvalue(), content_type="audio/wav")

        response = self.client.post(
            "/api/v1/artifacts/audio",
            {"file": upload, "consent_mode": "ROOM"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("mono", response.json()["error"])
        put_bytes_mock.assert_not_called()

    @override_settings(INGEST_MAX_DURATION_SECONDS=1)
    @patch("engine.api_views.put_bytes")
    def test_room_save_rejects_wav_longer_than_server_limit(self, put_bytes_mock):
        upload = SimpleUploadedFile("audio.wav", make_test_wav_bytes(seconds=1.5), content_type="audio/wav")

        response = self.client.post(
            "/api/v1/artifacts/audio",
            {"file": upload, "consent_mode": "ROOM"},
        )

        self.assertEqual(response.status_code, 413)
        self.assertIn("1 second", response.json()["error"])
        put_bytes_mock.assert_not_called()

    @override_settings(INGEST_MAX_UPLOAD_BYTES=128)
    @patch("engine.api_views.put_bytes")
    def test_room_save_rejects_upload_larger_than_server_limit(self, put_bytes_mock):
        upload = SimpleUploadedFile("audio.wav", make_test_wav_bytes(seconds=0.5), content_type="audio/wav")

        response = self.client.post(
            "/api/v1/artifacts/audio",
            {"file": upload, "consent_mode": "ROOM"},
        )

        self.assertEqual(response.status_code, 413)
        self.assertIn("byte limit", response.json()["error"])
        put_bytes_mock.assert_not_called()

    @override_settings(REST_FRAMEWORK={"DEFAULT_THROTTLE_RATES": {
        "public_ingest": "1/min",
        "public_ingest_ip": "10/min",
        "public_revoke": "1/min",
        "public_revoke_ip": "10/min",
    }})
    @patch("engine.api_views.put_bytes")
    def test_audio_ingest_is_rate_limited(self, put_bytes_mock):
        cache.clear()
        first_upload = SimpleUploadedFile("audio.wav", make_test_wav_bytes(seconds=0.5), content_type="audio/wav")
        second_upload = SimpleUploadedFile("audio.wav", make_test_wav_bytes(seconds=0.5), content_type="audio/wav")

        first = self.client.post("/api/v1/artifacts/audio", {"file": first_upload, "consent_mode": "ROOM"})
        second = self.client.post("/api/v1/artifacts/audio", {"file": second_upload, "consent_mode": "ROOM"})

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 429)
        cache.clear()

    @override_settings(REST_FRAMEWORK={"DEFAULT_THROTTLE_RATES": {
        "public_ingest": "10/min",
        "public_ingest_ip": "10/min",
        "public_revoke": "1/min",
        "public_revoke_ip": "10/min",
    }})
    def test_revoke_is_rate_limited(self):
        cache.clear()
        first = self.client.post("/api/v1/revoke", data={"token": "MISSING0000"}, content_type="application/json")
        second = self.client.post("/api/v1/revoke", data={"token": "MISSING0000"}, content_type="application/json")

        self.assertEqual(first.status_code, 404)
        self.assertEqual(second.status_code, 429)
        cache.clear()

    def test_raw_media_route_rejects_direct_access_without_token(self):
        artifact = self.make_active_artifact(raw_uri="raw/private.wav")

        response = self.client.get(f"/api/v1/media/raw/{artifact.id}")

        self.assertEqual(response.status_code, 404)

    @override_settings(REST_FRAMEWORK={"DEFAULT_THROTTLE_RATES": {
        "public_ingest": "2/min",
        "public_ingest_ip": "10/min",
        "public_revoke": "1/min",
        "public_revoke_ip": "10/min",
    }})
    @patch("engine.api_views.put_bytes")
    def test_surface_state_reports_remaining_ingest_budget_for_kiosk_client(self, put_bytes_mock):
        cache.clear()
        self.client.defaults["HTTP_X_MEMORY_CLIENT_ID"] = "kiosk-alpha"

        initial = self.client.get("/api/v1/surface/state")
        initial_budget = initial.json()["ingest_budget"]
        self.assertEqual(initial_budget["client"]["remaining"], 2)
        self.assertFalse(initial_budget["low"])
        self.assertFalse(initial_budget["exhausted"])

        upload = SimpleUploadedFile("audio.wav", make_test_wav_bytes(seconds=0.5), content_type="audio/wav")
        response = self.client.post("/api/v1/artifacts/audio", {"file": upload, "consent_mode": "ROOM"})
        self.assertEqual(response.status_code, 201)

        follow_up = self.client.get("/api/v1/surface/state")
        follow_up_budget = follow_up.json()["ingest_budget"]
        self.assertEqual(follow_up_budget["client"]["remaining"], 1)
        self.assertTrue(follow_up_budget["low"])
        self.assertFalse(follow_up_budget["exhausted"])
        cache.clear()

    @override_settings(REST_FRAMEWORK={"DEFAULT_THROTTLE_RATES": {
        "public_ingest": "1/min",
        "public_ingest_ip": "10/min",
        "public_revoke": "1/min",
        "public_revoke_ip": "10/min",
    }})
    @patch("engine.api_views.put_bytes")
    def test_budget_snapshot_marks_ingest_budget_exhausted_after_limit(self, put_bytes_mock):
        cache.clear()
        self.client.defaults["HTTP_X_MEMORY_CLIENT_ID"] = "kiosk-bravo"
        upload = SimpleUploadedFile("audio.wav", make_test_wav_bytes(seconds=0.5), content_type="audio/wav")

        response = self.client.post("/api/v1/artifacts/audio", {"file": upload, "consent_mode": "ROOM"})
        self.assertEqual(response.status_code, 201)

        budget = public_ingest_budget_snapshot(response.wsgi_request)
        self.assertEqual(budget["effective_remaining"], 0)
        self.assertTrue(budget["low"])
        self.assertTrue(budget["exhausted"])
        self.assertGreaterEqual(budget["effective_reset_in_seconds"], 1)
        cache.clear()

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
        access_token = build_media_token(purpose=PURPOSE_POOL_AUDIO, artifact_id=artifact.id)

        response = self.client.get(f"/api/v1/media/raw/{access_token}")

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
    def test_operator_spectrogram_list_and_tokenized_blob_proxy_work(self, stream_key_mock):
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

        denied = self.client.get("/api/v1/derivatives/spectrograms")
        self.assertEqual(denied.status_code, 403)

        self.login_operator()
        listing = self.client.get("/api/v1/derivatives/spectrograms")

        self.assertEqual(listing.status_code, 200)
        image_url = listing.json()[0]["image_url"]
        self.assertTrue(image_url.startswith("/api/v1/media/spectrogram/"))

        blob = self.client.get(image_url)

        self.assertEqual(blob.status_code, 200)
        stream_key_mock.assert_called_once_with("derivatives/fossil/spectrogram.png")

    def test_public_surface_fossil_feed_omits_artifact_ids(self):
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

        token = build_surface_token(purpose=PURPOSE_SURFACE_FOSSILS)
        response = self.client.get(f"/api/v1/surface/fossils/{token}")

        self.assertEqual(response.status_code, 200)
        payload = response.json()[0]
        self.assertNotIn("artifact_id", payload)
        self.assertIn("/api/v1/media/spectrogram/", payload["image_url"])

    @patch("engine.api_views.stream_key")
    def test_pool_audio_token_fails_for_revoked_artifact(self, stream_key_mock):
        artifact = self.make_active_artifact(raw_uri="raw/private.wav")
        artifact.status = Artifact.STATUS_REVOKED
        artifact.save(update_fields=["status"])
        access_token = build_media_token(purpose=PURPOSE_POOL_AUDIO, artifact_id=artifact.id)

        response = self.client.get(f"/api/v1/media/raw/{access_token}")

        self.assertEqual(response.status_code, 404)
        stream_key_mock.assert_not_called()

    def test_pool_next_defers_wear_until_playback_is_acknowledged(self):
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
        self.assertIn("/api/v1/pool/heard/", payload["playback_ack_url"])
        preferred.refresh_from_db()
        self.assertEqual(preferred.play_count, 0)
        self.assertEqual(preferred.wear, 0.0)
        self.assertEqual(AccessEvent.objects.filter(artifact=preferred, action="heard").count(), 0)

        ack_response = self.client.post(payload["playback_ack_url"])

        self.assertEqual(ack_response.status_code, 200)
        preferred.refresh_from_db()
        self.assertEqual(preferred.play_count, 1)
        self.assertGreater(preferred.wear, 0.0)
        self.assertEqual(AccessEvent.objects.filter(artifact=preferred, action="heard").count(), 1)

    def test_pool_playback_acknowledgement_is_one_time(self):
        artifact = self.make_active_artifact(
            raw_uri="raw/preferred.wav",
            created_at=timezone.now() - timedelta(hours=10),
        )
        token = build_media_token(
            purpose=PURPOSE_POOL_HEARD,
            artifact_id=artifact.id,
            nonce="nonce-once",
        )

        first = self.client.post(f"/api/v1/pool/heard/{token}")
        second = self.client.post(f"/api/v1/pool/heard/{token}")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        artifact.refresh_from_db()
        self.assertEqual(artifact.play_count, 1)
        self.assertEqual(AccessEvent.objects.filter(artifact=artifact, action="heard").count(), 1)

    @patch("engine.api_views.put_bytes", side_effect=RuntimeError("storage offline"))
    def test_room_save_rolls_back_artifact_when_storage_write_fails(self, put_bytes_mock):
        upload = SimpleUploadedFile("audio.wav", make_test_wav_bytes(seconds=0.5), content_type="audio/wav")

        with self.assertRaises(RuntimeError):
            self.client.post(
                "/api/v1/artifacts/audio",
                {"file": upload, "consent_mode": "ROOM"},
            )

        self.assertEqual(Artifact.objects.count(), 0)
        self.assertEqual(ConsentManifest.objects.count(), 0)
        put_bytes_mock.assert_called_once()

    @override_settings(ROOM_FOSSIL_VISUALS_ENABLED=True)
    def test_surface_fossil_feed_url_endpoint_renews_public_feed_url(self):
        response = self.client.get("/api/v1/surface/fossils-url")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("/api/v1/surface/fossils/", payload["feed_url"])
