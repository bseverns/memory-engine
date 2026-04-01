# First-Day Packet

This is the compact staff-facing packet for a first steward or facilitator.

Use it on opening day, soft pilots, or any handoff where the full runbook would be too much to hold in the moment.

## What This Machine Is

- `Memory Engine` is the project and the machine
- `Room Memory` is the public-facing recording and listening language
- one screen records at `/kiosk/`
- one screen listens at `/room/`
- one steward surface tends the machine at `/ops/`
- participants can remove saved recordings later at `/revoke/` on this node with the receipt code

## Opening Sequence

1. Run `./scripts/status.sh`.
2. Run `./scripts/doctor.sh`.
3. Open `/ops/` and confirm the node is healthy enough to open.
4. Run the output tone.
5. Run live monitor only if the steward machine's routing is in doubt.
6. Open `/kiosk/`, `/room/`, and `/revoke/`.
7. Confirm intake and playback are not paused by mistake.

## What To Say To Participants

Use the short truthful version:

- `Room Memory` stays on this device for about 48 hours and can be revoked later on this node with the receipt code.
- `Fossil Only` lets the raw recording fade sooner while a local image or audio residue may remain longer.
- `Don't Save` plays once and is then discarded from the device.
- memory color changes how a recording leans when it returns in playback; it does not replace the stored original recording.
- nothing is published from the machine by default.

## If Something Feels Wrong

### Dead kiosk

- check browser focus and microphone permission first
- check `/ops/` for maintenance mode or intake pause
- only then assume hardware drift

### Quiet room

- check `/ops/` for playback pause, warnings, or a small pool
- confirm the room machine's output path directly
- do not mistake the steward-browser monitor check for proof of the room machine

### Participant wants something removed

- if they have the receipt code, use `/revoke/`
- if something needs to leave circulation immediately, a steward can use `Remove from stack` in `/ops/`

## End Of Day

1. Confirm no one is still recording.
2. Check `/ops/` for critical warnings.
3. Run a backup or export if the day calls for it.
4. Leave a short handoff note for the next steward.

## Read These Next

- [OPERATOR_DRILL_CARD.md](./OPERATOR_DRILL_CARD.md)
- [participant-prompt-card.md](./participant-prompt-card.md)
- [maintenance.md](./maintenance.md)
- [HANDOFF_REHEARSAL.md](./HANDOFF_REHEARSAL.md)
