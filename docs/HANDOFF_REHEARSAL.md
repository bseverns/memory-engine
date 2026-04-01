# Handoff Rehearsal

This file is the running log for `v1.3` handoff proof.

It exists so appliance, steward, and pilot rehearsals become dated evidence instead of confident memory.

## How To Use This File

For each rehearsal or pilot:

- add the date
- add the commit SHA or release build
- note who ran it and whether they were the author
- record what actually failed or confused people
- record what changed afterward

## 1. Appliance Rehearsal

### Target path

`blank Ubuntu box -> install -> boot -> kiosk live -> room live -> ops live -> test recording -> revoke test -> backup -> restore rehearsal`

### Run log

- Date:
- Commit / build:
- Host image:
- Who ran it:
- Was this person the author?:
- Did the machine reach `/kiosk/`, `/room/`, and `/ops/` cleanly after reboot?:
- Did browser autostart and focus posture behave as expected?:
- Did test recording + revoke + backup + restore all succeed?:

### Friction notes

- Where the install drifted:
- What was ambiguous:
- What needed manual guesswork:
- What changed afterward:

## 2. Steward Handoff

### Steward task list

- open the system
- run opening checks
- explain it to participants
- troubleshoot a quiet room or dead kiosk
- remove something from stack if needed
- help a participant revoke
- close the day
- leave notes for the next steward

### Run log

- Date:
- Commit / build:
- Steward:
- Was this person a non-author?:
- What did they get right immediately?:
- What did they misread?:
- What did they assume incorrectly?:
- Where did they need verbal help?:
- What changed afterward:

## 3. Soft Public Pilot

### Pilot facts

- Date:
- Commit / build:
- Deployment kind:
- Installation profile:
- Audience type:
  - trusted insiders
  - mixed public
- Facilitators:

### Debrief prompts

- What did people think the system was doing?
- Where did they hesitate?
- Did the memory-color step help or distract?
- Was `Don't Save` understood and trusted?
- Did participants understand revocation?
- Did the room’s change feel perceptible?
- What did facilitators have to repeat over and over?
- What kinds of recordings actually emerged?
- What changed afterward:

## 4. Restore Drill

- Date:
- Commit / build:
- Backup source used:
- Target machine or throwaway environment:
- Time to restore:
- What failed:
- What still required repo knowledge:
- What changed afterward:
