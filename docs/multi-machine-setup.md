# Multi-Machine Setup

Use this when one node is serving more than one browser client at the same
time, especially the intended split:

- one recording station on `/kiosk/`
- one listening surface on `/room/`
- optional operator browser on `/ops/`

This document is about which machine should do what and how to keep the roles
clear during install and day-to-day use.

## The basic model

One server runs the stack.

Multiple client machines or browser sessions connect to that same server:

1. Recording machine
   Opens `/kiosk/`
   Owns microphone capture only.
2. Playback machine
   Opens `/room/`
   Owns room-loop playback only.
3. Operator machine
   Opens `/ops/`
   Owns status checks and maintenance visibility.

The important rule is: do not ask one browser surface to do all three jobs.
The product is now designed around separate roles.

## Recommended physical layout

- Put the recording station in the quieter, more private position.
- Put the playback machine where the room should listen.
- Keep the operator browser off to the side or on a steward device, not on a
  public-facing screen.
- If you print `docs/participant-prompt-card.md`, place it only at the
  recording station.

## URL assignments

Assuming the server is reachable at `https://memory.example.com`:

- recording machine:
  `https://memory.example.com/kiosk/`
- playback machine:
  `https://memory.example.com/room/`
- operator machine:
  `https://memory.example.com/ops/`

If you are still on a trusted internal-TLS IP setup, use the same route split,
just with the IP-based URL instead of the final domain.

## Recording machine instructions

This machine should:

- open `/kiosk/`
- have the intended USB microphone selected
- have persistent browser permission for microphone access on that URL
- not be responsible for ambient room playback

This machine should not:

- be the main room speaker surface
- expose `/ops/` to the public
- require the participant to manage playback controls

## Playback machine instructions

This machine should:

- open `/room/`
- feed the intended room speakers, amplifier, or monitor output
- stay dedicated to playback during public operation

This machine should not:

- have a microphone attached for participant use
- be used as the recording station
- be used as the operator dashboard during public operation

Practical note:

- `/room/` attempts to start playback automatically by default.
- If the browser blocks autoplay after boot, tap `Start listening` once and
  then leave the machine alone.
- Better: launch the playback browser with a site-level autoplay allowance so
  the machine comes back audibly after reboot without manual rescue.

## Operator machine instructions

This machine should:

- open `/ops/`
- sign in with `OPS_SHARED_SECRET`
- verify `ready`, `degraded`, or `broken` state
- use the live controls when intake or playback needs to be paused temporarily
- be used for setup, acceptance, and troubleshooting

It can also open `/kiosk/` or `/room/` temporarily for checks, but that should
be treated as a steward task, not the public-facing install posture.

## Autostart recommendations

### Recording machine

- launch Chromium directly to `/kiosk/`
- ensure microphone permission is already granted for that URL
- verify a page reload returns to the quiet idle state
- helper form:
  `./scripts/browser_kiosk.sh --role kiosk --base-url https://memory.example.com`

### Playback machine

- launch Chromium directly to `/room/`
- route audio to the intended playback hardware
- verify autoplay succeeds after boot; for unattended installs, prefer a launch
  policy such as Chromium's `--autoplay-policy=no-user-gesture-required`
  instead of relying on a one-tap recovery
- helper form:
  `./scripts/browser_kiosk.sh --role room --base-url https://memory.example.com`

### Operator machine

- autostart is optional
- usually this is better as a manual steward surface

## Acceptance test for a two-machine install

1. On the recording machine, open `/kiosk/` and confirm the microphone meter
   responds.
2. On the playback machine, open `/room/` and confirm playback can start.
3. Make one test recording on `/kiosk/`.
4. Confirm the recording machine never exposes room playback controls.
5. Confirm the playback machine never exposes microphone capture controls.
6. Confirm the new take becomes eligible for room playback on `/room/`.
7. Open `/ops/` and confirm the node looks healthy.

## Common mistakes

- Opening `/kiosk/` on the playback machine and expecting it to behave like a
  listening surface.
- Opening `/room/` on the recording station and then wondering why the
  participant cannot record.
- Testing microphone behavior over plain remote `http://IP/...`.
- Leaving the operator dashboard on a public screen.
- Forgetting that autoplay rules can differ from microphone rules; the
  playback machine may need one manual start even when the recorder works.

## Short steward version

If you need the shortest possible instruction set:

- recorder uses `/kiosk/`
- speakers use `/room/`
- steward uses `/ops/`

That is the intended multi-machine operating posture.
