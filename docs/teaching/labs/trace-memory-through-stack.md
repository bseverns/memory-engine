# Lab: Trace A Memory Through The Stack

## Goal

Follow one intake from recording to playback metadata, then through revoke or expiry posture.

## What This Proves

- the end-to-end flow from `/kiosk/` intake to `/room/` resurfacing to steward-visible lifecycle state
- where artifact bytes and metadata live at each stage
- whether revoke transitions are visible and legible to stewards

## What This Does Not Prove

- long-duration retention behavior (you need multi-day observation for that)
- real-world participant comprehension under public pressure
- speaker-routing quality on every machine

## Required Materials

- [memory-lifecycle.md](../../memory-lifecycle.md)
- [how-the-stack-works.md](../../how-the-stack-works.md)
- running local stack with `/kiosk/`, `/room/`, and `/ops/`
- one note template (shared document or lab notebook)
- ability to capture screenshots or JSON snippets

## Time

45-60 minutes

## Setup State

1. Confirm stack health with `./scripts/status.sh`.
2. Confirm `/ops/` is reachable with steward credentials.
3. Ensure playback is not paused and intake is not paused.
4. Start with a quiet test pool so one new artifact is easy to follow.

## Steps

1. Record one short artifact through `/kiosk/` using `ROOM`.
2. Confirm artifact appears in `/ops/` summary and recent artifacts.
3. Trigger room playback and confirm play count/wear movement.
4. Capture relevant node status snapshots (`/readyz`, `/api/v1/node/status`).
5. Revoke the artifact through `/revoke/` and confirm status transition.

## Expected Observations

- the artifact appears quickly in steward summaries after submit
- at least one playback event increments wear/play count signals
- revoke transitions move the artifact out of active circulation

## Common Failure Points

- autoplay or output-device blocks on the room browser
- mistaken steward state (playback paused or maintenance mode)
- revocation tested with wrong code or wrong environment

## Instructor Notes

- keep recordings short to reduce waiting and simplify evidence review
- require timestamps on every observation so sequence disputes are resolvable
- if the room never plays the new artifact, use this as a debugging exercise rather than bypassing it

## Optional Extension

- repeat the trace with `FOSSIL` and compare post-submit behavior against `ROOM`
- capture the same trace under a second deployment temperament and compare operator signals

## Student Deliverable Format

- one lifecycle trace note with timestamps
- one screenshot or JSON excerpt per major state transition
- one short explanation of where the artifact bytes and metadata lived at each stage

## Reflection Prompts

- Which transitions were most legible?
- Which required steward-only visibility?
