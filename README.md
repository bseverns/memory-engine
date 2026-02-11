# Memory Engine — Confessional Kiosk (v0 skeleton)

Local-first “room memory” appliance: record a short sound offering, choose consent, receive a revoke code, and let the room replay contributions with **very light decay per access**. Nodes are offline/local-first by design.

## What you get in this skeleton
- Django + DRF API (Artifacts, Pool playback, Revocation, Node status)
- Postgres for metadata
- MinIO for blob storage (raw audio + spectrogram PNG fossils)
- Redis + Celery (+ Beat) for background jobs (spectrogram generation + expiry)
- Kiosk UI: `/kiosk/` (record + consent + immediate playback for “Don’t save” + ambient pool loop)
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
- Kiosk: http://localhost:8000/kiosk/
- Admin: http://localhost:8000/admin/  (creates a default superuser in dev; see logs)

## Notes

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
- `api/` — Django project + Celery worker
- `api/engine/` — models, API endpoints, tasks
- `api/engine/templates/engine/kiosk.html` — kiosk UI
- `api/engine/static/engine/kiosk.js` — recording/playback + light decay

## Next obvious extensions
- Node-as-AP mode scripts (captive portal) for true “room Wi‑Fi”
- Policy editor UI (Decay Policy DSL)
- Export bundles (fossils + anonymized stats) to USB
- Federation (fossil-only sync between nodes)

