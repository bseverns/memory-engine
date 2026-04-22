from datetime import timedelta
import io
import json
from unittest.mock import patch

from django.core.cache import cache
from django.core.management import call_command
from django.test import override_settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone

from .base import EngineTestCase, make_test_wav_bytes
from ..ops import (
    BEAT_HEARTBEAT_CACHE_KEY,
    PRESENCE_HEARTBEAT_CACHE_KEY,
    PRESENCE_STATE_CACHE_KEY,
    WORKER_HEARTBEAT_CACHE_KEY,
    api_health_component_status,
    health_component_status,
    record_task_failure,
    record_task_success,
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

    def test_public_revocation_page_is_available_without_operator_auth(self):
        response = self.client.get("/revoke/?token=node-keep-1234")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Remove a saved recording")
        self.assertContains(response, "Revocation code")
        self.assertContains(response, 'value="node-keep-1234"', html=False)

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

        first = first_client.post(
            "/ops/",
            {"secret": "wrong-secret"},
            REMOTE_ADDR="127.0.0.1",
            HTTP_USER_AGENT="browser-a",
        )
        second = second_client.post(
            "/ops/",
            {"secret": "test-ops-secret"},
            REMOTE_ADDR="127.0.0.1",
            HTTP_USER_AGENT="browser-a",
        )

        self.assertEqual(first.status_code, 429)
        self.assertEqual(second.status_code, 429)
        self.assertContains(second, "Too many failed sign-in attempts", status_code=429)

    @override_settings(OPS_LOGIN_MAX_ATTEMPTS=1, OPS_LOGIN_LOCKOUT_SECONDS=60)
    def test_operator_login_lockout_does_not_spill_across_different_user_agents(self):
        first_client = self.client_class()
        second_client = self.client_class()

        first = first_client.post(
            "/ops/",
            {"secret": "wrong-secret"},
            REMOTE_ADDR="127.0.0.1",
            HTTP_USER_AGENT="browser-a",
        )
        second = second_client.post(
            "/ops/",
            {"secret": "test-ops-secret"},
            REMOTE_ADDR="127.0.0.1",
            HTTP_USER_AGENT="browser-b",
        )

        self.assertEqual(first.status_code, 429)
        self.assertEqual(second.status_code, 302)

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

    def test_node_status_reports_active_engine_deployment(self):
        self.login_operator()

        response = self.client.get("/api/v1/node/status")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["deployment"]["code"], "memory")
        self.assertEqual(response.json()["deployment"]["playback_policy_key"], "memory_default")
        self.assertIn("Weathered room-memory", response.json()["deployment"]["behavior_summary"])
        self.assertIn("room loop", response.json()["deployment"]["tuning_source"])

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

    @patch("engine.api_views.health_component_status")
    def test_node_status_reports_memory_color_summary(self, health_mock):
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
        self.make_active_artifact(
            consent=consent,
            raw_uri="raw/warm.wav",
            duration_ms=2400,
            effect_profile="warm",
            effect_metadata={"profile": "warm"},
            created_at=timezone.now() - timedelta(hours=6),
        )
        self.make_active_artifact(
            consent=consent,
            raw_uri="raw/dream.wav",
            duration_ms=2400,
            effect_profile="dream",
            effect_metadata={"profile": "dream"},
            created_at=timezone.now() - timedelta(hours=8),
        )

        response = self.client.get("/api/v1/node/status")

        self.assertEqual(response.status_code, 200)
        memory_colors = response.json()["memory_colors"]
        self.assertEqual(memory_colors["counts"]["warm"], 1)
        self.assertEqual(memory_colors["counts"]["dream"], 1)
        self.assertIn("clear", memory_colors["counts"])
        self.assertEqual(memory_colors["catalog"]["default"], "clear")

    def test_artifact_summary_command_reports_memory_color_counts(self):
        consent = self.make_consent("ROOM")
        self.make_active_artifact(
            consent=consent,
            raw_uri="raw/clear.wav",
            duration_ms=2200,
            effect_profile="clear",
            effect_metadata={"profile": "clear"},
            created_at=timezone.now() - timedelta(hours=2),
        )
        self.make_active_artifact(
            consent=consent,
            raw_uri="raw/radio.wav",
            duration_ms=2200,
            effect_profile="radio",
            effect_metadata={"profile": "radio"},
            created_at=timezone.now() - timedelta(hours=7),
        )
        stdout = io.StringIO()

        call_command("artifact_summary", stdout=stdout)

        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["active"], 2)
        self.assertEqual(payload["playable"], 2)
        self.assertEqual(payload["memory_colors"]["counts"]["clear"], 1)
        self.assertEqual(payload["memory_colors"]["counts"]["radio"], 1)
        self.assertEqual(payload["memory_colors"]["catalog"]["default"], "clear")
        self.assertIn("retention", payload)

    def test_operator_artifact_summary_requires_operator_session(self):
        response = self.client.get("/api/v1/operator/artifact-summary")

        self.assertEqual(response.status_code, 403)

    def test_operator_recent_artifacts_requires_operator_session(self):
        response = self.client.get("/api/v1/operator/artifacts")

        self.assertEqual(response.status_code, 403)

    def test_operator_artifact_summary_downloads_json_payload(self):
        self.login_operator()
        consent = self.make_consent("ROOM")
        self.make_active_artifact(
            consent=consent,
            raw_uri="raw/warm.wav",
            duration_ms=2500,
            effect_profile="warm",
            effect_metadata={"profile": "warm"},
            created_at=timezone.now() - timedelta(hours=5),
        )

        response = self.client.get("/api/v1/operator/artifact-summary")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Disposition"], 'attachment; filename="artifact-summary.json"')
        payload = response.json()
        self.assertEqual(payload["memory_colors"]["counts"]["warm"], 1)
        self.assertEqual(payload["playable"], 1)

    @override_settings(ENGINE_DEPLOYMENT="question")
    def test_operator_recent_artifacts_lists_only_active_deployment(self):
        self.login_operator()
        older = self.make_active_artifact(
            raw_uri="raw/question-one.wav",
            deployment_kind="question",
            topic_tag="entry_gate",
            lifecycle_status="open",
            created_at=timezone.now() - timedelta(hours=5),
        )
        newer = self.make_active_artifact(
            raw_uri="raw/question-two.wav",
            deployment_kind="question",
            topic_tag="entry_gate",
            lifecycle_status="pending",
            created_at=timezone.now() - timedelta(hours=3),
        )
        self.make_active_artifact(
            raw_uri="raw/repair-one.wav",
            deployment_kind="repair",
            topic_tag="projector",
            lifecycle_status="pending",
            created_at=timezone.now() - timedelta(hours=4),
        )

        response = self.client.get("/api/v1/operator/artifacts")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["deployment"]["code"], "question")
        self.assertEqual(len(payload["artifacts"]), 2)
        self.assertEqual(payload["artifacts"][0]["id"], newer.id)
        self.assertEqual(payload["artifacts"][0]["stack_position"], 1)
        self.assertEqual(payload["artifacts"][1]["id"], older.id)
        self.assertEqual(payload["artifacts"][1]["stack_position"], 2)
        self.assertEqual(payload["artifacts"][0]["deployment_kind"], "question")
        self.assertEqual(
            [action["value"] for action in payload["artifacts"][0]["quick_status_actions"]],
            ["answered", "resolved"],
        )
        self.assertEqual(payload["editable_fields"]["lifecycle_status"]["suggestions"][0], "open")
        self.assertEqual(payload["editable_fields"]["lifecycle_status"]["input_mode"], "select")
        self.assertTrue(payload["editable_fields"]["lifecycle_status"]["allow_blank"])
        self.assertIn("remove_from_circulation", payload["operator_actions"])
        self.assertEqual(payload["operator_actions"]["remove_from_circulation"]["label"], "Remove from stack")

    @override_settings(ENGINE_DEPLOYMENT="repair")
    def test_operator_recent_artifacts_exposes_repair_status_quick_actions(self):
        self.login_operator()
        artifact = self.make_active_artifact(
            raw_uri="raw/repair-ticket.wav",
            deployment_kind="repair",
            topic_tag="amp_rack",
            lifecycle_status="pending",
        )

        response = self.client.get("/api/v1/operator/artifacts")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["artifacts"][0]["id"], artifact.id)
        self.assertEqual(
            [action["value"] for action in payload["artifacts"][0]["quick_status_actions"]],
            ["fixed", "obsolete"],
        )

    @override_settings(ENGINE_DEPLOYMENT="repair")
    def test_operator_update_artifact_metadata_updates_topic_and_status(self):
        self.login_operator()
        artifact = self.make_active_artifact(
            raw_uri="raw/repair-note.wav",
            deployment_kind="repair",
            topic_tag="projector",
            lifecycle_status="pending",
        )

        response = self.client.post(
            f"/api/v1/operator/artifacts/{artifact.id}/metadata",
            data={
                "topic_tag": "amp_rack",
                "lifecycle_status": "fixed",
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        artifact.refresh_from_db()
        self.assertEqual(artifact.topic_tag, "amp_rack")
        self.assertEqual(artifact.lifecycle_status, "fixed")
        self.assertEqual(response.json()["changed_fields"], ["topic_tag", "lifecycle_status"])
        audit = StewardAction.objects.filter(action="artifact.metadata.updated").latest("created_at")
        self.assertIn("artifact", audit.detail)
        self.assertEqual(audit.payload["artifact_id"], artifact.id)
        self.assertEqual(audit.payload["topic_tag"], "amp_rack")
        self.assertEqual(audit.payload["lifecycle_status"], "fixed")

    @override_settings(ENGINE_DEPLOYMENT="question")
    def test_operator_update_artifact_metadata_rejects_other_deployment_artifact(self):
        self.login_operator()
        artifact = self.make_active_artifact(
            raw_uri="raw/repair-note.wav",
            deployment_kind="repair",
            topic_tag="projector",
            lifecycle_status="pending",
        )

        response = self.client.post(
            f"/api/v1/operator/artifacts/{artifact.id}/metadata",
            data={"topic_tag": "entry_gate", "lifecycle_status": "open"},
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 404)

    @patch("engine.api_views.delete_key")
    @override_settings(ENGINE_DEPLOYMENT="question")
    def test_operator_can_remove_recent_artifact_from_circulation_with_audit(self, delete_key_mock):
        self.login_operator()
        artifact = self.make_active_artifact(
            raw_uri="raw/question.wav",
            deployment_kind="question",
            topic_tag="entry_gate",
            lifecycle_status="open",
        )
        follower = self.make_active_artifact(
            raw_uri="raw/question-follow.wav",
            deployment_kind="question",
            topic_tag="entry_gate",
            lifecycle_status="pending",
        )
        Derivative.objects.create(
            artifact=artifact,
            kind=Derivative.KIND_SPECTROGRAM_PNG,
            uri="derivatives/question.png",
        )

        response = self.client.post(
            f"/api/v1/operator/artifacts/{artifact.id}/remove",
            data={},
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        artifact.refresh_from_db()
        follower.refresh_from_db()
        self.assertEqual(artifact.status, artifact.STATUS_REVOKED)
        self.assertEqual(artifact.raw_uri, "")
        self.assertEqual(artifact.stack_position, 0)
        self.assertEqual(follower.stack_position, 1)
        self.assertFalse(Derivative.objects.filter(artifact=artifact).exists())
        self.assertEqual(response.json()["status"], artifact.STATUS_REVOKED)
        self.assertEqual(response.json()["deleted_derivatives"], 1)
        self.assertEqual(response.json()["removed_stack_position"], 2)
        delete_key_mock.assert_any_call("raw/question.wav")
        delete_key_mock.assert_any_call("derivatives/question.png")
        audit = StewardAction.objects.filter(action="artifact.removed_from_circulation").latest("created_at")
        self.assertEqual(audit.payload["artifact_id"], artifact.id)
        self.assertEqual(audit.payload["deployment_kind"], "question")
        self.assertEqual(audit.payload["removed_stack_position"], 2)

    @override_settings(ENGINE_DEPLOYMENT="question")
    def test_operator_remove_artifact_rejects_other_deployment_artifact(self):
        self.login_operator()
        artifact = self.make_active_artifact(
            raw_uri="raw/repair.wav",
            deployment_kind="repair",
            topic_tag="projector",
            lifecycle_status="pending",
        )

        response = self.client.post(
            f"/api/v1/operator/artifacts/{artifact.id}/remove",
            data={},
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 404)

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
        redis_from_url_mock.return_value.llen.return_value = 0
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
        redis_from_url_mock.return_value.llen.return_value = 0
        s3_client_mock.return_value.head_bucket.return_value = {}

        ok, components = api_health_component_status()

        self.assertTrue(ok)
        self.assertEqual(set(components.keys()), {"database", "redis", "storage"})

    @patch("engine.ops.s3_client")
    @patch("engine.ops.redis.Redis.from_url")
    @patch("engine.ops.connection.cursor")
    @patch("engine.ops.broker_uses_external_redis", return_value=True)
    @override_settings(PRESENCE_SENSING_ENABLED=True, CELERY_BROKER_URL="redis://redis:6379/0")
    def test_health_component_status_reports_missing_presence_heartbeat_when_enabled(
        self,
        broker_uses_external_redis_mock,
        cursor_mock,
        redis_from_url_mock,
        s3_client_mock,
    ):
        cursor_mock.return_value.__enter__.return_value.fetchone.return_value = (1,)
        redis_client = redis_from_url_mock.return_value
        redis_client.ping.return_value = True
        redis_client.llen.return_value = 0
        redis_client.get.return_value = None
        s3_client_mock.return_value.head_bucket.return_value = {}
        record_worker_heartbeat()
        record_beat_heartbeat()

        ok, components = health_component_status()

        self.assertFalse(ok)
        self.assertFalse(components["presence"]["ok"])
        self.assertTrue(components["presence"]["enabled"])

    @patch("engine.ops.s3_client")
    @patch("engine.ops.redis.Redis.from_url")
    @patch("engine.ops.connection.cursor")
    @patch("engine.ops.broker_uses_external_redis", return_value=True)
    @override_settings(PRESENCE_SENSING_ENABLED=True, CELERY_BROKER_URL="redis://redis:6379/0")
    def test_health_component_status_is_ok_with_fresh_presence_heartbeat(
        self,
        broker_uses_external_redis_mock,
        cursor_mock,
        redis_from_url_mock,
        s3_client_mock,
    ):
        cursor_mock.return_value.__enter__.return_value.fetchone.return_value = (1,)
        redis_client = redis_from_url_mock.return_value
        redis_client.ping.return_value = True
        redis_client.llen.return_value = 0
        now_iso = timezone.now().isoformat()
        state_payload = json.dumps({
            "present": True,
            "confidence": 0.81,
            "motion_score": 0.02,
            "source": "opencv-motion",
        })

        def get_side_effect(key):
            if key == PRESENCE_HEARTBEAT_CACHE_KEY:
                return now_iso
            if key == PRESENCE_STATE_CACHE_KEY:
                return state_payload
            return None

        redis_client.get.side_effect = get_side_effect
        s3_client_mock.return_value.head_bucket.return_value = {}
        record_worker_heartbeat()
        record_beat_heartbeat()

        ok, components = health_component_status()

        self.assertTrue(components["presence"]["ok"])
        self.assertTrue(components["presence"]["enabled"])
        self.assertTrue(components["presence"]["present"])
        self.assertEqual(components["presence"]["source"], "opencv-motion")

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
        redis_from_url_mock.return_value.llen.return_value = 0
        s3_client_mock.return_value.head_bucket.return_value = {}
        record_worker_heartbeat()
        record_beat_heartbeat()

        ok, components = health_component_status()

        self.assertTrue(ok)
        self.assertTrue(components["worker"]["ok"])
        self.assertTrue(components["beat"]["ok"])
        self.assertEqual(components["queue"]["depth"], 0)

    @patch("engine.ops.s3_client")
    @patch("engine.ops.redis.Redis.from_url")
    @patch("engine.ops.connection.cursor")
    @override_settings(OPS_QUEUE_DEPTH_WARNING=3, OPS_QUEUE_DEPTH_CRITICAL=5)
    def test_health_component_status_reports_queue_backlog_warning(
        self,
        cursor_mock,
        redis_from_url_mock,
        s3_client_mock,
    ):
        cursor_mock.return_value.__enter__.return_value.fetchone.return_value = (1,)
        redis_from_url_mock.return_value.ping.return_value = True
        redis_from_url_mock.return_value.llen.return_value = 4
        s3_client_mock.return_value.head_bucket.return_value = {}
        record_worker_heartbeat()
        record_beat_heartbeat()

        ok, components = health_component_status()

        self.assertTrue(ok)
        self.assertEqual(components["queue"]["state"], "warning")
        self.assertEqual(components["queue"]["depth"], 4)

    @patch("engine.ops.s3_client")
    @patch("engine.ops.redis.Redis.from_url")
    @patch("engine.ops.connection.cursor")
    @override_settings(OPS_QUEUE_DEPTH_WARNING=3, OPS_QUEUE_DEPTH_CRITICAL=5)
    def test_health_component_status_reports_queue_backlog_critical(
        self,
        cursor_mock,
        redis_from_url_mock,
        s3_client_mock,
    ):
        cursor_mock.return_value.__enter__.return_value.fetchone.return_value = (1,)
        redis_from_url_mock.return_value.ping.return_value = True
        redis_from_url_mock.return_value.llen.return_value = 7
        s3_client_mock.return_value.head_bucket.return_value = {}
        record_worker_heartbeat()
        record_beat_heartbeat()

        ok, components = health_component_status()

        self.assertFalse(ok)
        self.assertEqual(components["queue"]["state"], "critical")
        self.assertEqual(components["queue"]["depth"], 7)

    @patch("engine.ops.s3_client")
    @patch("engine.ops.redis.Redis.from_url")
    @patch("engine.ops.connection.cursor")
    def test_health_component_status_reports_recent_background_task_failure(
        self,
        cursor_mock,
        redis_from_url_mock,
        s3_client_mock,
    ):
        cursor_mock.return_value.__enter__.return_value.fetchone.return_value = (1,)
        redis_from_url_mock.return_value.ping.return_value = True
        redis_from_url_mock.return_value.llen.return_value = 0
        s3_client_mock.return_value.head_bucket.return_value = {}
        record_worker_heartbeat()
        record_beat_heartbeat()
        record_task_failure("expire_raw", RuntimeError("cleanup failed"))

        ok, components = health_component_status()

        self.assertFalse(ok)
        self.assertFalse(components["tasks"]["ok"])
        self.assertEqual(components["tasks"]["issues"][0]["task_name"], "expire_raw")

    @patch("engine.ops.s3_client")
    @patch("engine.ops.redis.Redis.from_url")
    @patch("engine.ops.connection.cursor")
    def test_health_component_status_clears_task_issue_after_success(
        self,
        cursor_mock,
        redis_from_url_mock,
        s3_client_mock,
    ):
        cursor_mock.return_value.__enter__.return_value.fetchone.return_value = (1,)
        redis_from_url_mock.return_value.ping.return_value = True
        redis_from_url_mock.return_value.llen.return_value = 0
        s3_client_mock.return_value.head_bucket.return_value = {}
        record_worker_heartbeat()
        record_beat_heartbeat()
        record_task_failure("generate_spectrogram", RuntimeError("spectrogram failed"))
        record_task_success("generate_spectrogram")

        ok, components = health_component_status()

        self.assertTrue(ok)
        self.assertTrue(components["tasks"]["ok"])
        self.assertEqual(components["tasks"]["issues"], [])

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
                "presence": {"ok": False, "enabled": True, "error": "stale"},
            },
        )
        self.login_operator()

        response = self.client.get("/api/v1/node/status")

        self.assertEqual(response.status_code, 200)
        titles = {warning["title"] for warning in response.json()["warnings"]}
        self.assertIn("Worker heartbeat is stale", titles)
        self.assertIn("Beat heartbeat is stale", titles)
        self.assertIn("Audience presence signal is stale", titles)

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
