import shutil
from datetime import datetime, timedelta

import redis
from django.conf import settings
from django.core.cache import cache
from django.db import connection
from django.utils import timezone

from .models import Artifact, Derivative
from .storage import s3_client

WORKER_HEARTBEAT_CACHE_KEY = "memory_engine_worker_heartbeat"
BEAT_HEARTBEAT_CACHE_KEY = "memory_engine_beat_heartbeat"


def record_worker_heartbeat(*, at=None) -> None:
    now = at or timezone.now()
    cache.set(
        WORKER_HEARTBEAT_CACHE_KEY,
        now.isoformat(),
        timeout=max(300, int(getattr(settings, "OPS_WORKER_HEARTBEAT_MAX_AGE_SECONDS", 180)) * 4),
    )


def record_beat_heartbeat(*, at=None) -> None:
    now = at or timezone.now()
    cache.set(
        BEAT_HEARTBEAT_CACHE_KEY,
        now.isoformat(),
        timeout=max(300, int(getattr(settings, "OPS_BEAT_HEARTBEAT_MAX_AGE_SECONDS", 180)) * 4),
    )


def heartbeat_component(name: str, cache_key: str, max_age_seconds: int, *, now=None) -> dict:
    now = now or timezone.now()
    raw_value = cache.get(cache_key)
    if not raw_value:
        return {
            "ok": False,
            "error": f"No recent heartbeat from {name}.",
        }
    try:
        seen_at = datetime.fromisoformat(str(raw_value))
        if timezone.is_naive(seen_at):
            seen_at = timezone.make_aware(seen_at, timezone.get_current_timezone())
    except ValueError:
        return {
            "ok": False,
            "error": f"Heartbeat timestamp for {name} is unreadable.",
        }
    age_seconds = max(0.0, (now - seen_at).total_seconds())
    if age_seconds > max_age_seconds:
        return {
            "ok": False,
            "last_seen_at": seen_at,
            "stale_seconds": round(age_seconds, 1),
            "error": f"{name.title()} heartbeat is stale.",
        }
    return {
        "ok": True,
        "last_seen_at": seen_at,
        "stale_seconds": round(age_seconds, 1),
    }


def component_health_warnings(components: dict) -> list[dict]:
    warnings = []
    if not components.get("worker", {}).get("ok", True):
        warnings.append({
            "level": "critical",
            "title": "Worker heartbeat is stale",
            "detail": "Derivative generation and playback housekeeping tasks may no longer be running.",
        })
    if not components.get("beat", {}).get("ok", True):
        warnings.append({
            "level": "warning",
            "title": "Beat heartbeat is stale",
            "detail": "Scheduled expiry and pruning tasks may no longer be advancing on time.",
        })
    return warnings


def api_health_component_status() -> tuple[bool, dict]:
    components = {}

    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        components["database"] = {"ok": True}
    except Exception as exc:
        components["database"] = {"ok": False, "error": str(exc)}

    try:
        redis.Redis.from_url(settings.CELERY_BROKER_URL).ping()
        components["redis"] = {"ok": True}
    except Exception as exc:
        components["redis"] = {"ok": False, "error": str(exc)}

    try:
        s3_client().head_bucket(Bucket=settings.MINIO_BUCKET)
        components["storage"] = {"ok": True}
    except Exception as exc:
        components["storage"] = {"ok": False, "error": str(exc)}

    ok = all(component["ok"] for component in components.values())
    return ok, components


def health_component_status() -> tuple[bool, dict]:
    ok, components = api_health_component_status()
    components["worker"] = heartbeat_component(
        "celery worker",
        WORKER_HEARTBEAT_CACHE_KEY,
        int(getattr(settings, "OPS_WORKER_HEARTBEAT_MAX_AGE_SECONDS", 180)),
    )
    components["beat"] = heartbeat_component(
        "celery beat",
        BEAT_HEARTBEAT_CACHE_KEY,
        int(getattr(settings, "OPS_BEAT_HEARTBEAT_MAX_AGE_SECONDS", 180)),
    )

    cluster_ok = all(component["ok"] for component in components.values())
    return cluster_ok, components


def disk_status(path: str) -> dict:
    total_bytes, used_bytes, free_bytes = shutil.disk_usage(path)
    total_gb = total_bytes / (1024 ** 3)
    free_gb = free_bytes / (1024 ** 3)
    used_percent = 0.0 if total_bytes <= 0 else (used_bytes / total_bytes) * 100.0
    free_percent = 0.0 if total_bytes <= 0 else (free_bytes / total_bytes) * 100.0

    state = "ready"
    if (
        free_gb <= float(settings.OPS_DISK_CRITICAL_FREE_GB)
        or free_percent <= float(settings.OPS_DISK_CRITICAL_FREE_PERCENT)
    ):
        state = "critical"
    elif (
        free_gb <= float(settings.OPS_DISK_WARNING_FREE_GB)
        or free_percent <= float(settings.OPS_DISK_WARNING_FREE_PERCENT)
    ):
        state = "warning"

    return {
        "path": path,
        "state": state,
        "total_gb": round(total_gb, 2),
        "free_gb": round(free_gb, 2),
        "used_percent": round(used_percent, 1),
        "free_percent": round(free_percent, 1),
    }


def pool_warnings(active_count: int, lane_counts: dict, mood_counts: dict, playable_count: int) -> list[dict]:
    warnings = []

    if active_count <= int(settings.OPS_POOL_LOW_COUNT):
        warnings.append({
            "level": "warning",
            "title": "Playback pool is running low",
            "detail": f"Only {active_count} active sounds are available right now.",
        })

    if playable_count <= 0:
        warnings.append({
            "level": "critical",
            "title": "No playable sounds are available",
            "detail": "The room loop has nothing eligible to play from the current pool.",
        })
        return warnings

    imbalance_ratio = float(settings.OPS_POOL_IMBALANCE_RATIO)

    for lane, count in lane_counts.items():
        if count == 0 and playable_count >= 4:
            warnings.append({
                "level": "warning",
                "title": f"{lane.title()} lane is empty",
                "detail": "The room may feel flatter because one playback lane has no playable material.",
            })
        elif playable_count >= 6 and (count / playable_count) >= imbalance_ratio:
            warnings.append({
                "level": "warning",
                "title": f"{lane.title()} lane is dominating the pool",
                "detail": f"{count} of {playable_count} playable sounds are currently classified as {lane}.",
            })

    for mood, count in mood_counts.items():
        if count == 0 and playable_count >= 6:
            warnings.append({
                "level": "warning",
                "title": f"{mood.title()} mood is missing",
                "detail": "The room's compositional palette is narrowed because one mood has no playable material.",
            })
        elif playable_count >= 8 and (count / playable_count) >= imbalance_ratio:
            warnings.append({
                "level": "warning",
                "title": f"{mood.title()} mood is heavily overrepresented",
                "detail": f"{count} of {playable_count} playable sounds currently cluster in that mood.",
            })

    return warnings


def retention_summary(*, now=None) -> dict:
    now = now or timezone.now()
    soon_window_hours = int(getattr(settings, "OPS_RETENTION_SOON_HOURS", 24))
    soon_cutoff = now + timedelta(hours=soon_window_hours)

    raw_held = 0
    raw_expiring_soon = 0
    fossil_retained = 0
    fossil_residue_only = 0
    next_raw_expiry_at = None
    next_fossil_expiry_at = None

    active_artifacts = list(
        Artifact.objects.filter(status=Artifact.STATUS_ACTIVE, expires_at__gt=now)
        .select_related("consent")
        .prefetch_related("derivative_set")
    )

    for artifact in active_artifacts:
        consent_json = artifact.consent.json or {}
        retention = consent_json.get("retention", {})
        raw_ttl_hours = retention.get("raw_ttl_hours")
        mode = str(consent_json.get("mode") or "").upper()

        if artifact.raw_uri and raw_ttl_hours is not None:
            raw_expiry_at = artifact.created_at + timedelta(hours=int(raw_ttl_hours))
            if raw_expiry_at > now:
                raw_held += 1
                if raw_expiry_at <= soon_cutoff:
                    raw_expiring_soon += 1
                if next_raw_expiry_at is None or raw_expiry_at < next_raw_expiry_at:
                    next_raw_expiry_at = raw_expiry_at

        if mode == "FOSSIL":
            fossil_retained += 1
            if next_fossil_expiry_at is None or artifact.expires_at < next_fossil_expiry_at:
                next_fossil_expiry_at = artifact.expires_at
            has_live_essence = any(
                derivative.kind == Derivative.KIND_ESSENCE_WAV
                and (derivative.expires_at is None or derivative.expires_at > now)
                for derivative in artifact.derivative_set.all()
            )
            if not artifact.raw_uri and has_live_essence:
                fossil_residue_only += 1

    return {
        "soon_window_hours": soon_window_hours,
        "raw_held": raw_held,
        "raw_expiring_soon": raw_expiring_soon,
        "fossil_retained": fossil_retained,
        "fossil_residue_only": fossil_residue_only,
        "next_raw_expiry_at": next_raw_expiry_at,
        "next_fossil_expiry_at": next_fossil_expiry_at,
    }
