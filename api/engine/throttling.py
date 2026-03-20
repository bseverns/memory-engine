from __future__ import annotations

import re

from django.conf import settings
from django.core.cache import cache
from django.core.exceptions import ImproperlyConfigured
from django.utils import timezone
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.settings import api_settings


CLIENT_ID_PATTERN = re.compile(r"[^a-zA-Z0-9._-]+")
THROTTLE_EVENT_CACHE_PREFIX = "memory_engine_throttle_events"


def request_client_ip(request) -> str:
    trust_forwarded = bool(getattr(request, "trusted_forwarded_for", False)) or bool(
        getattr(settings, "TRUST_X_FORWARDED_FOR", False),
    )
    forwarded_for = str(request.META.get("HTTP_X_FORWARDED_FOR") or "").strip()
    if trust_forwarded and forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return str(request.META.get("REMOTE_ADDR") or "anonymous").strip() or "anonymous"


def sanitize_public_client_id(value: str) -> str:
    cleaned = CLIENT_ID_PATTERN.sub("", str(value or "").strip())[:96]
    return cleaned


def request_public_client_ident(request) -> str:
    header_value = sanitize_public_client_id(request.META.get("HTTP_X_MEMORY_CLIENT_ID") or "")
    if header_value:
        return f"client:{header_value}"
    cookie_value = sanitize_public_client_id(request.COOKIES.get("memory_engine_client_id") or "")
    if cookie_value:
        return f"client:{cookie_value}"
    return f"ip:{request_client_ip(request)}"


class BaseRequestThrottle(SimpleRateThrottle):
    def get_rate(self):
        if not self.scope:
            raise ImproperlyConfigured(f"{self.__class__.__name__} must define a scope.")
        rates = api_settings.DEFAULT_THROTTLE_RATES
        if self.scope not in rates:
            raise ImproperlyConfigured(
                f"No default throttle rate set for scope '{self.scope}'.",
            )
        return rates[self.scope]

    def request_ident(self, request) -> str:
        raise NotImplementedError

    def get_cache_key(self, request, view):
        ident = self.request_ident(request)
        return self.cache_format % {"scope": self.scope, "ident": ident}

    def throttle_failure(self):
        record_throttle_denial(self.scope)
        return super().throttle_failure()


class PublicIngestThrottle(BaseRequestThrottle):
    scope = "public_ingest"

    def request_ident(self, request) -> str:
        return request_public_client_ident(request)


class PublicIngestAbuseThrottle(BaseRequestThrottle):
    scope = "public_ingest_ip"

    def request_ident(self, request) -> str:
        return request_client_ip(request)


class PublicRevokeThrottle(BaseRequestThrottle):
    scope = "public_revoke"

    def request_ident(self, request) -> str:
        return request_public_client_ident(request)


class PublicRevokeAbuseThrottle(BaseRequestThrottle):
    scope = "public_revoke_ip"

    def request_ident(self, request) -> str:
        return request_client_ip(request)


def throttle_event_window_seconds() -> int:
    return max(60, int(getattr(settings, "OPS_THROTTLE_EVENT_WINDOW_SECONDS", 3600)))


def throttle_event_count_key(scope: str) -> str:
    return f"{THROTTLE_EVENT_CACHE_PREFIX}:{scope}:count"


def throttle_event_last_key(scope: str) -> str:
    return f"{THROTTLE_EVENT_CACHE_PREFIX}:{scope}:last"


def record_throttle_denial(scope: str) -> None:
    window_seconds = throttle_event_window_seconds()
    count_key = throttle_event_count_key(scope)
    last_key = throttle_event_last_key(scope)
    count = int(cache.get(count_key) or 0) + 1
    cache.set(count_key, count, timeout=window_seconds)
    cache.set(last_key, timezone.now().isoformat(), timeout=window_seconds)


def throttle_scope_snapshot(scope: str) -> dict:
    count = int(cache.get(throttle_event_count_key(scope)) or 0)
    last_denied_at = cache.get(throttle_event_last_key(scope))
    return {
        "rate": str(api_settings.DEFAULT_THROTTLE_RATES.get(scope, "")),
        "recent_denials": count,
        "last_denied_at": last_denied_at or None,
        "window_seconds": throttle_event_window_seconds(),
    }


def public_throttle_snapshots() -> dict:
    return {
        "public_ingest": throttle_scope_snapshot("public_ingest"),
        "public_ingest_ip": throttle_scope_snapshot("public_ingest_ip"),
        "public_revoke": throttle_scope_snapshot("public_revoke"),
        "public_revoke_ip": throttle_scope_snapshot("public_revoke_ip"),
    }
