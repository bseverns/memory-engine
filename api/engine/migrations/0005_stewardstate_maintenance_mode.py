from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("engine", "0004_derivative_kind_index"),
    ]

    operations = [
        migrations.AddField(
            model_name="stewardstate",
            name="maintenance_mode",
            field=models.BooleanField(default=False),
        ),
    ]
