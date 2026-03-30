from datetime import timedelta
import io
import math
import wave
from types import SimpleNamespace

from django.test import TestCase
from django.utils import timezone

from memory_engine.config_validation import validate_runtime_settings

from ..models import Artifact, ConsentManifest, Node
from ..operator_auth import OPS_SESSION_BINDING_KEY, OPS_SESSION_KEY, operator_session_binding


class EngineTestCase(TestCase):
    def login_operator(self):
        session = self.client.session
        session[OPS_SESSION_KEY] = True
        request = SimpleNamespace(META={"REMOTE_ADDR": "127.0.0.1", "HTTP_USER_AGENT": ""})
        session[OPS_SESSION_BINDING_KEY] = operator_session_binding(request)
        session.save()

    def make_consent(self, mode: str, token: str = "TOKEN12345") -> ConsentManifest:
        return ConsentManifest.objects.create(
            json={"mode": mode},
            revocation_token_hash=ConsentManifest.hash_token(token),
        )

    def make_active_artifact(self, *, consent=None, **overrides) -> Artifact:
        node = Node.objects.create(name="Test Node", location_hint="Lab")
        consent = consent or self.make_consent("ROOM")
        payload = {
            "node": node,
            "consent": consent,
            "status": Artifact.STATUS_ACTIVE,
            "raw_sha256": "abc123",
            "raw_uri": "raw/test.wav",
            "duration_ms": 4000,
            "expires_at": timezone.now() + timedelta(hours=24),
        }
        payload.update(overrides)
        return Artifact.objects.create(**payload)


def default_runtime_config(**overrides):
    payload = {
        "INSTALLATION_PROFILE": "custom",
        "ENGINE_DEPLOYMENT": "memory",
        "ALLOWED_HOSTS": ["localhost"],
        "CSRF_TRUSTED_ORIGINS": ["http://localhost"],
        "MINIO_ENDPOINT": "http://minio:9000",
        "CACHE_URL": "redis://redis:6379/0",
        "ALLOW_LOCAL_MEMORY_CACHE": False,
        "TRUST_X_FORWARDED_FOR": False,
        "SECURE_SSL_REDIRECT": False,
        "SESSION_COOKIE_SECURE": False,
        "CSRF_COOKIE_SECURE": False,
        "WEAR_EPSILON_PER_PLAY": 0.003,
        "POOL_PLAY_COOLDOWN_SECONDS": 90,
        "POOL_CANDIDATE_LIMIT": 40,
        "POOL_FRESH_MAX_AGE_HOURS": 8.0,
        "POOL_WORN_MIN_AGE_HOURS": 18.0,
        "POOL_FEATURED_RETURN_MIN_AGE_HOURS": 168.0,
        "POOL_FEATURED_RETURN_MIN_ABSENCE_HOURS": 96.0,
        "POOL_FEATURED_RETURN_BOOST": 1.45,
        "POOL_DENSITY_CLUSTER_PENALTY": 0.62,
        "POOL_DENSITY_RELEASE_BOOST": 1.18,
        "RAW_TTL_HOURS_ROOM": 48,
        "RAW_TTL_HOURS_FOSSIL": 48,
        "DERIVATIVE_TTL_DAYS_FOSSIL": 365,
        "ROOM_QUIET_HOURS_START_HOUR": 22,
        "ROOM_QUIET_HOURS_END_HOUR": 6,
        "ROOM_QUIET_HOURS_GAP_MULTIPLIER": 1.2,
        "ROOM_QUIET_HOURS_TONE_MULTIPLIER": 0.78,
        "ROOM_QUIET_HOURS_OUTPUT_GAIN_MULTIPLIER": 0.72,
        "ROOM_TONE_SOURCE_MODE": "synthetic",
        "ROOM_TONE_SOURCE_URL": "",
        "ROOM_SCARCITY_SEVERE_THRESHOLD": 3,
        "ROOM_SCARCITY_LOW_THRESHOLD": 6,
        "ROOM_ANTI_REPETITION_WINDOW_SIZE": 12,
        "ROOM_SOURCE_SLICE_MAX_SECONDS": 45,
        "ROOM_SOURCE_SLICE_REVOLUTION_SECONDS": 300,
        "ROOM_OVERLAP_CHANCE": 0.1,
        "ROOM_OVERLAP_MIN_POOL_SIZE": 6,
        "ROOM_OVERLAP_MAX_LAYERS": 2,
        "ROOM_OVERLAP_MIN_DELAY_MS": 180,
        "ROOM_OVERLAP_MAX_DELAY_MS": 520,
        "ROOM_OVERLAP_GAIN_MULTIPLIER": 0.68,
        "OPS_SESSION_TTL_SECONDS": 43200,
        "OPS_ALLOWED_NETWORKS": [],
        "OPS_SESSION_BINDING_MODE": "user_agent",
        "OPS_LOGIN_LOCKOUT_SCOPE": "ip_user_agent",
        "OPS_LOGIN_MAX_ATTEMPTS": 6,
        "OPS_LOGIN_LOCKOUT_SECONDS": 900,
        "OPS_WORKER_HEARTBEAT_MAX_AGE_SECONDS": 180,
        "OPS_BEAT_HEARTBEAT_MAX_AGE_SECONDS": 180,
        "OPS_THROTTLE_EVENT_WINDOW_SECONDS": 3600,
        "OPS_QUEUE_DEPTH_WARNING": 12,
        "OPS_QUEUE_DEPTH_CRITICAL": 40,
        "OPS_TASK_FAILURE_WINDOW_SECONDS": 1800,
        "OPS_LOCAL_HEALTH_HARNESS": False,
        "CELERY_TASK_DEFAULT_QUEUE": "celery",
        "MEDIA_ACCESS_TOKEN_TTL_SECONDS": 900,
        "SURFACE_ACCESS_TOKEN_TTL_SECONDS": 86400,
        "INGEST_MAX_UPLOAD_BYTES": 32 * 1024 * 1024,
        "INGEST_MAX_DURATION_SECONDS": 300,
        "ROOM_FOSSIL_VISUALS_ENABLED": True,
        "KIOSK_DEFAULT_LANGUAGE_CODE": "en",
        "KIOSK_DEFAULT_MAX_RECORDING_SECONDS": 120,
        "OPS_POOL_LOW_COUNT": 6,
        "OPS_POOL_IMBALANCE_RATIO": 0.72,
        "OPS_DISK_CRITICAL_FREE_GB": 3.0,
        "OPS_DISK_WARNING_FREE_GB": 8.0,
        "OPS_DISK_CRITICAL_FREE_PERCENT": 8.0,
        "OPS_DISK_WARNING_FREE_PERCENT": 15.0,
        "OPS_RETENTION_SOON_HOURS": 24,
    }
    payload.update(overrides)
    return SimpleNamespace(**payload)


def make_test_wav_bytes(*, seconds: float = 0.5, sample_rate: int = 8000, amplitude: float = 0.2) -> bytes:
    frame_count = max(1, int(round(seconds * sample_rate)))
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        frames = bytearray()
        for index in range(frame_count):
            sample = math.sin((index / sample_rate) * 2 * math.pi * 330.0)
            pcm = int(max(-1.0, min(1.0, sample * amplitude)) * 32767.0)
            frames.extend(int(pcm).to_bytes(2, "little", signed=True))
        wav_file.writeframes(bytes(frames))
    return buffer.getvalue()


__all__ = [
    "EngineTestCase",
    "default_runtime_config",
    "make_test_wav_bytes",
    "validate_runtime_settings",
]
