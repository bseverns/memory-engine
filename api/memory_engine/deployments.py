"""Deployment catalog for artifact/offering engine variants.

Memory Engine remains the canonical default. This module intentionally stays
small and explicit so deployment differences remain inspectable.
"""

from __future__ import annotations

from dataclasses import dataclass

DEFAULT_ENGINE_DEPLOYMENT = "memory"


@dataclass(frozen=True)
class DeploymentSpec:
    code: str
    label: str
    short_description: str
    participant_noun: str
    framing_noun: str
    copy_catalog_key: str
    playback_policy_key: str
    ops_note: str


DEPLOYMENT_SPECS: tuple[DeploymentSpec, ...] = (
    DeploymentSpec(
        code="memory",
        label="Memory Engine",
        short_description="Room-memory default with weathering and temporal depth.",
        participant_noun="memory",
        framing_noun="offering",
        copy_catalog_key="memory",
        playback_policy_key="memory_default",
        ops_note="Reflective room-memory posture with patina and gradual return.",
    ),
    DeploymentSpec(
        code="question",
        label="Question Engine",
        short_description="Inquiry-forward capture where unresolved returns can recur.",
        participant_noun="question",
        framing_noun="inquiry offering",
        copy_catalog_key="question",
        playback_policy_key="question_recurrence",
        ops_note="Favors unresolved recurrence and thematic resurfacing.",
    ),
    DeploymentSpec(
        code="prompt",
        label="Prompt Engine",
        short_description="Prompt-led intake where authored cues catalyze variation.",
        participant_noun="prompt response",
        framing_noun="prompt offering",
        copy_catalog_key="prompt",
        playback_policy_key="prompt_catalytic",
        ops_note="Keeps variety high and returns catalyst-like cues quickly.",
    ),
    DeploymentSpec(
        code="repair",
        label="Repair Engine",
        short_description="Practical capture tuned for useful resurfacing and recency.",
        participant_noun="repair note",
        framing_noun="repair offering",
        copy_catalog_key="repair",
        playback_policy_key="repair_recency",
        ops_note="Biases toward recent, useful, less-repetitive return patterns.",
    ),
    DeploymentSpec(
        code="witness",
        label="Witness Engine",
        short_description="Observation-oriented capture with documentary pacing.",
        participant_noun="witness note",
        framing_noun="witness offering",
        copy_catalog_key="witness",
        playback_policy_key="witness_documentary",
        ops_note="Prefers careful contextual pacing and documentary clarity.",
    ),
    DeploymentSpec(
        code="oracle",
        label="Oracle Engine",
        short_description="Ceremonial sparse resurfacing with rarity-forward timing.",
        participant_noun="oracle fragment",
        framing_noun="oracle offering",
        copy_catalog_key="oracle",
        playback_policy_key="oracle_rare",
        ops_note="Prioritizes rarity, longer gaps, and meaningful reappearance.",
    ),
)

DEPLOYMENT_SPEC_BY_CODE = {spec.code: spec for spec in DEPLOYMENT_SPECS}


def available_engine_deployments() -> tuple[str, ...]:
    return tuple(spec.code for spec in DEPLOYMENT_SPECS)


def normalize_engine_deployment_name(value: str | None) -> str:
    code = str(value or "").strip().lower()
    return code or DEFAULT_ENGINE_DEPLOYMENT


def deployment_spec(code: str | None) -> DeploymentSpec:
    normalized = normalize_engine_deployment_name(code)
    return DEPLOYMENT_SPEC_BY_CODE.get(normalized, DEPLOYMENT_SPEC_BY_CODE[DEFAULT_ENGINE_DEPLOYMENT])


def deployment_catalog_payload() -> list[dict[str, str]]:
    return [
        {
            "code": spec.code,
            "label": spec.label,
            "description": spec.short_description,
            "participantNoun": spec.participant_noun,
            "framingNoun": spec.framing_noun,
            "copyCatalogKey": spec.copy_catalog_key,
            "playbackPolicyKey": spec.playback_policy_key,
            "opsNote": spec.ops_note,
        }
        for spec in DEPLOYMENT_SPECS
    ]
