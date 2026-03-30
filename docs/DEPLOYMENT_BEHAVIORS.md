# Deployment Behaviors

This repo is one local-first artifact machine with explicit deployment kinds.
`memory` remains the canonical baseline. `question`, `repair`, and `oracle`
now have real playback differences, not just alternate copy.

## What Is Actually Distinct Now

| Deployment | Room feel now | Selection / weighting | Wear / legibility | Room-loop posture |
|---|---|---|---|---|
| `memory` | weathered, layered, composed | baseline lane, mood, age, and featured-return weighting | normal wear | baseline anti-repetition, gap pacing, overlap |
| `question` | unresolved, returning, lightly haunted | boosts `status=open` / unresolved items, recent questions, and recent-topic clustering | lighter wear keeps questions readable longer | shorter anti-repetition, slightly quicker gaps, slightly more recurrence |
| `repair` | practical, recent, useful | boosts recent items, shorter notes, and near-term topic recurrence | much lighter wear for clarity | shorter gaps, calmer tone bed, less overlap |
| `oracle` | sparse, ceremonial, event-like | penalizes brand-new material, favors older absent fragments and featured returns | very light wear | longer gaps, longer pauses, very low overlap |
| `prompt` | structurally supported | light weighting only | lighter than memory | modestly livelier pacing |
| `witness` | structurally supported | light weighting only | lighter than memory | calmer pacing |

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
- wear is much lighter than memory to preserve clarity
- room-loop gaps are shorter than memory
- room tone is reduced and overlap chance is lower

Not implemented:

- dedicated repair metadata editor in `/ops/`
- structured tool / part / issue taxonomies
- repair-specific retention controls

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

## Next Likely Extensions

- lightweight steward editing of `topic_tag` and `lifecycle_status` in `/ops/`
- deployment-specific room personalities that package tone, movement, and density more explicitly
- fuller behavior for `prompt` and `witness`
- room-state transitions driven by recent recording activity, not just playback history
