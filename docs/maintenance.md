# Maintenance Runbook

This project is intentionally light on moving parts, but the operator path is still easier if there is one place to look for the recurring commands.

## Operator shortcuts

Bootstrap a new server:

```bash
./scripts/first_boot.sh --public-host 203.0.113.10 --deploy
```

Re-deploy after code or config changes:

```bash
./scripts/deploy.sh --public-host 203.0.113.10
```

Run the fast repo checks before deploy:

```bash
./scripts/check.sh
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

Restore a backup:

```bash
./scripts/restore.sh --from backups/20260317-120000
```

## What each script is for

- `scripts/first_boot.sh` creates `.env` if needed, replaces development defaults, and optionally chains into deployment.
- `scripts/deploy.sh` writes host and TLS settings into `.env`, refuses obvious development secrets, and runs compose.
- `scripts/check.sh` is the quick sanity pass for JavaScript, Python, shell syntax, and `git diff --check`.
- `scripts/status.sh` prints `docker compose ps` and then fetches `/healthz` from inside the API container.
- `scripts/backup.sh` writes timestamped Postgres and MinIO snapshots into `backups/`.
- `scripts/restore.sh` restores one of those snapshots into the current stack.

## Standard maintenance flow

For a normal update on an existing server:

1. Pull the latest repo state.
2. Review `.env` if the change introduces new settings.
3. Run `./scripts/check.sh`.
4. Run `./scripts/backup.sh`.
5. Run `./scripts/deploy.sh --public-host ...`.
6. Run `./scripts/status.sh`.
7. Open `/ops/` and confirm the node is `ready`.

That sequence is deliberately conservative. The extra backup step matters more here than squeezing a few seconds out of deploy time.

## Health and readiness

There are three practical health surfaces:

- `docker compose ps` tells you whether the containers are running and whether Docker thinks health checks are passing.
- `/healthz` is the backend readiness view and is the source used by the API container health check.
- `/ops/` is the human-facing dashboard for steward use during install or troubleshooting.

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
- Take a fresh backup before restoring if there is any chance the current state matters.
- Expect active playback and ingest to be interrupted during restore.

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

Practical verification after deploy:

```bash
docker compose logs --tail 100 minio
docker compose logs --tail 100 minio_init
docker compose exec -T api curl -fsS http://localhost:8000/healthz
```

If you want to inspect the MinIO console directly on the server, use `http://127.0.0.1:9001` locally on that machine or tunnel it over SSH.

## Common operator failure modes

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
