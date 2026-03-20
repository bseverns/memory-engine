import random
from datetime import timedelta

from django.conf import settings
from django.db.models import Q

from .models import Artifact, Derivative


def playable_artifact_queryset(now):
    return Artifact.objects.filter(
        status=Artifact.STATUS_ACTIVE,
        expires_at__gt=now,
    ).filter(
        Q(raw_uri__gt="")
        | Q(derivative__kind=Derivative.KIND_ESSENCE_WAV, derivative__expires_at__gt=now)
    ).distinct()


def artifact_essence_derivative(artifact: Artifact, now):
    prefetched = getattr(artifact, "_prefetched_objects_cache", {})
    derivatives = prefetched.get("derivative_set")
    if derivatives is not None:
        candidates = [
            derivative for derivative in derivatives
            if derivative.kind == Derivative.KIND_ESSENCE_WAV
            and derivative.expires_at
            and derivative.expires_at > now
        ]
        if not candidates:
            return None
        candidates.sort(key=lambda derivative: derivative.created_at, reverse=True)
        return candidates[0]

    return artifact.derivative_set.filter(
        kind=Derivative.KIND_ESSENCE_WAV,
        expires_at__gt=now,
    ).order_by("-created_at").first()


def artifact_playback_key(artifact: Artifact, now):
    if artifact.raw_uri:
        return artifact.raw_uri
    essence = artifact_essence_derivative(artifact, now)
    return essence.uri if essence else ""


def artifact_age_hours(artifact: Artifact, now) -> float:
    return max(0.0, (now - artifact.created_at).total_seconds() / 3600.0)


def pool_weight(artifact: Artifact, now, cooldown_seconds: int, preferred_mood: str = "any") -> float:
    seconds_since_access = cooldown_seconds * 4
    if artifact.last_access_at:
        seconds_since_access = max(0.0, (now - artifact.last_access_at).total_seconds())

    age_hours = artifact_age_hours(artifact, now)
    cooldown_factor = min(3.0, 1.0 + (seconds_since_access / max(1, cooldown_seconds)))
    rarity_factor = 1.0 / (1.0 + (artifact.play_count * 0.45))
    wear_factor = max(0.45, 1.15 - (artifact.wear * 0.55))
    if age_hours <= 1.0:
        age_factor = 0.82
    elif age_hours <= 8.0:
        age_factor = 0.96
    elif age_hours <= 72.0:
        age_factor = 1.16
    elif age_hours <= 240.0:
        age_factor = 1.05
    else:
        age_factor = 0.92

    mood = artifact_mood(artifact, now)
    mood_factor = 1.0
    if preferred_mood != "any":
        if mood == preferred_mood:
            mood_factor = 1.5
        elif preferred_mood == "clear" and mood in {"hushed", "gathering"}:
            mood_factor = 1.18
        elif preferred_mood == "hushed" and mood in {"clear", "suspended"}:
            mood_factor = 1.18
        elif preferred_mood == "suspended" and mood in {"hushed", "weathered", "gathering"}:
            mood_factor = 1.14
        elif preferred_mood == "weathered" and mood in {"suspended", "hushed"}:
            mood_factor = 1.16
        elif preferred_mood == "gathering" and mood in {"clear", "suspended"}:
            mood_factor = 1.16
        else:
            mood_factor = 0.88

    return max(0.1, cooldown_factor * rarity_factor * wear_factor * age_factor * mood_factor)


def artifact_lane(artifact: Artifact, now) -> str:
    age_hours = artifact_age_hours(artifact, now)
    if (
        artifact.wear <= settings.POOL_FRESH_MAX_WEAR
        and artifact.play_count <= settings.POOL_FRESH_MAX_PLAY_COUNT
        and age_hours <= settings.POOL_FRESH_MAX_AGE_HOURS
    ):
        return "fresh"
    if (
        artifact.wear >= settings.POOL_WORN_MIN_WEAR
        or artifact.play_count >= settings.POOL_WORN_MIN_PLAY_COUNT
        or age_hours >= settings.POOL_WORN_MIN_AGE_HOURS
    ):
        return "worn"
    return "mid"


def artifact_density(artifact: Artifact) -> str:
    if artifact.duration_ms <= 5000:
        return "light"
    if artifact.duration_ms >= 18000:
        return "dense"
    return "medium"


def artifact_mood(artifact: Artifact, now) -> str:
    lane = artifact_lane(artifact, now)
    density = artifact_density(artifact)
    age_hours = artifact_age_hours(artifact, now)

    if lane == "fresh" and density == "light":
        return "clear"
    if lane == "fresh":
        return "gathering"
    if lane == "worn" and density == "dense":
        return "weathered"
    if lane == "worn":
        return "hushed"
    if density == "dense" or age_hours >= 12:
        return "suspended"
    return "hushed"


def select_pool_artifact(
    now,
    preferred_lane: str = "any",
    preferred_density: str = "any",
    preferred_mood: str = "any",
    excluded_ids: set[int] | None = None,
):
    cooldown_seconds = max(1, int(settings.POOL_PLAY_COOLDOWN_SECONDS))
    cooldown_threshold = now - timedelta(seconds=cooldown_seconds)
    candidate_limit = max(5, int(settings.POOL_CANDIDATE_LIMIT))

    base_qs = playable_artifact_queryset(now)
    preferred_base_qs = base_qs
    if excluded_ids:
        preferred_base_qs = preferred_base_qs.exclude(id__in=excluded_ids)

    cooldown_qs = preferred_base_qs.filter(
        Q(last_access_at__isnull=True) | Q(last_access_at__lt=cooldown_threshold)
    )
    candidates = list(cooldown_qs.order_by("play_count", "wear", "-created_at")[:candidate_limit])
    if not candidates:
        candidates = list(preferred_base_qs.order_by("last_access_at", "play_count", "wear", "-created_at")[:candidate_limit])
    if not candidates and excluded_ids:
        cooldown_qs = base_qs.filter(
            Q(last_access_at__isnull=True) | Q(last_access_at__lt=cooldown_threshold)
        )
        candidates = list(cooldown_qs.order_by("play_count", "wear", "-created_at")[:candidate_limit])
        if not candidates:
            candidates = list(base_qs.order_by("last_access_at", "play_count", "wear", "-created_at")[:candidate_limit])
    if not candidates:
        return None, None

    if preferred_lane in {"fresh", "mid", "worn"}:
        lane_candidates = [artifact for artifact in candidates if artifact_lane(artifact, now) == preferred_lane]
        if lane_candidates:
            candidates = lane_candidates

    if preferred_density in {"light", "medium", "dense"}:
        density_candidates = [artifact for artifact in candidates if artifact_density(artifact) == preferred_density]
        if density_candidates:
            candidates = density_candidates

    if preferred_mood in {"clear", "hushed", "suspended", "weathered", "gathering"}:
        mood_candidates = [artifact for artifact in candidates if artifact_mood(artifact, now) == preferred_mood]
        if mood_candidates:
            candidates = mood_candidates

    weights = [pool_weight(artifact, now, cooldown_seconds, preferred_mood) for artifact in candidates]
    selected = random.choices(candidates, weights=weights, k=1)[0]
    return selected, artifact_lane(selected, now)
