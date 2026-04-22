# Lab: Perform An Ops Recovery Drill

## Goal

Practice steward recovery under bounded, realistic failure conditions.

## What This Proves

- whether stewards can diagnose and recover common faults without author intervention
- whether runbook language is clear under time pressure
- whether handoff quality is sufficient between operators

## What This Does Not Prove

- every rare failure mode in production
- hardware-specific reboot edge cases on all host types
- long-term steward staffing sustainability

## Required Materials

- [OPERATOR_DRILL_CARD.md](../../OPERATOR_DRILL_CARD.md)
- [maintenance.md](../../maintenance.md)
- [HANDOFF_REHEARSAL.md](../../HANDOFF_REHEARSAL.md)
- one role sheet (primary steward, secondary steward, observer)
- one preselected controlled fault scenario

## Time

50-75 minutes

## Setup State

1. Confirm baseline stack readiness before fault injection.
2. Assign roles and define a maximum drill window.
3. Agree on safety stop conditions (for example if data-loss risk appears).

## Steps

1. Assign roles: primary steward, secondary steward, observer.
2. Introduce one controlled fault (for example stop `worker` or fill queue pressure).
3. Primary steward diagnoses via `/ops/` and runbook.
4. Apply recovery action and verify `/readyz` + surface behavior.
5. Secondary steward repeats from written handoff only.

## Expected Observations

- primary steward identifies failing component and executes a bounded recovery path
- secondary steward can reproduce recovery from notes with minimal verbal coaching
- unclear runbook language becomes obvious during transfer

## Common Failure Points

- overreliance on one expert operator
- skipping verification after restart/action
- handoff notes missing timestamps or exact commands

## Instructor Notes

- use one controlled fault at a time; avoid stacked failures in first rounds
- score legibility of reasoning, not just speed
- if recovery succeeds but explanation is weak, mark that as partial success

## Optional Extension

- rerun drill with swapped roles and a different controlled fault
- add a timed constraint and compare quality/safety tradeoffs

## Student Deliverable Format

- recovery timeline
- handoff note from primary to secondary steward
- list of unclear runbook steps

## Reflection Prompts

- Could a non-author steward recover independently?
- What evidence supports that answer?
