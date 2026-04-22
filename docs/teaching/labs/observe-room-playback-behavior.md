# Lab: Observe Room Playback Behavior

## Goal

Observe how playback composition changes with pool conditions and deployment temperament.

## What This Proves

- deployment temperament can change room behavior without changing core routes
- pool composition and pacing controls are observable in live playback
- operator summaries can be correlated to listener-facing behavior

## What This Does Not Prove

- long-term audience adaptation effects
- complete acoustic quality in final installation space
- participant comprehension of deployment language

## Required Materials

- [DEPLOYMENT_BEHAVIORS.md](../../DEPLOYMENT_BEHAVIORS.md)
- [RESPONSIVENESS.md](../../RESPONSIVENESS.md)
- [experimental-proofs.md](../../experimental-proofs.md)
- at least 4-6 test artifacts
- observation log sheet with timestamp column

## Time

45-70 minutes

## Setup State

1. Confirm stack readiness and `/ops/` access.
2. Choose two deployment modes before starting.
3. Keep room output hardware constant between comparisons.

## Steps

1. Start in `ENGINE_DEPLOYMENT=memory` and collect a short baseline observation.
2. Record at least 4-6 artifacts with mixed consent modes.
3. Observe room playback for 10-15 minutes; note recurrence and spacing.
4. Switch deployment temperament (for example `question` or `repair`) and repeat.
5. Compare lane/mood summaries and perceived room behavior.

## Expected Observations

- measurable differences in pacing, recurrence, or tonal clustering across deployments
- not every difference is dramatic in a short run; some are subtle but consistent
- `/ops/` summaries help explain behavior that listeners only partially perceive

## Common Failure Points

- too few artifacts to produce meaningful differences
- switching multiple variables at once (deployment plus profile plus room tuning)
- insufficient observation window after changing deployment

## Instructor Notes

- keep one variable change per run whenever possible
- ask students to separate direct observations from interpretations
- require explicit links to deployment-behavior claims in docs

## Optional Extension

- repeat with a second `INSTALLATION_PROFILE` while holding deployment fixed
- include one blinded listening pass before showing operator data

## Student Deliverable Format

- observation log with timestamps
- deployment comparison notes
- one hypothesis about why behavior changed

## Reflection Prompts

- Which differences were clear to listeners?
- Which differences were visible only in operator summaries?
