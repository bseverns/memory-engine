from __future__ import annotations

from dataclasses import dataclass


ACCEPTED_WAV_CONTENT_TYPES = {
    "audio/wav",
    "audio/wave",
    "audio/x-wav",
    "audio/vnd.wave",
    "application/octet-stream",
}


class UploadValidationError(Exception):
    def __init__(self, message: str, *, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = int(status_code)


@dataclass(frozen=True)
class ValidatedWavUpload:
    data: bytes
    duration_ms: int
    sample_rate: int
    frame_count: int


def validate_wav_upload(upload, *, max_bytes: int, max_duration_seconds: int) -> ValidatedWavUpload:
    if upload is None:
        raise UploadValidationError("file required", status_code=400)

    content_type = str(getattr(upload, "content_type", "") or "").strip().lower()
    if content_type and content_type not in ACCEPTED_WAV_CONTENT_TYPES:
        raise UploadValidationError("Uploaded audio must be a WAV file.", status_code=415)

    declared_size = getattr(upload, "size", None)
    if declared_size is not None and int(declared_size) > int(max_bytes):
        raise UploadValidationError(
            f"Uploaded audio exceeds the {int(max_bytes)} byte limit.",
            status_code=413,
        )

    try:
        upload.seek(0)
    except (AttributeError, OSError):
        pass
    data = upload.read(int(max_bytes) + 1)
    if len(data) > int(max_bytes):
        raise UploadValidationError(
            f"Uploaded audio exceeds the {int(max_bytes)} byte limit.",
            status_code=413,
        )

    sample_rate, frame_count, duration_ms = inspect_pcm16_mono_wav(data)
    max_duration_ms = int(max_duration_seconds) * 1000
    if duration_ms <= 0:
        raise UploadValidationError("Uploaded audio must contain at least one sample.", status_code=400)
    if duration_ms > max_duration_ms:
        raise UploadValidationError(
            f"Uploaded audio exceeds the {int(max_duration_seconds)} second limit.",
            status_code=413,
        )

    return ValidatedWavUpload(
        data=data,
        duration_ms=duration_ms,
        sample_rate=sample_rate,
        frame_count=frame_count,
    )


def inspect_pcm16_mono_wav(wav_bytes: bytes) -> tuple[int, int, int]:
    if wav_bytes[0:4] != b"RIFF" or wav_bytes[8:12] != b"WAVE":
        raise UploadValidationError("Uploaded audio must be a RIFF/WAVE file.", status_code=400)

    index = 12
    fmt = None
    data = None
    while index + 8 <= len(wav_bytes):
        chunk_id = wav_bytes[index:index + 4]
        chunk_size = int.from_bytes(wav_bytes[index + 4:index + 8], "little")
        chunk_data = wav_bytes[index + 8:index + 8 + chunk_size]
        if len(chunk_data) != chunk_size:
            raise UploadValidationError("Uploaded audio is truncated.", status_code=400)
        if chunk_id == b"fmt ":
            fmt = chunk_data
        elif chunk_id == b"data":
            data = chunk_data
            break
        index += 8 + chunk_size + (chunk_size % 2)

    if fmt is None or data is None:
        raise UploadValidationError("Uploaded WAV is missing fmt or data chunks.", status_code=400)
    if len(fmt) < 16:
        raise UploadValidationError("Uploaded WAV has an incomplete fmt chunk.", status_code=400)

    audio_format = int.from_bytes(fmt[0:2], "little")
    num_channels = int.from_bytes(fmt[2:4], "little")
    sample_rate = int.from_bytes(fmt[4:8], "little")
    block_align = int.from_bytes(fmt[12:14], "little")
    bits_per_sample = int.from_bytes(fmt[14:16], "little")

    if audio_format != 1:
        raise UploadValidationError("Uploaded WAV must use PCM encoding.", status_code=400)
    if num_channels != 1:
        raise UploadValidationError("Uploaded WAV must be mono.", status_code=400)
    if bits_per_sample != 16:
        raise UploadValidationError("Uploaded WAV must be 16-bit.", status_code=400)
    if sample_rate <= 0 or sample_rate > 96000:
        raise UploadValidationError("Uploaded WAV has an unsupported sample rate.", status_code=400)

    expected_block_align = num_channels * (bits_per_sample // 8)
    if block_align != expected_block_align or block_align <= 0:
        raise UploadValidationError("Uploaded WAV has an invalid block alignment.", status_code=400)
    if len(data) % block_align != 0:
        raise UploadValidationError("Uploaded WAV data chunk is misaligned.", status_code=400)

    frame_count = len(data) // block_align
    duration_ms = int(round((frame_count / sample_rate) * 1000)) if frame_count else 0
    return sample_rate, frame_count, duration_ms
