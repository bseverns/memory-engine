# Instructor Guide

This guide is for instructors, studio leads, and steward-trainers who want to teach Memory Engine as both a technical appliance and a participatory public artwork.

## Teaching Posture

Keep three frames in view at once:
1. Memory Engine as a local-first machine
2. Room Memory as a participant ritual
3. Stewardship as an operational and ethical practice

Do not teach this stack as a generic web app exercise.

## Recommended Formats

### 1-day workshop (fast orientation)
- Session 1: system map and lifecycle
- Session 2: consent/revocation lab
- Session 3: ops drill and reflection

### 2-week studio (deeper practice)
- Week 1: modules + architecture/lifecycle labs
- Week 2: deployment temperament comparison + evaluation notes + steward handoff rehearsal

### Steward practicum
- Focus on `/ops/`, recovery, backups, restore rehearsal, and participant-facing explanation quality

## Before You Teach

Use this checklist before the first class:
- confirm runtime posture with [maintenance.md](../maintenance.md)
- run install checks with [installation-checklist.md](../installation-checklist.md)
- rehearse operator recovery with [OPERATOR_DRILL_CARD.md](../OPERATOR_DRILL_CARD.md)
- review lifecycle diagrams in [memory-lifecycle.md](../memory-lifecycle.md)
- choose one deployment temperament to be canonical for the cohort

## Suggested Sequence

1. Open with [modules/room-memory-as-a-system.md](./modules/room-memory-as-a-system.md)
2. Ground architecture with [modules/local-first-architecture.md](./modules/local-first-architecture.md)
3. Run [labs/trace-memory-through-stack.md](./labs/trace-memory-through-stack.md)
4. Teach governance with [modules/consent-retention-revocation.md](./modules/consent-retention-revocation.md)
5. Run [labs/consent-revocation-audit.md](./labs/consent-revocation-audit.md)
6. Teach stewardship with [modules/ops-stewardship-recovery.md](./modules/ops-stewardship-recovery.md)
7. Run [labs/ops-recovery-drill.md](./labs/ops-recovery-drill.md)
8. Close with evaluation framing and templates

## Evidence To Capture During Teaching

Capture operational and comprehension evidence, not extractive participant data:
- steward ability to open, diagnose, and recover the node
- participant comprehension of consent and revocation language
- observable room behavior changes across deployment settings
- failure handling quality during drills

Use templates:
- [pilot-notes-template.md](./templates/pilot-notes-template.md)
- [steward-handoff-template.md](./templates/steward-handoff-template.md)
- [participant-comprehension-template.md](./templates/participant-comprehension-template.md)

## Facilitation Notes

- Keep language concrete and local.
- Pair each conceptual discussion with one surface-level action (`/kiosk/`, `/room/`, `/ops/`, `/revoke/`).
- Ask students to explain "what the machine promises" and "what it explicitly does not promise."
- Require at least one restore rehearsal before any real public use claims.

## Assessment

Use [assessment-rubric.md](./assessment-rubric.md) with light touch:
- prioritize operational clarity and ethical boundary literacy
- avoid grading participants on aesthetic preference alone
