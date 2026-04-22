# Presence Sensing

Presence sensing is an optional sidecar for operational awareness.

It is intentionally narrow, disabled by default, and currently treated as a steward-facing health signal only.

## Current Posture

- `PRESENCE_SENSING_ENABLED=0` is the default.
- The sensor is not part of the default compose startup path.
- Enabling it adds a camera-adjacent process to the room, so steward explanation and signage are required.
- Presence output is visible in `/readyz` and `/ops/` as a freshness/health component.
- Presence output should not drive room playback behavior until pilots establish trust and comprehension.

## What It Observes

The sidecar reads frames from a local webcam source and runs simple motion differencing (`opencv`):

- frame-to-frame luminance difference
- thresholded moving area
- a coarse `present` boolean and confidence estimate

It is a motion signal, not identity recognition.

## What It Does Not Store

The current implementation does not store:

- video frames
- audio from the camera device
- face embeddings, transcripts, or identity vectors
- person-level history

Only aggregate motion/presence state and heartbeat timing are published.

## Redis Keys And Payload

The sidecar publishes:

- `memory_engine_presence_heartbeat`: ISO-8601 timestamp of latest sensor heartbeat
- `memory_engine_presence_state`: JSON payload with:
  - `captured_at`
  - `source` (`opencv-motion`)
  - `present` (boolean)
  - `confidence` (`0.0..1.0`)
  - `motion_score` (normalized moving-area ratio)
  - optional `sensor_error` string

TTL is short-lived and tied to heartbeat freshness settings.

## How `/ops/` Uses It

- `/readyz` includes a `presence` component.
- `/ops/` surfaces stale/missing presence heartbeat as a warning when sensing is enabled.
- If sensing is disabled, presence reports as disabled rather than failed.
- Presence currently informs steward diagnostics only; it does not alter ingest or playback behavior.

## Enable And Disable

Enable:

1. Set `PRESENCE_SENSING_ENABLED=1` in `.env`.
2. Keep `PRESENCE_CAMERA_DEVICE` as a device path for compose mapping (for example `/dev/video0`).
3. Set `PRESENCE_CAMERA_SOURCE` to the OpenCV source (`/dev/video0` or `0`).
4. Start the sidecar:
   `docker compose --profile presence up -d presence_sensor`

Disable:

1. Set `PRESENCE_SENSING_ENABLED=0`.
2. Stop the sidecar:
   `docker compose --profile presence stop presence_sensor`

## Camera Config Notes

There are two related camera settings:

- `PRESENCE_CAMERA_DEVICE` is for compose `devices:` mapping and should be a host path like `/dev/video0`.
- `PRESENCE_CAMERA_SOURCE` is for OpenCV capture and can be either `/dev/video0` or an index like `0`.

If you set `PRESENCE_CAMERA_DEVICE=0`, compose device mapping can fail. Use `PRESENCE_CAMERA_SOURCE=0` while keeping `PRESENCE_CAMERA_DEVICE` as a path.

## Steward Signage And Explanation Requirements

If sensing is enabled in a public room, do not hide it. At minimum:

- add visible signage at room entry and near kiosk
- explain that sensing is motion-only and does not store frames
- explain that participation in recording remains optional
- explain where revocation and steward contact live

Recommended steward script line:

> This room uses a motion-only presence signal for system health. It does not record or store camera footage.

## Pilot Boundary

Presence sensing can easily be overread by participants.

Current policy boundary:

- allowed: steward health visibility and pilot instrumentation
- not allowed: automated participant profiling or adaptive behavior that changes room treatment per detected presence

Any shift from health-only signal to behavior-driving signal should require an explicit pilot protocol, public explanation update, and documented ethics review.

## Related Docs

- [maintenance.md](./maintenance.md)
- [how-the-stack-works.md](./how-the-stack-works.md)
- [experimental-proofs.md](./experimental-proofs.md)
- [teaching/modules/ethics-public-memory-boundaries.md](./teaching/modules/ethics-public-memory-boundaries.md)
