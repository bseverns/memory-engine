import os
import hashlib
import secrets
from datetime import timedelta
from django.conf import settings
from django.db import transaction
from django.http import FileResponse, Http404, HttpResponse
from django.shortcuts import render
from django.utils import timezone

from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response
from rest_framework import status

from .models import Node, ConsentManifest, Artifact, AccessEvent, Derivative
from .serializers import ArtifactSerializer, DerivativeSerializer
from .storage import put_bytes, stream_key, delete_key
from .tasks import generate_spectrogram

def kiosk_view(request):
    return render(request, "engine/kiosk.html", {})

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
    # Pick an ACTIVE artifact whose raw still exists and TTL not passed
    now = timezone.now()
    qs = Artifact.objects.filter(
        status=Artifact.STATUS_ACTIVE,
        expires_at__gt=now,
    ).exclude(raw_uri="").order_by("wear", "-created_at")[:25]
    art = qs.first()
    if not art:
        return Response(status=status.HTTP_204_NO_CONTENT)

    with transaction.atomic():
        art = Artifact.objects.select_for_update().get(id=art.id)
        art.play_count += 1
        art.wear = min(1.0, art.wear + float(settings.WEAR_EPSILON_PER_PLAY))
        art.last_access_at = timezone.now()
        art.save(update_fields=["play_count","wear","last_access_at"])
        AccessEvent.objects.create(artifact=art, context="kiosk", action="play")

    return Response({
        "artifact_id": art.id,
        "wear": art.wear,
        "play_count": art.play_count,
        "audio_url": f"/api/v1/blob/{art.id}/raw",
        "expires_at": art.expires_at,
    })

@api_view(["GET"])
def node_status(request):
    now = timezone.now()
    active = Artifact.objects.filter(status=Artifact.STATUS_ACTIVE, expires_at__gt=now).count()
    expired = Artifact.objects.filter(status=Artifact.STATUS_EXPIRED).count()
    revoked = Artifact.objects.filter(status=Artifact.STATUS_REVOKED).count()
    return Response({
        "active": active,
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
