# Operator Surfaces: Lite vs Bench

Memory Engine uses two steward routes on purpose.

- `/ops/` is Operator Lite for daily stewardship.
- `/ops/bench/` is Operator Bench for deeper diagnostics and artifact stewardship.

The split keeps the daily surface calm and legible while preserving full maintenance depth when needed.

## Why `/ops/` Uses Task Moments

`/ops/` is organized around steward moments instead of system categories:

- `Open Room`
- `Run Room`
- `Fix Problem`
- `Close Session`

This keeps first decisions visible at the top of the screen:

- machine state (`ready`, `degraded`, `broken`)
- next recommended action
- survival controls (maintenance, intake, playback, quieter, clear framing, output tone)
- evidence chips (playable, warnings, storage, last action)

Task-moment organization helps stewards answer "what do I do now?" before they parse diagnostic detail.

## What Belongs In `/ops/`

Keep `/ops/` bounded to daily operation:

- fast readiness posture
- fast pause/soften/clear controls
- short guided action language
- close-of-session archive command builder
- links out to deeper tools

`/ops/` should not become a live composition console or a deep artifact workbench.

## What Belongs In `/ops/bench/`

Use `/ops/bench/` when steward tasks need depth:

- full dependency and retention diagnostics
- artifact metadata editing and remove-from-stack actions
- monitor tooling and extended troubleshooting cards
- broader operational evidence and long-form guidance

Bench preserves full capability. Lite preserves speed and legibility.

## Current Evidence Gaps

Still needs real steward pilot evidence:

- whether non-author stewards find the top task tabs faster than category dashboards
- whether state strip + control row reduce recovery time during degraded events
- whether close-session archive completion improves under real time pressure
- whether tab persistence helps handoff between refreshes/reboots without confusion
