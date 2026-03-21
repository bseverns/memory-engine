from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("engine", "0008_stewardstate_kiosk_language_code"),
    ]

    operations = [
        migrations.AddField(
            model_name="artifact",
            name="effect_metadata",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="artifact",
            name="effect_profile",
            field=models.CharField(blank=True, default="", max_length=32),
        ),
    ]
