from __future__ import annotations

from django.db import transaction
from memory_engine.deployments import deployment_spec

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
        "kiosk_language_code": str(state.kiosk_language_code or ""),
        "kiosk_accessibility_mode": str(state.kiosk_accessibility_mode or ""),
        "kiosk_force_reduced_motion": bool(state.kiosk_force_reduced_motion),
        "kiosk_max_recording_seconds": int(state.kiosk_max_recording_seconds or 120),
        "session_theme_title": str(state.session_theme_title or ""),
        "session_theme_prompt": str(state.session_theme_prompt or ""),
        "deployment_focus_topic": str(state.deployment_focus_topic or ""),
        "deployment_focus_status": str(state.deployment_focus_status or ""),
        "updated_at": state.updated_at,
    }


def deployment_focus_status_suggestions(deployment_code: str) -> tuple[str, ...]:
    code = deployment_spec(deployment_code).code
    if code == "question":
        return ("open", "pending", "answered", "resolved")
    if code == "repair":
        return ("pending", "needs_part", "fixed", "obsolete")
    if code == "prompt":
        return ("seed", "echo", "spent")
    if code == "witness":
        return ("observed", "verified", "contextual")
    if code == "oracle":
        return ("held", "spent")
    return ("open", "resolved")


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
    kiosk_language_code: str,
    kiosk_accessibility_mode: str,
    kiosk_force_reduced_motion: bool,
    kiosk_max_recording_seconds: int,
    session_theme_title: str,
    session_theme_prompt: str,
    deployment_focus_topic: str,
    deployment_focus_status: str,
    deployment_code: str,
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
    normalized_language_code = str(kiosk_language_code or "").strip().lower()
    if normalized_language_code not in {"", "en", "es_mx_ca"}:
        normalized_language_code = ""
    normalized_accessibility_mode = str(kiosk_accessibility_mode or "").strip().lower()
    if normalized_accessibility_mode not in {"", "large_high_contrast"}:
        normalized_accessibility_mode = ""
    normalized_max_recording_seconds = max(30, min(300, int(kiosk_max_recording_seconds or 120)))
    normalized_session_theme_title = str(session_theme_title or "").strip()[:64]
    normalized_session_theme_prompt = str(session_theme_prompt or "").strip()[:180]
    normalized_deployment_focus_topic = str(deployment_focus_topic or "").strip()[:64]
    normalized_deployment_focus_status = str(deployment_focus_status or "").strip().lower()[:32]
    allowed_focus_statuses = set(deployment_focus_status_suggestions(deployment_code))
    if normalized_deployment_focus_status and normalized_deployment_focus_status not in allowed_focus_statuses:
        normalized_deployment_focus_status = ""

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

    previous_language_code = str(state.kiosk_language_code or "")
    if previous_language_code != normalized_language_code:
        state.kiosk_language_code = normalized_language_code
        language_detail = normalized_language_code or "installation default"
        changes.append({
            "field": "kiosk_language_code",
            "value": normalized_language_code,
            "action": "kiosk_language_code.updated",
            "detail": f"kiosk language set to {language_detail}",
        })
        record_steward_action(
            action="kiosk_language_code.updated",
            actor=actor or "operator",
            detail=f"kiosk language set to {language_detail}",
            payload={"field": "kiosk_language_code", "value": normalized_language_code},
        )

    previous_accessibility_mode = str(state.kiosk_accessibility_mode or "")
    if previous_accessibility_mode != normalized_accessibility_mode:
        state.kiosk_accessibility_mode = normalized_accessibility_mode
        accessibility_detail = normalized_accessibility_mode or "standard"
        changes.append({
            "field": "kiosk_accessibility_mode",
            "value": normalized_accessibility_mode,
            "action": "kiosk_accessibility_mode.updated",
            "detail": f"kiosk accessibility mode set to {accessibility_detail}",
        })
        record_steward_action(
            action="kiosk_accessibility_mode.updated",
            actor=actor or "operator",
            detail=f"kiosk accessibility mode set to {accessibility_detail}",
            payload={"field": "kiosk_accessibility_mode", "value": normalized_accessibility_mode},
        )

    previous_reduced_motion = bool(state.kiosk_force_reduced_motion)
    if previous_reduced_motion != bool(kiosk_force_reduced_motion):
        state.kiosk_force_reduced_motion = bool(kiosk_force_reduced_motion)
        motion_detail = "enabled" if state.kiosk_force_reduced_motion else "disabled"
        changes.append({
            "field": "kiosk_force_reduced_motion",
            "value": state.kiosk_force_reduced_motion,
            "action": f"kiosk_force_reduced_motion.{motion_detail}",
            "detail": f"kiosk reduced motion {motion_detail}",
        })
        record_steward_action(
            action=f"kiosk_force_reduced_motion.{motion_detail}",
            actor=actor or "operator",
            detail=f"kiosk reduced motion {motion_detail}",
            payload={"field": "kiosk_force_reduced_motion", "value": state.kiosk_force_reduced_motion},
        )

    previous_max_recording_seconds = int(state.kiosk_max_recording_seconds or 120)
    if previous_max_recording_seconds != normalized_max_recording_seconds:
        state.kiosk_max_recording_seconds = normalized_max_recording_seconds
        changes.append({
            "field": "kiosk_max_recording_seconds",
            "value": normalized_max_recording_seconds,
            "action": "kiosk_max_recording_seconds.updated",
            "detail": f"kiosk max recording duration set to {normalized_max_recording_seconds} seconds",
        })
        record_steward_action(
            action="kiosk_max_recording_seconds.updated",
            actor=actor or "operator",
            detail=f"kiosk max recording duration set to {normalized_max_recording_seconds} seconds",
            payload={"field": "kiosk_max_recording_seconds", "value": normalized_max_recording_seconds},
        )

    previous_theme_title = str(state.session_theme_title or "")
    if previous_theme_title != normalized_session_theme_title:
        state.session_theme_title = normalized_session_theme_title
        theme_title_detail = normalized_session_theme_title or "cleared"
        changes.append({
            "field": "session_theme_title",
            "value": normalized_session_theme_title,
            "action": "session_theme_title.updated",
            "detail": f"session theme title set to {theme_title_detail}",
        })
        record_steward_action(
            action="session_theme_title.updated",
            actor=actor or "operator",
            detail=f"session theme title set to {theme_title_detail}",
            payload={"field": "session_theme_title", "value": normalized_session_theme_title},
        )

    previous_theme_prompt = str(state.session_theme_prompt or "")
    if previous_theme_prompt != normalized_session_theme_prompt:
        state.session_theme_prompt = normalized_session_theme_prompt
        theme_prompt_detail = normalized_session_theme_prompt or "cleared"
        changes.append({
            "field": "session_theme_prompt",
            "value": normalized_session_theme_prompt,
            "action": "session_theme_prompt.updated",
            "detail": f"session theme framing set to {theme_prompt_detail}",
        })
        record_steward_action(
            action="session_theme_prompt.updated",
            actor=actor or "operator",
            detail=f"session theme framing set to {theme_prompt_detail}",
            payload={"field": "session_theme_prompt", "value": normalized_session_theme_prompt},
        )

    previous_focus_topic = str(state.deployment_focus_topic or "")
    if previous_focus_topic != normalized_deployment_focus_topic:
        state.deployment_focus_topic = normalized_deployment_focus_topic
        focus_topic_detail = normalized_deployment_focus_topic or "cleared"
        changes.append({
            "field": "deployment_focus_topic",
            "value": normalized_deployment_focus_topic,
            "action": "deployment_focus_topic.updated",
            "detail": f"deployment focus topic set to {focus_topic_detail}",
        })
        record_steward_action(
            action="deployment_focus_topic.updated",
            actor=actor or "operator",
            detail=f"deployment focus topic set to {focus_topic_detail}",
            payload={"field": "deployment_focus_topic", "value": normalized_deployment_focus_topic},
        )

    previous_focus_status = str(state.deployment_focus_status or "")
    if previous_focus_status != normalized_deployment_focus_status:
        state.deployment_focus_status = normalized_deployment_focus_status
        focus_status_detail = normalized_deployment_focus_status or "cleared"
        changes.append({
            "field": "deployment_focus_status",
            "value": normalized_deployment_focus_status,
            "action": "deployment_focus_status.updated",
            "detail": f"deployment focus status set to {focus_status_detail}",
        })
        record_steward_action(
            action="deployment_focus_status.updated",
            actor=actor or "operator",
            detail=f"deployment focus status set to {focus_status_detail}",
            payload={"field": "deployment_focus_status", "value": normalized_deployment_focus_status},
        )

    if changes:
        state.save(update_fields=[
            "intake_paused",
            "playback_paused",
            "quieter_mode",
            "maintenance_mode",
            "mood_bias",
            "kiosk_language_code",
            "kiosk_accessibility_mode",
            "kiosk_force_reduced_motion",
            "kiosk_max_recording_seconds",
            "session_theme_title",
            "session_theme_prompt",
            "deployment_focus_topic",
            "deployment_focus_status",
            "updated_at",
        ])

    return state, changes
