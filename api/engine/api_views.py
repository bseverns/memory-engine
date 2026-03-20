import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.http import FileResponse, Http404
from django.utils import timezone

from rest_framework import status
from rest_framework.decorators import api_view, parser_classes, throttle_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from .consent import consent_manifest, default_node_from_env, hash_token, make_revocation_token
from .ingest_validation import UploadValidationError, validate_wav_upload
from .media_access import (
    PURPOSE_EPHEMERAL_AUDIO,
    PURPOSE_POOL_AUDIO,
    PURPOSE_POOL_HEARD,
    PURPOSE_SPECTROGRAM_IMAGE,
    PURPOSE_SURFACE_FOSSILS,
    build_media_token,
    build_surface_token,
    media_playback_heard_url,
    media_raw_url,
    media_spectrogram_url,
    read_media_token,
    read_surface_token,
    surface_fossils_url,
)
from .models import AccessEvent, Artifact, ConsentManifest, Derivative
from .operator_auth import operator_secret_configured, operator_session_active
from .ops import component_health_warnings, disk_status, health_component_status, pool_warnings, retention_summary
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
from .throttling import (
    PublicIngestAbuseThrottle,
    PublicIngestThrottle,
    PublicRevokeAbuseThrottle,
    PublicRevokeThrottle,
    public_throttle_snapshots,
)


def operator_api_denied():
    if not operator_secret_configured():
        return Response({"error": "operator secret is not configured"}, status=503)
    return Response({"error": "operator authentication required or session no longer matches the configured binding policy"}, status=403)


def request_operator_label(request) -> str:
    forwarded_for = (request.META.get("HTTP_X_FORWARDED_FOR") or "").strip()
    remote_addr = (
        forwarded_for.split(",")[0].strip()
        if bool(getattr(settings, "TRUST_X_FORWARDED_FOR", False)) and forwarded_for
        else request.META.get("REMOTE_ADDR", "")
    ).strip()
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


def current_surface_fossils_feed_url() -> str:
    if not bool(getattr(settings, "ROOM_FOSSIL_VISUALS_ENABLED", False)):
        return ""
    return surface_fossils_url(build_surface_token(purpose=PURPOSE_SURFACE_FOSSILS))


def artifact_latest_spectrogram(artifact: Artifact, now):
    return artifact.derivative_set.filter(
        kind=Derivative.KIND_SPECTROGRAM_PNG,
    ).filter(
        expires_at__isnull=True,
    ).order_by("-created_at").first() or artifact.derivative_set.filter(
        kind=Derivative.KIND_SPECTROGRAM_PNG,
        expires_at__gt=now,
    ).order_by("-created_at").first()


def playable_artifact_or_404(artifact_id: int, now):
    artifact = Artifact.objects.prefetch_related("derivative_set").filter(id=int(artifact_id)).first()
    if not artifact:
        raise Http404("Artifact not found")
    if not playable_artifact_queryset(now).filter(id=artifact.id).exists():
        raise Http404("No playable audio")
    return artifact


def spectrogram_derivative_or_404(artifact_id: int, now):
    try:
        artifact = Artifact.objects.get(id=int(artifact_id))
    except Artifact.DoesNotExist:
        raise Http404("Artifact not found")
    if artifact.status != Artifact.STATUS_ACTIVE:
        raise Http404("No spectrogram available")
    derivative = artifact_latest_spectrogram(artifact, now)
    if not derivative:
        raise Http404("No spectrogram available")
    return artifact, derivative


def serialize_surface_spectrogram(derivative: Derivative) -> dict:
    token = build_media_token(
        purpose=PURPOSE_SPECTROGRAM_IMAGE,
        artifact_id=derivative.artifact_id,
    )
    return {
        "created_at": derivative.created_at,
        "image_url": media_spectrogram_url(token),
        "title": "Fossil drift",
    }


@api_view(["POST"])
@parser_classes([MultiPartParser, FormParser])
@throttle_classes([PublicIngestThrottle, PublicIngestAbuseThrottle])
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
    try:
        validated_upload = validate_wav_upload(
            upload,
            max_bytes=int(settings.INGEST_MAX_UPLOAD_BYTES),
            max_duration_seconds=int(settings.INGEST_MAX_DURATION_SECONDS),
        )
    except UploadValidationError as exc:
        return Response({"error": exc.message}, status=exc.status_code)
    data = validated_upload.data
    token = make_revocation_token()
    manifest = consent_manifest(consent_mode)
    node = default_node_from_env()
    key = ""
    with transaction.atomic():
        consent = ConsentManifest.objects.create(json=manifest, revocation_token_hash=hash_token(token))
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
            duration_ms=validated_upload.duration_ms,
        )

        key = f"raw/{artifact.id}/audio.wav"
        try:
            put_bytes(key, data, "audio/wav")
        except Exception:
            try:
                delete_key(key)
            except Exception:
                pass
            raise
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
@throttle_classes([PublicIngestThrottle, PublicIngestAbuseThrottle])
def create_ephemeral_audio(request):
    state = load_steward_state()
    if state.maintenance_mode:
        return Response({"error": "node is in maintenance mode"}, status=423)
    if state.intake_paused:
        return Response({"error": "intake is paused by the steward"}, status=423)

    upload = request.data.get("file")
    if not upload:
        return Response({"error": "file required"}, status=400)
    try:
        validated_upload = validate_wav_upload(
            upload,
            max_bytes=int(settings.INGEST_MAX_UPLOAD_BYTES),
            max_duration_seconds=int(settings.INGEST_MAX_DURATION_SECONDS),
        )
    except UploadValidationError as exc:
        return Response({"error": exc.message}, status=exc.status_code)
    data = validated_upload.data
    node = default_node_from_env()
    with transaction.atomic():
        consent = ConsentManifest.objects.create(
            json=consent_manifest("NOSAVE"),
            revocation_token_hash=hash_token("NOSAVE"),
        )
        artifact = Artifact.objects.create(
            node=node,
            consent=consent,
            status=Artifact.STATUS_EPHEMERAL,
            raw_sha256=hashlib.sha256(data).hexdigest(),
            expires_at=timezone.now() + timedelta(minutes=5),
            duration_ms=validated_upload.duration_ms,
        )
        key = f"ephemeral/{artifact.id}/audio.wav"
        try:
            put_bytes(key, data, "audio/wav")
        except Exception:
            try:
                delete_key(key)
            except Exception:
                pass
            raise
        artifact.raw_uri = key
        artifact.save(update_fields=["raw_uri"])

        consume_token = secrets.token_urlsafe(16)
        consent.json["consume_token_hash"] = hash_token(consume_token)
        consent.json["ephemeral_access_hash"] = hash_token(consume_token)
        consent.save(update_fields=["json"])

    return Response({
        "artifact_id": artifact.id,
        "play_url": media_raw_url(
            build_media_token(
                purpose=PURPOSE_EPHEMERAL_AUDIO,
                artifact_id=artifact.id,
                nonce=consume_token,
            ),
        ),
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
@throttle_classes([PublicRevokeThrottle, PublicRevokeAbuseThrottle])
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
    playback_ack_token = build_media_token(
        purpose=PURPOSE_POOL_HEARD,
        artifact_id=artifact.id,
        nonce=secrets.token_urlsafe(18),
    )

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
        "playback_ack_url": media_playback_heard_url(playback_ack_token),
        "audio_url": media_raw_url(
            build_media_token(
                purpose=PURPOSE_POOL_AUDIO,
                artifact_id=artifact.id,
            ),
        ),
        "expires_at": artifact.expires_at,
    })


@api_view(["POST"])
def pool_heard(request, access_token: str):
    token_payload = read_media_token(access_token)
    if not token_payload or str(token_payload.get("purpose") or "") != PURPOSE_POOL_HEARD:
        raise Http404("Playback acknowledgement not found")

    artifact_id = token_payload.get("artifact_id")
    nonce = str(token_payload.get("nonce") or "")
    if not artifact_id or not nonce:
        raise Http404("Playback acknowledgement is incomplete")

    cache_key = f"memory_engine_playback_heard:{nonce}"
    if not cache.add(cache_key, True, timeout=int(getattr(settings, "MEDIA_ACCESS_TOKEN_TTL_SECONDS", 900))):
        return Response({"ok": True, "duplicate": True})

    try:
        with transaction.atomic():
            artifact = Artifact.objects.select_for_update().get(id=int(artifact_id))
            if artifact.status == Artifact.STATUS_REVOKED:
                return Response({"ok": True, "ignored": True})
            artifact.play_count += 1
            artifact.wear = min(1.0, artifact.wear + float(settings.WEAR_EPSILON_PER_PLAY))
            artifact.last_access_at = timezone.now()
            artifact.save(update_fields=["play_count", "wear", "last_access_at"])
            AccessEvent.objects.create(artifact=artifact, context="room", action="heard")
    except Artifact.DoesNotExist:
        raise Http404("Artifact not found")

    return Response({"ok": True})


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
    throttles = public_throttle_snapshots()
    warnings = []
    operator_state = steward_state_payload()
    warnings.extend(component_health_warnings(components))
    if throttles["public_ingest"]["recent_denials"] > 0 or throttles["public_ingest_ip"]["recent_denials"] > 0:
        warnings.append({
            "level": "warning",
            "title": "Recent ingest throttling detected",
            "detail": "The recording station has recently hit its public ingest budget. Consider raising the limit for this installation if busy periods are expected.",
        })
    if throttles["public_revoke"]["recent_denials"] > 0 or throttles["public_revoke_ip"]["recent_denials"] > 0:
        warnings.append({
            "level": "warning",
            "title": "Recent revoke throttling detected",
            "detail": "Receipt revocation requests have recently hit their public rate limit.",
        })
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
        "throttles": throttles,
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


def media_proxy_raw(request, access_token: str):
    token_payload = read_media_token(access_token)
    if not token_payload:
        raise Http404("Media token not found")

    purpose = str(token_payload.get("purpose") or "")
    artifact_id = token_payload.get("artifact_id")
    if not artifact_id:
        raise Http404("Media token is incomplete")

    now = timezone.now()
    if purpose == PURPOSE_POOL_AUDIO:
        artifact = playable_artifact_or_404(int(artifact_id), now)
        media_key = artifact_playback_key(artifact, now)
        if not media_key:
            raise Http404("No playable audio")
        stream, content_type = stream_key(media_key)
    elif purpose == PURPOSE_EPHEMERAL_AUDIO:
        nonce = str(token_payload.get("nonce") or "")
        if not nonce:
            raise Http404("Media token is incomplete")
        with transaction.atomic():
            try:
                artifact = Artifact.objects.select_for_update().select_related("consent").get(id=int(artifact_id))
            except Artifact.DoesNotExist:
                raise Http404("Artifact not found")
            if artifact.status != Artifact.STATUS_EPHEMERAL or not artifact.raw_uri:
                raise Http404("No playable audio")
            expected = artifact.consent.json.get("ephemeral_access_hash")
            if not expected or hash_token(nonce) != expected:
                raise Http404("No playable audio")
            media_key = artifact.raw_uri
            stream, content_type = stream_key(media_key)
            artifact.status = Artifact.STATUS_REVOKED
            artifact.raw_uri = ""
            artifact.save(update_fields=["status", "raw_uri"])
            artifact.consent.json.pop("ephemeral_access_hash", None)
            artifact.consent.save(update_fields=["json"])
        try:
            delete_key(media_key)
        except Exception:
            pass
    else:
        raise Http404("Media token not found")

    response = FileResponse(stream, content_type=content_type)
    response["Cache-Control"] = "no-store"
    return response


def media_proxy_spectrogram(request, access_token: str):
    token_payload = read_media_token(access_token)
    if not token_payload or str(token_payload.get("purpose") or "") != PURPOSE_SPECTROGRAM_IMAGE:
        raise Http404("Media token not found")
    artifact_id = token_payload.get("artifact_id")
    if not artifact_id:
        raise Http404("Media token is incomplete")
    _, derivative = spectrogram_derivative_or_404(int(artifact_id), timezone.now())
    stream, content_type = stream_key(derivative.uri)
    response = FileResponse(stream, content_type=content_type)
    response["Cache-Control"] = "no-store"
    return response


@api_view(["GET"])
def list_spectrograms(request):
    if not operator_session_active(request):
        return operator_api_denied()

    queryset = Derivative.objects.filter(
        kind=Derivative.KIND_SPECTROGRAM_PNG,
    ).select_related("artifact").order_by("-created_at")[:50]
    now = timezone.now()
    return Response([
        {
            **DerivativeSerializer(derivative).data,
            "image_url": media_spectrogram_url(
                build_media_token(
                    purpose=PURPOSE_SPECTROGRAM_IMAGE,
                    artifact_id=derivative.artifact_id,
                ),
            ),
            "is_expired": bool(derivative.expires_at and derivative.expires_at <= now),
        }
        for derivative in queryset
        if derivative.artifact.status == Artifact.STATUS_ACTIVE
        and (not derivative.expires_at or derivative.expires_at > now)
    ])


@api_view(["GET"])
def surface_fossils(request, access_token: str):
    token_payload = read_surface_token(access_token)
    if not token_payload or str(token_payload.get("purpose") or "") != PURPOSE_SURFACE_FOSSILS:
        raise Http404("Surface feed not found")

    now = timezone.now()
    queryset = Derivative.objects.filter(
        kind=Derivative.KIND_SPECTROGRAM_PNG,
        artifact__status=Artifact.STATUS_ACTIVE,
    ).select_related("artifact").order_by("-created_at")[:12]
    return Response([
        serialize_surface_spectrogram(derivative)
        for derivative in queryset
        if not derivative.expires_at or derivative.expires_at > now
    ])


@api_view(["GET"])
def surface_fossils_feed_url(request):
    return Response({"feed_url": current_surface_fossils_feed_url()})
