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

class Derivative(models.Model):
    artifact = models.ForeignKey(Artifact, on_delete=models.CASCADE)
    kind = models.CharField(max_length=64)  # spectrogram_png
    uri = models.CharField(max_length=512)  # s3 key
    created_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField(null=True, blank=True)
    publishable = models.BooleanField(default=False)

class AccessEvent(models.Model):
    artifact = models.ForeignKey(Artifact, on_delete=models.CASCADE)
    ts = models.DateTimeField(default=timezone.now)
    context = models.CharField(max_length=64, default="kiosk")
    action = models.CharField(max_length=64, default="play")
