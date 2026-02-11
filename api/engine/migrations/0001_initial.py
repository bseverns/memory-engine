# Generated manually for skeleton
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone

class Migration(migrations.Migration):
    initial = True

    dependencies = [
    ]

    operations = [
        migrations.CreateModel(
            name='Node',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=200)),
                ('location_hint', models.CharField(blank=True, default='', max_length=200)),
                ('created_at', models.DateTimeField(default=django.utils.timezone.now)),
            ],
        ),
        migrations.CreateModel(
            name='ConsentManifest',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('json', models.JSONField()),
                ('revocation_token_hash', models.CharField(max_length=128)),
            ],
        ),
        migrations.CreateModel(
            name='Artifact',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('kind', models.CharField(default='audio_snippet', max_length=64)),
                ('created_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('status', models.CharField(choices=[('ACTIVE', 'Active'), ('EXPIRED', 'Expired'), ('REVOKED', 'Revoked'), ('EPHEMERAL', 'Ephemeral')], default='ACTIVE', max_length=16)),
                ('raw_uri', models.CharField(blank=True, default='', max_length=512)),
                ('raw_sha256', models.CharField(blank=True, default='', max_length=128)),
                ('duration_ms', models.IntegerField(default=0)),
                ('wear', models.FloatField(default=0.0)),
                ('play_count', models.IntegerField(default=0)),
                ('last_access_at', models.DateTimeField(blank=True, null=True)),
                ('expires_at', models.DateTimeField(blank=True, null=True)),
                ('consent', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to='engine.consentmanifest')),
                ('node', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='engine.node')),
            ],
        ),
        migrations.CreateModel(
            name='Derivative',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('kind', models.CharField(max_length=64)),
                ('uri', models.CharField(max_length=512)),
                ('created_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('expires_at', models.DateTimeField(blank=True, null=True)),
                ('publishable', models.BooleanField(default=False)),
                ('artifact', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='engine.artifact')),
            ],
        ),
        migrations.CreateModel(
            name='AccessEvent',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('ts', models.DateTimeField(default=django.utils.timezone.now)),
                ('context', models.CharField(default='kiosk', max_length=64)),
                ('action', models.CharField(default='play', max_length=64)),
                ('artifact', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='engine.artifact')),
            ],
        ),
    ]
