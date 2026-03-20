from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("engine", "0007_stewardstate_kiosk_controls"),
    ]

    operations = [
        migrations.AddField(
            model_name="stewardstate",
            name="kiosk_language_code",
            field=models.CharField(blank=True, default="", max_length=32),
        ),
    ]
