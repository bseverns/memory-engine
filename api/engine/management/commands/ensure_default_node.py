import os
from django.core.management.base import BaseCommand
from engine.models import Node

class Command(BaseCommand):
    help = "Ensure a default Node exists."

    def handle(self, *args, **options):
        if Node.objects.exists():
            return
        Node.objects.create(
            name=os.getenv("NODE_NAME", "Room Memory Node"),
            location_hint=os.getenv("NODE_LOCATION_HINT", ""),
        )
        self.stdout.write(self.style.SUCCESS("Default Node created."))
