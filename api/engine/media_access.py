from __future__ import annotations

from django.conf import settings
from django.core import signing


MEDIA_TOKEN_SALT = "memory_engine.media_access"
SURFACE_TOKEN_SALT = "memory_engine.surface_access"

PURPOSE_POOL_AUDIO = "pool_audio"
PURPOSE_POOL_HEARD = "pool_heard"
PURPOSE_EPHEMERAL_AUDIO = "ephemeral_audio"
PURPOSE_SPECTROGRAM_IMAGE = "spectrogram_image"
PURPOSE_SURFACE_FOSSILS = "surface_fossils"


def build_media_token(*, purpose: str, artifact_id: int | None = None, nonce: str = "") -> str:
    payload: dict[str, object] = {"purpose": str(purpose)}
    if artifact_id is not None:
        payload["artifact_id"] = int(artifact_id)
    if nonce:
        payload["nonce"] = str(nonce)
    return signing.dumps(payload, salt=MEDIA_TOKEN_SALT, compress=True)


def read_media_token(token: str, *, max_age_seconds: int | None = None) -> dict | None:
    if not token:
        return None
    try:
        return signing.loads(
            token,
            salt=MEDIA_TOKEN_SALT,
            max_age=max_age_seconds or int(getattr(settings, "MEDIA_ACCESS_TOKEN_TTL_SECONDS", 900)),
        )
    except signing.BadSignature:
        return None
    except signing.SignatureExpired:
        return None


def build_surface_token(*, purpose: str) -> str:
    return signing.dumps({"purpose": str(purpose)}, salt=SURFACE_TOKEN_SALT, compress=True)


def read_surface_token(token: str, *, max_age_seconds: int | None = None) -> dict | None:
    if not token:
        return None
    try:
        return signing.loads(
            token,
            salt=SURFACE_TOKEN_SALT,
            max_age=max_age_seconds or int(getattr(settings, "SURFACE_ACCESS_TOKEN_TTL_SECONDS", 86400)),
        )
    except signing.BadSignature:
        return None
    except signing.SignatureExpired:
        return None


def media_raw_url(access_token: str) -> str:
    return f"/api/v1/media/raw/{access_token}"


def media_spectrogram_url(access_token: str) -> str:
    return f"/api/v1/media/spectrogram/{access_token}"


def media_playback_heard_url(access_token: str) -> str:
    return f"/api/v1/pool/heard/{access_token}"


def surface_fossils_url(access_token: str) -> str:
    return f"/api/v1/surface/fossils/{access_token}"
