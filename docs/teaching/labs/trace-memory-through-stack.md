# Lab: Trace A Memory Through The Stack

## Goal

Follow one intake from recording to playback metadata, then through revoke or expiry posture.

## Prerequisites

- [memory-lifecycle.md](../../memory-lifecycle.md)
- [how-the-stack-works.md](../../how-the-stack-works.md)
- running local stack

## Time

45-60 minutes

## Steps

1. Record one short artifact through `/kiosk/` using `ROOM`.
2. Confirm artifact appears in `/ops/` summary and recent artifacts.
3. Trigger room playback and confirm play count/wear movement.
4. Capture relevant node status snapshots (`/readyz`, `/api/v1/node/status`).
5. Revoke the artifact through `/revoke/` and confirm status transition.

## Deliverables

- one lifecycle trace note with timestamps
- one screenshot or JSON excerpt per major state transition
- one short explanation of where the artifact bytes and metadata lived at each stage

## Debrief

- Which transitions were most legible?
- Which required steward-only visibility?
