from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("engine", "0009_artifact_memory_color"),
    ]

    operations = [
        migrations.AddField(
            model_name="artifact",
            name="deployment_kind",
            field=models.CharField(default="memory", max_length=32),
        ),
        migrations.AddField(
            model_name="artifact",
            name="topic_tag",
            field=models.CharField(blank=True, default="", max_length=64),
        ),
        migrations.AddField(
            model_name="artifact",
            name="lifecycle_status",
            field=models.CharField(blank=True, default="", max_length=32),
        ),
        migrations.AddIndex(
            model_name="artifact",
            index=models.Index(fields=["deployment_kind", "status", "expires_at"], name="artifact_deploy_idx"),
        ),
    ]
