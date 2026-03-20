from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("engine", "0005_stewardstate_maintenance_mode"),
    ]

    operations = [
        migrations.AddField(
            model_name="stewardstate",
            name="mood_bias",
            field=models.CharField(blank=True, default="", max_length=32),
        ),
    ]
