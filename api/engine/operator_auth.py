from __future__ import annotations

import hmac

from django.conf import settings


OPS_SESSION_KEY = "memory_engine_ops_authenticated"


def operator_secret_configured() -> bool:
    return bool(str(getattr(settings, "OPS_SHARED_SECRET", "")).strip())


def operator_session_active(request) -> bool:
    return bool(request.session.get(OPS_SESSION_KEY)) and operator_secret_configured()


def authenticate_operator_secret(secret: str) -> bool:
    configured = str(getattr(settings, "OPS_SHARED_SECRET", "")).strip()
    return operator_secret_configured() and hmac.compare_digest(configured, str(secret or ""))


def start_operator_session(request) -> None:
    request.session[OPS_SESSION_KEY] = True
    request.session.set_expiry(int(getattr(settings, "OPS_SESSION_TTL_SECONDS", 43200)))


def end_operator_session(request) -> None:
    request.session.pop(OPS_SESSION_KEY, None)
