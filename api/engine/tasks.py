import io
import hashlib
from datetime import timedelta
import numpy as np
from scipy.signal import butter, resample, sosfiltfilt, spectrogram
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from celery import shared_task
from django.utils import timezone
from django.conf import settings
from django.db import transaction

from .models import Artifact, Derivative
from .storage import get_bytes, put_bytes, delete_key

ESSENCE_SAMPLE_RATE = 12000
ESSENCE_DURATION_SECONDS = 8
ESSENCE_LOW_PASS_HZ = 2200
ESSENCE_TARGET_PEAK = 0.28
ESSENCE_ENVELOPE_WINDOW = 601

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


def _float32_to_wav_mono16(sample_rate: int, samples: np.ndarray) -> bytes:
    clipped = np.clip(samples, -1.0, 1.0)
    pcm = (clipped * 32767.0).astype(np.int16)
    data = pcm.tobytes()
    buffer = io.BytesIO()
    buffer.write(b"RIFF")
    buffer.write((36 + len(data)).to_bytes(4, "little"))
    buffer.write(b"WAVE")
    buffer.write(b"fmt ")
    buffer.write((16).to_bytes(4, "little"))
    buffer.write((1).to_bytes(2, "little"))  # PCM
    buffer.write((1).to_bytes(2, "little"))  # mono
    buffer.write(int(sample_rate).to_bytes(4, "little"))
    byte_rate = sample_rate * 2
    buffer.write(byte_rate.to_bytes(4, "little"))
    buffer.write((2).to_bytes(2, "little"))  # block align
    buffer.write((16).to_bytes(2, "little"))
    buffer.write(b"data")
    buffer.write(len(data).to_bytes(4, "little"))
    buffer.write(data)
    return buffer.getvalue()


def _essence_from_samples(sample_rate: int, samples: np.ndarray) -> tuple[int, np.ndarray]:
    if samples.size == 0:
        return ESSENCE_SAMPLE_RATE, np.zeros(ESSENCE_SAMPLE_RATE * ESSENCE_DURATION_SECONDS, dtype=np.float32)

    target_length = ESSENCE_SAMPLE_RATE * ESSENCE_DURATION_SECONDS
    if sample_rate != ESSENCE_SAMPLE_RATE:
        working = resample(samples, max(1, int(round(samples.size * (ESSENCE_SAMPLE_RATE / sample_rate))))).astype(np.float32)
    else:
        working = samples.astype(np.float32, copy=True)

    nyquist = ESSENCE_SAMPLE_RATE / 2.0
    cutoff = min(ESSENCE_LOW_PASS_HZ, nyquist * 0.94)
    sos = butter(4, cutoff / nyquist, btype="lowpass", output="sos")
    filtered = sosfiltfilt(sos, working)

    if filtered.size != target_length:
        contour = resample(filtered, target_length).astype(np.float32)
    else:
        contour = filtered.astype(np.float32, copy=True)

    envelope = np.abs(contour)
    window = np.ones(ESSENCE_ENVELOPE_WINDOW, dtype=np.float32) / ESSENCE_ENVELOPE_WINDOW
    smoothed_envelope = np.convolve(envelope, window, mode="same")
    if np.max(smoothed_envelope) > 1e-6:
        smoothed_envelope = smoothed_envelope / np.max(smoothed_envelope)

    spectral_source = contour - np.mean(contour)
    spectrum = np.abs(np.fft.rfft(spectral_source))
    if np.max(spectrum) > 1e-6:
        spectrum = spectrum / np.max(spectrum)

    noise = np.random.normal(0.0, 1.0, target_length).astype(np.float32)
    shaped = np.fft.irfft(np.fft.rfft(noise) * np.maximum(0.08, spectrum), n=target_length).astype(np.float32)
    shaped *= (0.18 + (smoothed_envelope * 0.82))

    fade_samples = min(target_length // 8, ESSENCE_SAMPLE_RATE // 2)
    if fade_samples > 0:
        ramp = np.linspace(0.0, 1.0, fade_samples, dtype=np.float32)
        shaped[:fade_samples] *= ramp
        shaped[-fade_samples:] *= ramp[::-1]

    peak = float(np.max(np.abs(shaped)))
    if peak > 1e-6:
        shaped *= (ESSENCE_TARGET_PEAK / peak)

    return ESSENCE_SAMPLE_RATE, shaped.astype(np.float32)

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
        kind=Derivative.KIND_SPECTROGRAM_PNG,
        defaults={"uri": key, "expires_at": expires_at, "publishable": False},
    )


@shared_task
def generate_essence_audio(artifact_id: int) -> None:
    art = Artifact.objects.get(id=artifact_id)
    if not art.raw_uri:
        return

    wav_bytes = get_bytes(art.raw_uri)
    sample_rate, samples = _wav_to_mono_float32(wav_bytes)
    essence_rate, essence_samples = _essence_from_samples(sample_rate, samples)
    essence_wav = _float32_to_wav_mono16(essence_rate, essence_samples)

    key = f"derivatives/{art.id}/essence.wav"
    put_bytes(key, essence_wav, "audio/wav")

    expires_at = timezone.now() + timedelta(days=int(settings.DERIVATIVE_TTL_DAYS_FOSSIL))
    Derivative.objects.update_or_create(
        artifact=art,
        kind=Derivative.KIND_ESSENCE_WAV,
        defaults={"uri": key, "expires_at": expires_at, "publishable": False},
    )

@shared_task
def expire_raw() -> None:
    now = timezone.now()
    qs = Artifact.objects.filter(status=Artifact.STATUS_ACTIVE)
    for art in qs.iterator():
        retention = art.consent.json.get("retention", {}) if art.consent_id else {}
        raw_ttl_hours = int(retention.get("raw_ttl_hours") or 0)
        raw_expired = raw_ttl_hours <= 0 or (art.created_at + timedelta(hours=raw_ttl_hours)) < now
        if raw_expired and art.raw_uri:
            try:
                delete_key(art.raw_uri)
            except Exception:
                pass
            art.raw_uri = ""

        essence_exists = Derivative.objects.filter(
            artifact=art,
            kind=Derivative.KIND_ESSENCE_WAV,
            expires_at__gt=now,
        ).exists()

        if art.expires_at and art.expires_at < now:
            art.status = Artifact.STATUS_EXPIRED
            art.raw_uri = ""
        elif not art.raw_uri and not essence_exists:
            art.status = Artifact.STATUS_EXPIRED

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
