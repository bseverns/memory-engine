import hashlib
import os
import secrets

from django.conf import settings

from .models import Node


def default_node_from_settings() -> Node:
    node = Node.objects.order_by("id").first()
    if not node:
        node = Node.objects.create(
            name=settings.__dict__.get("NODE_NAME", "Room Memory Node"),
            location_hint=settings.__dict__.get("NODE_LOCATION_HINT", ""),
        )
    return node


def default_node_from_env() -> Node:
    node = Node.objects.order_by("id").first()
    if not node:
        node = Node.objects.create(
            name=os.getenv("NODE_NAME", "Room Memory Node"),
            location_hint=os.getenv("NODE_LOCATION_HINT", ""),
        )
    return node


def make_revocation_token() -> str:
    raw = secrets.token_urlsafe(8)
    return raw.replace("-", "").replace("_", "")[:10].upper()


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def consent_manifest(consent_mode: str) -> dict:
    if consent_mode == "ROOM":
        return {
            "mode": "ROOM",
            "capture": {"audio": True},
            "publish": {"raw": False, "derivatives": False},
            "derive_allowed": [],
            "retention": {"raw_ttl_hours": settings.RAW_TTL_HOURS_ROOM, "derivative_ttl_days": 0},
            "revocation": {"allowed": True},
        }
    if consent_mode == "FOSSIL":
        return {
            "mode": "FOSSIL",
            "capture": {"audio": True},
            "publish": {"raw": False, "derivatives": False},
            "derive_allowed": ["spectrogram_png", "essence_wav"],
            "retention": {
                "raw_ttl_hours": settings.RAW_TTL_HOURS_FOSSIL,
                "derivative_ttl_days": settings.DERIVATIVE_TTL_DAYS_FOSSIL,
            },
            "revocation": {"allowed": True},
        }
    if consent_mode == "NOSAVE":
        return {
            "mode": "NOSAVE",
            "capture": {"audio": True},
            "publish": {"raw": False, "derivatives": False},
            "derive_allowed": [],
            "retention": {"raw_ttl_hours": 0, "derivative_ttl_days": 0},
            "revocation": {"allowed": False},
        }
    raise ValueError(f"Unknown consent mode: {consent_mode}")
