import shutil
from datetime import datetime, timedelta
from urllib.parse import urlparse

import redis
from django.conf import settings
from django.core.cache import cache
from django.db import connection
from django.utils import timezone

from .models import Artifact, Derivative
from .storage import s3_client

WORKER_HEARTBEAT_CACHE_KEY = "memory_engine_worker_heartbeat"
BEAT_HEARTBEAT_CACHE_KEY = "memory_engine_beat_heartbeat"
TASK_STATUS_CACHE_PREFIX = "memory_engine_task_status"
TRACKED_TASKS = {
    "generate_spectrogram": {"label": "spectrogram generation", "scheduled": False},
    "generate_essence_audio": {"label": "essence generation", "scheduled": False},
    "expire_raw": {"label": "raw expiry", "scheduled": True},
    "prune_derivatives": {"label": "derivative pruning", "scheduled": True},
}


def local_health_harness_enabled() -> bool:
    return bool(getattr(settings, "OPS_LOCAL_HEALTH_HARNESS", False))


def broker_uses_external_redis() -> bool:
    broker_url = str(getattr(settings, "CELERY_BROKER_URL", "") or "").strip().lower()
    return broker_url.startswith("redis://") or broker_url.startswith("rediss://")


def parse_cached_datetime(raw_value):
    if not raw_value:
        return None
    try:
        parsed = datetime.fromisoformat(str(raw_value))
    except ValueError:
        return None
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed


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
    seen_at = parse_cached_datetime(cache.get(cache_key))
    if not seen_at:
        return {
            "ok": False,
            "error": f"No recent heartbeat from {name}.",
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


def task_status_cache_key(task_name: str) -> str:
    return f"{TASK_STATUS_CACHE_PREFIX}:{task_name}"


def task_status_snapshot(task_name: str) -> dict:
    payload = dict(cache.get(task_status_cache_key(task_name)) or {})
    last_success_at = parse_cached_datetime(payload.get("last_success_at"))
    last_failure_at = parse_cached_datetime(payload.get("last_failure_at"))
    return {
        "task_name": task_name,
        "last_success_at": last_success_at,
        "last_failure_at": last_failure_at,
        "last_error": str(payload.get("last_error") or "").strip(),
        "consecutive_failures": int(payload.get("consecutive_failures") or 0),
    }


def record_task_success(task_name: str, *, at=None) -> None:
    now = at or timezone.now()
    snapshot = task_status_snapshot(task_name)
    cache.set(
        task_status_cache_key(task_name),
        {
            "last_success_at": now.isoformat(),
            "last_failure_at": snapshot["last_failure_at"].isoformat() if snapshot["last_failure_at"] else "",
            "last_error": snapshot["last_error"],
            "consecutive_failures": 0,
        },
        timeout=max(86400, int(getattr(settings, "OPS_TASK_FAILURE_WINDOW_SECONDS", 1800)) * 8),
    )


def record_task_failure(task_name: str, error, *, at=None) -> None:
    now = at or timezone.now()
    snapshot = task_status_snapshot(task_name)
    cache.set(
        task_status_cache_key(task_name),
        {
            "last_success_at": snapshot["last_success_at"].isoformat() if snapshot["last_success_at"] else "",
            "last_failure_at": now.isoformat(),
            "last_error": str(error or "").strip()[:240],
            "consecutive_failures": snapshot["consecutive_failures"] + 1,
        },
        timeout=max(86400, int(getattr(settings, "OPS_TASK_FAILURE_WINDOW_SECONDS", 1800)) * 8),
    )


def broker_redis_client():
    return redis.Redis.from_url(settings.CELERY_BROKER_URL)


def queue_depth_component() -> dict:
    queue_name = str(getattr(settings, "CELERY_TASK_DEFAULT_QUEUE", "celery") or "celery").strip() or "celery"
    if local_health_harness_enabled() and not broker_uses_external_redis():
        return {
            "ok": True,
            "queue": queue_name,
            "depth": 0,
            "state": "ready",
            "warning_depth": int(getattr(settings, "OPS_QUEUE_DEPTH_WARNING", 12)),
            "critical_depth": int(getattr(settings, "OPS_QUEUE_DEPTH_CRITICAL", 40)),
            "detail": "Local browser harness is using an eager in-process task queue.",
        }
    client = broker_redis_client()
    depth = int(client.llen(queue_name))
    warning_depth = int(getattr(settings, "OPS_QUEUE_DEPTH_WARNING", 12))
    critical_depth = int(getattr(settings, "OPS_QUEUE_DEPTH_CRITICAL", 40))
    state = "ready"
    ok = True
    if depth >= critical_depth:
        state = "critical"
        ok = False
    elif depth >= warning_depth:
        state = "warning"
    # Queue depth is operator-facing posture, not scheduler truth. It tells the
    # steward whether work is piling up faster than the appliance is clearing it.
    return {
        "ok": ok,
        "queue": queue_name,
        "depth": depth,
        "state": state,
        "warning_depth": warning_depth,
        "critical_depth": critical_depth,
        "detail": f"{depth} queued task(s) on '{queue_name}'.",
    }


def task_pipeline_component(*, now=None) -> dict:
    now = now or timezone.now()
    failure_window_seconds = int(getattr(settings, "OPS_TASK_FAILURE_WINDOW_SECONDS", 1800))
    snapshots = {
        task_name: task_status_snapshot(task_name)
        for task_name in TRACKED_TASKS
    }
    issues = []

    for task_name, spec in TRACKED_TASKS.items():
        snapshot = snapshots[task_name]
        last_success_at = snapshot["last_success_at"]
        last_failure_at = snapshot["last_failure_at"]
        if not last_failure_at:
            continue
        failure_age_seconds = max(0.0, (now - last_failure_at).total_seconds())
        if failure_age_seconds > failure_window_seconds:
            continue
        if last_success_at and last_success_at >= last_failure_at:
            continue
        issues.append({
            "task_name": task_name,
            "label": spec["label"],
            "scheduled": bool(spec["scheduled"]),
            "last_failure_at": last_failure_at,
            "last_error": snapshot["last_error"],
            "consecutive_failures": snapshot["consecutive_failures"],
        })

    if not issues:
        return {
            "ok": True,
            "issues": [],
            "detail": "No recent task failures are blocking background work.",
            "tracked_tasks": {
                task_name: {
                    "label": spec["label"],
                    "scheduled": bool(spec["scheduled"]),
                    "last_success_at": snapshots[task_name]["last_success_at"],
                    "last_failure_at": snapshots[task_name]["last_failure_at"],
                    "consecutive_failures": snapshots[task_name]["consecutive_failures"],
                }
                for task_name, spec in TRACKED_TASKS.items()
            },
        }

    # Scheduled-task failures are treated more seriously because they quietly
    # age the archive into drift: expiry, pruning, and retention stop matching
    # the consent/runtime posture even if the kiosk still appears alive.
    scheduled_issue = any(issue["scheduled"] for issue in issues)
    labels = ", ".join(issue["label"] for issue in issues[:3])
    detail = f"Recent background task failures need attention ({labels})."
    if len(issues) > 3:
        detail = f"{detail[:-1]} and more."
    return {
        "ok": False if scheduled_issue or len(issues) >= 2 else True,
        "issues": issues,
        "detail": detail,
        "tracked_tasks": {
            task_name: {
                "label": spec["label"],
                "scheduled": bool(spec["scheduled"]),
                "last_success_at": snapshots[task_name]["last_success_at"],
                "last_failure_at": snapshots[task_name]["last_failure_at"],
                "consecutive_failures": snapshots[task_name]["consecutive_failures"],
            }
            for task_name, spec in TRACKED_TASKS.items()
        },
    }


def component_health_warnings(components: dict) -> list[dict]:
    warnings = []
    # These are the human-facing warning translations for `/ops/`. Keep the
    # rules here so the browser renders the server's judgment instead of inventing its own.
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
    queue_component = components.get("queue", {})
    if queue_component.get("state") == "critical":
        warnings.append({
            "level": "critical",
            "title": "Background queue is critically backed up",
            "detail": queue_component.get("detail") or "The Redis-backed Celery queue is critically deep.",
        })
    elif queue_component.get("state") == "warning":
        warnings.append({
            "level": "warning",
            "title": "Background queue is building up",
            "detail": queue_component.get("detail") or "The Redis-backed Celery queue is growing.",
        })
    task_component = components.get("tasks", {})
    for issue in task_component.get("issues", [])[:3]:
        warnings.append({
            "level": "critical" if issue.get("scheduled") else "warning",
            "title": f"{issue.get('label', 'Background task').title()} failed recently",
            "detail": issue.get("last_error") or "A recent background task failure has not yet been superseded by a later success.",
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

    if local_health_harness_enabled() and not broker_uses_external_redis():
        components["redis"] = {
            "ok": True,
            "detail": "Local browser harness is using in-process cache/task services.",
        }
    else:
        try:
            broker_redis_client().ping()
            components["redis"] = {"ok": True}
        except Exception as exc:
            components["redis"] = {"ok": False, "error": str(exc)}

    minio_endpoint = str(getattr(settings, "MINIO_ENDPOINT", "") or "").strip()
    parsed_endpoint = urlparse(minio_endpoint) if minio_endpoint else None
    if local_health_harness_enabled() and parsed_endpoint and parsed_endpoint.hostname and parsed_endpoint.hostname.endswith(".invalid"):
        components["storage"] = {
            "ok": True,
            "detail": "Local browser harness skips the external object-storage probe.",
        }
    else:
        try:
            s3_client().head_bucket(Bucket=settings.MINIO_BUCKET)
            components["storage"] = {"ok": True}
        except Exception as exc:
            components["storage"] = {"ok": False, "error": str(exc)}

    ok = all(component["ok"] for component in components.values())
    return ok, components


def health_component_status() -> tuple[bool, dict]:
    ok, components = api_health_component_status()
    if local_health_harness_enabled():
        components["worker"] = {
            "ok": True,
            "detail": "Local browser harness does not run a separate worker process.",
        }
        components["beat"] = {
            "ok": True,
            "detail": "Local browser harness does not run a separate beat process.",
        }
    else:
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
    try:
        components["queue"] = queue_depth_component()
    except Exception as exc:
        components["queue"] = {"ok": False, "state": "critical", "error": str(exc)}
    components["tasks"] = task_pipeline_component()

    # This broader readiness surface is allowed to go degraded even when
    # `/healthz` is still green; that split lets the API container stay up
    # while operators still learn that background work is drifting.
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

    # Pool warnings are compositional warnings, not database/storage failures.
    # They exist so operators can notice when the room feel is flattening before
    # participants experience it only as "the room got boring."
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

    # This is a steward summary, not a legal retention ledger: enough to answer
    # "what is about to shed?" and "what survives only as residue?" at a glance.
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
