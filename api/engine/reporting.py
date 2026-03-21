from django.utils import timezone

from .memory_color import (
    DEFAULT_MEMORY_COLOR_PROFILE,
    MEMORY_COLOR_PROFILE_ORDER,
    memory_color_catalog_payload,
    normalize_memory_color_profile,
)
from .models import Artifact
from .ops import retention_summary
from .pool import artifact_lane, artifact_mood, playable_artifact_queryset


def artifact_summary_payload(*, now=None) -> dict:
    current_time = now or timezone.now()
    active_qs = Artifact.objects.filter(status=Artifact.STATUS_ACTIVE, expires_at__gt=current_time)
    playable_artifacts = list(playable_artifact_queryset(current_time).prefetch_related("derivative_set"))

    lane_counts = {"fresh": 0, "mid": 0, "worn": 0}
    mood_counts = {
        "clear": 0,
        "hushed": 0,
        "suspended": 0,
        "weathered": 0,
        "gathering": 0,
    }
    memory_color_counts = {profile: 0 for profile in MEMORY_COLOR_PROFILE_ORDER}

    for artifact in playable_artifacts:
        lane_counts[artifact_lane(artifact, current_time)] += 1
        mood_counts[artifact_mood(artifact, current_time)] += 1
        effect_profile = normalize_memory_color_profile(
            artifact.effect_profile,
            default=DEFAULT_MEMORY_COLOR_PROFILE,
        ) or DEFAULT_MEMORY_COLOR_PROFILE
        memory_color_counts.setdefault(effect_profile, 0)
        memory_color_counts[effect_profile] += 1

    return {
        "generated_at": current_time,
        "active": active_qs.count(),
        "playable": len(playable_artifacts),
        "expired": Artifact.objects.filter(status=Artifact.STATUS_EXPIRED).count(),
        "revoked": Artifact.objects.filter(status=Artifact.STATUS_REVOKED).count(),
        "lanes": lane_counts,
        "moods": mood_counts,
        "memory_colors": {
            "counts": memory_color_counts,
            "catalog": memory_color_catalog_payload(),
        },
        "retention": retention_summary(now=current_time),
    }
