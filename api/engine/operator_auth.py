from __future__ import annotations

import hashlib
import hmac
import ipaddress

from django.conf import settings
from django.core.cache import cache


OPS_SESSION_KEY = "memory_engine_ops_authenticated"
OPS_SESSION_BINDING_KEY = "memory_engine_ops_binding"
OPS_LOGIN_CACHE_PREFIX = "memory_engine_ops_login"


def operator_secret_configured() -> bool:
    return bool(str(getattr(settings, "OPS_SHARED_SECRET", "")).strip())


def request_operator_ip(request) -> str:
    forwarded_for = str(request.META.get("HTTP_X_FORWARDED_FOR") or "").strip()
    if bool(getattr(settings, "TRUST_X_FORWARDED_FOR", False)) and forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return str(request.META.get("REMOTE_ADDR") or "").strip()


def request_operator_user_agent(request) -> str:
    return str(request.META.get("HTTP_USER_AGENT") or "").strip()


def operator_allowed_networks() -> list[str]:
    configured = getattr(settings, "OPS_ALLOWED_NETWORKS", []) or []
    return [str(entry).strip() for entry in configured if str(entry).strip()]


def operator_session_binding_mode() -> str:
    mode = str(getattr(settings, "OPS_SESSION_BINDING_MODE", "user_agent") or "").strip().lower()
    if mode in {"strict", "user_agent", "none"}:
        return mode
    return "user_agent"


def operator_login_lockout_scope() -> str:
    scope = str(getattr(settings, "OPS_LOGIN_LOCKOUT_SCOPE", "ip_user_agent") or "").strip().lower()
    if scope in {"ip", "ip_user_agent"}:
        return scope
    return "ip_user_agent"


def operator_request_allowed(request) -> bool:
    allowed_networks = operator_allowed_networks()
    if not allowed_networks:
        return True

    remote_ip = request_operator_ip(request)
    if not remote_ip:
        return False
    try:
        ip_obj = ipaddress.ip_address(remote_ip)
    except ValueError:
        return False

    for network in allowed_networks:
        try:
            if ip_obj in ipaddress.ip_network(network, strict=False):
                return True
        except ValueError:
            continue
    return False


def operator_session_binding(request) -> str:
    mode = operator_session_binding_mode()
    if mode == "none":
        payload = "operator-session"
    elif mode == "strict":
        payload = f"{request_operator_ip(request)}|{request_operator_user_agent(request)}"
    else:
        payload = request_operator_user_agent(request)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def operator_session_active(request) -> bool:
    if not bool(request.session.get(OPS_SESSION_KEY)) or not operator_secret_configured():
        return False
    if not operator_request_allowed(request):
        return False
    return hmac.compare_digest(
        str(request.session.get(OPS_SESSION_BINDING_KEY) or ""),
        operator_session_binding(request),
    )


def authenticate_operator_secret(secret: str) -> bool:
    configured = str(getattr(settings, "OPS_SHARED_SECRET", "")).strip()
    return operator_secret_configured() and hmac.compare_digest(configured, str(secret or ""))


def login_attempt_identity(request) -> str:
    remote_ip = request_operator_ip(request) or "unknown"
    if operator_login_lockout_scope() == "ip":
        payload = remote_ip
    else:
        payload = f"{remote_ip}|{request_operator_user_agent(request) or 'unknown'}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def login_attempt_cache_key(request) -> str:
    return f"{OPS_LOGIN_CACHE_PREFIX}:{operator_login_lockout_scope()}:{login_attempt_identity(request)}"


def operator_login_locked_out(request) -> bool:
    return int(cache.get(login_attempt_cache_key(request)) or 0) >= int(getattr(settings, "OPS_LOGIN_MAX_ATTEMPTS", 6))


def note_failed_operator_login(request) -> int:
    key = login_attempt_cache_key(request)
    lockout_seconds = int(getattr(settings, "OPS_LOGIN_LOCKOUT_SECONDS", 900))
    attempts = int(cache.get(key) or 0) + 1
    cache.set(key, attempts, timeout=lockout_seconds)
    return attempts


def clear_failed_operator_logins(request) -> None:
    cache.delete(login_attempt_cache_key(request))


def start_operator_session(request) -> None:
    request.session.cycle_key()
    request.session[OPS_SESSION_KEY] = True
    request.session[OPS_SESSION_BINDING_KEY] = operator_session_binding(request)
    request.session.set_expiry(int(getattr(settings, "OPS_SESSION_TTL_SECONDS", 43200)))


def end_operator_session(request) -> None:
    request.session.pop(OPS_SESSION_KEY, None)
    request.session.pop(OPS_SESSION_BINDING_KEY, None)
