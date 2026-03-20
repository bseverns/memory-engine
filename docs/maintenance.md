# Maintenance Runbook

This project is intentionally light on moving parts, but the operator path is still easier if there is one place to look for the recurring commands.

## Operator shortcuts

Bootstrap a new server:

```bash
./scripts/first_boot.sh --public-host 203.0.113.10 --deploy
```

Re-deploy after code or config changes:

```bash
./scripts/update.sh --public-host 203.0.113.10
```

Run the fast repo checks before deploy:

```bash
./scripts/check.sh
```

Clear local cache and test/browser noise when this clone has been used for
setup or diagnostics:

```bash
./scripts/clean_local.sh
```

Run the operator doctor for env, browser, and storage posture:

```bash
./scripts/doctor.sh
```

Walk through the install-day hardware and kiosk checklist:

```bash
open docs/installation-checklist.md
```

See service state and backend readiness:

```bash
./scripts/status.sh
```

Tail recent logs for one service:

```bash
./scripts/status.sh --logs api
./scripts/status.sh --logs worker --tail 80
```

Create a backup:

```bash
./scripts/backup.sh
```

Create a portable export bundle from the latest backup:

```bash
./scripts/export_bundle.sh --latest
```

Restore a backup:

```bash
./scripts/restore.sh --from backups/20260317-120000
```

Create a remote-friendly support bundle with logs and health snapshots:

```bash
./scripts/support_bundle.sh
```

## What each script is for

- `scripts/first_boot.sh` creates `.env` if needed, replaces development defaults, and optionally chains into deployment.
- `scripts/deploy.sh` writes host and TLS settings into `.env`, refuses obvious development secrets, and runs compose.
- `scripts/update.sh` is the normal existing-server path: fast-forward pull, checks, doctor, backup, deploy, and final status.
- `scripts/check.sh` is the quick sanity pass for browser JavaScript syntax, frontend smoke tests, Python, the Django behavior suite, shell syntax, and `git diff --check`.
- `scripts/clean_local.sh` removes regenerable local caches such as `api/.test-cache`, `__pycache__`, and Playwright output. Pass `--include-screenshots` if you also want to clear generated screenshots.
- `.github/workflows/check.yml` runs that same `scripts/check.sh` gate in GitHub Actions using a repo-local `.venv`, so CI stays aligned with the local check path.
- `scripts/doctor.sh` checks `.env`, compose state, MinIO reachability through `/healthz`, and browser/TLS constraints that affect recording.
- `scripts/browser_kiosk.sh` launches Chromium into `/kiosk/`, `/room/`, or `/ops/` with a repeatable kiosk-safe flag set. The `/room/` role adds autoplay-hardening flags automatically.
- `scripts/status.sh` prints `docker compose ps` and then fetches `/healthz` from inside the API container.
- `scripts/backup.sh` writes timestamped Postgres and MinIO snapshots into `backups/`.
- `scripts/restore.sh` restores one of those snapshots into the current stack and now asks for explicit confirmation plus a fresh pre-restore snapshot by default.
- `scripts/export_bundle.sh` packages one backup snapshot into a portable `.tgz` with a manifest and checksums.
- `scripts/support_bundle.sh` gathers a redacted `.env`, `/healthz`, compose status, doctor output, and recent logs into a single handoff archive.
- `docs/installation-checklist.md` is the install-day checklist for kiosk hardware, browser mode, audio routing, and auto-start verification.
- Django also validates runtime config relationships at startup now, so bad threshold ordering or insecure origin posture fails fast before the stack enters service.
- `INSTALLATION_PROFILE` can provide a named starting posture for room behavior and kiosk defaults. Explicit env vars still override profile defaults.
- Public write paths are also guarded by server-side WAV validation and two-layer DRF throttling: a kiosk-friendly client limit plus a broader IP abuse ceiling. If you tune those limits, update `INGEST_MAX_UPLOAD_BYTES`, `INGEST_MAX_DURATION_SECONDS`, `PUBLIC_INGEST_RATE`, `PUBLIC_INGEST_IP_RATE`, `PUBLIC_REVOKE_RATE`, and `PUBLIC_REVOKE_IP_RATE` together.
- Leave `DJANGO_TRUST_X_FORWARDED_FOR=0` unless your reverse proxy strips and rewrites forwarded headers correctly. If you turn it on, throttling and steward network allowlists will trust that header.
- `/healthz` and `/ops/` now also expect fresh Celery worker and beat heartbeats. If Redis is up but those heartbeats go stale, the node should show degraded rather than falsely green.
- Operator sessions now default to `OPS_SESSION_BINDING_MODE=user_agent`, which is less brittle than pinning to the steward IP. Use `strict` if you explicitly want IP+browser binding, or `none` for a very trusted single-site install.

## Runtime contract

The official supported runtime is the Docker Compose stack, with the API image
from [api/Dockerfile](/Users/bseverns/Documents/GitHub/memory-engine-kiosk/api/Dockerfile) pinned to Python `3.12`.

What that means in practice:

- deployment and operator guidance assume the containerized stack
- `docker compose up --build` is the source-of-truth runtime
- `./scripts/check.sh` is the source-of-truth repo gate
- local `.venv` usage is still useful, but it is a convenience path rather than the primary support contract

If `./scripts/check.sh` reports a host Python other than `3.12`, treat that as
best-effort local maintenance. It may still work, but the repo does not promise
that every dependency will install or behave identically outside the container.

Current bundled installation profiles:

- `custom`: no bundled behavior defaults beyond the normal repo baseline
- `quiet_gallery`: slower pacing, gentler tone, and quiet-hours enabled
- `shared_lab`: balanced defaults for a recording kiosk plus a separate playback surface
- `active_exhibit`: quicker pacing, shorter slice windows, and more overlap

## Standard maintenance flow

For a normal update on an existing server:

```bash
./scripts/update.sh --public-host memory.example.com
```

That is the default conservative path for an existing server. It will:

1. Fast-forward pull the current branch from `origin`.
2. Run `./scripts/check.sh`.
3. Run `./scripts/doctor.sh`.
4. Run `./scripts/backup.sh`.
5. Run `./scripts/deploy.sh --public-host ...`.
6. Run `./scripts/status.sh`.

Then open `/ops/` and confirm the node is `ready` with no critical storage or pool warnings.
Sign in there with `OPS_SHARED_SECRET`; the dashboard now protects live operator controls behind that shared secret, optional trusted-network rules, login lockout, and browser-bound steward sessions.

That sequence is deliberately conservative. The extra backup step matters more here than squeezing a few seconds out of deploy time.

If you need to skip one phase intentionally:

```bash
./scripts/update.sh --public-host memory.example.com --skip-pull
./scripts/update.sh --public-host memory.example.com --skip-backup
./scripts/update.sh --public-host 203.0.113.10 --tls internal
```

## Health and readiness

There are three practical health surfaces:

- `docker compose ps` tells you whether the containers are running and whether Docker thinks health checks are passing.
- `/healthz` is the backend readiness view and is the source used by the API container health check.
- `/ops/` is the human-facing dashboard for steward use during install or troubleshooting.
- `/ops/` is now the authenticated steward surface. It exposes maintenance mode, pause-intake, pause-playback, and quieter-mode controls once the steward secret is accepted.
- `/ops/` can also be narrowed to trusted IPs or CIDR ranges with `OPS_ALLOWED_NETWORKS`.
- repeated bad sign-in attempts now lock out temporarily based on `OPS_LOGIN_MAX_ATTEMPTS` and `OPS_LOGIN_LOCKOUT_SECONDS`.
- `/ops/` also reports retention posture: raw audio still held, raw audio expiring soon, fossils retained, and fossils that now exist only as residue.
- For unattended listening machines, launch Chromium through `./scripts/browser_kiosk.sh --role room --base-url ...` so the browser picks up the autoplay-safe flags instead of relying on a one-tap recovery after every reboot.

Expected healthy services:

- `proxy`
- `api`
- `db`
- `redis`
- `minio`
- `worker`
- `beat`

`minio_init` is expected to complete and exit.

## Logs

Quick compose commands if the helper script is not enough:

```bash
docker compose ps
docker compose logs --tail 100 api
docker compose logs --tail 100 worker
docker compose logs --tail 100 proxy
```

If the operator dashboard says `degraded` or `broken`, look at `api` first. If the API is healthy but playback is missing, inspect `worker`, `beat`, and `minio`.

## Backup and restore notes

Backups currently capture:

- Postgres metadata as `postgres.sql.gz`
- MinIO object data as `minio-data.tgz`

Each backup lands under `backups/YYYYMMDD-HHMMSS/` with a small manifest file.

Restore cautions:

- `scripts/restore.sh` replaces the current database contents.
- `scripts/restore.sh` replaces the current MinIO object store.
- `scripts/restore.sh` now takes that fresh pre-restore backup automatically unless you pass `--skip-snapshot`.
- `scripts/restore.sh` also asks you to type `RESTORE` unless you pass `--yes`.
- Expect active playback and ingest to be interrupted during restore.

Export bundle notes:

- `scripts/export_bundle.sh --latest` packages the newest backup into `exports/`.
- Each export includes the Postgres dump, MinIO archive, source manifest, a bundle manifest, and `CHECKSUMS.txt`.
- Use export bundles for migration, archival handoff, or off-machine storage where a single file is easier to manage than a backup folder.

Support bundle notes:

- `scripts/support_bundle.sh` writes into `support-bundles/`.
- It includes redacted environment values, compose status, doctor output, `/healthz`, and recent logs for the main services.
- It is meant for remote troubleshooting without handing over shell access or the raw `.env`.

## MinIO setup notes

This stack uses MinIO only as private object storage for raw audio and derivatives. It is not intended to be exposed publicly by default.

Where each setting lives:

- `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD` are read by the `minio` container itself. These are the bootstrap admin credentials for the MinIO server.
- `MINIO_ENDPOINT`, `MINIO_BUCKET`, `MINIO_ACCESS_KEY`, and `MINIO_SECRET_KEY` are read by `api`, `worker`, `beat`, and `minio_init`.
- `docker-compose.yml` binds MinIO to `127.0.0.1:9000` and the MinIO console to `127.0.0.1:9001`, so server-root access or an SSH tunnel is the normal way to inspect it directly.

What to set before the first deploy:

- Set strong values for `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD`.
- Set `MINIO_BUCKET` to the bucket name you want the app to use. The default `memory` is fine unless you need a different naming scheme.
- Leave `MINIO_ENDPOINT=http://minio:9000` if MinIO stays inside this compose stack. That internal service name is what the app expects.

Current repo behavior:

- The simplest supported path is to keep `MINIO_ACCESS_KEY` equal to `MINIO_ROOT_USER`.
- The simplest supported path is to keep `MINIO_SECRET_KEY` equal to `MINIO_ROOT_PASSWORD`.
- In that mode, `minio_init` uses those credentials to create the bucket on first boot, and the Django/Celery services use the same credentials to read and write objects afterward.

Current recommendation:

- For the simplest single-node installation, reusing the root-backed credentials is still acceptable.
- For a production or longer-lived installation, prefer a separate MinIO service identity for `MINIO_ACCESS_KEY` and `MINIO_SECRET_KEY`.
- That keeps the app off the MinIO admin identity and makes later credential rotation cleaner.

If you want to provision MinIO manually:

- You can create a separate MinIO user or service account yourself because you have root on the server.
- If you do that, set `MINIO_ACCESS_KEY` and `MINIO_SECRET_KEY` in `.env` to that non-root identity.
- That identity needs permission to read, write, list, and delete objects in `MINIO_BUCKET`.
- `minio_init` still tries to ensure the bucket exists using `MINIO_ACCESS_KEY` and `MINIO_SECRET_KEY`, so that identity also needs permission to create the bucket, or you need to create the bucket yourself before deploy.

When to change what:

- Before first deploy: set all MinIO env vars in `.env`.
- When rotating the MinIO root/admin credentials: update `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD`, and also update `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` if the app is still using the root identity.
- When rotating only the app/service identity: update `MINIO_ACCESS_KEY` and `MINIO_SECRET_KEY`, then re-run deployment so `api`, `worker`, `beat`, and `minio_init` pick up the new values.
- When changing `MINIO_BUCKET`: create the new bucket first or let `minio_init` create it, then redeploy the stack so all services point at the same place.
- When moving MinIO outside this compose stack: change `MINIO_ENDPOINT` to the external S3-compatible endpoint and verify network reachability from the `api` container.

Rotation notes:

- Django secret rotation: update `DJANGO_SECRET_KEY` in `.env`, redeploy, and expect session invalidation.
- Steward secret rotation: update `OPS_SHARED_SECRET` in `.env`, redeploy, and expect current `/ops/` sessions to sign in again.
- Postgres password rotation: rotate `POSTGRES_PASSWORD` in both the `db` service and the application `.env`, then redeploy together.
- MinIO app/service credential rotation: update `MINIO_ACCESS_KEY` and `MINIO_SECRET_KEY`, ensure the MinIO identity already exists with bucket read/write/list/delete access, then redeploy.
- MinIO root/admin credential rotation: update `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD`, and also update app credentials if the app still shares that same identity.

External S3-compatible migration notes:

- Pre-create the destination bucket and grant the app identity read, write, list, and delete permissions there.
- Copy object data from the existing MinIO bucket before changing `.env`.
- Update `MINIO_ENDPOINT`, `MINIO_BUCKET`, `MINIO_ACCESS_KEY`, and `MINIO_SECRET_KEY`.
- Run `./scripts/check.sh`, then redeploy and confirm `/healthz` plus a real playback request from `/room/`.
- Keep the old MinIO data untouched until `/ops/` reports healthy storage and the room has successfully played migrated audio.

Versioning and object-locking notes:

- Leave MinIO bucket versioning and object locking disabled by default in this stack.
- The current retention and revocation model expects real deletes to succeed for raw audio and derivatives.
- If policy ever requires object locking, treat that as a deeper storage-policy project rather than a flip-the-switch operator task.

Practical verification after deploy:

```bash
docker compose logs --tail 100 minio
docker compose logs --tail 100 minio_init
docker compose exec -T api curl -fsS http://localhost:8000/healthz
```

If you want to inspect the MinIO console directly on the server, use `http://127.0.0.1:9001` locally on that machine or tunnel it over SSH.

## Common operator failure modes

### `/ops/` loads a sign-in page, but the secret never works

Check `OPS_SHARED_SECRET` in `.env`, then redeploy. `scripts/first_boot.sh` now generates that value automatically if it is still a placeholder.
If `OPS_ALLOWED_NETWORKS` is set, also confirm the current steward machine IP falls inside one of those ranges.
If repeated attempts were made with the wrong secret, wait for the `OPS_LOGIN_LOCKOUT_SECONDS` window to expire before retrying.

### The site loads but recording will not start

The browser microphone API usually requires `https://` or `localhost`. A plain remote `http://IP/...` URL often renders the page but blocks recording.

### `/healthz` fails after deploy

Check service order and dependency state:

- `db` health
- `redis` health
- `minio` reachability
- MinIO bucket and credentials in `.env`
- `api` logs for migration or environment errors

### Playback pool feels empty or repetitive

Check `/ops/` first. If artifact counts are low, the system may be behaving correctly and just has little material to work with. If counts are healthy, inspect the browser kiosk and worker logs.

### Restore completed but the kiosk still looks stale

Refresh the browser kiosk and re-run `./scripts/status.sh`. If the containers restarted cleanly, stale browser state is usually the issue before backend state is.

## Ownership notes

- `.env` is operator-owned state. Treat it as part of deployment, not source control.
- `backups/` should be copied off-machine if the installation matters.
- `docs/roadmap.md` tracks future improvements; this file is for recurring operations, not product planning.
