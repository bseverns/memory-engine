# Start Here

Use this page when you know what role you are in but do not yet know which document should lead.

## Installer

Open these in order:

1. [AT_A_GLANCE.md](./AT_A_GLANCE.md)
2. [installation-checklist.md](./installation-checklist.md)
3. [UBUNTU_APPLIANCE.md](./UBUNTU_APPLIANCE.md)
4. [maintenance.md](./maintenance.md)

Use this path when you are turning a fresh machine into the appliance or validating that a node is actually ready for public use.

## Steward

Open these first:

1. [OPERATOR_DRILL_CARD.md](./OPERATOR_DRILL_CARD.md)
2. [maintenance.md](./maintenance.md)
3. [participant-prompt-card.md](./participant-prompt-card.md)

Use this path when you need to recover the machine quickly, check whether intake or playback is paused, remove something from circulation, or help a participant revoke a recording later.

Practical reminder:

- the `/ops/` audio monitor proves the current steward browser's local routing
- it does not certify the separate kiosk recorder path
- it does not certify the full room playback machine

## Maintainer

Open these first:

1. [AT_A_GLANCE.md](./AT_A_GLANCE.md)
2. [how-the-stack-works.md](./how-the-stack-works.md)
3. [surface-contract.md](./surface-contract.md)
4. [DEPLOYMENT_BEHAVIORS.md](./DEPLOYMENT_BEHAVIORS.md)

Use this path when you are changing ingest, retention, playback, steward controls, or deployment-specific behavior and need to know which layer actually owns the decision.

## Curator Or Project Lead

Open these first:

1. [MISSION_EXPANSION.md](./MISSION_EXPANSION.md)
2. [DEPLOYMENT_BEHAVIORS.md](./DEPLOYMENT_BEHAVIORS.md)
3. [roadmap.md](./roadmap.md)

Use this path when you are deciding whether a new behavior belongs in the machine at all, not just whether it can be implemented.

## Live Node Checklist

If the machine is already installed and you only need to confirm it is serviceable:

1. Run `./scripts/check.sh` in the repo clone you deploy from.
2. Run `./scripts/status.sh`.
3. Run `./scripts/doctor.sh`.
4. Open `/ops/`.
5. Confirm `/kiosk/`, `/room/`, and `/revoke/` are reachable from their intended machines.
