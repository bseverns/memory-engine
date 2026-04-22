# Session And Focus Controls

This page defines the bounded steward controls introduced in `v1.2.2`:

- `session_theme_title`
- `session_theme_prompt`
- `deployment_focus_topic`
- `deployment_focus_status`

These controls are intentionally small. They shape framing and short-horizon attention without turning `/ops/` into a live composition console.

## What Each Field Is For

- `session_theme_title`: short steward-authored frame label shown on `/kiosk/` copy surfaces.
- `session_theme_prompt`: one additional framing line used in kiosk idle/review/prompt language.
- `deployment_focus_topic`: advisory topic hint for deployment thread follow behavior.
- `deployment_focus_status`: advisory status hint constrained by deployment-specific suggestions.

## Where Effects Apply

- `/kiosk/`:
  - session theme title/prompt augment participant-facing framing copy
  - they influence wording only; they do not alter consent routes or mode buttons
- `/room/`:
  - deployment focus topic/status are consumed only as advisory thread hints in `question` and `repair`
  - non-thread deployments ignore focus hints
- `/ops/` and `/ops/bench/`:
  - fields are editable on bench
  - both surfaces expose `Clear session framing` for close-of-day cleanup

## Does Change / Does Not Change

What these controls do change:

- kiosk framing language on this node
- advisory thread preference hints for `question` and `repair`
- steward-visible state and audit trail entries

What these controls do not change:

- ingest API routes or payload schema
- consent, retention, expiry, or revocation policy
- deployment code, profile, or room-loop safety limits
- direct playback forcing or queue pinning
- privileged host execution from `/ops/`

## Stale-State Policy

Current policy is manual clear on close, not auto-clear on logout.

Why:

- explicit end-of-day ritual is easier to audit and teach
- automatic clearing on browser/session boundaries can hide steward intent
- this keeps the behavior deterministic across lite and bench surfaces

## Close-Of-Day Ritual

1. In `/ops/` or `/ops/bench/`, use `Clear session framing`.
2. Confirm the status line reads `No session framing/focus overrides are active.`
3. Run end-of-session archive from host shell:
   - local archive:
     `./scripts/session_close_archive.sh`
   - local + USB copy:
     `./scripts/session_close_archive.sh --to-usb /absolute/mount/path`
4. Record resulting backup/export paths in steward notes.

For fuller operation context, see [maintenance.md](./maintenance.md) and [OPERATOR_DRILL_CARD.md](./OPERATOR_DRILL_CARD.md).

## Evidence Still Needed

Still requires live pilot evidence:

- whether non-author stewards consistently clear framing/focus at close
- whether deployment focus hints improve legibility without over-reading causality
- whether guided archive command flow is completed correctly under time pressure
- whether steward handoff notes capture backup/export paths reliably
