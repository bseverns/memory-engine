from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("engine", "0011_artifact_stack_position"),
    ]

    operations = [
        migrations.AddField(
            model_name="stewardstate",
            name="session_theme_prompt",
            field=models.CharField(blank=True, default="", max_length=180),
        ),
        migrations.AddField(
            model_name="stewardstate",
            name="session_theme_title",
            field=models.CharField(blank=True, default="", max_length=64),
        ),
    ]
