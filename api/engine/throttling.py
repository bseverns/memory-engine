from __future__ import annotations

from django.core.exceptions import ImproperlyConfigured
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.settings import api_settings


def request_client_ident(request) -> str:
    forwarded_for = str(request.META.get("HTTP_X_FORWARDED_FOR") or "").strip()
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return str(request.META.get("REMOTE_ADDR") or "anonymous").strip() or "anonymous"


class BaseClientIPThrottle(SimpleRateThrottle):
    def get_rate(self):
        if not self.scope:
            raise ImproperlyConfigured(f"{self.__class__.__name__} must define a scope.")
        rates = api_settings.DEFAULT_THROTTLE_RATES
        if self.scope not in rates:
            raise ImproperlyConfigured(
                f"No default throttle rate set for scope '{self.scope}'.",
            )
        return rates[self.scope]

    def get_cache_key(self, request, view):
        ident = request_client_ident(request)
        return self.cache_format % {"scope": self.scope, "ident": ident}


class PublicIngestThrottle(BaseClientIPThrottle):
    scope = "public_ingest"


class PublicRevokeThrottle(BaseClientIPThrottle):
    scope = "public_revoke"
