import shutil

import redis
from django.conf import settings
from django.db import connection

from .storage import s3_client


def health_component_status() -> tuple[bool, dict]:
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
