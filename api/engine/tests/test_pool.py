from datetime import datetime, timedelta

from django.test import override_settings
from django.utils import timezone

from .base import EngineTestCase
from ..pool import artifact_playback_window, pool_weight, select_pool_artifact


class PoolBehaviorTests(EngineTestCase):
    def test_pool_next_falls_back_to_excluded_artifact_when_pool_is_too_small(self):
        artifact = self.make_active_artifact(
            raw_uri="raw/only.wav",
            created_at=timezone.now() - timedelta(hours=10),
        )

        response = self.client.get(f"/api/v1/pool/next?exclude_ids={artifact.id}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["artifact_id"], artifact.id)

    def test_pool_next_windows_long_recordings_into_room_slices(self):
        artifact = self.make_active_artifact(
            raw_uri="raw/long.wav",
            duration_ms=300000,
            effect_profile="warm",
            effect_metadata={"profile": "warm", "family": "participant_memory_color", "version": "v1", "label": "Warm"},
            created_at=timezone.now() - timedelta(hours=10),
        )

        response = self.client.get(f"/api/v1/pool/next?exclude_ids={artifact.id + 1000}")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["artifact_id"], artifact.id)
        self.assertTrue(payload["playback_windowed"])
        self.assertEqual(payload["playback_duration_ms"], 45000)
        self.assertEqual(payload["effect_profile"], "warm")
        self.assertTrue(payload["audio_url"].startswith("/api/v1/media/raw/"))
        self.assertGreaterEqual(payload["playback_start_ms"], 0)
        self.assertLessEqual(payload["playback_start_ms"], artifact.duration_ms - payload["playback_duration_ms"])
        self.assertEqual(payload["playback_revolution_seconds"], 300)

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

    def test_artifact_playback_window_moves_across_revolutions_for_long_recordings(self):
        artifact = self.make_active_artifact(
            raw_uri="raw/windowed.wav",
            duration_ms=300000,
            created_at=timezone.now() - timedelta(hours=12),
        )

        first = artifact_playback_window(
            artifact,
            timezone.make_aware(datetime(2026, 3, 20, 10, 0, 0), timezone.get_current_timezone()),
            max_slice_seconds=45,
            revolution_seconds=300,
            variant="primary",
        )
        second = artifact_playback_window(
            artifact,
            timezone.make_aware(datetime(2026, 3, 20, 10, 5, 0), timezone.get_current_timezone()),
            max_slice_seconds=45,
            revolution_seconds=300,
            variant="primary",
        )

        self.assertTrue(first["windowed"])
        self.assertEqual(first["duration_ms"], 45000)
        self.assertEqual(second["duration_ms"], 45000)
        self.assertNotEqual(first["start_ms"], second["start_ms"])

    def test_pool_weight_prefers_light_release_after_dense_cluster(self):
        now = timezone.now()
        consent = self.make_consent("ROOM")
        dense = self.make_active_artifact(
            consent=consent,
            raw_uri="raw/dense.wav",
            duration_ms=24000,
            created_at=now - timedelta(hours=16),
            last_access_at=now - timedelta(hours=6),
        )
        light = self.make_active_artifact(
            consent=consent,
            raw_uri="raw/light.wav",
            duration_ms=3000,
            created_at=now - timedelta(hours=16),
            last_access_at=now - timedelta(hours=6),
        )

        dense_weight = pool_weight(
            dense,
            now,
            cooldown_seconds=90,
            recent_densities=["dense", "dense", "medium"],
        )
        light_weight = pool_weight(
            light,
            now,
            cooldown_seconds=90,
            recent_densities=["dense", "dense", "medium"],
        )

        self.assertGreater(light_weight, dense_weight)

    def test_pool_weight_boosts_featured_return_after_long_absence(self):
        now = timezone.now()
        consent = self.make_consent("ROOM")
        older_return = self.make_active_artifact(
            consent=consent,
            raw_uri="raw/older-return.wav",
            created_at=now - timedelta(days=12),
            last_access_at=now - timedelta(days=8),
        )
        merely_old = self.make_active_artifact(
            consent=consent,
            raw_uri="raw/merely-old.wav",
            created_at=now - timedelta(days=12),
            last_access_at=now - timedelta(hours=10),
        )

        return_weight = pool_weight(older_return, now, cooldown_seconds=90)
        old_weight = pool_weight(merely_old, now, cooldown_seconds=90)

        self.assertGreater(return_weight, old_weight)

    def test_pool_weight_question_prefers_unresolved_items(self):
        now = timezone.now()
        consent = self.make_consent("ROOM")
        unresolved = self.make_active_artifact(
            consent=consent,
            raw_uri="raw/open.wav",
            lifecycle_status="open",
            created_at=now - timedelta(hours=20),
            last_access_at=now - timedelta(hours=5),
        )
        answered = self.make_active_artifact(
            consent=consent,
            raw_uri="raw/answered.wav",
            lifecycle_status="answered",
            created_at=now - timedelta(hours=20),
            last_access_at=now - timedelta(hours=5),
        )

        unresolved_weight = pool_weight(unresolved, now, cooldown_seconds=90, deployment_code="question")
        answered_weight = pool_weight(answered, now, cooldown_seconds=90, deployment_code="question")

        self.assertGreater(unresolved_weight, answered_weight)

    def test_pool_weight_question_boosts_recent_topic_cluster(self):
        now = timezone.now()
        consent = self.make_consent("ROOM")
        clustered = self.make_active_artifact(
            consent=consent,
            raw_uri="raw/clustered-question.wav",
            deployment_kind="question",
            topic_tag="entry_gate",
            lifecycle_status="open",
            created_at=now - timedelta(hours=18),
            last_access_at=now - timedelta(hours=5),
        )
        unrelated = self.make_active_artifact(
            consent=consent,
            raw_uri="raw/unrelated-question.wav",
            deployment_kind="question",
            topic_tag="maintenance",
            lifecycle_status="open",
            created_at=now - timedelta(hours=18),
            last_access_at=now - timedelta(hours=5),
        )

        clustered_weight = pool_weight(
            clustered,
            now,
            cooldown_seconds=90,
            recent_topics=["entry_gate"],
            deployment_code="question",
        )
        unrelated_weight = pool_weight(
            unrelated,
            now,
            cooldown_seconds=90,
            recent_topics=["entry_gate"],
            deployment_code="question",
        )

        self.assertGreater(clustered_weight, unrelated_weight)

    def test_pool_weight_repair_prefers_recent_shorter_notes(self):
        now = timezone.now()
        consent = self.make_consent("ROOM")
        recent_short = self.make_active_artifact(
            consent=consent,
            raw_uri="raw/repair-short.wav",
            deployment_kind="repair",
            duration_ms=7000,
            created_at=now - timedelta(hours=12),
            last_access_at=now - timedelta(hours=8),
        )
        old_dense = self.make_active_artifact(
            consent=consent,
            raw_uri="raw/repair-dense.wav",
            deployment_kind="repair",
            duration_ms=26000,
            created_at=now - timedelta(days=20),
            last_access_at=now - timedelta(days=7),
        )

        recent_weight = pool_weight(recent_short, now, cooldown_seconds=90, deployment_code="repair")
        old_weight = pool_weight(old_dense, now, cooldown_seconds=90, deployment_code="repair")

        self.assertGreater(recent_weight, old_weight)

    def test_pool_weight_prompt_prefers_recent_catalytic_material(self):
        now = timezone.now()
        consent = self.make_consent("ROOM")
        recent_prompt = self.make_active_artifact(
            consent=consent,
            raw_uri="raw/prompt-recent.wav",
            deployment_kind="prompt",
            topic_tag="call_and_response",
            duration_ms=6000,
            created_at=now - timedelta(hours=8),
            last_access_at=now - timedelta(hours=4),
        )
        old_prompt = self.make_active_artifact(
            consent=consent,
            raw_uri="raw/prompt-old.wav",
            deployment_kind="prompt",
            topic_tag="spent",
            duration_ms=26000,
            created_at=now - timedelta(days=20),
            last_access_at=now - timedelta(days=6),
        )

        recent_weight = pool_weight(
            recent_prompt,
            now,
            cooldown_seconds=90,
            recent_topics=["call_and_response"],
            deployment_code="prompt",
        )
        old_weight = pool_weight(old_prompt, now, cooldown_seconds=90, deployment_code="prompt")

        self.assertGreater(recent_weight, old_weight)

    def test_pool_weight_witness_prefers_settled_contextual_material(self):
        now = timezone.now()
        consent = self.make_consent("ROOM")
        settled = self.make_active_artifact(
            consent=consent,
            raw_uri="raw/witness-settled.wav",
            deployment_kind="witness",
            duration_ms=14000,
            created_at=now - timedelta(hours=30),
            last_access_at=now - timedelta(hours=12),
        )
        new_item = self.make_active_artifact(
            consent=consent,
            raw_uri="raw/witness-new.wav",
            deployment_kind="witness",
            duration_ms=4000,
            created_at=now - timedelta(hours=1),
            last_access_at=now - timedelta(hours=1),
        )

        settled_weight = pool_weight(settled, now, cooldown_seconds=90, deployment_code="witness")
        new_weight = pool_weight(new_item, now, cooldown_seconds=90, deployment_code="witness")

        self.assertGreater(settled_weight, new_weight)

    def test_pool_weight_oracle_penalizes_brand_new_material(self):
        now = timezone.now()
        consent = self.make_consent("ROOM")
        new_item = self.make_active_artifact(
            consent=consent,
            raw_uri="raw/new-oracle.wav",
            created_at=now - timedelta(hours=1),
            last_access_at=now - timedelta(hours=1),
        )
        old_absent = self.make_active_artifact(
            consent=consent,
            raw_uri="raw/old-oracle.wav",
            created_at=now - timedelta(days=10),
            last_access_at=now - timedelta(days=7),
        )

        new_weight = pool_weight(new_item, now, cooldown_seconds=90, deployment_code="oracle")
        old_weight = pool_weight(old_absent, now, cooldown_seconds=90, deployment_code="oracle")

        self.assertGreater(old_weight, new_weight)

    def test_select_pool_artifact_for_question_falls_back_to_same_deployment_before_memory(self):
        now = timezone.now()
        consent = self.make_consent("ROOM")
        question_artifact = self.make_active_artifact(
            consent=consent,
            raw_uri="raw/question-only.wav",
            deployment_kind="question",
            lifecycle_status="open",
            created_at=now - timedelta(hours=24),
        )
        self.make_active_artifact(
            consent=consent,
            raw_uri="raw/memory-other.wav",
            deployment_kind="memory",
            created_at=now - timedelta(hours=24),
        )

        selected, _ = select_pool_artifact(
            now,
            excluded_ids={question_artifact.id},
            deployment_code="question",
        )

        self.assertIsNotNone(selected)
        self.assertEqual(selected.id, question_artifact.id)

    def test_select_pool_artifact_for_prompt_prefers_recent_prompt_material(self):
        now = timezone.now()
        consent = self.make_consent("ROOM")
        recent_prompt = self.make_active_artifact(
            consent=consent,
            raw_uri="raw/prompt-recent.wav",
            deployment_kind="prompt",
            topic_tag="call_and_response",
            created_at=now - timedelta(hours=6),
            last_access_at=now - timedelta(hours=4),
        )
        self.make_active_artifact(
            consent=consent,
            raw_uri="raw/prompt-old.wav",
            deployment_kind="prompt",
            topic_tag="spent",
            created_at=now - timedelta(days=25),
            last_access_at=now - timedelta(days=8),
        )

        selected, _ = select_pool_artifact(
            now,
            deployment_code="prompt",
            recent_topics=["call_and_response"],
        )

        self.assertIsNotNone(selected)
        self.assertEqual(selected.id, recent_prompt.id)

    def test_select_pool_artifact_for_witness_prefers_settled_material(self):
        now = timezone.now()
        consent = self.make_consent("ROOM")
        settled = self.make_active_artifact(
            consent=consent,
            raw_uri="raw/witness-settled.wav",
            deployment_kind="witness",
            created_at=now - timedelta(hours=18),
            last_access_at=now - timedelta(hours=12),
        )
        self.make_active_artifact(
            consent=consent,
            raw_uri="raw/witness-fresh.wav",
            deployment_kind="witness",
            created_at=now - timedelta(hours=2),
            last_access_at=now - timedelta(hours=2),
        )

        selected, _ = select_pool_artifact(
            now,
            deployment_code="witness",
        )

        self.assertIsNotNone(selected)
        self.assertEqual(selected.id, settled.id)

    @override_settings(ENGINE_DEPLOYMENT="question")
    def test_pool_next_returns_question_metadata_for_room_loop_clustering(self):
        artifact = self.make_active_artifact(
            raw_uri="raw/question-meta.wav",
            deployment_kind="question",
            topic_tag="entry_gate",
            lifecycle_status="open",
            created_at=timezone.now() - timedelta(hours=12),
        )

        response = self.client.get("/api/v1/pool/next?recent_topics=entry_gate")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["artifact_id"], artifact.id)
        self.assertEqual(payload["deployment_kind"], "question")
        self.assertEqual(payload["topic_tag"], "entry_gate")
        self.assertEqual(payload["lifecycle_status"], "open")
