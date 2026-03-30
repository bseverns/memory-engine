# Deployment Behaviors and Afterlife Posture

This repo runs one local-first artifact/offering engine with explicit deployment kinds.
Memory Engine stays canonical. Other modes branch through copy + metadata + policy seams.

## Deployment quick map

| Deployment | Participant ask | Useful metadata | Room resurfacing posture | Afterlife stance | Responsiveness emphasis |
|---|---|---|---|---|---|
| `memory` | Offer a room memory | memory color, tone, duration | weathering, patina, temporal depth | layered local residue and worn return | reflective but immediate |
| `question` | Ask what is unresolved | topic tag, lifecycle (`open`/`answered`) | recurrence + unresolved return | unresolved items keep coming back | clear acknowledgement of inquiry |
| `prompt` | Offer a prompt response | topic tag, session cue | catalytic rotation + variety | keeps the cycle moving, avoids stagnation | fast iteration loops |
| `repair` | Record practical repair notes | topic tag, lifecycle, recency | recency/usefulness bias | practical resurfacing near active workflows | utility-first feedback |
| `witness` | Record a careful witness note | topic tag, context marker | contextual pacing, documentary clarity | less churn, more trace continuity | calm but explicit confirmation |
| `oracle` | Offer a sparse oracle fragment | lifecycle + rarity framing | rare, ceremonial timing | sparse but meaningful recurrence | immediate acknowledgment, delayed return |

## Already real in code

- Deployment catalog with copy/policy references: `api/memory_engine/deployments.py`
- Deployment-aware kiosk copy selection: `api/engine/static/engine/kiosk-copy.js`
- Deployment-aware playback weight hook: `api/engine/deployment_policy.py`
- Deployment metadata on artifacts: `deployment_kind`, `topic_tag`, `lifecycle_status`

## Playback hook posture (small and intentional)

Current deployment policies are weighting adjustments, not a second engine:

- `memory`: baseline lane/mood behavior
- `question`: unresolved lifecycle gets a return boost
- `prompt`: keeps rotation lively; very old material cools
- `repair`: strong recency bias for practical usefulness
- `witness`: suppresses hyper-recency spikes; favors settled clarity
- `oracle`: favors older absent artifacts; penalizes brand-new ones

## Rule for future contributors

If a change can be expressed as metadata, copy, or weighting, keep it inside this shared engine.
Only split systems when runtime boundaries or trust boundaries genuinely diverge.
