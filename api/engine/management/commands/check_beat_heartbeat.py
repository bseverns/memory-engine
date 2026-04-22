from django.conf import settings
from django.core.cache import cache
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from engine.ops import BEAT_HEARTBEAT_CACHE_KEY, parse_cached_datetime


class Command(BaseCommand):
    help = "Exit non-zero when Celery beat heartbeat is missing or stale."

    def add_arguments(self, parser):
        parser.add_argument(
            "--max-age-seconds",
            type=int,
            default=int(getattr(settings, "OPS_BEAT_HEARTBEAT_MAX_AGE_SECONDS", 180)),
            help="Maximum accepted beat heartbeat age in seconds.",
        )

    def handle(self, *args, **options):
        max_age_seconds = int(options["max_age_seconds"])
        seen_at = parse_cached_datetime(cache.get(BEAT_HEARTBEAT_CACHE_KEY))
        if not seen_at:
            raise CommandError("No recent beat heartbeat found in cache.")

        age_seconds = max(0.0, (timezone.now() - seen_at).total_seconds())
        if age_seconds > max_age_seconds:
            raise CommandError(
                f"Beat heartbeat is stale ({round(age_seconds, 1)}s > {max_age_seconds}s).",
            )

        self.stdout.write(self.style.SUCCESS(f"Beat heartbeat is fresh ({round(age_seconds, 1)}s old)."))
