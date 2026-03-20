from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("engine", "0006_stewardstate_mood_bias"),
    ]

    operations = [
        migrations.AddField(
            model_name="stewardstate",
            name="kiosk_accessibility_mode",
            field=models.CharField(blank=True, default="", max_length=32),
        ),
        migrations.AddField(
            model_name="stewardstate",
            name="kiosk_force_reduced_motion",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="stewardstate",
            name="kiosk_max_recording_seconds",
            field=models.PositiveIntegerField(default=120),
        ),
    ]
