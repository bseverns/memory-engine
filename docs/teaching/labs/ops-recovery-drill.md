# Lab: Perform An Ops Recovery Drill

## Goal

Practice steward recovery under bounded, realistic failure conditions.

## Prerequisites

- [OPERATOR_DRILL_CARD.md](../../OPERATOR_DRILL_CARD.md)
- [maintenance.md](../../maintenance.md)
- [HANDOFF_REHEARSAL.md](../../HANDOFF_REHEARSAL.md)

## Time

50-75 minutes

## Steps

1. Assign roles: primary steward, secondary steward, observer.
2. Introduce one controlled fault (for example stop `worker` or fill queue pressure).
3. Primary steward diagnoses via `/ops/` and runbook.
4. Apply recovery action and verify `/readyz` + surface behavior.
5. Secondary steward repeats from written handoff only.

## Deliverables

- recovery timeline
- handoff note from primary to secondary steward
- list of unclear runbook steps

## Debrief

- Could a non-author steward recover independently?
- What evidence supports that answer?
