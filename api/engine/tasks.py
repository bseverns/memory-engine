import io
import hashlib
from datetime import timedelta
import numpy as np
from scipy.signal import spectrogram
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from celery import shared_task
from django.utils import timezone
from django.conf import settings
from django.db import transaction

from .models import Artifact, Derivative
from .storage import get_bytes, put_bytes, delete_key

def _wav_to_mono_float32(wav_bytes: bytes):
    # Minimal WAV PCM 16-bit mono decoder (for kiosk WAV output).
    # Expects RIFF/WAVE fmt + data.
    if wav_bytes[0:4] != b"RIFF" or wav_bytes[8:12] != b"WAVE":
        raise ValueError("Not a WAV file (RIFF/WAVE).")
    # Find 'fmt ' and 'data'
    i = 12
    fmt = None
    data = None
    while i + 8 <= len(wav_bytes):
        chunk_id = wav_bytes[i:i+4]
        chunk_size = int.from_bytes(wav_bytes[i+4:i+8], "little")
        chunk_data = wav_bytes[i+8:i+8+chunk_size]
        if chunk_id == b"fmt ":
            fmt = chunk_data
        elif chunk_id == b"data":
            data = chunk_data
            break
        i += 8 + chunk_size + (chunk_size % 2)
    if fmt is None or data is None:
        raise ValueError("WAV missing fmt or data chunk.")
    audio_format = int.from_bytes(fmt[0:2], "little")
    num_channels = int.from_bytes(fmt[2:4], "little")
    sample_rate = int.from_bytes(fmt[4:8], "little")
    bits_per_sample = int.from_bytes(fmt[14:16], "little")
    if audio_format != 1 or num_channels != 1 or bits_per_sample != 16:
        raise ValueError("WAV must be PCM 16-bit mono for v0.")
    samples = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
    return sample_rate, samples

@shared_task
def generate_spectrogram(artifact_id: int) -> None:
    art = Artifact.objects.get(id=artifact_id)
    if not art.raw_uri:
        return
    wav_bytes = get_bytes(art.raw_uri)
    sr, x = _wav_to_mono_float32(wav_bytes)
    f, t, Sxx = spectrogram(x, fs=sr, nperseg=1024, noverlap=768)
    # Render
    fig = plt.figure(figsize=(6, 3), dpi=150)
    ax = plt.gca()
    ax.pcolormesh(t, f, 10*np.log10(Sxx + 1e-12), shading="auto")
    ax.set_yscale("log")
    ax.set_ylim(50, min(20000, sr/2))
    ax.set_xlabel("time (s)")
    ax.set_ylabel("freq (Hz)")
    ax.set_title(f"Artifact {art.id} spectrogram")
    fig.tight_layout()
    buf = io.BytesIO()
    plt.savefig(buf, format="png")
    plt.close(fig)
    png = buf.getvalue()

    key = f"derivatives/{art.id}/spectrogram.png"
    put_bytes(key, png, "image/png")

    expires_at = timezone.now() + timedelta(days=int(settings.DERIVATIVE_TTL_DAYS_FOSSIL))
    Derivative.objects.update_or_create(
        artifact=art,
        kind="spectrogram_png",
        defaults={"uri": key, "expires_at": expires_at, "publishable": False},
    )

@shared_task
def expire_raw() -> None:
    now = timezone.now()
    qs = Artifact.objects.filter(status=Artifact.STATUS_ACTIVE, expires_at__isnull=False, expires_at__lt=now)
    for art in qs.iterator():
        if art.raw_uri:
            try:
                delete_key(art.raw_uri)
            except Exception:
                pass
        art.status = Artifact.STATUS_EXPIRED
        art.raw_uri = ""
        art.save(update_fields=["status", "raw_uri"])

    # Ephemeral safety: clean up any EPHEMERAL older than 10 minutes
    cutoff = now - timedelta(minutes=10)
    eph = Artifact.objects.filter(status=Artifact.STATUS_EPHEMERAL, created_at__lt=cutoff)
    for art in eph.iterator():
        if art.raw_uri:
            try:
                delete_key(art.raw_uri)
            except Exception:
                pass
        art.status = Artifact.STATUS_REVOKED
        art.raw_uri = ""
        art.save(update_fields=["status", "raw_uri"])

@shared_task
def prune_derivatives() -> None:
    now = timezone.now()
    qs = Derivative.objects.filter(expires_at__isnull=False, expires_at__lt=now)
    for d in qs.iterator():
        try:
            delete_key(d.uri)
        except Exception:
            pass
        d.delete()
