from __future__ import annotations

import re

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.settings import api_settings


CLIENT_ID_PATTERN = re.compile(r"[^a-zA-Z0-9._-]+")


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
