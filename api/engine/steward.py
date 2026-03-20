from __future__ import annotations

from django.db import transaction

from .models import StewardAction, StewardState


def load_steward_state() -> StewardState:
    return StewardState.load()


def steward_state_payload(state: StewardState | None = None) -> dict:
    state = state or load_steward_state()
    return {
        "intake_paused": bool(state.intake_paused),
        "playback_paused": bool(state.playback_paused),
        "quieter_mode": bool(state.quieter_mode),
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
def update_steward_state(*, intake_paused: bool, playback_paused: bool, quieter_mode: bool, actor: str) -> tuple[StewardState, list[dict]]:
    state = StewardState.objects.select_for_update().get_or_create(singleton_key="default")[0]

    changes = []
    next_values = {
        "intake_paused": bool(intake_paused),
        "playback_paused": bool(playback_paused),
        "quieter_mode": bool(quieter_mode),
    }

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
        StewardAction.objects.create(
            action=action_name,
            actor=actor or "operator",
            detail=f"{field_name.replace('_', ' ')} {detail}",
            payload={"field": field_name, "value": next_value},
        )

    if changes:
        state.save(update_fields=["intake_paused", "playback_paused", "quieter_mode", "updated_at"])

    return state, changes
