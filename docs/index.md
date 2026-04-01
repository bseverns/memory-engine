# Memory Engine Manual

Memory Engine is a local-first room memory appliance. One surface records a short offering, one surface lets the room listen back over time, and one surface lets a steward keep the machine healthy without turning it into a heavy moderation console.

This documentation set is the machine's front door. Use it when you need to install, run, repair, or extend the stack without reverse-engineering intent from the repo layout.

![Recording kiosk idle](screenshots/recording-kiosk-idle.png){ .hero-shot }

## What This Machine Is

- a dedicated recording surface at `/kiosk/`
- a dedicated listening surface at `/room/`
- a steward surface at `/ops/`
- a participant-facing revoke flow at `/revoke/`
- a local-first runtime built around Django, Postgres, Redis, Celery, and MinIO

Memory Engine remains the canonical center of the project. The deployment family exists so the same appliance can support closely related public rituals without turning into a generic platform.

## Start With The Right Path

If you are installing the machine:

- start with [start-here.md](./start-here.md)
- then use [installation-checklist.md](./installation-checklist.md)
- use [UBUNTU_APPLIANCE.md](./UBUNTU_APPLIANCE.md) for the current host recipe

If you are stewarding a live node:

- use [OPERATOR_DRILL_CARD.md](./OPERATOR_DRILL_CARD.md) for the shortest recovery ritual
- use [maintenance.md](./maintenance.md) for the full runbook
- use [participant-prompt-card.md](./participant-prompt-card.md) for the public handoff language

If you are changing code or deployment behavior:

- use [AT_A_GLANCE.md](./AT_A_GLANCE.md) for subsystem ownership and first knobs
- use [how-the-stack-works.md](./how-the-stack-works.md) for architecture
- use [surface-contract.md](./surface-contract.md) for browser/API boundaries
- use [DEPLOYMENT_BEHAVIORS.md](./DEPLOYMENT_BEHAVIORS.md) for deployment-specific grammar

## Surface Map

| Surface | Purpose | Open This First |
|---|---|---|
| `/kiosk/` | Record an offering, review it, choose consent, receive a revoke code | [installation-checklist.md](./installation-checklist.md) |
| `/room/` | Play the room loop on a dedicated listening machine | [multi-machine-setup.md](./multi-machine-setup.md) |
| `/ops/` | Check health, pause intake/playback, steward artifacts, run local monitor checks | [maintenance.md](./maintenance.md) |
| `/revoke/` | Public revocation flow using the participant receipt code | [participant-prompt-card.md](./participant-prompt-card.md) |

## Current Reference Posture

- target host image: `Ubuntu Server 24.04.4 LTS`
- canonical runtime: `docker compose up --build`
- canonical repo gate: `./scripts/check.sh`
- default deployment: `ENGINE_DEPLOYMENT=memory`
- recommended install split: one kiosk machine, one room machine, one steward machine

## Documentation Map

- [start-here.md](./start-here.md): role-based orientation
- [AT_A_GLANCE.md](./AT_A_GLANCE.md): shortest machine map
- [maintenance.md](./maintenance.md): deploy, backup, restore, and repair commands
- [UBUNTU_APPLIANCE.md](./UBUNTU_APPLIANCE.md): firewall and restart-on-boot host recipe
- [how-the-stack-works.md](./how-the-stack-works.md): architecture and request flow
- [MISSION_EXPANSION.md](./MISSION_EXPANSION.md): strategic boundary for the project
- [roadmap.md](./roadmap.md): what is still open and why
