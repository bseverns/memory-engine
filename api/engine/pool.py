import hashlib
import random
from datetime import timedelta

from django.conf import settings
from django.db.models import Q

from memory_engine.deployments import deployment_spec

from .deployment_policy import (
    UNRESOLVED_LIFECYCLE_STATUSES,
    pool_candidate_limit,
    pool_cooldown_seconds,
    playback_profile,
    resolved_lifecycle_status,
    weight_adjustment,
)
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


def artifact_playback_window(
    artifact: Artifact,
    now,
    *,
    max_slice_seconds: int | None = None,
    revolution_seconds: int | None = None,
    variant: str = "",
):
    # Long-form material is sliced deterministically per time revolution so the
    # room can keep moving through a source without storing extra playback state.
    max_slice_ms = max(1000, int((max_slice_seconds or settings.ROOM_SOURCE_SLICE_MAX_SECONDS) * 1000))
    cycle_seconds = max(1, int(revolution_seconds or settings.ROOM_SOURCE_SLICE_REVOLUTION_SECONDS))
    full_duration_ms = max(0, int(artifact.duration_ms or 0))
    playback_duration_ms = min(full_duration_ms, max_slice_ms) if full_duration_ms else 0
    revolution_index = int(now.timestamp()) // cycle_seconds

    if full_duration_ms <= playback_duration_ms:
        return {
            "start_ms": 0,
            "duration_ms": playback_duration_ms,
            "full_duration_ms": full_duration_ms,
            "windowed": False,
            "revolution_index": revolution_index,
        }

    available_offset_ms = max(0, full_duration_ms - playback_duration_ms)
    seed_input = f"{artifact.id}:{revolution_index}:{variant or 'base'}".encode("utf-8")
    digest = hashlib.sha256(seed_input).digest()
    ratio = int.from_bytes(digest[:8], "big") / float((1 << 64) - 1)
    raw_start_ms = int(round(available_offset_ms * ratio))
    quantum_ms = 250
    start_ms = int(round(raw_start_ms / quantum_ms) * quantum_ms)
    start_ms = max(0, min(available_offset_ms, start_ms))

    return {
        "start_ms": start_ms,
        "duration_ms": playback_duration_ms,
        "full_duration_ms": full_duration_ms,
        "windowed": True,
        "revolution_index": revolution_index,
    }


def artifact_age_hours(artifact: Artifact, now) -> float:
    return max(0.0, (now - artifact.created_at).total_seconds() / 3600.0)


def artifact_absence_hours(artifact: Artifact, now) -> float:
    if artifact.last_access_at:
        return max(0.0, (now - artifact.last_access_at).total_seconds() / 3600.0)
    return artifact_age_hours(artifact, now)


def artifact_is_featured_return(artifact: Artifact, now) -> bool:
    return bool(
        artifact_age_hours(artifact, now) >= settings.POOL_FEATURED_RETURN_MIN_AGE_HOURS
        and artifact_absence_hours(artifact, now) >= settings.POOL_FEATURED_RETURN_MIN_ABSENCE_HOURS
    )


def density_balance_factor(artifact: Artifact, now, recent_densities: list[str] | None = None) -> float:
    recent = [density for density in (recent_densities or []) if density in {"light", "medium", "dense"}]
    if len(recent) < 2:
        return 1.0

    candidate_density = artifact_density(artifact)
    penalty = float(settings.POOL_DENSITY_CLUSTER_PENALTY)
    release_boost = float(settings.POOL_DENSITY_RELEASE_BOOST)
    trailing = recent[-3:]
    dense_cluster = trailing.count("dense") >= 2
    light_cluster = trailing.count("light") >= 2

    if dense_cluster:
        if candidate_density == "dense":
            return penalty
        if candidate_density == "light":
            return release_boost
        return 1.08

    if light_cluster:
        if candidate_density == "light":
            return max(0.78, penalty + 0.18)
        if candidate_density == "medium":
            return max(1.05, release_boost - 0.06)
        return max(1.0, release_boost - 0.12)

    return 1.0


def pool_weight(
    artifact: Artifact,
    now,
    cooldown_seconds: int,
    preferred_mood: str = "any",
    recent_densities: list[str] | None = None,
    recent_topics: list[str] | None = None,
    deployment_code: str = "memory",
) -> float:
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

    lane = artifact_lane(artifact, now)
    density = artifact_density(artifact)
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

    featured_return_factor = (
        float(settings.POOL_FEATURED_RETURN_BOOST)
        * playback_profile(deployment_code).featured_return_multiplier
        if artifact_is_featured_return(artifact, now)
        else 1.0
    )
    density_factor = density_balance_factor(artifact, now, recent_densities)
    deployment_factor = weight_adjustment(
        deployment_code=deployment_code,
        age_hours=age_hours,
        absence_hours=artifact_absence_hours(artifact, now),
        lifecycle_status=str(getattr(artifact, "lifecycle_status", "") or ""),
        topic_tag=str(getattr(artifact, "topic_tag", "") or ""),
        recent_topics=recent_topics or [],
        duration_ms=int(getattr(artifact, "duration_ms", 0) or 0),
        lane=lane,
        density=density,
        mood=mood,
    )

    return max(
        0.1,
        cooldown_factor * rarity_factor * wear_factor * age_factor * mood_factor * featured_return_factor * density_factor * deployment_factor,
    )


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
    recent_densities: list[str] | None = None,
    recent_topics: list[str] | None = None,
    preferred_topic: str = "",
    preferred_lifecycle_status: str = "",
    deployment_code: str = "memory",
):
    # Selection is intentionally staged:
    # 1. stay inside the active deployment
    # 2. respect cooldown when possible
    # 3. relax exclusions before leaving the deployment
    # 4. only non-memory deployments with no playable pool fall back to memory
    cooldown_seconds = pool_cooldown_seconds(int(settings.POOL_PLAY_COOLDOWN_SECONDS), deployment_code)
    cooldown_threshold = now - timedelta(seconds=cooldown_seconds)
    candidate_limit = pool_candidate_limit(int(settings.POOL_CANDIDATE_LIMIT), deployment_code)

    deployment = deployment_spec(deployment_code)
    base_qs = playable_artifact_queryset(now).filter(deployment_kind=deployment.code)
    deployment_has_playable = base_qs.exists()
    preferred_base_qs = base_qs
    if excluded_ids:
        preferred_base_qs = preferred_base_qs.exclude(id__in=excluded_ids)

    cooldown_qs = preferred_base_qs.filter(Q(last_access_at__isnull=True) | Q(last_access_at__lt=cooldown_threshold))
    candidates = select_candidates_for_deployment(
        cooldown_qs=cooldown_qs,
        preferred_base_qs=preferred_base_qs,
        deployment_code=deployment.code,
        now=now,
        candidate_limit=candidate_limit,
        recent_topics=recent_topics,
        preferred_topic=preferred_topic,
        preferred_lifecycle_status=preferred_lifecycle_status,
    )
    if not candidates and excluded_ids:
        cooldown_qs = base_qs.filter(Q(last_access_at__isnull=True) | Q(last_access_at__lt=cooldown_threshold))
        candidates = select_candidates_for_deployment(
            cooldown_qs=cooldown_qs,
            preferred_base_qs=base_qs,
            deployment_code=deployment.code,
            now=now,
            candidate_limit=candidate_limit,
            recent_topics=recent_topics,
            preferred_topic=preferred_topic,
            preferred_lifecycle_status=preferred_lifecycle_status,
        )
    if not candidates and deployment.code != "memory" and not deployment_has_playable:
        base_qs = playable_artifact_queryset(now)
        preferred_base_qs = base_qs.exclude(id__in=excluded_ids) if excluded_ids else base_qs
        cooldown_qs = preferred_base_qs.filter(Q(last_access_at__isnull=True) | Q(last_access_at__lt=cooldown_threshold))
        candidates = select_candidates_for_deployment(
            cooldown_qs=cooldown_qs,
            preferred_base_qs=preferred_base_qs,
            deployment_code="memory",
            now=now,
            candidate_limit=candidate_limit,
            recent_topics=recent_topics,
            preferred_topic=preferred_topic,
            preferred_lifecycle_status=preferred_lifecycle_status,
        )

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

    weights = [
        pool_weight(
            artifact,
            now,
            cooldown_seconds,
            preferred_mood,
            recent_densities=recent_densities,
            recent_topics=recent_topics,
            deployment_code=deployment.code,
        )
        for artifact in candidates
    ]
    selected = random.choices(candidates, weights=weights, k=1)[0]
    return selected, artifact_lane(selected, now)


def unresolved_queryset(queryset):
    return queryset.filter(lifecycle_status__in=tuple(UNRESOLVED_LIFECYCLE_STATUSES))


def preferred_topic_queryset(queryset, preferred_topic: str | None):
    topic = str(preferred_topic or "").strip().lower()
    if not topic:
        return queryset.none()
    return queryset.filter(topic_tag__iexact=topic)


def preferred_lifecycle_queryset(queryset, preferred_lifecycle_status: str | None):
    lifecycle_status = resolved_lifecycle_status(preferred_lifecycle_status or "")
    if not lifecycle_status:
        return queryset.none()
    return queryset.filter(lifecycle_status__iexact=lifecycle_status)


def topic_cluster_queryset(queryset, recent_topics: list[str] | None):
    topics = [str(topic or "").strip().lower() for topic in (recent_topics or []) if str(topic or "").strip()]
    if not topics:
        return queryset.none()
    topic_query = Q()
    for topic in topics[:3]:
        topic_query |= Q(topic_tag__iexact=topic)
    return queryset.filter(topic_query)


def select_candidates_for_deployment(
    *,
    cooldown_qs,
    preferred_base_qs,
    deployment_code: str,
    now,
    candidate_limit: int,
    recent_topics: list[str] | None = None,
    preferred_topic: str = "",
    preferred_lifecycle_status: str = "",
):
    code = deployment_spec(deployment_code).code
    recent_topics = [str(topic or "").strip().lower() for topic in (recent_topics or []) if str(topic or "").strip()]
    batches = []
    threaded_cooldown_qs = preferred_topic_queryset(cooldown_qs, preferred_topic)
    threaded_base_qs = preferred_topic_queryset(preferred_base_qs, preferred_topic)
    preferred_status_cooldown_qs = preferred_lifecycle_queryset(cooldown_qs, preferred_lifecycle_status)
    preferred_status_base_qs = preferred_lifecycle_queryset(preferred_base_qs, preferred_lifecycle_status)

    if code == "question":
        # Question wants the room to feel unresolved before it feels merely
        # recent, so threaded open material gets first pick at the candidate set.
        unresolved_cooldown_qs = unresolved_queryset(cooldown_qs)
        unresolved_base_qs = unresolved_queryset(preferred_base_qs)
        threaded_unresolved_cooldown_qs = preferred_topic_queryset(unresolved_cooldown_qs, preferred_topic)
        threaded_unresolved_base_qs = preferred_topic_queryset(unresolved_base_qs, preferred_topic)
        batches.extend([
            preferred_lifecycle_queryset(threaded_unresolved_cooldown_qs, preferred_lifecycle_status).order_by("-created_at", "play_count", "wear"),
            threaded_unresolved_cooldown_qs.order_by("-created_at", "play_count", "wear"),
            preferred_lifecycle_queryset(unresolved_cooldown_qs, preferred_lifecycle_status).order_by("-created_at", "play_count", "wear"),
            topic_cluster_queryset(unresolved_queryset(cooldown_qs), recent_topics).order_by("-created_at", "play_count", "wear"),
            unresolved_cooldown_qs.order_by("-created_at", "play_count", "wear"),
            preferred_lifecycle_queryset(threaded_unresolved_base_qs, preferred_lifecycle_status).order_by("last_access_at", "-created_at", "play_count", "wear"),
            threaded_unresolved_base_qs.order_by("last_access_at", "-created_at", "play_count", "wear"),
            preferred_status_base_qs.order_by("last_access_at", "-created_at", "play_count", "wear"),
            topic_cluster_queryset(preferred_base_qs, recent_topics).order_by("last_access_at", "-created_at", "play_count", "wear"),
            preferred_base_qs.order_by("last_access_at", "-created_at", "play_count", "wear"),
        ])
    elif code == "prompt":
        recent_threshold = now - timedelta(days=10)
        recent_cooldown_qs = cooldown_qs.filter(created_at__gte=recent_threshold)
        recent_base_qs = preferred_base_qs.filter(created_at__gte=recent_threshold)
        batches.extend([
            topic_cluster_queryset(recent_cooldown_qs, recent_topics).order_by("-created_at", "play_count", "wear"),
            recent_cooldown_qs.order_by("-created_at", "play_count", "wear"),
            topic_cluster_queryset(cooldown_qs, recent_topics).order_by("-created_at", "play_count", "wear"),
            recent_base_qs.order_by("-created_at", "last_access_at", "play_count", "wear"),
            preferred_base_qs.order_by("-created_at", "last_access_at", "play_count", "wear"),
        ])
    elif code == "repair":
        recent_threshold = now - timedelta(days=14)
        recent_cooldown_qs = cooldown_qs.filter(created_at__gte=recent_threshold)
        recent_base_qs = preferred_base_qs.filter(created_at__gte=recent_threshold)
        threaded_recent_cooldown_qs = preferred_topic_queryset(recent_cooldown_qs, preferred_topic)
        threaded_recent_base_qs = preferred_topic_queryset(recent_base_qs, preferred_topic)
        # Repair is more literal than memory: keep useful recent notes in reach,
        # and only widen back out to the full deployment once the practical
        # thread cannot be sustained.
        batches.extend([
            preferred_lifecycle_queryset(threaded_recent_cooldown_qs, preferred_lifecycle_status).order_by("-created_at", "play_count", "wear"),
            threaded_recent_cooldown_qs.order_by("-created_at", "play_count", "wear"),
            preferred_lifecycle_queryset(recent_cooldown_qs, preferred_lifecycle_status).order_by("-created_at", "play_count", "wear"),
            topic_cluster_queryset(recent_cooldown_qs, recent_topics).order_by("-created_at", "play_count", "wear"),
            recent_cooldown_qs.order_by("-created_at", "play_count", "wear"),
            preferred_lifecycle_queryset(threaded_recent_base_qs, preferred_lifecycle_status).order_by("-created_at", "last_access_at", "play_count", "wear"),
            threaded_recent_base_qs.order_by("-created_at", "last_access_at", "play_count", "wear"),
            preferred_status_cooldown_qs.order_by("-created_at", "last_access_at", "play_count", "wear"),
            topic_cluster_queryset(cooldown_qs, recent_topics).order_by("-created_at", "play_count", "wear"),
            threaded_base_qs.order_by("-created_at", "last_access_at", "play_count", "wear"),
            recent_base_qs.order_by("-created_at", "last_access_at", "play_count", "wear"),
            preferred_base_qs.order_by("-created_at", "last_access_at", "play_count", "wear"),
        ])
    elif code == "witness":
        settled_threshold = now - timedelta(hours=6)
        settled_cooldown_qs = cooldown_qs.filter(created_at__lt=settled_threshold)
        settled_base_qs = preferred_base_qs.filter(created_at__lt=settled_threshold)
        batches.extend([
            settled_cooldown_qs.order_by("last_access_at", "-created_at", "play_count", "wear"),
            settled_base_qs.order_by("last_access_at", "-created_at", "play_count", "wear"),
            cooldown_qs.order_by("last_access_at", "-created_at", "play_count", "wear"),
            preferred_base_qs.order_by("last_access_at", "-created_at", "play_count", "wear"),
        ])
    elif code == "oracle":
        oracle_threshold = now - timedelta(hours=12)
        absent_threshold = now - timedelta(hours=72)
        aged_cooldown_qs = cooldown_qs.filter(created_at__lt=oracle_threshold)
        absent_cooldown_qs = aged_cooldown_qs.filter(Q(last_access_at__isnull=True) | Q(last_access_at__lt=absent_threshold))
        aged_base_qs = preferred_base_qs.filter(created_at__lt=oracle_threshold)
        batches.extend([
            absent_cooldown_qs.order_by("last_access_at", "created_at", "play_count", "wear"),
            aged_cooldown_qs.order_by("last_access_at", "created_at", "play_count", "wear"),
            aged_base_qs.order_by("last_access_at", "created_at", "play_count", "wear"),
        ])
    else:
        batches.extend([
            cooldown_qs.order_by("play_count", "wear", "-created_at"),
            preferred_base_qs.order_by("last_access_at", "play_count", "wear", "-created_at"),
        ])

    for queryset in batches:
        candidates = list(queryset[:candidate_limit])
        if candidates:
            return candidates
    return []
