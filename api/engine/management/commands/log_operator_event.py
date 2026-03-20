from django.core.management.base import BaseCommand, CommandError

from engine.steward import record_steward_action


class Command(BaseCommand):
    help = "Write an operator/steward audit event into the local event log."

    def add_arguments(self, parser):
        parser.add_argument("--action", required=True)
        parser.add_argument("--actor", default="operator")
        parser.add_argument("--detail", default="")

    def handle(self, *args, **options):
        action = (options.get("action") or "").strip()
        if not action:
            raise CommandError("--action is required")

        event = record_steward_action(
            action=action,
            actor=(options.get("actor") or "operator").strip() or "operator",
            detail=(options.get("detail") or "").strip(),
            payload={},
        )
        self.stdout.write(self.style.SUCCESS(f"Recorded operator event {event.id}: {event.action}"))
