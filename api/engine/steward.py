from __future__ import annotations

from django.db import transaction

from .models import StewardAction, StewardState


def record_steward_action(*, action: str, actor: str, detail: str = "", payload: dict | None = None) -> StewardAction:
    return StewardAction.objects.create(
        action=action,
        actor=actor or "operator",
        detail=detail,
        payload=payload or {},
    )


def load_steward_state() -> StewardState:
    return StewardState.load()


def steward_state_payload(state: StewardState | None = None) -> dict:
    state = state or load_steward_state()
    return {
        "intake_paused": bool(state.intake_paused),
        "playback_paused": bool(state.playback_paused),
        "quieter_mode": bool(state.quieter_mode),
        "maintenance_mode": bool(state.maintenance_mode),
        "mood_bias": str(state.mood_bias or ""),
        "updated_at": state.updated_at,
    }


def recent_steward_actions(limit: int = 8) -> list[dict]:
    return [
        {
            "action": action.action,
            "actor": action.actor,
            "detail": action.detail,
            "payload": action.payload,
            "created_at": action.created_at,
        }
        for action in StewardAction.objects.order_by("-created_at")[:limit]
    ]


@transaction.atomic
def update_steward_state(
    *,
    intake_paused: bool,
    playback_paused: bool,
    quieter_mode: bool,
    maintenance_mode: bool,
    mood_bias: str,
    actor: str,
) -> tuple[StewardState, list[dict]]:
    state = StewardState.objects.select_for_update().get_or_create(singleton_key="default")[0]

    changes = []
    next_values = {
        "intake_paused": bool(intake_paused),
        "playback_paused": bool(playback_paused),
        "quieter_mode": bool(quieter_mode),
        "maintenance_mode": bool(maintenance_mode),
    }
    normalized_mood_bias = str(mood_bias or "").strip().lower()
    if normalized_mood_bias not in {"", "clear", "hushed", "suspended", "weathered", "gathering"}:
        normalized_mood_bias = ""

    for field_name, next_value in next_values.items():
        previous_value = bool(getattr(state, field_name))
        if previous_value == next_value:
            continue
        setattr(state, field_name, next_value)
        detail = "enabled" if next_value else "disabled"
        action_name = f"{field_name}.{detail}"
        changes.append({
            "field": field_name,
            "value": next_value,
            "action": action_name,
            "detail": f"{field_name.replace('_', ' ')} {detail}",
        })
        record_steward_action(
            action=action_name,
            actor=actor or "operator",
            detail=f"{field_name.replace('_', ' ')} {detail}",
            payload={"field": field_name, "value": next_value},
        )

    previous_mood_bias = str(state.mood_bias or "")
    if previous_mood_bias != normalized_mood_bias:
        state.mood_bias = normalized_mood_bias
        mood_detail = normalized_mood_bias or "none"
        changes.append({
            "field": "mood_bias",
            "value": normalized_mood_bias,
            "action": "mood_bias.updated",
            "detail": f"mood bias set to {mood_detail}",
        })
        record_steward_action(
            action="mood_bias.updated",
            actor=actor or "operator",
            detail=f"mood bias set to {mood_detail}",
            payload={"field": "mood_bias", "value": normalized_mood_bias},
        )

    if changes:
        state.save(update_fields=[
            "intake_paused",
            "playback_paused",
            "quieter_mode",
            "maintenance_mode",
            "mood_bias",
            "updated_at",
        ])

    return state, changes
