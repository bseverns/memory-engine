from datetime import datetime, timedelta

from django.utils import timezone

from .base import EngineTestCase
from ..pool import artifact_playback_window, pool_weight


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
            created_at=timezone.now() - timedelta(hours=10),
        )

        response = self.client.get(f"/api/v1/pool/next?exclude_ids={artifact.id + 1000}")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["artifact_id"], artifact.id)
        self.assertTrue(payload["playback_windowed"])
        self.assertEqual(payload["playback_duration_ms"], 45000)
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
