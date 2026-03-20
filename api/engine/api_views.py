import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.http import FileResponse, Http404
from django.utils import timezone

from rest_framework import status
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from .consent import consent_manifest, default_node_from_env, hash_token, make_revocation_token
from .models import AccessEvent, Artifact, ConsentManifest, Derivative
from .operator_auth import operator_secret_configured, operator_session_active
from .ops import disk_status, health_component_status, pool_warnings, retention_summary
from .pool import (
    artifact_age_hours,
    artifact_density,
    artifact_is_featured_return,
    artifact_lane,
    artifact_mood,
    artifact_playback_key,
    artifact_playback_window,
    playable_artifact_queryset,
    select_pool_artifact,
)
from .serializers import ArtifactSerializer, DerivativeSerializer
from .storage import delete_key, put_bytes, stream_key
from .steward import (
    load_steward_state,
    recent_steward_actions,
    record_steward_action,
    steward_state_payload,
    update_steward_state,
)
from .tasks import generate_essence_audio, generate_spectrogram


def operator_api_denied():
    if not operator_secret_configured():
        return Response({"error": "operator secret is not configured"}, status=503)
    return Response({"error": "operator authentication required"}, status=403)


def request_operator_label(request) -> str:
    forwarded_for = (request.META.get("HTTP_X_FORWARDED_FOR") or "").strip()
    remote_addr = (forwarded_for.split(",")[0].strip() if forwarded_for else request.META.get("REMOTE_ADDR", "")).strip()
    return f"operator@{remote_addr}" if remote_addr else "operator"


def parse_boolish(value) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def parse_intish(value, fallback: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return int(fallback)


def intake_suspended() -> bool:
    state = load_steward_state()
    return bool(state.maintenance_mode or state.intake_paused)


def playback_suspended() -> bool:
    state = load_steward_state()
    return bool(state.maintenance_mode or state.playback_paused)


def artifact_latest_spectrogram(artifact: Artifact, now):
    return artifact.derivative_set.filter(
        kind=Derivative.KIND_SPECTROGRAM_PNG,
    ).filter(
        expires_at__isnull=True,
    ).order_by("-created_at").first() or artifact.derivative_set.filter(
        kind=Derivative.KIND_SPECTROGRAM_PNG,
        expires_at__gt=now,
    ).order_by("-created_at").first()


@api_view(["POST"])
@parser_classes([MultiPartParser, FormParser])
def create_audio_artifact(request):
    state = load_steward_state()
    if state.maintenance_mode:
        return Response({"error": "node is in maintenance mode"}, status=423)
    if state.intake_paused:
        return Response({"error": "intake is paused by the steward"}, status=423)

    consent_mode = (request.data.get("consent_mode") or "ROOM").upper()
    if consent_mode not in ("ROOM", "FOSSIL"):
        return Response({"error": "consent_mode must be ROOM or FOSSIL for this endpoint."}, status=400)

    upload = request.data.get("file")
    if not upload:
        return Response({"error": "file required"}, status=400)

    data = upload.read()
    token = make_revocation_token()
    manifest = consent_manifest(consent_mode)
    consent = ConsentManifest.objects.create(json=manifest, revocation_token_hash=hash_token(token))
    node = default_node_from_env()

    artifact = Artifact.objects.create(
        node=node,
        consent=consent,
        status=Artifact.STATUS_ACTIVE,
        raw_sha256=hashlib.sha256(data).hexdigest(),
        expires_at=(
            timezone.now() + timedelta(days=int(manifest["retention"]["derivative_ttl_days"]))
            if consent_mode == "FOSSIL"
            else timezone.now() + timedelta(hours=int(manifest["retention"]["raw_ttl_hours"]))
        ),
        duration_ms=int(request.data.get("duration_ms") or 0),
    )

    key = f"raw/{artifact.id}/audio.wav"
    put_bytes(key, data, "audio/wav")
    artifact.raw_uri = key
    artifact.save(update_fields=["raw_uri"])

    if "spectrogram_png" in manifest.get("derive_allowed", []):
        generate_spectrogram.delay(artifact.id)
    if "essence_wav" in manifest.get("derive_allowed", []):
        generate_essence_audio.delay(artifact.id)

    return Response({
        "artifact": ArtifactSerializer(artifact).data,
        "revocation_token": token,
        "revocation_url": "/kiosk/#revoke",
    }, status=201)


@api_view(["POST"])
@parser_classes([MultiPartParser, FormParser])
def create_ephemeral_audio(request):
    state = load_steward_state()
    if state.maintenance_mode:
        return Response({"error": "node is in maintenance mode"}, status=423)
    if state.intake_paused:
        return Response({"error": "intake is paused by the steward"}, status=423)

    upload = request.data.get("file")
    if not upload:
        return Response({"error": "file required"}, status=400)

    data = upload.read()
    consent = ConsentManifest.objects.create(
        json=consent_manifest("NOSAVE"),
        revocation_token_hash=hash_token("NOSAVE"),
    )
    node = default_node_from_env()

    artifact = Artifact.objects.create(
        node=node,
        consent=consent,
        status=Artifact.STATUS_EPHEMERAL,
        raw_sha256=hashlib.sha256(data).hexdigest(),
        expires_at=timezone.now() + timedelta(minutes=5),
        duration_ms=int(request.data.get("duration_ms") or 0),
    )
    key = f"ephemeral/{artifact.id}/audio.wav"
    put_bytes(key, data, "audio/wav")
    artifact.raw_uri = key
    artifact.save(update_fields=["raw_uri"])

    consume_token = secrets.token_urlsafe(16)
    consent.json["consume_token_hash"] = hash_token(consume_token)
    consent.save(update_fields=["json"])

    return Response({
        "artifact_id": artifact.id,
        "play_url": f"/api/v1/blob/{artifact.id}/raw",
        "consume_token": consume_token,
    }, status=201)


@api_view(["POST"])
@parser_classes([JSONParser])
def consume_ephemeral(request):
    artifact_id = request.data.get("artifact_id")
    token = request.data.get("consume_token")
    if not artifact_id or not token:
        return Response({"error": "artifact_id and consume_token required"}, status=400)

    try:
        artifact = Artifact.objects.get(id=int(artifact_id))
    except Artifact.DoesNotExist:
        return Response({"error": "not found"}, status=404)

    if artifact.status != Artifact.STATUS_EPHEMERAL:
        return Response({"error": "not ephemeral"}, status=400)

    expected = artifact.consent.json.get("consume_token_hash")
    if not expected or hash_token(token) != expected:
        return Response({"error": "invalid token"}, status=403)

    if artifact.raw_uri:
        try:
            delete_key(artifact.raw_uri)
        except Exception:
            pass
    artifact.status = Artifact.STATUS_REVOKED
    artifact.raw_uri = ""
    artifact.save(update_fields=["status", "raw_uri"])
    return Response({"ok": True})


@api_view(["POST"])
@parser_classes([JSONParser])
def revoke(request):
    token = (request.data.get("token") or "").strip().upper()
    if not token:
        return Response({"error": "token required"}, status=400)

    consent = ConsentManifest.objects.filter(
        revocation_token_hash=hash_token(token),
    ).order_by("-id").first()
    if not consent:
        return Response({"error": "not found"}, status=404)

    artifacts = Artifact.objects.filter(consent=consent).exclude(status=Artifact.STATUS_REVOKED)
    for artifact in artifacts:
        if artifact.raw_uri:
            try:
                delete_key(artifact.raw_uri)
            except Exception:
                pass
        artifact.status = Artifact.STATUS_REVOKED
        artifact.raw_uri = ""
        artifact.save(update_fields=["status", "raw_uri"])
        for derivative in Derivative.objects.filter(artifact=artifact):
            try:
                delete_key(derivative.uri)
            except Exception:
                pass
            derivative.delete()
    record_steward_action(
        action="revocation.completed",
        actor=request_operator_label(request) if operator_session_active(request) else "participant",
        detail=f"Revoked {artifacts.count()} artifact(s) via receipt token.",
        payload={"revoked_artifacts": artifacts.count()},
    )
    return Response({"ok": True, "revoked_artifacts": artifacts.count()})


@api_view(["GET"])
def pool_next(request):
    if playback_suspended():
        return Response(status=status.HTTP_204_NO_CONTENT)

    now = timezone.now()
    playable_count = playable_artifact_queryset(now).count()
    requested_lane = (request.query_params.get("lane") or "any").strip().lower()
    if requested_lane not in {"any", "fresh", "mid", "worn"}:
        requested_lane = "any"
    requested_density = (request.query_params.get("density") or "any").strip().lower()
    if requested_density not in {"any", "light", "medium", "dense"}:
        requested_density = "any"
    requested_mood = (request.query_params.get("mood") or "any").strip().lower()
    if requested_mood not in {"any", "clear", "hushed", "suspended", "weathered", "gathering"}:
        requested_mood = "any"

    excluded_ids = set()
    raw_excluded_ids = (request.query_params.get("exclude_ids") or "").strip()
    if raw_excluded_ids:
        for chunk in raw_excluded_ids.split(",")[:50]:
            chunk = chunk.strip()
            if not chunk:
                continue
            try:
                excluded_ids.add(int(chunk))
            except ValueError:
                continue

    recent_densities = []
    raw_recent_densities = (request.query_params.get("recent_densities") or "").strip().lower()
    if raw_recent_densities:
        recent_densities = [
            chunk for chunk in (piece.strip() for piece in raw_recent_densities.split(",")[:6])
            if chunk in {"light", "medium", "dense"}
        ]
    segment_variant = (request.query_params.get("segment_variant") or "").strip()[:120]

    artifact, selected_lane = select_pool_artifact(
        now,
        requested_lane,
        requested_density,
        requested_mood,
        excluded_ids=excluded_ids,
        recent_densities=recent_densities,
    )
    if not artifact:
        return Response(status=status.HTTP_204_NO_CONTENT)

    age_hours = artifact_age_hours(artifact, now)
    density = artifact_density(artifact)
    mood = artifact_mood(artifact, now)
    featured_return = artifact_is_featured_return(artifact, now)
    playback_window = artifact_playback_window(artifact, now, variant=segment_variant)

    with transaction.atomic():
        artifact = Artifact.objects.select_for_update().get(id=artifact.id)
        artifact.play_count += 1
        artifact.wear = min(1.0, artifact.wear + float(settings.WEAR_EPSILON_PER_PLAY))
        artifact.last_access_at = timezone.now()
        artifact.save(update_fields=["play_count", "wear", "last_access_at"])
        AccessEvent.objects.create(artifact=artifact, context="kiosk", action="play")

    return Response({
        "artifact_id": artifact.id,
        "requested_lane": requested_lane,
        "requested_density": requested_density,
        "requested_mood": requested_mood,
        "lane": selected_lane,
        "density": density,
        "mood": mood,
        "duration_ms": artifact.duration_ms,
        "playback_start_ms": playback_window["start_ms"],
        "playback_duration_ms": playback_window["duration_ms"],
        "playback_windowed": playback_window["windowed"],
        "playback_revolution_index": playback_window["revolution_index"],
        "playback_revolution_seconds": int(settings.ROOM_SOURCE_SLICE_REVOLUTION_SECONDS),
        "age_hours": round(age_hours, 3),
        "wear": artifact.wear,
        "featured_return": featured_return,
        "play_count": artifact.play_count,
        "pool_size": playable_count,
        "audio_url": f"/api/v1/blob/{artifact.id}/raw",
        "expires_at": artifact.expires_at,
    })


@api_view(["GET"])
def healthz(request):
    ok, components = health_component_status()
    return Response(
        {
            "ok": ok,
            "components": components,
            "now": timezone.now(),
        },
        status=status.HTTP_200_OK if ok else status.HTTP_503_SERVICE_UNAVAILABLE,
    )


@api_view(["GET"])
def node_status(request):
    if not operator_session_active(request):
        return operator_api_denied()

    now = timezone.now()
    ok, components = health_component_status()
    active_qs = Artifact.objects.filter(status=Artifact.STATUS_ACTIVE, expires_at__gt=now)
    active = active_qs.count()
    expired = Artifact.objects.filter(status=Artifact.STATUS_EXPIRED).count()
    revoked = Artifact.objects.filter(status=Artifact.STATUS_REVOKED).count()
    playable_artifacts = list(playable_artifact_queryset(now).prefetch_related("derivative_set"))
    lane_counts = {"fresh": 0, "mid": 0, "worn": 0}
    mood_counts = {
        "clear": 0,
        "hushed": 0,
        "suspended": 0,
        "weathered": 0,
        "gathering": 0,
    }
    for artifact in playable_artifacts:
        lane_counts[artifact_lane(artifact, now)] += 1
        mood_counts[artifact_mood(artifact, now)] += 1

    playable_count = len(playable_artifacts)
    storage = disk_status(settings.OPS_STORAGE_PATH)
    retention = retention_summary(now=now)
    warnings = []
    operator_state = steward_state_payload()
    if operator_state["maintenance_mode"]:
        warnings.append({
            "level": "warning",
            "title": "Node is in maintenance mode",
            "detail": "Audience playback and recording intake are suspended until maintenance mode is cleared.",
        })
    if storage["state"] == "critical":
        warnings.append({
            "level": "critical",
            "title": "Storage is critically low",
            "detail": f"{storage['free_gb']} GB free ({storage['free_percent']}%).",
        })
    elif storage["state"] == "warning":
        warnings.append({
            "level": "warning",
            "title": "Storage pressure is rising",
            "detail": f"{storage['free_gb']} GB free ({storage['free_percent']}%).",
        })
    warnings.extend(pool_warnings(active, lane_counts, mood_counts, playable_count))

    return Response({
        "ok": ok,
        "components": components,
        "operator_state": operator_state,
        "active": active,
        "lanes": lane_counts,
        "moods": mood_counts,
        "playable": playable_count,
        "storage": storage,
        "retention": retention,
        "warnings": warnings,
        "expired": expired,
        "revoked": revoked,
        "now": now,
    })


@api_view(["GET"])
def surface_state(request):
    return Response({
        "operator_state": steward_state_payload(),
    })


@api_view(["GET", "POST"])
@parser_classes([JSONParser])
def operator_controls(request):
    if not operator_session_active(request):
        return operator_api_denied()

    if request.method == "GET":
        return Response({
            "operator_state": steward_state_payload(),
            "recent_actions": recent_steward_actions(),
        })

    state = load_steward_state()
    state, changes = update_steward_state(
        intake_paused=parse_boolish(request.data.get("intake_paused", state.intake_paused)),
        playback_paused=parse_boolish(request.data.get("playback_paused", state.playback_paused)),
        quieter_mode=parse_boolish(request.data.get("quieter_mode", state.quieter_mode)),
        maintenance_mode=parse_boolish(request.data.get("maintenance_mode", state.maintenance_mode)),
        mood_bias=request.data.get("mood_bias", state.mood_bias),
        kiosk_language_code=request.data.get("kiosk_language_code", state.kiosk_language_code),
        kiosk_accessibility_mode=request.data.get("kiosk_accessibility_mode", state.kiosk_accessibility_mode),
        kiosk_force_reduced_motion=parse_boolish(
            request.data.get("kiosk_force_reduced_motion", state.kiosk_force_reduced_motion),
        ),
        kiosk_max_recording_seconds=parse_intish(
            request.data.get("kiosk_max_recording_seconds", state.kiosk_max_recording_seconds or 120),
            state.kiosk_max_recording_seconds or 120,
        ),
        actor=request_operator_label(request),
    )
    return Response({
        "operator_state": steward_state_payload(state),
        "changes": changes,
        "recent_actions": recent_steward_actions(),
    })


def blob_proxy_raw(request, artifact_id: int):
    try:
        artifact = Artifact.objects.get(id=int(artifact_id))
    except Artifact.DoesNotExist:
        raise Http404("Artifact not found")
    media_key = artifact_playback_key(artifact, timezone.now())
    if not media_key:
        raise Http404("No playable audio")
    stream, content_type = stream_key(media_key)
    response = FileResponse(stream, content_type=content_type)
    response["Cache-Control"] = "no-store"
    return response


def blob_proxy_spectrogram(request, artifact_id: int):
    try:
        artifact = Artifact.objects.get(id=int(artifact_id))
    except Artifact.DoesNotExist:
        raise Http404("Artifact not found")

    derivative = artifact_latest_spectrogram(artifact, timezone.now())
    if not derivative:
        raise Http404("No spectrogram available")

    stream, content_type = stream_key(derivative.uri)
    response = FileResponse(stream, content_type=content_type)
    response["Cache-Control"] = "no-store"
    return response


@api_view(["GET"])
def list_spectrograms(request):
    queryset = Derivative.objects.filter(kind="spectrogram_png").order_by("-created_at")[:50]
    now = timezone.now()
    return Response([
        {
            **DerivativeSerializer(derivative).data,
            "image_url": f"/api/v1/blob/{derivative.artifact_id}/spectrogram",
            "is_expired": bool(derivative.expires_at and derivative.expires_at <= now),
        }
        for derivative in queryset
        if not derivative.expires_at or derivative.expires_at > now
    ])
