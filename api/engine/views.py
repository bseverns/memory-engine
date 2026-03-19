import os
import hashlib
import random
import secrets
import shutil
from datetime import timedelta
from django.conf import settings
from django.db import connection
from django.db import transaction
from django.db.models import Q
from django.http import FileResponse, Http404
from django.shortcuts import render
from django.utils import timezone
import redis

from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response
from rest_framework import status

from .models import Node, ConsentManifest, Artifact, AccessEvent, Derivative
from .serializers import ArtifactSerializer, DerivativeSerializer
from .storage import put_bytes, stream_key, delete_key, s3_client
from .tasks import generate_spectrogram

def kiosk_view(request):
    return render(request, "engine/kiosk.html", {
        "kiosk_config": {
            "roomIntensityProfile": settings.ROOM_INTENSITY_PROFILE,
            "roomMovementPreset": settings.ROOM_MOVEMENT_PRESET,
            "roomScarcityEnabled": bool(settings.ROOM_SCARCITY_ENABLED),
            "roomScarcityLowThreshold": int(settings.ROOM_SCARCITY_LOW_THRESHOLD),
            "roomScarcitySevereThreshold": int(settings.ROOM_SCARCITY_SEVERE_THRESHOLD),
            "roomAntiRepetitionWindowSize": int(settings.ROOM_ANTI_REPETITION_WINDOW_SIZE),
        },
    })

def operator_dashboard_view(request):
    return render(request, "engine/operator_dashboard.html", {})

def _default_node() -> Node:
    node = Node.objects.order_by("id").first()
    if not node:
        node = Node.objects.create(
            name=settings.__dict__.get("NODE_NAME", "Room Memory Node"),
            location_hint=settings.__dict__.get("NODE_LOCATION_HINT", ""),
        )
    return node

def _make_revocation_token() -> str:
    # Friendly-ish token for display, hashed in DB
    raw = secrets.token_urlsafe(8)
    token = raw.replace("-", "").replace("_", "")[:10].upper()
    return token

def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()

def _health_component_status() -> tuple[bool, dict]:
    components = {}

    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        components["database"] = {"ok": True}
    except Exception as exc:
        components["database"] = {"ok": False, "error": str(exc)}

    try:
        redis.Redis.from_url(settings.CELERY_BROKER_URL).ping()
        components["redis"] = {"ok": True}
    except Exception as exc:
        components["redis"] = {"ok": False, "error": str(exc)}

    try:
        s3_client().head_bucket(Bucket=settings.MINIO_BUCKET)
        components["storage"] = {"ok": True}
    except Exception as exc:
        components["storage"] = {"ok": False, "error": str(exc)}

    ok = all(component["ok"] for component in components.values())
    return ok, components

def _disk_status(path: str) -> dict:
    total_bytes, used_bytes, free_bytes = shutil.disk_usage(path)
    total_gb = total_bytes / (1024 ** 3)
    free_gb = free_bytes / (1024 ** 3)
    used_percent = 0.0 if total_bytes <= 0 else (used_bytes / total_bytes) * 100.0
    free_percent = 0.0 if total_bytes <= 0 else (free_bytes / total_bytes) * 100.0

    state = "ready"
    if (
        free_gb <= float(settings.OPS_DISK_CRITICAL_FREE_GB)
        or free_percent <= float(settings.OPS_DISK_CRITICAL_FREE_PERCENT)
    ):
        state = "critical"
    elif (
        free_gb <= float(settings.OPS_DISK_WARNING_FREE_GB)
        or free_percent <= float(settings.OPS_DISK_WARNING_FREE_PERCENT)
    ):
        state = "warning"

    return {
        "path": path,
        "state": state,
        "total_gb": round(total_gb, 2),
        "free_gb": round(free_gb, 2),
        "used_percent": round(used_percent, 1),
        "free_percent": round(free_percent, 1),
    }

def _pool_warnings(active_count: int, lane_counts: dict, mood_counts: dict, playable_count: int) -> list[dict]:
    warnings = []

    if active_count <= int(settings.OPS_POOL_LOW_COUNT):
        warnings.append({
            "level": "warning",
            "title": "Playback pool is running low",
            "detail": f"Only {active_count} active sounds are available right now.",
        })

    if playable_count <= 0:
        warnings.append({
            "level": "critical",
            "title": "No playable sounds are available",
            "detail": "The room loop has nothing eligible to play from the current pool.",
        })
        return warnings

    imbalance_ratio = float(settings.OPS_POOL_IMBALANCE_RATIO)

    for lane, count in lane_counts.items():
        if count == 0 and playable_count >= 4:
            warnings.append({
                "level": "warning",
                "title": f"{lane.title()} lane is empty",
                "detail": "The room may feel flatter because one playback lane has no playable material.",
            })
        elif playable_count >= 6 and (count / playable_count) >= imbalance_ratio:
            warnings.append({
                "level": "warning",
                "title": f"{lane.title()} lane is dominating the pool",
                "detail": f"{count} of {playable_count} playable sounds are currently classified as {lane}.",
            })

    for mood, count in mood_counts.items():
        if count == 0 and playable_count >= 6:
            warnings.append({
                "level": "warning",
                "title": f"{mood.title()} mood is missing",
                "detail": "The room's compositional palette is narrowed because one mood has no playable material.",
            })
        elif playable_count >= 8 and (count / playable_count) >= imbalance_ratio:
            warnings.append({
                "level": "warning",
                "title": f"{mood.title()} mood is heavily overrepresented",
                "detail": f"{count} of {playable_count} playable sounds currently cluster in that mood.",
            })

    return warnings

def _artifact_age_hours(artifact: Artifact, now) -> float:
    return max(0.0, (now - artifact.created_at).total_seconds() / 3600.0)

def _pool_weight(artifact: Artifact, now, cooldown_seconds: int, preferred_mood: str = "any") -> float:
    # Favor material that has rested for a while, but keep older / more played
    # memories in circulation so the room does not feel like a pure "latest wins"
    # feed.
    seconds_since_access = cooldown_seconds * 4
    if artifact.last_access_at:
        seconds_since_access = max(0.0, (now - artifact.last_access_at).total_seconds())

    age_hours = _artifact_age_hours(artifact, now)
    cooldown_factor = min(3.0, 1.0 + (seconds_since_access / max(1, cooldown_seconds)))
    rarity_factor = 1.0 / (1.0 + (artifact.play_count * 0.45))
    wear_factor = max(0.45, 1.15 - (artifact.wear * 0.55))
    # Keep brand-new material from dominating immediately, favor memories that
    # have had time to settle into the room, and gently taper very old material
    # so the loop keeps circulating instead of fossilizing.
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

    mood = _artifact_mood(artifact, now)
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

    return max(0.1, cooldown_factor * rarity_factor * wear_factor * age_factor * mood_factor)

def _artifact_lane(artifact: Artifact, now) -> str:
    # The playback lanes are a simple age/wear dramaturgy:
    # fresh = recently offered, worn = repeatedly heard or aged, mid = in between.
    age_hours = _artifact_age_hours(artifact, now)

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

def _artifact_density(artifact: Artifact) -> str:
    duration_seconds = max(0.0, artifact.duration_ms / 1000.0)

    if duration_seconds >= 20 or artifact.wear >= 0.55:
        return "dense"
    if duration_seconds <= 8 and artifact.wear <= 0.22:
        return "light"
    return "medium"

def _artifact_mood(artifact: Artifact, now) -> str:
    # "Mood" is intentionally derived from coarse metadata only. It is not meant
    # to classify semantic content, just to give the browser loop a light
    # compositional vocabulary.
    lane = _artifact_lane(artifact, now)
    density = _artifact_density(artifact)
    age_hours = _artifact_age_hours(artifact, now)

    if lane == "fresh" and density == "dense":
        return "gathering"
    if lane == "fresh" and density in {"light", "medium"}:
        return "clear"
    if lane == "worn" and density in {"medium", "dense"}:
        return "weathered"
    if density == "light" and age_hours >= 6:
        return "hushed"
    return "suspended"

def _select_pool_artifact(
    now,
    preferred_lane: str = "any",
    preferred_density: str = "any",
    preferred_mood: str = "any",
    excluded_ids: set[int] | None = None,
):
    cooldown_seconds = max(1, int(settings.POOL_PLAY_COOLDOWN_SECONDS))
    cooldown_threshold = now - timedelta(seconds=cooldown_seconds)
    candidate_limit = max(5, int(settings.POOL_CANDIDATE_LIMIT))

    base_qs = Artifact.objects.filter(
        status=Artifact.STATUS_ACTIVE,
        expires_at__gt=now,
    ).exclude(raw_uri="")
    preferred_base_qs = base_qs
    if excluded_ids:
        preferred_base_qs = preferred_base_qs.exclude(id__in=excluded_ids)

    cooldown_qs = preferred_base_qs.filter(
        Q(last_access_at__isnull=True) | Q(last_access_at__lt=cooldown_threshold)
    )
    candidates = list(cooldown_qs.order_by("play_count", "wear", "-created_at")[:candidate_limit])
    if not candidates:
        candidates = list(preferred_base_qs.order_by("last_access_at", "play_count", "wear", "-created_at")[:candidate_limit])
    if not candidates and excluded_ids:
        cooldown_qs = base_qs.filter(
            Q(last_access_at__isnull=True) | Q(last_access_at__lt=cooldown_threshold)
        )
        candidates = list(cooldown_qs.order_by("play_count", "wear", "-created_at")[:candidate_limit])
        if not candidates:
            candidates = list(base_qs.order_by("last_access_at", "play_count", "wear", "-created_at")[:candidate_limit])
    if not candidates:
        return None, None

    if preferred_lane in {"fresh", "mid", "worn"}:
        lane_candidates = [artifact for artifact in candidates if _artifact_lane(artifact, now) == preferred_lane]
        if lane_candidates:
            candidates = lane_candidates

    if preferred_density in {"light", "medium", "dense"}:
        density_candidates = [artifact for artifact in candidates if _artifact_density(artifact) == preferred_density]
        if density_candidates:
            candidates = density_candidates

    if preferred_mood in {"clear", "hushed", "suspended", "weathered", "gathering"}:
        mood_candidates = [artifact for artifact in candidates if _artifact_mood(artifact, now) == preferred_mood]
        if mood_candidates:
            candidates = mood_candidates

    # Weighted randomness keeps the room feeling curated rather than deterministic
    # while still respecting cooldown and lane/density requests from the kiosk.
    weights = [_pool_weight(artifact, now, cooldown_seconds, preferred_mood) for artifact in candidates]
    selected = random.choices(candidates, weights=weights, k=1)[0]
    return selected, _artifact_lane(selected, now)

def _consent_manifest(consent_mode: str) -> dict:
    # Local-first v0: nothing is public.
    if consent_mode == "ROOM":
        return {
            "mode": "ROOM",
            "capture": {"audio": True},
            "publish": {"raw": False, "derivatives": False},
            "derive_allowed": [],
            "retention": {"raw_ttl_hours": settings.RAW_TTL_HOURS_ROOM, "derivative_ttl_days": 0},
            "revocation": {"allowed": True},
        }
    if consent_mode == "FOSSIL":
        return {
            "mode": "FOSSIL",
            "capture": {"audio": True},
            "publish": {"raw": False, "derivatives": False},
            "derive_allowed": ["spectrogram_png"],
            "retention": {"raw_ttl_hours": settings.RAW_TTL_HOURS_FOSSIL, "derivative_ttl_days": settings.DERIVATIVE_TTL_DAYS_FOSSIL},
            "revocation": {"allowed": True},
        }
    if consent_mode == "NOSAVE":
        return {
            "mode": "NOSAVE",
            "capture": {"audio": True},
            "publish": {"raw": False, "derivatives": False},
            "derive_allowed": [],
            "retention": {"raw_ttl_hours": 0, "derivative_ttl_days": 0},
            "revocation": {"allowed": False},
        }
    return {"mode": "ROOM"}

@api_view(["POST"])
@parser_classes([MultiPartParser, FormParser])
def create_audio_artifact(request):
    consent_mode = (request.data.get("consent_mode") or "ROOM").upper()
    if consent_mode not in ("ROOM", "FOSSIL"):
        return Response({"error": "consent_mode must be ROOM or FOSSIL for this endpoint."}, status=400)

    f = request.data.get("file")
    if not f:
        return Response({"error": "file required"}, status=400)

    data = f.read()
    sha = hashlib.sha256(data).hexdigest()

    token = _make_revocation_token()
    manifest = _consent_manifest(consent_mode)
    cm = ConsentManifest.objects.create(json=manifest, revocation_token_hash=_hash_token(token))

    node = Node.objects.order_by("id").first()
    if not node:
        node = Node.objects.create(name=os.getenv("NODE_NAME","Room Memory Node"), location_hint=os.getenv("NODE_LOCATION_HINT",""))

    expires_at = timezone.now() + timedelta(hours=int(manifest["retention"]["raw_ttl_hours"]))
    art = Artifact.objects.create(
        node=node,
        consent=cm,
        status=Artifact.STATUS_ACTIVE,
        raw_sha256=sha,
        expires_at=expires_at,
        duration_ms=int(request.data.get("duration_ms") or 0),
    )

    key = f"raw/{art.id}/audio.wav"
    put_bytes(key, data, "audio/wav")
    art.raw_uri = key
    art.save(update_fields=["raw_uri"])

    # Derivatives (async)
    if "spectrogram_png" in manifest.get("derive_allowed", []):
        generate_spectrogram.delay(art.id)

    return Response({
        "artifact": ArtifactSerializer(art).data,
        "revocation_token": token,
        "revocation_url": "/kiosk/#revoke",
    }, status=201)

@api_view(["POST"])
@parser_classes([MultiPartParser, FormParser])
def create_ephemeral_audio(request):
    # "Don't save": play once immediately, then discard.
    f = request.data.get("file")
    if not f:
        return Response({"error": "file required"}, status=400)
    data = f.read()
    sha = hashlib.sha256(data).hexdigest()

    manifest = _consent_manifest("NOSAVE")
    cm = ConsentManifest.objects.create(json=manifest, revocation_token_hash=_hash_token("NOSAVE"))

    node = Node.objects.order_by("id").first()
    if not node:
        node = Node.objects.create(name=os.getenv("NODE_NAME","Room Memory Node"), location_hint=os.getenv("NODE_LOCATION_HINT",""))

    art = Artifact.objects.create(
        node=node,
        consent=cm,
        status=Artifact.STATUS_EPHEMERAL,
        raw_sha256=sha,
        expires_at=timezone.now() + timedelta(minutes=5),
        duration_ms=int(request.data.get("duration_ms") or 0),
    )
    key = f"ephemeral/{art.id}/audio.wav"
    put_bytes(key, data, "audio/wav")
    art.raw_uri = key
    art.save(update_fields=["raw_uri"])

    consume_token = secrets.token_urlsafe(16)
    # Store consume token hash in consent json (v0 simple)
    cm.json["consume_token_hash"] = _hash_token(consume_token)
    cm.save(update_fields=["json"])

    return Response({
        "artifact_id": art.id,
        "play_url": f"/api/v1/blob/{art.id}/raw",
        "consume_token": consume_token,
    }, status=201)

@api_view(["POST"])
@parser_classes([JSONParser])
def consume_ephemeral(request):
    art_id = request.data.get("artifact_id")
    token = request.data.get("consume_token")
    if not art_id or not token:
        return Response({"error": "artifact_id and consume_token required"}, status=400)
    try:
        art = Artifact.objects.get(id=int(art_id))
    except Artifact.DoesNotExist:
        return Response({"error": "not found"}, status=404)
    if art.status != Artifact.STATUS_EPHEMERAL:
        return Response({"error": "not ephemeral"}, status=400)
    expected = art.consent.json.get("consume_token_hash")
    if not expected or _hash_token(token) != expected:
        return Response({"error": "invalid token"}, status=403)

    # Delete immediately
    if art.raw_uri:
        try:
            delete_key(art.raw_uri)
        except Exception:
            pass
    art.status = Artifact.STATUS_REVOKED
    art.raw_uri = ""
    art.save(update_fields=["status", "raw_uri"])
    return Response({"ok": True})

@api_view(["POST"])
@parser_classes([JSONParser])
def revoke(request):
    token = (request.data.get("token") or "").strip().upper()
    if not token:
        return Response({"error": "token required"}, status=400)
    token_hash = _hash_token(token)
    cm = ConsentManifest.objects.filter(revocation_token_hash=token_hash).order_by("-id").first()
    if not cm:
        return Response({"error": "not found"}, status=404)

    # Revoke all artifacts under this manifest
    arts = Artifact.objects.filter(consent=cm).exclude(status=Artifact.STATUS_REVOKED)
    for art in arts:
        if art.raw_uri:
            try:
                delete_key(art.raw_uri)
            except Exception:
                pass
        art.status = Artifact.STATUS_REVOKED
        art.raw_uri = ""
        art.save(update_fields=["status","raw_uri"])
        # delete derivatives too (v0 conservative)
        for d in Derivative.objects.filter(artifact=art):
            try:
                delete_key(d.uri)
            except Exception:
                pass
            d.delete()
    return Response({"ok": True, "revoked_artifacts": arts.count()})

@api_view(["GET"])
def pool_next(request):
    now = timezone.now()
    playable_count = Artifact.objects.filter(
        status=Artifact.STATUS_ACTIVE,
        expires_at__gt=now,
    ).exclude(raw_uri="").count()
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

    art, selected_lane = _select_pool_artifact(
        now,
        requested_lane,
        requested_density,
        requested_mood,
        excluded_ids=excluded_ids,
    )
    if not art:
        return Response(status=status.HTTP_204_NO_CONTENT)

    age_hours = _artifact_age_hours(art, now)
    density = _artifact_density(art)
    mood = _artifact_mood(art, now)

    with transaction.atomic():
        # Wear advances only when something is actually served into the room, so
        # the perceived aging of a memory stays tied to audience exposure.
        art = Artifact.objects.select_for_update().get(id=art.id)
        art.play_count += 1
        art.wear = min(1.0, art.wear + float(settings.WEAR_EPSILON_PER_PLAY))
        art.last_access_at = timezone.now()
        art.save(update_fields=["play_count","wear","last_access_at"])
        AccessEvent.objects.create(artifact=art, context="kiosk", action="play")

    return Response({
        "artifact_id": art.id,
        "requested_lane": requested_lane,
        "requested_density": requested_density,
        "requested_mood": requested_mood,
        "lane": selected_lane,
        "density": density,
        "mood": mood,
        "duration_ms": art.duration_ms,
        "age_hours": round(age_hours, 3),
        "wear": art.wear,
        "play_count": art.play_count,
        "pool_size": playable_count,
        "audio_url": f"/api/v1/blob/{art.id}/raw",
        "expires_at": art.expires_at,
    })

@api_view(["GET"])
def healthz(request):
    ok, components = _health_component_status()
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
    now = timezone.now()
    ok, components = _health_component_status()
    active_qs = Artifact.objects.filter(status=Artifact.STATUS_ACTIVE, expires_at__gt=now)
    active = active_qs.count()
    expired = Artifact.objects.filter(status=Artifact.STATUS_EXPIRED).count()
    revoked = Artifact.objects.filter(status=Artifact.STATUS_REVOKED).count()
    playable_artifacts = list(active_qs.exclude(raw_uri=""))
    lane_counts = {"fresh": 0, "mid": 0, "worn": 0}
    mood_counts = {
        "clear": 0,
        "hushed": 0,
        "suspended": 0,
        "weathered": 0,
        "gathering": 0,
    }
    for artifact in playable_artifacts:
        lane_counts[_artifact_lane(artifact, now)] += 1
        mood_counts[_artifact_mood(artifact, now)] += 1

    playable_count = len(playable_artifacts)
    storage = _disk_status(settings.OPS_STORAGE_PATH)
    warnings = []
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
    warnings.extend(_pool_warnings(active, lane_counts, mood_counts, playable_count))

    return Response({
        "ok": ok,
        "components": components,
        "active": active,
        "lanes": lane_counts,
        "moods": mood_counts,
        "playable": playable_count,
        "storage": storage,
        "warnings": warnings,
        "expired": expired,
        "revoked": revoked,
        "now": now,
    })

def blob_proxy_raw(request, artifact_id: int):
    try:
        art = Artifact.objects.get(id=int(artifact_id))
    except Artifact.DoesNotExist:
        raise Http404("Artifact not found")
    if not art.raw_uri:
        raise Http404("No raw blob")
    stream, content_type = stream_key(art.raw_uri)
    resp = FileResponse(stream, content_type=content_type)
    resp["Cache-Control"] = "no-store"
    return resp

@api_view(["GET"])
def list_spectrograms(request):
    qs = Derivative.objects.filter(kind="spectrogram_png").order_by("-created_at")[:50]
    return Response(DerivativeSerializer(qs, many=True).data)
