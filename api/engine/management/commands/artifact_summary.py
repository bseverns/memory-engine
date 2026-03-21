import json

from django.core.management.base import BaseCommand

from engine.reporting import artifact_summary_payload


class Command(BaseCommand):
    help = "Emit a compact JSON summary of current artifact posture for reporting and bundles."

    def handle(self, *args, **options):
        payload = artifact_summary_payload()

        self.stdout.write(json.dumps(payload, indent=2, sort_keys=True, default=str))
