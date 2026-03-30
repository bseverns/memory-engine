# At-A-Glance Guide

Use this file when you need the shortest practical map of the machine:

- what each surface and subsystem does
- where its code lives
- which settings usually matter first
- what to inspect when something starts to drift or fail

If you need installation-day steps, use [maintenance.md](./maintenance.md).
If you need full architecture detail, use [how-the-stack-works.md](./how-the-stack-works.md).
If you need deployment temperament detail, use [DEPLOYMENT_BEHAVIORS.md](./DEPLOYMENT_BEHAVIORS.md).
If you need the shortest explicit browser/API boundary rules, use [surface-contract.md](./surface-contract.md).
If you need the current hardware trigger path for `/kiosk/`, use [HANDS_FREE_CONTROLS.md](./HANDS_FREE_CONTROLS.md).
If you need the shortest non-author recovery ritual, use [OPERATOR_DRILL_CARD.md](./OPERATOR_DRILL_CARD.md).

Reference host image right now:

- `Ubuntu Server 24.04.4 LTS`

As of `March 30, 2026`, that is the stable Ubuntu target to standardize on.
Ubuntu `26.04 LTS` is still beta until its expected final release on
`April 23, 2026`.

## Start Here

If you are:

- an operator trying to recover the node: start with [maintenance.md](./maintenance.md), then come back here for subsystem ownership and knobs
- a maintainer trying to find the right file fast: start with the map below, then jump into the listed code paths
- tuning room feel rather than fixing a fault: start with `INSTALLATION_PROFILE` and `ENGINE_DEPLOYMENT` before touching lower-level `ROOM_*` and `POOL_*` values

## System Map

| Concern | What it does | Main code | First knobs | First checks when it breaks |
|---|---|---|---|---|
| Recording kiosk | Captures audio, guides review, submits artifacts | `api/engine/templates/engine/kiosk.html`, `api/engine/static/engine/kiosk.js`, `api/engine/static/engine/kiosk-copy.js`, `api/engine/api_views.py` | `KIOSK_DEFAULT_MAX_RECORDING_SECONDS`, `INGEST_MAX_DURATION_SECONDS`, `INGEST_MAX_UPLOAD_BYTES`, `ENGINE_DEPLOYMENT` | browser mic permission, `/healthz`, ingest throttles in `/ops/`, `api` logs |
| Room playback | Chooses artifacts, composes pacing, plays the room loop | `api/engine/views.py`, `api/engine/pool.py`, `api/engine/deployment_policy.py`, `api/engine/static/engine/kiosk-room-loop*.js` | `INSTALLATION_PROFILE`, `ENGINE_DEPLOYMENT`, `ROOM_*`, `POOL_*`, `WEAR_EPSILON_PER_PLAY` | `/readyz`, `/api/v1/pool/next`, `/api/v1/surface/state`, `/ops/` pool warnings |
| Operator dashboard | Shows health, warnings, controls, recent artifact stewardship, and local monitor verification | `api/engine/templates/engine/operator_dashboard.html`, `api/engine/static/engine/operator-dashboard.js`, `api/engine/api_views.py`, `api/engine/ops.py`, `api/engine/steward.py` | `OPS_SHARED_SECRET`, `OPS_ALLOWED_NETWORKS`, `OPS_SESSION_BINDING_MODE`, `OPS_LOGIN_*`, `OPS_DISK_*`, `OPS_POOL_*` | `/ops/`, `/api/v1/node/status`, auth settings, browser mic permission on `/ops/`, `api` logs |
| Background jobs | Generates derivatives, expires raw audio, keeps fossils and cleanup moving | `api/engine/tasks.py`, `api/engine/ops.py`, Celery worker and beat | `RAW_TTL_HOURS_ROOM`, `RAW_TTL_HOURS_FOSSIL`, `DERIVATIVE_TTL_DAYS_FOSSIL`, `OPS_WORKER_HEARTBEAT_MAX_AGE_SECONDS`, `OPS_BEAT_HEARTBEAT_MAX_AGE_SECONDS` | `/readyz`, worker logs, beat logs, queue depth warnings in `/ops/` |
| Runtime configuration | Loads env, applies installation/deployment defaults, rejects bad config | `api/memory_engine/settings.py`, `api/memory_engine/installation_profiles.py`, `api/memory_engine/deployments.py`, `api/memory_engine/config_validation.py` | `INSTALLATION_PROFILE`, `ENGINE_DEPLOYMENT`, `CACHE_URL`, `MINIO_*`, `DJANGO_*`, `OPS_*` | startup failure text, `docker compose logs api`, config validation errors |
| Storage and state | Stores metadata, audio bytes, cache-backed shared state | Postgres, MinIO, Redis, plus `api/engine/storage.py`, `api/engine/models.py`, `api/engine/media_access.py` | `MINIO_*`, `DATABASE_URL`, `CACHE_URL`, `OPS_STORAGE_PATH` | `/healthz`, MinIO reachability, Redis/cache reachability, disk warnings in `/ops/` |

## First Knobs By Intent

Start with the highest-level knob that matches the problem. Avoid diving straight into lower-level tuning unless the broad setting is already correct.

### Overall room temperament

Use these first:

- `INSTALLATION_PROFILE`: bundled site posture such as `shared_lab`, `quiet_gallery`, or `active_exhibit`
- `ENGINE_DEPLOYMENT`: playback temperament such as `memory`, `question`, `repair`, `oracle`

Touch these only after the two settings above are right:

- `ROOM_INTENSITY_PROFILE`
- `ROOM_MOVEMENT_PRESET`
- `ROOM_TONE_PROFILE`

### Playback pacing and density

Use these when the room feels too busy, too quiet, or too repetitive:

- `ROOM_OVERLAP_CHANCE`
- `ROOM_OVERLAP_MAX_LAYERS`
- `ROOM_ANTI_REPETITION_WINDOW_SIZE`
- `POOL_PLAY_COOLDOWN_SECONDS`
- `ROOM_SCARCITY_LOW_THRESHOLD`
- `ROOM_SCARCITY_SEVERE_THRESHOLD`

Rule of thumb:

- if the room feels too crowded, lower overlap before changing selection math
- if the room repeats too soon, raise anti-repetition and cooldown before changing deployment policy
- if the room feels too sleepy, start with installation profile or intensity profile before lowering safety rails

### Deployment feel

Use these when the active deployment is technically working but feels wrong:

- `ENGINE_DEPLOYMENT`
- artifact metadata: `topic_tag` and `lifecycle_status`
- `api/engine/deployment_policy.py`
- `docs/DEPLOYMENT_BEHAVIORS.md`

Practical reminder:

- `question` depends on unresolved statuses and topics
- `repair` depends on practical statuses and topics
- if operators do not steward those fields at all, deployment differences flatten out

### Ingest limits and public pressure

Use these when recordings are rejected, cut off, or throttled:

- `INGEST_MAX_UPLOAD_BYTES`
- `INGEST_MAX_DURATION_SECONDS`
- `PUBLIC_INGEST_RATE`
- `PUBLIC_INGEST_IP_RATE`
- `PUBLIC_REVOKE_RATE`
- `PUBLIC_REVOKE_IP_RATE`

Check `/ops/` first. If the dashboard already shows recent ingest or revoke denials, fix the budget posture before touching frontend code.

### Operator access and session posture

Use these when `/ops/` is inaccessible or stewards are getting locked out:

- `OPS_SHARED_SECRET`
- `OPS_ALLOWED_NETWORKS`
- `OPS_SESSION_BINDING_MODE`
- `OPS_LOGIN_LOCKOUT_SCOPE`
- `OPS_LOGIN_MAX_ATTEMPTS`
- `OPS_LOGIN_LOCKOUT_SECONDS`

### Health sensitivity and warning thresholds

Use these when the node is healthy enough to run but `/ops/` is warning too early or too late:

- `OPS_DISK_WARNING_FREE_GB`
- `OPS_DISK_WARNING_FREE_PERCENT`
- `OPS_DISK_CRITICAL_FREE_GB`
- `OPS_DISK_CRITICAL_FREE_PERCENT`
- `OPS_POOL_LOW_COUNT`
- `OPS_POOL_IMBALANCE_RATIO`
- `OPS_QUEUE_DEPTH_WARNING`
- `OPS_QUEUE_DEPTH_CRITICAL`
- `OPS_RETENTION_SOON_HOURS`

## Symptom Triage

### The kiosk cannot record

Check in this order:

1. browser microphone permission on `/kiosk/`
2. `/healthz`
3. ingest throttles and maintenance/intake pause in `/ops/`
4. `api` logs

Likely files:

- `api/engine/static/engine/kiosk-capture.js`
- `api/engine/static/engine/kiosk.js`
- `api/engine/api_views.py`

Likely knobs:

- `INGEST_MAX_DURATION_SECONDS`
- `INGEST_MAX_UPLOAD_BYTES`
- `PUBLIC_INGEST_RATE`
- `PUBLIC_INGEST_IP_RATE`

Practical note:

- if you only need to prove the current machine can hear the live mic path, do
  that from `/ops/` first. The kiosk monitor check is intentionally just an
  output tone.

### The room is silent or nearly silent

Check in this order:

1. `/readyz`
2. `/ops/` for playback pause, maintenance mode, storage warnings, and pool warnings
3. `/api/v1/pool/next`
4. room browser autoplay posture and output device

Likely files:

- `api/engine/pool.py`
- `api/engine/static/engine/kiosk-room-loop.js`
- `api/engine/static/engine/kiosk-room-loop-playback.js`

Likely knobs:

- `ROOM_INTENSITY_PROFILE`
- `ROOM_OVERLAP_CHANCE`
- `POOL_PLAY_COOLDOWN_SECONDS`
- `ROOM_SCARCITY_*`

### The room feels too repetitive

Check in this order:

1. active deployment in `/ops/`
2. recent artifact/topic metadata in `/ops/`
3. current anti-repetition and cooldown settings

Likely knobs:

- `ROOM_ANTI_REPETITION_WINDOW_SIZE`
- `POOL_PLAY_COOLDOWN_SECONDS`
- `ROOM_OVERLAP_CHANCE`

Likely code:

- `api/engine/pool.py`
- `api/engine/deployment_policy.py`

### The deployment does not feel distinct enough

Check in this order:

1. `ENGINE_DEPLOYMENT`
2. deployment metadata quality in recent artifacts
3. deployment policy and room-loop behavior docs

Likely files:

- `api/memory_engine/deployments.py`
- `api/engine/deployment_policy.py`
- `docs/DEPLOYMENT_BEHAVIORS.md`

### `/ops/` says degraded or broken

Check in this order:

1. which card is failing on `/ops/`
2. `/healthz`
3. `/readyz`
4. `docker compose logs api`
5. `docker compose logs worker` and `docker compose logs beat`

Likely knobs:

- `OPS_*` thresholds
- `OPS_WORKER_HEARTBEAT_MAX_AGE_SECONDS`
- `OPS_BEAT_HEARTBEAT_MAX_AGE_SECONDS`

Likely files:

- `api/engine/ops.py`
- `api/engine/operator_auth.py`

### Leonardo or kiosk shortcuts stop responding after reboot

Check in this order:

1. confirm Chromium is frontmost on `/kiosk/`
2. dismiss any restore bubble, permission prompt, or browser chrome that stole focus
3. test `Space` or `Escape` from a normal keyboard
4. relaunch with `./scripts/browser_kiosk.sh --role kiosk --base-url ...`

Likely files:

- `scripts/browser_kiosk.sh`
- `api/engine/static/engine/kiosk.js`
- `docs/HANDS_FREE_CONTROLS.md`

Likely cause:

- focus loss or bad reboot posture, not HID firmware drift
- `api/engine/static/engine/operator-dashboard.js`

### Startup fails before the node comes up

Check in this order:

1. config validation error text in `api` logs
2. `.env`
3. installation profile and deployment name

Likely files:

- `api/memory_engine/settings.py`
- `api/memory_engine/config_validation.py`
- `api/memory_engine/installation_profiles.py`

## File Shortcuts For Maintainers

When you need to change:

- runtime and env loading: `api/memory_engine/settings.py`
- runtime validation and fail-fast rules: `api/memory_engine/config_validation.py`
- deployment catalog and copy posture: `api/memory_engine/deployments.py`
- installation presets: `api/memory_engine/installation_profiles.py`
- ingest and API entrypoints: `api/engine/api_views.py`
- playback selection: `api/engine/pool.py`
- deployment-specific playback behavior: `api/engine/deployment_policy.py`
- room browser composition: `api/engine/static/engine/kiosk-room-loop.js`
- room browser pacing/tone policy: `api/engine/static/engine/kiosk-room-loop-policy.js`
- operator health/warnings: `api/engine/ops.py`
- steward controls and audit trail: `api/engine/steward.py`
- operator auth and lockout: `api/engine/operator_auth.py`

## Which Doc To Read Next

Read:

- [maintenance.md](./maintenance.md) for deploy, backup, restore, and live recovery commands
- [how-the-stack-works.md](./how-the-stack-works.md) for the full architecture and data flow
- [DEPLOYMENT_BEHAVIORS.md](./DEPLOYMENT_BEHAVIORS.md) for playback temperament and metadata-dependent behavior
- [multi-machine-setup.md](./multi-machine-setup.md) for recorder/playback/operator device split
- [installation-checklist.md](./installation-checklist.md) for install-day hardware and browser posture
