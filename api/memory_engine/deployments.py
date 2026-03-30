"""Deployment catalog for artifact-engine variants.

Memory Engine remains the canonical default. This module intentionally keeps the
shape small so future deployments can branch copy/policy without forcing a broad
rewrite today.
"""

from __future__ import annotations

from dataclasses import dataclass

DEFAULT_ENGINE_DEPLOYMENT = "memory"


@dataclass(frozen=True)
class DeploymentSpec:
    code: str
    label: str
    short_description: str


DEPLOYMENT_SPECS: tuple[DeploymentSpec, ...] = (
    DeploymentSpec(
        code="memory",
        label="Memory Engine",
        short_description="Room-memory default with weathering and temporal depth.",
    ),
    DeploymentSpec(
        code="question",
        label="Question Engine",
        short_description="Question-forward capture where unresolved returns can be emphasized.",
    ),
    DeploymentSpec(
        code="prompt",
        label="Prompt Engine",
        short_description="Prompt-led intake where authored cues steer artifact framing.",
    ),
    DeploymentSpec(
        code="repair",
        label="Repair Engine",
        short_description="Repair-focused capture tuned for practical resurfacing and recency utility.",
    ),
    DeploymentSpec(
        code="witness",
        label="Witness Engine",
        short_description="Witness posture for testimony-like offerings and trace stewardship.",
    ),
    DeploymentSpec(
        code="oracle",
        label="Oracle Engine",
        short_description="Ceremonial, sparse reappearance posture for prompt-like returns.",
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
