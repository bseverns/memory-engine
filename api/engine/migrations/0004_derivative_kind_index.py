from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("engine", "0003_artifact_pool_indexes"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="derivative",
            index=models.Index(fields=["artifact", "kind", "expires_at"], name="derivative_kind_idx"),
        ),
    ]
