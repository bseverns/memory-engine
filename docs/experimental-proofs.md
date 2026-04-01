# Experimental Proofs

This page is the proof board for the machine.

It is not the same thing as the roadmap. The roadmap says what the project may still become. This page says what the current stack should still prove in public, in rehearsal, or in a tighter technical validation pass.

## Current Proof Board

| Proof target | Why it matters | Current evidence | Next proof pass | Status |
|---|---|---|---|---|
| Public `/revoke/` is understandable without a steward present at the moment of use | Trust depends on participants being able to act on the receipt later | public revoke page, receipt copy, API path, tests | run a small participant comprehension check with real printed receipts and note failure points | `TODO` |
| Export bundles are truly handoff-ready without repo knowledge | Archives should survive operator turnover | bundle manifest, checksums, import instructions | restore one bundle onto a fresh throwaway node using only the bundle contents and docs | `TODO` |
| Deployment prompt packs materially change first interaction tone | Distinct deployments should feel behaviorally real, not just configurable | deployment-specific starter packs now render on `/kiosk/` | compare first-take behavior across `memory`, `question`, and `repair` with a small scripted capture set | `TODO` |
| `question` and `repair` stewardship changes produce audible room differences | `/ops/` quick status actions only matter if the room actually responds | deployment policy, thread signals, status pickers, room-loop behavior | run a short annotated playback session and log whether status changes alter recurrence within the expected horizon | `TODO` |
| Ubuntu appliance bootstrap reduces install-day drift | First deployment depends more on reproducible host posture than elegant scripts | Ubuntu bootstrap script and host recipe docs | rehearse from a fresh `Ubuntu Server 24.04.4 LTS` image and record exact elapsed time plus surprises | `TODO` |
| `/ops/` monitor check language prevents false confidence | Stewards should not mistake local browser routing proof for whole-system proof | sharper `/ops/` wording and runbook warnings | ask a new steward to explain what the monitor check proves after using it once | `TODO` |
| Coverage gate plus default Playwright slice catch common regressions before deploy | The stack now claims a testing-ready posture | CI gate, Python/Node coverage thresholds, browser subset | track the next several regressions and note whether the default gate would have caught them | `PARTIAL` |

## Good Experimental Passes To Run Next

- Run a receipt-to-revocation rehearsal with someone who did not build the stack.
- Restore an export bundle onto a clean throwaway install using only [maintenance.md](./maintenance.md) and the bundle contents.
- Record the same small prompt set under `memory`, `question`, and `repair`, then compare prompt-pack effect, room resurfacing, and operator posture.
- Flip `question` and `repair` lifecycle statuses in `/ops/` during a controlled room session and note the audible recurrence delay.
- Rehearse a fresh Ubuntu appliance bootstrap from blank host to serviceable `/kiosk/`, `/room/`, and `/ops/`.

## Evidence To Capture During Each Pass

- exact date and machine/build SHA
- deployment kind and installation profile
- who ran the pass and whether they were already familiar with the stack
- whether the proof passed, partially passed, or failed
- screenshots, logs, or notes that explain what actually happened
- one concrete follow-up, not a vague impression

## TODO Notes

- Add a small appendix linking each proof item back to the code seams or docs it is exercising.
- Decide whether proof runs should live only in docs or also in a machine-readable checklist under `scripts/` or `test-results/`.
- Add one completed proof example here after the first formal rehearsal so future maintainers can see the intended level of specificity.
