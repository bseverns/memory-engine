import io
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import patch

from django.core.exceptions import ImproperlyConfigured
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone

from memory_engine.config_validation import validate_runtime_settings

from .models import AccessEvent, Artifact, ConsentManifest, Derivative, Node, StewardAction, StewardState
from .operator_auth import OPS_SESSION_KEY
from .pool import pool_weight
from .room_composer import active_daypart_for_hour, quiet_hours_active_for_hour, room_schedule_snapshot


class EngineBehaviorTests(TestCase):
    def login_operator(self):
        session = self.client.session
        session[OPS_SESSION_KEY] = True
        session.save()

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
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        state = StewardState.load()
        self.assertTrue(state.maintenance_mode)
        self.assertTrue(state.intake_paused)
        self.assertTrue(state.playback_paused)
        self.assertTrue(state.quieter_mode)
        self.assertEqual(StewardAction.objects.count(), 4)
        payload = response.json()
        self.assertTrue(payload["operator_state"]["maintenance_mode"])
        self.assertTrue(payload["operator_state"]["intake_paused"])
        self.assertEqual(len(payload["changes"]), 4)

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

    @patch("engine.tasks.delete_key")
    def test_fossil_artifact_stays_active_on_essence_after_raw_expiry(self, delete_key_mock):
        from .tasks import expire_raw

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

    def test_runtime_config_validation_accepts_default_test_like_values(self):
        config = SimpleNamespace(
            ALLOWED_HOSTS=["localhost"],
            CSRF_TRUSTED_ORIGINS=["http://localhost"],
            MINIO_ENDPOINT="http://minio:9000",
            SECURE_SSL_REDIRECT=False,
            SESSION_COOKIE_SECURE=False,
            CSRF_COOKIE_SECURE=False,
            WEAR_EPSILON_PER_PLAY=0.003,
            POOL_PLAY_COOLDOWN_SECONDS=90,
            POOL_CANDIDATE_LIMIT=40,
            POOL_FRESH_MAX_AGE_HOURS=8.0,
            POOL_WORN_MIN_AGE_HOURS=18.0,
            RAW_TTL_HOURS_ROOM=48,
            RAW_TTL_HOURS_FOSSIL=48,
            DERIVATIVE_TTL_DAYS_FOSSIL=365,
            ROOM_QUIET_HOURS_START_HOUR=22,
            ROOM_QUIET_HOURS_END_HOUR=6,
            ROOM_QUIET_HOURS_GAP_MULTIPLIER=1.2,
            ROOM_QUIET_HOURS_TONE_MULTIPLIER=0.78,
            ROOM_QUIET_HOURS_OUTPUT_GAIN_MULTIPLIER=0.72,
            ROOM_SCARCITY_SEVERE_THRESHOLD=3,
            ROOM_SCARCITY_LOW_THRESHOLD=6,
            ROOM_ANTI_REPETITION_WINDOW_SIZE=12,
            OPS_SESSION_TTL_SECONDS=43200,
            OPS_POOL_LOW_COUNT=6,
            OPS_POOL_IMBALANCE_RATIO=0.72,
            OPS_DISK_CRITICAL_FREE_GB=3.0,
            OPS_DISK_WARNING_FREE_GB=8.0,
            OPS_DISK_CRITICAL_FREE_PERCENT=8.0,
            OPS_DISK_WARNING_FREE_PERCENT=15.0,
            OPS_RETENTION_SOON_HOURS=24,
        )

        validate_runtime_settings(config)

    def test_runtime_config_validation_rejects_inverted_thresholds(self):
        config = SimpleNamespace(
            ALLOWED_HOSTS=["localhost"],
            CSRF_TRUSTED_ORIGINS=["http://localhost"],
            MINIO_ENDPOINT="http://minio:9000",
            SECURE_SSL_REDIRECT=False,
            SESSION_COOKIE_SECURE=False,
            CSRF_COOKIE_SECURE=False,
            WEAR_EPSILON_PER_PLAY=0.003,
            POOL_PLAY_COOLDOWN_SECONDS=90,
            POOL_CANDIDATE_LIMIT=40,
            POOL_FRESH_MAX_AGE_HOURS=8.0,
            POOL_WORN_MIN_AGE_HOURS=6.0,
            RAW_TTL_HOURS_ROOM=48,
            RAW_TTL_HOURS_FOSSIL=48,
            DERIVATIVE_TTL_DAYS_FOSSIL=365,
            ROOM_QUIET_HOURS_START_HOUR=22,
            ROOM_QUIET_HOURS_END_HOUR=6,
            ROOM_QUIET_HOURS_GAP_MULTIPLIER=1.2,
            ROOM_QUIET_HOURS_TONE_MULTIPLIER=0.78,
            ROOM_QUIET_HOURS_OUTPUT_GAIN_MULTIPLIER=0.72,
            ROOM_SCARCITY_SEVERE_THRESHOLD=8,
            ROOM_SCARCITY_LOW_THRESHOLD=6,
            ROOM_ANTI_REPETITION_WINDOW_SIZE=12,
            OPS_SESSION_TTL_SECONDS=43200,
            OPS_POOL_LOW_COUNT=6,
            OPS_POOL_IMBALANCE_RATIO=0.72,
            OPS_DISK_CRITICAL_FREE_GB=9.0,
            OPS_DISK_WARNING_FREE_GB=8.0,
            OPS_DISK_CRITICAL_FREE_PERCENT=16.0,
            OPS_DISK_WARNING_FREE_PERCENT=15.0,
            OPS_RETENTION_SOON_HOURS=24,
        )

        with self.assertRaises(ImproperlyConfigured) as ctx:
            validate_runtime_settings(config)

        self.assertIn("POOL_WORN_MIN_AGE_HOURS", str(ctx.exception))
        self.assertIn("ROOM_SCARCITY_SEVERE_THRESHOLD", str(ctx.exception))
        self.assertIn("OPS_DISK_CRITICAL_FREE_GB", str(ctx.exception))

    def test_runtime_config_validation_rejects_insecure_origins_under_secure_cookies(self):
        config = SimpleNamespace(
            ALLOWED_HOSTS=["memory.example.com"],
            CSRF_TRUSTED_ORIGINS=["http://memory.example.com"],
            MINIO_ENDPOINT="http://minio:9000",
            SECURE_SSL_REDIRECT=True,
            SESSION_COOKIE_SECURE=True,
            CSRF_COOKIE_SECURE=True,
            WEAR_EPSILON_PER_PLAY=0.003,
            POOL_PLAY_COOLDOWN_SECONDS=90,
            POOL_CANDIDATE_LIMIT=40,
            POOL_FRESH_MAX_AGE_HOURS=8.0,
            POOL_WORN_MIN_AGE_HOURS=18.0,
            RAW_TTL_HOURS_ROOM=48,
            RAW_TTL_HOURS_FOSSIL=48,
            DERIVATIVE_TTL_DAYS_FOSSIL=365,
            ROOM_QUIET_HOURS_START_HOUR=22,
            ROOM_QUIET_HOURS_END_HOUR=6,
            ROOM_QUIET_HOURS_GAP_MULTIPLIER=1.2,
            ROOM_QUIET_HOURS_TONE_MULTIPLIER=0.78,
            ROOM_QUIET_HOURS_OUTPUT_GAIN_MULTIPLIER=0.72,
            ROOM_SCARCITY_SEVERE_THRESHOLD=3,
            ROOM_SCARCITY_LOW_THRESHOLD=6,
            ROOM_ANTI_REPETITION_WINDOW_SIZE=12,
            OPS_SESSION_TTL_SECONDS=43200,
            OPS_POOL_LOW_COUNT=6,
            OPS_POOL_IMBALANCE_RATIO=0.72,
            OPS_DISK_CRITICAL_FREE_GB=3.0,
            OPS_DISK_WARNING_FREE_GB=8.0,
            OPS_DISK_CRITICAL_FREE_PERCENT=8.0,
            OPS_DISK_WARNING_FREE_PERCENT=15.0,
            OPS_RETENTION_SOON_HOURS=24,
        )

        with self.assertRaises(ImproperlyConfigured) as ctx:
            validate_runtime_settings(config)

        self.assertIn("https://", str(ctx.exception))

    def test_room_schedule_snapshot_uses_daypart_overrides_when_enabled(self):
        schedule = room_schedule_snapshot(
            intensity_profile="balanced",
            movement_preset="balanced",
            daypart_enabled=True,
            quiet_hours_enabled=False,
            now=timezone.make_aware(datetime(2026, 3, 20, 18, 0, 0), timezone.get_current_timezone()),
        )

        self.assertEqual(schedule["daypartName"], "evening")
        self.assertEqual(schedule["intensityProfile"], "active")
        self.assertEqual(schedule["movementPreset"], "balanced")

    def test_room_schedule_snapshot_falls_back_to_base_profiles_when_disabled(self):
        schedule = room_schedule_snapshot(
            intensity_profile="balanced",
            movement_preset="active",
            daypart_enabled=False,
            quiet_hours_enabled=False,
            now=timezone.make_aware(datetime(2026, 3, 20, 8, 0, 0), timezone.get_current_timezone()),
        )

        self.assertEqual(schedule["daypartName"], "")
        self.assertEqual(schedule["intensityProfile"], "balanced")
        self.assertEqual(schedule["movementPreset"], "active")

    def test_active_daypart_for_hour_handles_overnight_windows(self):
        self.assertEqual(active_daypart_for_hour(23)["name"], "night")
        self.assertEqual(active_daypart_for_hour(4)["name"], "night")

    def test_room_schedule_snapshot_marks_quiet_hours_active(self):
        schedule = room_schedule_snapshot(
            intensity_profile="balanced",
            movement_preset="balanced",
            daypart_enabled=True,
            quiet_hours_enabled=True,
            quiet_hours_start_hour=22,
            quiet_hours_end_hour=6,
            quiet_hours_gap_multiplier=1.25,
            quiet_hours_tone_multiplier=0.7,
            quiet_hours_output_gain_multiplier=0.65,
            now=timezone.make_aware(datetime(2026, 3, 20, 23, 0, 0), timezone.get_current_timezone()),
        )

        self.assertTrue(schedule["quietHoursActive"])
        self.assertEqual(schedule["quietHoursGapMultiplier"], 1.25)
        self.assertEqual(schedule["quietHoursToneMultiplier"], 0.7)
        self.assertEqual(schedule["quietHoursOutputGainMultiplier"], 0.65)

    def test_quiet_hours_active_for_hour_handles_overnight_windows(self):
        self.assertTrue(quiet_hours_active_for_hour(23, enabled=True, start_hour=22, end_hour=6))
        self.assertTrue(quiet_hours_active_for_hour(4, enabled=True, start_hour=22, end_hour=6))
        self.assertFalse(quiet_hours_active_for_hour(14, enabled=True, start_hour=22, end_hour=6))
