from django.db import migrations, models


def backfill_stack_positions(apps, schema_editor):
    Artifact = apps.get_model("engine", "Artifact")

    Artifact.objects.exclude(status="ACTIVE").update(stack_position=0)

    deployment_codes = (
        Artifact.objects.filter(status="ACTIVE")
        .values_list("deployment_kind", flat=True)
        .distinct()
    )
    for deployment_code in deployment_codes:
        artifact_ids = list(
            Artifact.objects.filter(
                status="ACTIVE",
                deployment_kind=deployment_code,
            ).order_by("-created_at", "-id").values_list("id", flat=True)
        )
        for position, artifact_id in enumerate(artifact_ids, start=1):
            Artifact.objects.filter(id=artifact_id).update(stack_position=position)


class Migration(migrations.Migration):

    dependencies = [
        ("engine", "0010_artifact_deployment_metadata"),
    ]

    operations = [
        migrations.AddField(
            model_name="artifact",
            name="stack_position",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.RunPython(backfill_stack_positions, migrations.RunPython.noop),
        migrations.AddIndex(
            model_name="artifact",
            index=models.Index(fields=["deployment_kind", "status", "stack_position"], name="artifact_stack_idx"),
        ),
    ]
