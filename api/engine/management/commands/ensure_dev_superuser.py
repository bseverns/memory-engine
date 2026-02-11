import os
from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model

class Command(BaseCommand):
    help = "Dev-only: create a superuser if none exists."

    def handle(self, *args, **options):
        if os.getenv("DEV_CREATE_SUPERUSER", "0") != "1":
            return
        User = get_user_model()
        if User.objects.filter(is_superuser=True).exists():
            return
        username = os.getenv("DEV_SUPERUSER_USERNAME", "admin")
        password = os.getenv("DEV_SUPERUSER_PASSWORD", "admin")
        email = os.getenv("DEV_SUPERUSER_EMAIL", "admin@example.com")
        User.objects.create_superuser(username=username, password=password, email=email)
        self.stdout.write(self.style.SUCCESS(f"Dev superuser created: {username} / {password}"))
