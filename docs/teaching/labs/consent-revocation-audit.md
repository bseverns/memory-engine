# Lab: Run A Consent/Revocation Audit

## Goal

Evaluate whether participant-facing consent and revocation behavior matches system behavior.

## What This Proves

- whether documented consent modes match real runtime behavior
- whether revoke language and revoke execution remain aligned
- whether stewards can explain retention behavior without improvising policy

## What This Does Not Prove

- legal adequacy for a specific jurisdiction
- participant emotional response in a live public context
- long-horizon retention drift

## Required Materials

- [participant-prompt-card.md](../../participant-prompt-card.md)
- [ARCHIVE_STEWARDSHIP.md](../../ARCHIVE_STEWARDSHIP.md)
- [maintenance.md](../../maintenance.md)
- three short test recordings
- a consent mode comparison table template

## Time

40-55 minutes

## Setup State

1. Confirm stack health and steward login.
2. Confirm intake and playback are unpaused.
3. Clear prior test confusion by labeling this run in notes with date/time.

## Steps

1. Prepare three test recordings: one each for `ROOM`, `FOSSIL`, and `NOSAVE`.
2. For each, write expected retention/revocation behavior before testing.
3. Execute revocation for applicable cases.
4. Verify actual behavior through `/ops/` and lifecycle evidence.
5. Compare expected vs observed outcomes.

## Expected Observations

- `ROOM` participates in normal playback and can be revoked
- `FOSSIL` enters archive posture consistent with current retention policy
- `NOSAVE` does not persist like archived consent modes

## Common Failure Points

- participants or students mixing up consent labels and retention meanings
- revocation attempted with stale/wrong receipt code
- observers assuming `/ops/` summary timing is instantaneous

## Instructor Notes

- require teams to write expected outcomes before testing so hindsight bias is reduced
- if expected and observed behavior diverge, treat that as a documentation bug until proven otherwise
- keep participant-facing language simple and avoid legalistic overreach

## Optional Extension

- run the same audit with a second steward doing all explanations from the prompt card only
- compare whether explanation consistency changes outcome interpretation

## Student Deliverable Format

- consent mode comparison table
- mismatch list (if any)
- revised participant explanation language for confusing points

## Reflection Prompts

- Where could participant understanding fail even when code is correct?
- Which wording changes would improve trust without legal overreach?
