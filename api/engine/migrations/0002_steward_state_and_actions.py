from django.db import migrations, models
import django.utils.timezone


class Migration(migrations.Migration):

    dependencies = [
        ("engine", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="StewardState",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("singleton_key", models.CharField(default="default", max_length=32, unique=True)),
                ("intake_paused", models.BooleanField(default=False)),
                ("playback_paused", models.BooleanField(default=False)),
                ("quieter_mode", models.BooleanField(default=False)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
        ),
        migrations.CreateModel(
            name="StewardAction",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("action", models.CharField(max_length=64)),
                ("actor", models.CharField(blank=True, default="operator", max_length=128)),
                ("detail", models.CharField(blank=True, default="", max_length=255)),
                ("payload", models.JSONField(blank=True, default=dict)),
            ],
        ),
    ]
