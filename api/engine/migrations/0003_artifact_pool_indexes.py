from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("engine", "0002_steward_state_and_actions"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="artifact",
            index=models.Index(fields=["status", "expires_at"], name="artifact_active_idx"),
        ),
        migrations.AddIndex(
            model_name="artifact",
            index=models.Index(
                fields=["status", "expires_at", "play_count", "wear", "-created_at"],
                name="artifact_pool_rank_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="artifact",
            index=models.Index(
                fields=["status", "expires_at", "last_access_at", "play_count", "wear", "-created_at"],
                name="artifact_pool_cool_idx",
            ),
        ),
    ]
