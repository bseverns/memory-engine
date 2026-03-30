# Mission Expansion: Memory Engine → Artifact Engine Family

This repository still ships as **Memory Engine** first. That default is not being diluted.

The opening in this pass is architectural and editorial: we now name the shared substrate as a **local-first artifact/offering engine** that can host multiple sibling deployments without breaking the current machine.

## What stays the same

- Local-first ingest, playback, and operator model.
- Distinct surfaces and operational posture: `/kiosk/`, `/room/`, `/ops/`.
- Memory Engine default behavior, default copy, and default policy tuning.
- Existing operator workflow and route map.
- Existing persistence model for artifacts, derivatives, and revocation.

## What becomes configurable

Deployment kind (`ENGINE_DEPLOYMENT`) is now a first-pass config primitive.

Planned supported values:

- `memory` (default, fully wired)
- `question`
- `prompt`
- `repair`
- `witness`
- `oracle`

In this pass, deployment kind is intentionally lightweight and used for:

- participant copy selection hooks
- prompt/intake framing hooks
- future metadata branching hooks
- future playback-policy branching hooks
- operator-facing labeling

## Why Question Engine is the same engine

Question Engine should not be built as a separate system because it shares the same hard parts:

- local capture and consent workflow
- artifact storage + retention mechanics
- room composition and replay loops
- steward controls and safety posture

What changes is mostly **policy and rhetoric**: intake framing, review language, artifact interpretation, and replay bias.

## Plausible deployment family

- **Memory Engine**: voice offerings for weathered room memory.
- **Question Engine**: unresolved prompts and recurring asks.
- **Prompt Engine**: authored prompt cycles and participant responses.
- **Repair Engine**: practical notes, fixes, and resurfacing tasks.
- **Witness Engine**: testimony-oriented offerings with trace stewardship.
- **Oracle Engine**: sparse, ceremonial, cue-like resurfacing.

## Deployment-defining system layers

A deployment is defined by tuning these layers (not by rewriting the stack):

1. **Intake framing** (kiosk attract language + recording invitation)
2. **Artifact metadata** (what the offering is treated as)
3. **Review language** (keep/discard rhetoric and consent framing)
4. **Room playback/composition behavior** (selection, recurrence, rarity, layering)
5. **Operator controls** (which tuning knobs are exposed per deployment)
6. **Retention / afterlife posture** (what persists, for how long, in what form)
7. **Responsiveness expectations** (immediate acknowledgement → near-immediate reflection → ambient afterlife)

## Guardrails for contributors

- Do not flatten Memory Engine into generic blandness.
- Keep the code inspectable and local-first.
- Prefer small policy seams over heavyweight abstraction frameworks.
- Add deployment hooks only where they have immediate operational use.
