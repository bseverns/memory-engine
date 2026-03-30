"""Explicit deployment playback policy.

Memory stays canonical. Other deployments differ by small, named policy hooks:
selection, weighting, wear, and room-loop pacing. The goal is readable
temperament shifts, not a second engine.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Sequence

from memory_engine.deployments import DEFAULT_ENGINE_DEPLOYMENT, deployment_spec


UNRESOLVED_LIFECYCLE_STATUSES = frozenset({"", "open", "unresolved", "pending"})
RESOLVED_LIFECYCLE_STATUSES = frozenset({"answered", "resolved", "closed", "complete", "completed", "fixed"})


@dataclass(frozen=True)
class DeploymentPlaybackProfile:
    code: str
    behavior_summary: str
    afterlife_summary: str
    tuning_source: str
    candidate_limit_multiplier: float = 1.0
    cooldown_multiplier: float = 1.0
    wear_multiplier: float = 1.0
    anti_repetition_window: int = 12
    cue_gap_multiplier: float = 1.0
    pause_gap_multiplier: float = 1.0
    tone_gain_multiplier: float = 1.0
    overlap_chance_multiplier: float = 1.0
    featured_return_multiplier: float = 1.0
    topic_cluster_boost: float = 1.0


DEPLOYMENT_PLAYBACK_PROFILES: dict[str, DeploymentPlaybackProfile] = {
    "memory": DeploymentPlaybackProfile(
        code="memory",
        behavior_summary="Weathered room-memory with fresh-to-worn oscillation and featured returns.",
        afterlife_summary="Patina builds gradually; older absent material can feel newly arrived again.",
        tuning_source="Shared pool weighting + default room loop movement and wear.",
    ),
    "question": DeploymentPlaybackProfile(
        code="question",
        behavior_summary="Open questions recur sooner, stay more legible, and can loosely cluster by topic.",
        afterlife_summary="Unresolved material keeps returning until it settles; old open questions can still haunt the room.",
        tuning_source="Question weighting, shorter anti-repetition, topic clustering, and lighter wear.",
        candidate_limit_multiplier=1.15,
        cooldown_multiplier=0.65,
        wear_multiplier=0.45,
        anti_repetition_window=8,
        cue_gap_multiplier=0.88,
        pause_gap_multiplier=0.92,
        tone_gain_multiplier=0.94,
        overlap_chance_multiplier=1.18,
        featured_return_multiplier=0.96,
        topic_cluster_boost=1.24,
    ),
    "prompt": DeploymentPlaybackProfile(
        code="prompt",
        behavior_summary="Prompt responses stay lively and avoid settling too quickly.",
        afterlife_summary="Catalytic responses circulate sooner and older prompts cool faster.",
        tuning_source="Light prompt weighting on top of the shared loop.",
        candidate_limit_multiplier=1.05,
        cooldown_multiplier=0.9,
        wear_multiplier=0.8,
        anti_repetition_window=10,
        cue_gap_multiplier=0.94,
        pause_gap_multiplier=0.96,
        tone_gain_multiplier=0.96,
        overlap_chance_multiplier=1.05,
    ),
    "repair": DeploymentPlaybackProfile(
        code="repair",
        behavior_summary="Recent, practical notes recur while useful and stay clearer than weathered memory.",
        afterlife_summary="Useful fixes come back on a working-timescale instead of fading into elegy.",
        tuning_source="Repair weighting, stronger recency, shorter gaps, and gentler wear.",
        candidate_limit_multiplier=1.2,
        cooldown_multiplier=0.78,
        wear_multiplier=0.3,
        anti_repetition_window=9,
        cue_gap_multiplier=0.8,
        pause_gap_multiplier=0.86,
        tone_gain_multiplier=0.82,
        overlap_chance_multiplier=0.72,
        featured_return_multiplier=0.9,
        topic_cluster_boost=1.12,
    ),
    "witness": DeploymentPlaybackProfile(
        code="witness",
        behavior_summary="Witness notes keep documentary pacing and avoid hyper-recency spikes.",
        afterlife_summary="Return stays measured and contextual rather than restless.",
        tuning_source="Witness weighting with modestly calmer loop pacing.",
        candidate_limit_multiplier=1.0,
        cooldown_multiplier=1.05,
        wear_multiplier=0.7,
        anti_repetition_window=12,
        cue_gap_multiplier=1.08,
        pause_gap_multiplier=1.1,
        tone_gain_multiplier=1.02,
        overlap_chance_multiplier=0.85,
    ),
    "oracle": DeploymentPlaybackProfile(
        code="oracle",
        behavior_summary="Sparse ceremonial resurfacing with long pauses and rare chosen-feeling returns.",
        afterlife_summary="Fragments stay scarce; when they return they should read as events, not circulation.",
        tuning_source="Oracle rarity weighting, longer gaps, lower overlap, and very light wear.",
        candidate_limit_multiplier=0.8,
        cooldown_multiplier=1.5,
        wear_multiplier=0.18,
        anti_repetition_window=18,
        cue_gap_multiplier=1.45,
        pause_gap_multiplier=1.7,
        tone_gain_multiplier=1.14,
        overlap_chance_multiplier=0.18,
        featured_return_multiplier=1.32,
    ),
}


def playback_profile(deployment_code: str | None) -> DeploymentPlaybackProfile:
    code = deployment_spec(deployment_code).code
    return DEPLOYMENT_PLAYBACK_PROFILES.get(code, DEPLOYMENT_PLAYBACK_PROFILES[DEFAULT_ENGINE_DEPLOYMENT])


def resolved_lifecycle_status(lifecycle_status: str) -> str:
    return str(lifecycle_status or "").strip().lower()


def unresolved_lifecycle(lifecycle_status: str) -> bool:
    return resolved_lifecycle_status(lifecycle_status) in UNRESOLVED_LIFECYCLE_STATUSES


def recent_topic_list(recent_topics: Sequence[str] | None) -> list[str]:
    topics: list[str] = []
    for value in recent_topics or []:
        topic = str(value or "").strip().lower()
        if topic and topic not in topics:
            topics.append(topic)
    return topics


def pool_candidate_limit(base_limit: int, deployment_code: str | None) -> int:
    profile = playback_profile(deployment_code)
    return max(5, int(round(max(1, base_limit) * profile.candidate_limit_multiplier)))


def pool_cooldown_seconds(base_seconds: int, deployment_code: str | None) -> int:
    profile = playback_profile(deployment_code)
    return max(1, int(round(max(1, base_seconds) * profile.cooldown_multiplier)))


def wear_increment_multiplier(deployment_code: str | None) -> float:
    return playback_profile(deployment_code).wear_multiplier


def deployment_room_loop_policy(deployment_code: str | None) -> dict[str, object]:
    profile = playback_profile(deployment_code)
    return {
        "code": profile.code,
        "behaviorSummary": profile.behavior_summary,
        "afterlifeSummary": profile.afterlife_summary,
        "tuningSource": profile.tuning_source,
        "antiRepetitionWindow": profile.anti_repetition_window,
        "cueGapMultiplier": profile.cue_gap_multiplier,
        "pauseGapMultiplier": profile.pause_gap_multiplier,
        "toneGainMultiplier": profile.tone_gain_multiplier,
        "overlapChanceMultiplier": profile.overlap_chance_multiplier,
        "wearMultiplier": profile.wear_multiplier,
        "featuredReturnMultiplier": profile.featured_return_multiplier,
        "topicClusterBoost": profile.topic_cluster_boost,
    }


def room_loop_config_for_deployment(loop_config: dict, deployment_code: str | None) -> dict:
    config = deepcopy(loop_config)
    policy = dict(config.get("policy", {}))
    policy["activeDeployment"] = deployment_room_loop_policy(deployment_code)
    policy["deploymentProfiles"] = {
        code: deployment_room_loop_policy(code)
        for code in DEPLOYMENT_PLAYBACK_PROFILES
    }
    config["policy"] = policy
    return config


def weight_artifact_for_memory(**_: object) -> float:
    return 1.0


def weight_artifact_for_question(
    *,
    age_hours: float,
    absence_hours: float,
    lifecycle_status: str,
    topic_tag: str,
    recent_topics: Sequence[str] | None,
    lane: str,
    density: str,
    mood: str,
    **_: object,
) -> float:
    weight = 1.0
    if unresolved_lifecycle(lifecycle_status):
        weight *= 1.35
    elif resolved_lifecycle_status(lifecycle_status) in RESOLVED_LIFECYCLE_STATUSES:
        weight *= 0.72
    else:
        weight *= 0.92

    if age_hours <= 72:
        weight *= 1.18
    elif age_hours <= 336:
        weight *= 1.04
    elif unresolved_lifecycle(lifecycle_status) and absence_hours >= 72:
        weight *= 1.12
    else:
        weight *= 0.94

    if topic_tag and topic_tag.lower() in recent_topic_list(recent_topics):
        weight *= playback_profile("question").topic_cluster_boost

    if lane == "worn":
        weight *= 0.9
    elif lane == "fresh":
        weight *= 1.06

    if density == "dense":
        weight *= 0.92
    if mood in {"clear", "gathering", "suspended"}:
        weight *= 1.08
    elif mood == "weathered":
        weight *= 0.9

    return weight


def weight_artifact_for_prompt(*, age_hours: float, **_: object) -> float:
    if age_hours <= 36:
        return 1.12
    if age_hours >= 360:
        return 0.88
    return 1.0


def weight_artifact_for_repair(
    *,
    age_hours: float,
    absence_hours: float,
    lifecycle_status: str,
    topic_tag: str,
    recent_topics: Sequence[str] | None,
    duration_ms: int,
    lane: str,
    density: str,
    mood: str,
    **_: object,
) -> float:
    weight = 1.0
    if age_hours <= 48:
        weight *= 1.38
    elif age_hours <= 168:
        weight *= 1.14
    elif age_hours >= 336:
        weight *= 0.76

    if absence_hours <= 72:
        weight *= 1.08

    if duration_ms <= 8000:
        weight *= 1.16
    elif duration_ms >= 24000:
        weight *= 0.8

    if unresolved_lifecycle(lifecycle_status):
        weight *= 1.08
    elif resolved_lifecycle_status(lifecycle_status) in RESOLVED_LIFECYCLE_STATUSES:
        weight *= 0.95

    if topic_tag and topic_tag.lower() in recent_topic_list(recent_topics):
        weight *= playback_profile("repair").topic_cluster_boost

    if lane == "worn":
        weight *= 0.84
    if density == "dense":
        weight *= 0.82
    elif density == "light":
        weight *= 1.08
    if mood in {"clear", "hushed"}:
        weight *= 1.1

    return weight


def weight_artifact_for_witness(*, age_hours: float, **_: object) -> float:
    if age_hours < 2:
        return 0.86
    if 8 <= age_hours <= 168:
        return 1.14
    return 1.0


def weight_artifact_for_oracle(
    *,
    age_hours: float,
    absence_hours: float,
    lane: str,
    density: str,
    mood: str,
    **_: object,
) -> float:
    weight = 1.0
    if age_hours < 24:
        weight *= 0.4
    elif age_hours >= 168 and absence_hours >= 96:
        weight *= 1.72
    elif absence_hours >= 240:
        weight *= 1.34
    else:
        weight *= 0.88

    if lane == "fresh":
        weight *= 0.72
    elif lane == "worn":
        weight *= 1.12

    if density == "dense":
        weight *= 0.9
    if mood in {"weathered", "hushed", "suspended"}:
        weight *= 1.08

    return weight


def weight_adjustment(
    *,
    deployment_code: str,
    age_hours: float,
    absence_hours: float,
    lifecycle_status: str,
    topic_tag: str = "",
    recent_topics: Sequence[str] | None = None,
    duration_ms: int = 0,
    lane: str = "mid",
    density: str = "medium",
    mood: str = "suspended",
) -> float:
    code = deployment_spec(deployment_code).code
    if code == "question":
        return weight_artifact_for_question(
            age_hours=age_hours,
            absence_hours=absence_hours,
            lifecycle_status=lifecycle_status,
            topic_tag=topic_tag,
            recent_topics=recent_topics,
            duration_ms=duration_ms,
            lane=lane,
            density=density,
            mood=mood,
        )
    if code == "prompt":
        return weight_artifact_for_prompt(
            age_hours=age_hours,
            absence_hours=absence_hours,
            lifecycle_status=lifecycle_status,
            topic_tag=topic_tag,
            recent_topics=recent_topics,
            duration_ms=duration_ms,
            lane=lane,
            density=density,
            mood=mood,
        )
    if code == "repair":
        return weight_artifact_for_repair(
            age_hours=age_hours,
            absence_hours=absence_hours,
            lifecycle_status=lifecycle_status,
            topic_tag=topic_tag,
            recent_topics=recent_topics,
            duration_ms=duration_ms,
            lane=lane,
            density=density,
            mood=mood,
        )
    if code == "witness":
        return weight_artifact_for_witness(
            age_hours=age_hours,
            absence_hours=absence_hours,
            lifecycle_status=lifecycle_status,
            topic_tag=topic_tag,
            recent_topics=recent_topics,
            duration_ms=duration_ms,
            lane=lane,
            density=density,
            mood=mood,
        )
    if code == "oracle":
        return weight_artifact_for_oracle(
            age_hours=age_hours,
            absence_hours=absence_hours,
            lifecycle_status=lifecycle_status,
            topic_tag=topic_tag,
            recent_topics=recent_topics,
            duration_ms=duration_ms,
            lane=lane,
            density=density,
            mood=mood,
        )
    return weight_artifact_for_memory(
        age_hours=age_hours,
        absence_hours=absence_hours,
        lifecycle_status=lifecycle_status,
        topic_tag=topic_tag,
        recent_topics=recent_topics,
        duration_ms=duration_ms,
        lane=lane,
        density=density,
        mood=mood,
    )
