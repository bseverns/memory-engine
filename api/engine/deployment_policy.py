"""Deployment-level playback policy hooks.

These hooks intentionally stay lightweight: memory remains canonical and other
modes apply small weight adjustments instead of replacing pool logic.
"""

from __future__ import annotations

from memory_engine.deployments import deployment_spec


def weight_adjustment(*, deployment_code: str, age_hours: float, absence_hours: float, lifecycle_status: str) -> float:
    code = deployment_spec(deployment_code).code
    lifecycle = str(lifecycle_status or "").strip().lower()

    if code == "question":
        unresolved = lifecycle in {"", "open", "unresolved", "pending"}
        return 1.22 if unresolved else 0.92

    if code == "prompt":
        if age_hours <= 36:
            return 1.12
        if age_hours >= 360:
            return 0.88
        return 1.0

    if code == "repair":
        if age_hours <= 72:
            return 1.28
        if age_hours >= 240:
            return 0.72
        return 1.0

    if code == "witness":
        if age_hours < 2:
            return 0.86
        if 8 <= age_hours <= 168:
            return 1.14
        return 1.0

    if code == "oracle":
        if absence_hours >= 120 and age_hours >= 120:
            return 1.45
        if age_hours < 12:
            return 0.62
        return 0.9

    return 1.0
