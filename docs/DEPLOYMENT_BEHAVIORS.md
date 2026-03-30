# Deployment Behaviors

This repo is one local-first artifact machine with explicit deployment kinds.
`memory` remains the canonical baseline. `question`, `repair`, `oracle`,
`prompt`, and `witness` now all differ through explicit policy rather than copy
alone, though `memory`, `question`, and `repair` remain the most developed.

## What Is Actually Distinct Now

| Deployment | Room feel now | Selection / weighting | Wear / legibility | Room-loop posture |
|---|---|---|---|---|
| `memory` | weathered, layered, composed | baseline lane, mood, age, and featured-return weighting | normal wear | baseline anti-repetition, gap pacing, overlap |
| `question` | unresolved, returning, lightly haunted | boosts `status=open` / unresolved items, recent questions, recent-topic clustering, and explicit topic/status threads | lighter wear keeps questions readable longer | shorter anti-repetition, slightly quicker gaps, plus rare question-chorus layering that can extend into a later echo when a thread persists |
| `repair` | practical, recent, useful | boosts recent items, shorter notes, near-term topic recurrence, and explicit work-thread returns | much lighter wear for clarity | shorter gaps, calmer tone bed, less overlap, plus bench-log follow-ons that get lighter and tighter as a practical thread stays active |
| `oracle` | sparse, ceremonial, event-like | penalizes brand-new material, favors older absent fragments and featured returns | very light wear | longer gaps, longer pauses, very low overlap |
| `prompt` | catalytic, quick, recirculating | boosts recent shorter prompt responses and recent-topic echoes | lighter wear than memory | shortest anti-repetition, quicker gaps, slightly more overlap |
| `witness` | settled, contextual, documentary | cools hyper-recent material and favors settled contextual notes | gentler wear than memory | longer anti-repetition, calmer pacing, lower overlap |

## Metadata In Play

No new large metadata system was added.

Current lightweight fields:

- `deployment_kind`
- `topic_tag`
- `lifecycle_status`

Small compatibility improvement:

- ingest now accepts `topic_tag`, `topic`, or `category`
- ingest now accepts `lifecycle_status` or `status`

That is enough for:

- `question` topic clustering and open/answered behavior
- `repair` topic recurrence and practical-status bias

Existing artifacts without metadata still work. Empty `lifecycle_status` still
counts as unresolved in `question`, which keeps older data compatible.

## Where The Behavior Lives

Primary backend policy:

- `api/engine/deployment_policy.py`

Shared pool selection:

- `api/engine/pool.py`

Room-loop config delivery:

- `api/engine/views.py`
- `api/engine/static/engine/kiosk-room-loop-policy.js`
- `api/engine/static/engine/kiosk-room-loop.js`
- `api/engine/static/engine/kiosk-room-loop-playback.js`

Participant-facing copy:

- `api/engine/static/engine/kiosk-copy.js`

Operator awareness:

- `api/engine/templates/engine/operator_dashboard.html`
- `api/engine/static/engine/operator-dashboard.js`
- `api/engine/api_views.py`

Operator metadata editing:

- `GET /api/v1/operator/artifacts`
- `POST /api/v1/operator/artifacts/<id>/metadata`

## Implemented Policy Summary

### `memory`

Baseline behavior is preserved:

- same shared pool age/cooldown/wear logic remains canonical
- featured returns still matter
- fresh, mid, and worn lanes still shape the room
- normal wear continues to build patina over time

### `question`

Implemented now:

- unresolved lifecycle states are boosted
- answered / resolved states are cooled down
- recent questions are favored, but older open questions can still return
- recent `topic_tag` history can cluster adjacent questions loosely
- the room loop can carry a short topic/status thread so an unresolved question can return as a deliberate revisit
- some threaded unresolved questions now trigger a rare same-topic layered return, producing a small chorus moment instead of only single-file recurrence
- when that same unresolved topic has already persisted across several recent room events, the chorus can add a later third voice instead of stopping at a simple pair
- wear is lighter than memory so question audio stays more legible
- room-loop anti-repetition is shorter than memory
- room-loop gaps are modestly quicker than memory

Not implemented:

- semantic grouping
- transcript-aware similarity
- explicit moderator workflow for answering / closing questions

### `repair`

Implemented now:

- recent material is strongly favored
- shorter items are boosted, dense/long items are cooled
- near-term topic recurrence is supported with `topic_tag`
- the room loop can prefer a recent practical thread so related bench notes return while still useful
- some repair threads now trigger a short same-topic follow-on note, so the room can feel like a bench notebook instead of isolated tips
- longer practical threads now force those follow-ons toward lighter-density companions with shorter post-cue breathing room, so the room feels more like an active workbench than a memorial loop
- wear is much lighter than memory to preserve clarity
- room-loop gaps are shorter than memory
- room tone is reduced and overlap chance is lower

Not implemented:

- structured tool / part / issue taxonomies
- repair-specific retention controls

### `prompt`

Implemented now:

- recent prompt responses are favored over old spent material
- shorter prompts are boosted over long dense ones
- recent `topic_tag` history can echo prompt-adjacent material
- anti-repetition is shorter than memory
- gaps are quicker and overlap is slightly more permissive

Not implemented:

- steward-authored prompt packs
- explicit prompt chains or thread awareness

### `witness`

Implemented now:

- very recent witness notes are cooled until they settle
- settled mid-age material is favored
- longer contextual notes are slightly preferred over clipped fragments
- anti-repetition is longer than memory
- pacing is calmer and overlap is reduced

Not implemented:

- richer witness verification workflow
- witness-specific context fields beyond topic/status

### `oracle`

Implemented now:

- brand-new material is strongly penalized
- older absent material is boosted
- featured-return logic matters more than memory
- wear is very light
- anti-repetition window is long
- room-loop cue gaps and pauses are much longer
- overlap chance is heavily reduced

Not implemented:

- formal ceremony states
- steward-triggered oracle events
- custom visual mode beyond the shared playback surface

## Responsiveness Rule

Deployment differences do not change the responsiveness ladder:

1. immediate acknowledgement
2. near-immediate reflection / preview
3. ambient afterlife in the room/archive

The distinct behavior only changes step 3, plus a small amount of truthful copy
around what that afterlife means.

## Safe Fallbacks

- unknown deployment names still normalize to `memory`
- if a non-memory deployment has no playable artifacts at all, the pool can still fall back safely
- if a non-memory deployment does have playable artifacts, the selector stays inside that deployment before falling back elsewhere

## Operator Editing

`/ops/` now includes a small deployment-scoped artifact metadata section:

- only recent artifacts from the active deployment are shown
- only `topic_tag` and `lifecycle_status` are editable
- `lifecycle_status` now uses deployment-specific picker presets, while still preserving older custom values already in the archive
- edits are audited through steward actions

This keeps stewardship inspectable without turning the dashboard into a large
artifact management console.

## Next Likely Extensions

- deployment-specific room personalities that package tone, movement, and density more explicitly
- room-state transitions driven by recent recording activity, not just playback history
