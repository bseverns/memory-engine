# Memory Engine — Confessional Kiosk (v0 skeleton)

Local-first “room memory” appliance: record a short sound offering, choose consent, receive a revoke code, and let the room replay contributions with **very light decay per access**. Nodes are offline/local-first by design.

## What you get in this skeleton
- Django + DRF API (Artifacts, Pool playback, Revocation, Node status)
- Postgres for metadata
- MinIO for blob storage (raw audio + spectrogram / essence fossils)
- Redis + Celery (+ Beat) for background jobs (derivative generation + expiry)
- Separate client surfaces: `/kiosk/` for recording and `/room/` for dedicated playback
- “Don’t save” = **play once immediately, then discard**

## Quick start
1) Install Docker + Docker Compose.
2) Copy env:
```bash
cp .env.example .env
```
3) Build + run:
```bash
docker compose up --build
```
4) Open:
- Kiosk: http://localhost/kiosk/
- Room playback: http://localhost/room/
- Admin: http://localhost/admin/  (creates a default superuser in dev; see logs)
- Ops: http://localhost/ops/

`/ops/` now requires the shared steward secret from `OPS_SHARED_SECRET`.

For a real multi-machine install, the intended role split is:
- recording machine opens `/kiosk/`
- playback machine opens `/room/`
- steward/operator machine opens `/ops/`

## Server deployment: public IP now, domain later
The compose stack is set up for a reverse proxy in front of Django:
- `caddy` is the public entrypoint on `80/443`
- Django runs behind it via `gunicorn`
- static files are served through Django/WhiteNoise
- MinIO is no longer exposed publicly by default
- `/healthz` exposes dependency readiness for operators and container health checks

The fastest path on a fresh server is the deploy script:

```bash
./scripts/first_boot.sh --public-host 203.0.113.10 --deploy
```

If you prefer to separate secret generation from deployment:

```bash
./scripts/first_boot.sh --public-host 203.0.113.10
./scripts/deploy.sh --public-host 203.0.113.10
```

If the kiosk device needs recording before DNS exists and you control that device's trust store, use:

```bash
./scripts/deploy.sh --public-host 203.0.113.10 --tls internal
```

Later, when DNS exists:

```bash
./scripts/deploy.sh --public-host memory.example.com
```

What the script does:
- creates `.env` from `.env.example` if needed
- writes the public host, Caddy site address, Django allowed hosts, and CSRF trusted origins
- generates a fresh `OPS_SHARED_SECRET` if the default placeholder is still present
- turns off Django debug mode and dev superuser bootstrap
- refuses to deploy if obvious dev secrets are still unchanged
- runs `docker compose up --build -d`

For a server that is already bootstrapped and just needs the usual
`pull -> test -> backup -> deploy -> status` cycle, use:

```bash
./scripts/update.sh --public-host memory.example.com
```

That wrapper will:
- fast-forward pull the current branch from `origin`
- run `./scripts/check.sh`
- run `./scripts/doctor.sh`
- create a backup
- deploy the stack
- print final status and readiness

Useful flags:

```bash
./scripts/update.sh --public-host memory.example.com --skip-pull
./scripts/update.sh --public-host 203.0.113.10 --tls internal
./scripts/update.sh --public-host memory.example.com --branch main
```

Backup and restore helpers are included for operators:

```bash
./scripts/backup.sh
./scripts/restore.sh --from backups/20260317-120000
./scripts/export_bundle.sh --latest
./scripts/support_bundle.sh
```

Fast maintenance helpers are also included:

```bash
./scripts/check.sh
./scripts/status.sh
./scripts/doctor.sh
```

GitHub Actions runs that same `./scripts/check.sh` gate from a repo-local
`.venv`, so CI matches the local maintenance path instead of using a different
test command.

At process startup, Django now also validates the runtime config shape beyond
secret presence: threshold ordering, secure-origin posture, MinIO endpoint
scheme, and other range relationships fail fast instead of surfacing later as
ambiguous runtime behavior.

Public ingest is also hardened server-side now: the API enforces a maximum WAV
upload size, a maximum recording duration, PCM 16-bit mono WAV validation, and
IP-based throttling on ingest and revoke endpoints instead of trusting the
browser's reported duration alone.

For common installs, you can also start from a named behavior preset:

```env
INSTALLATION_PROFILE=shared_lab
```

Available profiles:
- `custom`: no bundled behavior overrides
- `quiet_gallery`: quieter pacing and softer overnight posture
- `shared_lab`: balanced defaults for a multi-surface lab or classroom
- `active_exhibit`: quicker pacing and stronger layering for busier public use

Explicit env vars still win over the profile, so the profile is a starting
point rather than a lock-in.

For browser-level simulation and screenshots, the repo also supports a small
Playwright layer:

```bash
npm install
npx playwright install chromium
npm run screenshots
```

That starts Django with the browser test settings, opens the recording kiosk,
the dedicated playback surface, and the operator dashboard in headless
Chromium, and writes example screenshots under `artifacts/screenshots/`.
The browser walkthrough now also signs into `/ops/`, applies live steward
controls, and captures how `/kiosk/` and `/room/` react to those changes.

Longer operator notes live in `docs/maintenance.md`.
That includes a MinIO section covering which credentials live where, what is set before first deploy, and how manual MinIO provisioning changes the `.env` values.
The install-day hardware and kiosk checklist lives in `docs/installation-checklist.md`.
The explicit recorder/playback/operator role split lives in `docs/multi-machine-setup.md`.
The printable off-screen participant guidance lives in `docs/participant-prompt-card.md`.
The architecture and request-flow notes live in `docs/how-the-stack-works.md`.
The shortest browser/API boundary notes live in `docs/surface-contract.md`.

For a server reachable at `203.0.113.10`, set these values in `.env`:

```env
DJANGO_DEBUG=0
DJANGO_SECRET_KEY=replace-this
DJANGO_ALLOWED_HOSTS=203.0.113.10,localhost,127.0.0.1
DJANGO_CSRF_TRUSTED_ORIGINS=http://203.0.113.10,http://localhost,http://127.0.0.1
DEV_CREATE_SUPERUSER=0

APP_SITE_ADDRESS=:80
APP_TLS_DIRECTIVE=
```

Then bring the stack up:

```bash
docker compose up --build -d
```

At that point the site will be available at:
- `http://203.0.113.10/kiosk/`

Important browser constraint:
- the recording UI uses `getUserMedia`, so remote microphone capture usually needs `https://...` or `localhost`
- plain `http://203.0.113.10/...` is fine for viewing the site, but many browsers will block microphone recording there

If you need recording before DNS exists, the practical dedicated-kiosk workaround is:
```env
APP_SITE_ADDRESS=203.0.113.10
APP_TLS_DIRECTIVE=tls internal
DJANGO_ALLOWED_HOSTS=203.0.113.10,localhost,127.0.0.1
DJANGO_CSRF_TRUSTED_ORIGINS=https://203.0.113.10,http://localhost,http://127.0.0.1
DJANGO_SECURE_SSL_REDIRECT=1
DJANGO_SESSION_COOKIE_SECURE=1
DJANGO_CSRF_COOKIE_SECURE=1
```

That makes Caddy serve HTTPS with its own internal CA. This only works cleanly if you control the kiosk device and trust Caddy's root certificate there. It is not appropriate for general public browsers.

When the real domain exists later, switch to:

```env
APP_SITE_ADDRESS=memory.example.com
APP_TLS_DIRECTIVE=
DJANGO_ALLOWED_HOSTS=memory.example.com,203.0.113.10,localhost,127.0.0.1
DJANGO_CSRF_TRUSTED_ORIGINS=https://memory.example.com,http://localhost,http://127.0.0.1
DJANGO_SECURE_SSL_REDIRECT=1
DJANGO_SESSION_COOKIE_SECURE=1
DJANGO_CSRF_COOKIE_SECURE=1
```

Caddy will then be able to obtain a public certificate automatically, assuming ports `80` and `443` are open to the server.

## Notes

## Guided kiosk flow
- The kiosk UI now uses an explicit guided flow: `not armed` -> `armed` -> `recording` -> `review` -> `done`.
- The microphone stays asleep until the participant arms it, which makes the start of the interaction clearer and less intrusive.
- A short visual pre-roll countdown and a soft cue tone give the speaker a moment to settle before capture begins.
- The live meter now doubles as an explicit mic check, and recording shows both elapsed and remaining time with an auto-stop cap.
- Keyboard support is built in for kiosk deployments:
  - `Space` or `Enter` advances the primary action for the current state
  - `1`, `2`, `3` choose the memory mode after recording
  - `Esc` resets the session, or cancels the current take while recording
- Recorded takes now get light silence trimming, peak normalization, and short fades before upload.

## Raspberry Pi / Piper kit posture
- This frontend is still intentionally light: plain Django templates, plain CSS, and a single browser script. No front-end build step is required.
- The intended deployment is a Raspberry Pi 3 class device running the site in Chromium kiosk mode with a USB microphone attached.
- The guided prompts and large controls are designed to work with touch, mouse, or a simple keyboard, which fits a Piper kit enclosure better than precise small controls.
- The live mic meter is meant to give immediate confidence that the USB microphone is actually receiving sound before recording starts.

## Playback feel
- The room loop now uses a cooldown-aware weighted selection instead of always taking the first eligible artifact.
- Selection now also leans on age and recentness, so brand-new material does not dominate immediately and long-circulating material does not calcify into a fixed archive.
- Playback now alternates between fresher and more worn memories when possible, so the room has a stronger sense of temporal depth.
- A subtle room-tone bed rises when the pool is sparse and ducks under spoken material, which keeps silence from feeling like a broken system.
- The browser loop now composes short scenes instead of only picking one item at a time: it clusters related densities and moods, inserts occasional longer holds, and lets fresh/mid/worn material gather into phrases.
- The loop now moves through longer-form movements such as arrival, gathering, weathering, and release, so pacing can shift across a wider span instead of only reacting clip-to-clip.
- Playback applies loudness smoothing, gentle fades, and a small gap between loop items so the room feels less abrupt and less repetitive.

## Audience experience notes
- The playback system is trying to feel composed rather than merely shuffled. It asks for kinds of memories, not exact files, and then lets weighted randomness keep the room alive.
- `fresh`, `mid`, and `worn` are not just technical labels. They are the main temporal language of the room: newer offerings feel nearer, older and repeatedly heard offerings feel more weathered.
- Intentional pauses are part of the piece. Some moments hold only the room-tone bed on purpose so the space can breathe between voices.
- Wear is meant to read as patina, not collapse. As memories are replayed, they lose a little brightness, pick up a little grain, and settle further into the room without turning into a gimmicky lo-fi effect.
- Loudness is gently normalized so a quiet speaker and a loud speaker can coexist in the same installation without the room feeling jumpy or broken.
- The scene logic reacts to recent playback so the system can counterbalance itself: too much worn material opens toward fresher space, and dense clusters are often followed by more suspended moments.
- A longer movement cycle sits above that local counterbalance. The room can spend a few memories gathering energy, drift into weathered material, and then open back out rather than staying in one perpetual middle state.

## Operator view
- `/ops/` now sits behind the shared steward secret in `OPS_SHARED_SECRET`.
- After sign-in, `/ops/` provides the node state (`ready`, `degraded`, `broken`), dependency checks, current artifact counts, and a quick view of fresh/mid/worn lane balance.
- `/ops/` also carries live steward controls for maintenance mode, pausing intake, pausing playback, and switching the room into a quieter mode.
- `/ops/` now includes a retention view for raw-audio expiry pressure and fossil hold posture.
- `/ops/` recent events now include revocations, restores, exports, and live control changes.

## Decay feel tuning (v0)
The kiosk applies **stateful wear** on each playback (raw audio remains immutable). Wear is stored server-side and mapped to gentle “memory loss” effects client-side (WebAudio).

Recommended starting values:
- `WEAR_EPSILON_PER_PLAY=0.003` (about 300 plays to reach full patina)
- Lowpass gradually reduces “air” (but never collapses to a telephone filter)
- Bit reduction stays subtle (16→12 bits) + slight sample-hold grain
- Noise floor rises very slightly (like tape hiss), no harsh dropouts

If you want faster/stronger change, raise epsilon to `0.005–0.01`.

- This is a **skeleton**: the policies are minimal but the architecture is ready to evolve.
- Blob access is proxied through Django, so the kiosk can fetch audio without MinIO CORS config.
- The decay is “stateful wear”: raw audio is immutable; wear accumulates and is applied during playback.

## Directory map
- `docker-compose.yml` — full local node stack
- `docs/maintenance.md` — deployment, status, backup, restore, and troubleshooting runbook
- `docs/how-the-stack-works.md` — architecture, request flows, playback model, storage, and testing notes
- `docs/installation-checklist.md` — hardware, browser kiosk mode, audio, and auto-start install checklist
- `docs/roadmap.md` — landed changes and the next likely improvements
- `scripts/check.sh` — browser syntax, frontend smoke tests, Django behavior tests, and patch-hygiene validation
- `scripts/clean_local.sh` — clear regenerable local caches such as `api/.test-cache`, `__pycache__`, and Playwright output
- `scripts/doctor.sh` — operator-focused env, compose, storage, and browser-constraint checks
- `scripts/deploy.sh` — server-side deploy helper for IP-now / domain-later rollout
- `scripts/update.sh` — server-side pull, verify, backup, deploy, and status helper for existing installs
- `scripts/first_boot.sh` — bootstrap strong secrets and node identity before deployment
- `scripts/backup.sh` — snapshot Postgres + MinIO data
- `scripts/restore.sh` — restore Postgres + MinIO data from a backup folder
- `scripts/export_bundle.sh` — package one backup snapshot into a portable handoff archive with checksums
- `scripts/support_bundle.sh` — gather redacted env, health, status, and recent logs for remote support
- `scripts/status.sh` — compose and backend readiness summary for operators
- `api/` — Django project + Celery worker
- `api/engine/` — models, API endpoints, tasks
- `api/engine/templates/engine/kiosk.html` — kiosk UI
- `api/engine/static/engine/kiosk.js` — recording/playback + light decay

## Next obvious extensions
- Node-as-AP mode scripts (captive portal) for true “room Wi‑Fi”
- Policy editor UI (Decay Policy DSL)
- Export bundles (fossils + anonymized stats) to USB
- Federation (fossil-only sync between nodes)
