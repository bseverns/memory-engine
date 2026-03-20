from datetime import datetime

from django.utils import timezone

from .base import EngineTestCase
from ..room_composer import active_daypart_for_hour, quiet_hours_active_for_hour, room_schedule_snapshot


class RoomScheduleTests(EngineTestCase):
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
            tone_profile="warm_hiss",
            tone_source_mode="synthetic",
            tone_source_url="",
            now=timezone.make_aware(datetime(2026, 3, 20, 23, 0, 0), timezone.get_current_timezone()),
        )

        self.assertTrue(schedule["quietHoursActive"])
        self.assertEqual(schedule["quietHoursGapMultiplier"], 1.25)
        self.assertEqual(schedule["quietHoursToneMultiplier"], 0.7)
        self.assertEqual(schedule["quietHoursOutputGainMultiplier"], 0.65)
        self.assertEqual(schedule["roomToneProfile"], "warm_hiss")
        self.assertEqual(schedule["roomToneSourceMode"], "synthetic")

    def test_quiet_hours_active_for_hour_handles_overnight_windows(self):
        self.assertTrue(quiet_hours_active_for_hour(23, enabled=True, start_hour=22, end_hour=6))
        self.assertTrue(quiet_hours_active_for_hour(4, enabled=True, start_hour=22, end_hour=6))
        self.assertFalse(quiet_hours_active_for_hour(14, enabled=True, start_hour=22, end_hour=6))
