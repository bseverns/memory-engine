import hashlib
from django.db import models
from django.utils import timezone

class Node(models.Model):
    name = models.CharField(max_length=200)
    location_hint = models.CharField(max_length=200, blank=True, default="")
    created_at = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return self.name

class ConsentManifest(models.Model):
    created_at = models.DateTimeField(default=timezone.now)
    json = models.JSONField()
    revocation_token_hash = models.CharField(max_length=128)

    @staticmethod
    def hash_token(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

class Artifact(models.Model):
    STATUS_ACTIVE = "ACTIVE"
    STATUS_EXPIRED = "EXPIRED"
    STATUS_REVOKED = "REVOKED"
    STATUS_EPHEMERAL = "EPHEMERAL"  # for "Don't save" one-time play

    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_EXPIRED, "Expired"),
        (STATUS_REVOKED, "Revoked"),
        (STATUS_EPHEMERAL, "Ephemeral"),
    ]

    KIND_AUDIO = "audio_snippet"
    kind = models.CharField(max_length=64, default=KIND_AUDIO)
    node = models.ForeignKey(Node, on_delete=models.CASCADE)
    consent = models.ForeignKey(ConsentManifest, on_delete=models.PROTECT)

    created_at = models.DateTimeField(default=timezone.now)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_ACTIVE)

    raw_uri = models.CharField(max_length=512, blank=True, default="")  # s3 key
    raw_sha256 = models.CharField(max_length=128, blank=True, default="")
    duration_ms = models.IntegerField(default=0)

    wear = models.FloatField(default=0.0)  # 0..1
    play_count = models.IntegerField(default=0)
    last_access_at = models.DateTimeField(null=True, blank=True)

    expires_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"{self.kind} {self.id} ({self.status})"

    class Meta:
        indexes = [
            # Fast path for "is this artifact still active and eligible by time?"
            models.Index(fields=["status", "expires_at"], name="artifact_active_idx"),
            # Supports the cooled-down candidate ordering used by pool selection.
            models.Index(
                fields=["status", "expires_at", "play_count", "wear", "-created_at"],
                name="artifact_pool_rank_idx",
            ),
            # Supports recent-access fallback ordering when cooldown filtering applies.
            models.Index(
                fields=["status", "expires_at", "last_access_at", "play_count", "wear", "-created_at"],
                name="artifact_pool_cool_idx",
            ),
        ]

class Derivative(models.Model):
    KIND_SPECTROGRAM_PNG = "spectrogram_png"
    KIND_ESSENCE_WAV = "essence_wav"

    artifact = models.ForeignKey(Artifact, on_delete=models.CASCADE)
    kind = models.CharField(max_length=64)  # spectrogram_png
    uri = models.CharField(max_length=512)  # s3 key
    created_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField(null=True, blank=True)
    publishable = models.BooleanField(default=False)

    class Meta:
        indexes = [
            models.Index(fields=["artifact", "kind", "expires_at"], name="derivative_kind_idx"),
        ]

class AccessEvent(models.Model):
    artifact = models.ForeignKey(Artifact, on_delete=models.CASCADE)
    ts = models.DateTimeField(default=timezone.now)
    context = models.CharField(max_length=64, default="kiosk")
    action = models.CharField(max_length=64, default="play")


class StewardState(models.Model):
    singleton_key = models.CharField(max_length=32, unique=True, default="default")
    intake_paused = models.BooleanField(default=False)
    playback_paused = models.BooleanField(default=False)
    quieter_mode = models.BooleanField(default=False)
    maintenance_mode = models.BooleanField(default=False)
    mood_bias = models.CharField(max_length=32, blank=True, default="")
    kiosk_accessibility_mode = models.CharField(max_length=32, blank=True, default="")
    kiosk_force_reduced_motion = models.BooleanField(default=False)
    kiosk_max_recording_seconds = models.PositiveIntegerField(default=120)
    updated_at = models.DateTimeField(auto_now=True)

    @classmethod
    def load(cls):
        state, _ = cls.objects.get_or_create(singleton_key="default")
        return state


class StewardAction(models.Model):
    created_at = models.DateTimeField(default=timezone.now)
    action = models.CharField(max_length=64)
    actor = models.CharField(max_length=128, blank=True, default="operator")
    detail = models.CharField(max_length=255, blank=True, default="")
    payload = models.JSONField(default=dict, blank=True)
