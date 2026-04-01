# Naming Policy

This file settles the naming hierarchy for the repo as it heads toward `v1.3`.

The goal is not branding polish. It is conceptual gravity.

## Canonical Names

| Layer | Name | Use it where |
|---|---|---|
| project / machine / repo | `Memory Engine` | README, roadmap, mission docs, release notes, maintainer language |
| participant-facing recording and listening language | `Room Memory` | `/kiosk/`, `/room/`, participant cards, printed prompts, revoke page titles |
| participant-facing action language | `Recording Station`, `Listening Surface`, `Revoke A Recording` | local page titles and short UI labels |
| operator-facing surface language | `Room Memory Status` or `Operator Access` / `Operator Dashboard` | `/ops/` titles and steward docs |
| internal architectural language | `artifact`, `artifact storage`, `artifact lifecycle`, `artifact engine` | code, architecture docs, internal notes only |

## What Should Stay Secondary

- The project is not renamed to `Artifact Engine`.
- `artifact engine` can still describe the shared internal substrate, but it should not outrank `Memory Engine` in outward-facing docs.
- Secondary deployments exist, but they should read as temperaments or sibling modes under one machine, not as equal competing products.

## Deployment Status Language

Use these status terms consistently:

| Deployment | Status language | Notes |
|---|---|---|
| `memory` | `stable`, `canonical`, `default` | the home deployment and the center of gravity |
| `question` | `supported secondary deployment` | behaviorally real and stewardable, but still secondary to `memory` |
| `repair` | `supported secondary deployment` | behaviorally real and stewardable, but still secondary to `memory` |
| `prompt` | `experimental` | first-pass behavior exists, but it should not be described as equally mature |
| `witness` | `experimental` | first-pass behavior exists, but it is still early |
| `oracle` | `experimental` | first-pass behavior exists, but it is still early |

## Terms To Avoid Or Demote

- `Confessional Kiosk` as the primary public name
  it is evocative, but too narrow for the full social field the machine now wants to hold
- `Question Engine`, `Repair Engine`, and similar product-style names as if they were independent systems
  they are better treated as deployment codes or secondary temperaments

## Practical Rule

When in doubt:

1. say `Memory Engine` for the project
2. say `Room Memory` for the public-facing recording/listening surfaces
3. use deployment codes only when the distinction matters
4. keep `artifact` language inside architecture, code, and steward-facing internals
