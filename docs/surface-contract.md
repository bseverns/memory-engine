# Surface Contract

This document is the shortest explicit contract for the three browser surfaces:
`/kiosk/`, `/room/`, and `/ops/`.

Its purpose is to prevent drift. When a change lands in one layer, this file
should make it obvious whether the browser, Django, or steward state is meant
to own that behavior.

## Source layers

There are four practical sources of truth in the stack:

1. Boot-time settings
   Environment-backed Django settings and static room config resolved on the
   server before a page is rendered.
2. Steward state
   The live singleton posture controlled from `/ops/`, exposed publicly through
   `/api/v1/surface/state` and privately through `/api/v1/operator/controls`.
3. Pool payloads
   Per-selection playback decisions returned by `/api/v1/pool/next`.
4. Local browser state
   Transient interaction state such as which panel is open, what the current
   countdown token is, or which spectrogram image is showing right now.

The browser should not invent policy that belongs to the first three layers.

## `/kiosk/`

The recording kiosk may assume:

- `kiosk_config` contains static install-time posture such as:
  - default language
  - default max recording length
  - room loop config needed by the embedded playback controller
- `/api/v1/surface/state` contains live steward posture such as:
  - `intake_paused`
  - `maintenance_mode`
  - `kiosk_language_code`
  - `kiosk_accessibility_mode`
  - `kiosk_force_reduced_motion`
  - `kiosk_max_recording_seconds`
- artifact save endpoints are the source of truth for whether a submission is
  accepted

The recording kiosk must not assume:

- that a local UI mode choice changes retention policy by itself
- that intake is allowed just because the page rendered
- that a playback artifact exists or is eligible without asking the API
- that operator auth state is available on this surface

## `/room/`

The listening surface may assume:

- `kiosk_config.roomLoopConfig` contains the static room composition data:
  - scenes
  - movements
  - dayparts
  - tone profiles
  - overlap presets
  - sequencer and scarcity policy tables
- `/api/v1/surface/state` contains live playback posture such as:
  - `playback_paused`
  - `maintenance_mode`
  - `quieter_mode`
  - `mood_bias`
- `/api/v1/pool/next` is the source of truth for each playable selection:
  - `audio_url`
  - `playback_ack_url`
  - `wear`
  - `lane`
  - `density`
  - `mood`
  - playback window fields

The listening surface must not assume:

- that a requested lane or mood will always exist
- that browser-local recent history overrules server eligibility
- that quiet-hours or scarcity policy should be redefined on the client
- that a spectrogram image implies an artifact is currently playable

## `/ops/`

The operator surface may assume:

- `/api/v1/node/status` is the source of truth for:
  - dependency health
  - pool counts
  - warnings
  - retention summaries
- `/api/v1/operator/controls` is the source of truth for live steward state and
  recent steward actions
- session-backed auth gates access to operator-only controls

The operator surface must not assume:

- that a locally toggled checkbox is authoritative before the API accepts it
- that public surfaces see unpersisted control changes
- that health warnings are equivalent to auth or policy state

## Settings vs steward state vs pool payloads

Use this split when deciding where a new field belongs:

- Put it in settings when it describes installation posture or default policy.
  Examples:
  - storage thresholds
  - default recording duration
  - room tone profile
  - daypart schedule
- Put it in steward state when it is a live operational override.
  Examples:
  - pause intake
  - pause playback
  - quieter mode
  - temporary mood bias
  - temporary kiosk language override
- Put it in a pool payload when it is a one-selection decision.
  Examples:
  - chosen artifact id
  - wear
  - playback window
  - featured return flag

## Current payload contract

`/api/v1/surface/state` currently carries the public live machine posture for
`/kiosk/` and `/room/`. For `/kiosk/`, it also carries a small ingest-budget
snapshot for the current client identity so the recorder can warn before the
station fully hits its public write ceiling.

`/api/v1/pool/next` currently carries:

- `artifact_id`
- `audio_url`
- `playback_ack_url`
- `wear`
- `lane`
- `density`
- `mood`
- `pool_size`
- `featured_return`
- `playback_start_ms`
- `playback_duration_ms`
- `playback_windowed`
- `playback_revolution_index`
- `playback_revolution_seconds`

If a new browser behavior needs a server-owned field, add it to the contract
explicitly rather than inferring it from some other value.
