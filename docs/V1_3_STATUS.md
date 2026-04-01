# v1.3 Status

This note is the short release-facing status readout for the `v1.3` closure push.

## Stable

- `Memory Engine` as the canonical project and default deployment
- local-first `/kiosk/`, `/room/`, `/ops/`, and `/revoke/` surface set
- Ubuntu appliance recipe for `Ubuntu Server 24.04.4 LTS`
- backup, restore, export, and support-bundle paths
- participant-facing local revoke flow
- lightweight steward metadata and removal actions in `/ops/`
- default repo gate with backend, frontend, and a small browser slice

## Supported Secondary Deployments

- `question`
- `repair`

These are behaviorally real and stewardable, but still secondary to `memory`.

## Experimental

- `prompt`
- `witness`
- `oracle`

These have first-pass behavior and language, but should not be described as equally mature with `memory`.

## What v1.3 Is Trying To Prove

- the machine can be handed to a non-author steward without losing composure
- the trust language speaks with one mouth
- the appliance path has real rehearsal evidence
- the public ritual has been learned from real use, not only design intent

## What Is Still Not Proven By Repo Work Alone

- clean-machine appliance rehearsal
- non-author steward handoff
- soft public pilot and debrief
- restore drill on a fresh target

Those are `v1.3` requirements, but they require dated runs in the world, not just code changes in the repo.
