from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("engine", "0012_stewardstate_session_theme"),
    ]

    operations = [
        migrations.AddField(
            model_name="stewardstate",
            name="deployment_focus_status",
            field=models.CharField(blank=True, default="", max_length=32),
        ),
        migrations.AddField(
            model_name="stewardstate",
            name="deployment_focus_topic",
            field=models.CharField(blank=True, default="", max_length=64),
        ),
    ]
