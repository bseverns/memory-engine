# Roadmap

## Landed In This Pass

### Operator / deployment
- Reverse-proxy deployment path with `caddy` + `gunicorn`
- `/healthz` endpoint for readiness checks
- Docker healthchecks for core services that have reliable built-in probes
- `/ops/` operator dashboard with `ready`, `degraded`, and `broken` states
- Shared-secret auth boundary for `/ops/` and protected operator APIs
- `scripts/first_boot.sh` to stamp out development defaults and set node identity
- `scripts/deploy.sh` for public-IP-now / domain-later rollout
- `scripts/backup.sh` and `scripts/restore.sh` for Postgres + MinIO recovery
- `scripts/export_bundle.sh` for portable archival or migration handoff bundles
- `scripts/support_bundle.sh` for remote-friendly support log collection
- Shared shell helpers to keep operator scripts consistent
- `scripts/check.sh` and `scripts/status.sh` for quicker maintenance passes
- `scripts/doctor.sh` to check `.env`, compose state, storage reachability, and browser/TLS constraints
- `docs/maintenance.md` as the steward runbook
- `docs/installation-checklist.md` for kiosk hardware, browser kiosk mode, audio routing, and auto-start
- `README.md` pointers for operator maintenance and recovery flows
- Disk-space and storage-pressure warnings surfaced in `/ops/`
- Pool-health warnings in `/ops/` when lanes or moods become too sparse or imbalanced
- Simple steward controls for pausing intake, pausing playback, or switching to a quieter mode
- Maintenance mode so intake and audience playback can be suspended cleanly
- Persisted steward state and audit rows for live control changes
- Audit logging for revocation, restore, export, and stewardship actions
- Retention summary in `/ops/` showing raw-audio expiry pressure and fossil hold posture
- Safer restore flow with confirmation prompts and automatic pre-restore snapshots
- Rotation notes and helper steps for Postgres, Django, and MinIO credential changes
- MinIO deployment notes covering root-backed vs separate app credentials
- Documented migration path from compose-managed MinIO to an external S3-compatible backend
- Decision notes for MinIO bucket versioning and object locking posture

### Recording experience
- Split the browser experience into a dedicated recording station at `/kiosk/` and a separate playback surface at `/room/`
- Short pre-roll countdown before recording begins
- Soft pre-roll tone paired with the visual countdown
- Explicit mic-check feedback using the live meter
- Visible max-duration countdown with auto-stop
- Browser-side trimming of quiet leading/trailing edges
- Light peak normalization before the WAV is uploaded
- Small fades on recorded takes to avoid clicks at the edges
- Attract-loop guidance in idle mode so participants can begin without steward help
- Quiet-take warning with a keep-or-retake choice before mode selection
- Visible idle timeout so abandoned review screens reset cleanly

### Audience playback
- Weighted pool selection with cooldown to reduce obvious repetition
- Selection weighting that also accounts for age and recentness, so the room favors settled material without locking into the oldest memories
- Separate "fresh" and "worn" playback lanes so the room has more temporal depth
- Explicit "essence" afterlife for `FOSSIL` memories so raw audio can expire while a smaller residue remains playable
- Gentle room-tone bedding behind sparse or empty playback moments
- Stronger scene composition in the pool
  - weighted clustering by density
  - occasional longer silences
  - lane-aware sequencing across fresh, mid, and worn material
- Richer mood shaping across the room loop
  - mood-aware artifact requests from the browser
  - clustering by mood as well as density
  - movement-based counterbalance between clear, hushed, suspended, gathering, and weathered material
- More deliberate macro-pacing across a longer span
  - movement phases for arrival, gathering, weathering, and release
  - movement-specific gap pacing instead of one steady room tempo
- Playback loudness smoothing so contributions land closer together
- Fade-in / fade-out and a short gap between room-loop items
- Intensity profiles such as `quiet`, `balanced`, and `active` so pacing can be tuned without code edits
- Scarcity mode for low-pool situations that leans harder on silence and room tone
- Persistent anti-repetition window so repetition control survives browser refreshes and restarts
- Adaptive gap timing based on total pool size so a sparse archive feels spacious and a deep archive feels alive
- Daypart scheduling so movement pacing and intensity can shift across morning, afternoon, evening, and night
- Quiet-hours mode so spaces can soften room pacing and playback intensity on a schedule
- Steward-tunable room-tone options, including the ability to swap the synthetic bed for site-specific ambience
- Rare overlap or layering events so the room can occasionally feel accumulative instead of strictly sequential
- More explicit density balancing so long or heavy material is less likely to cluster by accident
- A "featured return" path for older material that has been absent long enough to feel newly arrived again
- Optional audience-facing fossil visuals via ambient spectrogram drift on the playback surface
- Steward-selectable mood bias so performances or guided sessions can temporarily lean toward one listening posture
- Steward-tunable movement presets so one installation can feel meditative while another feels more active
- Code comments around playback selection, scene composition, room tone, and wear processing
- `README.md` audience-experience notes describing the intended listening effect

## Still Open Now

### User / speaker
- Support a hands-free control path
  - USB button
  - footswitch

## Next

### User / speaker
- Add multilingual kiosk copy so the full guided flow can be swapped per installation
- Add a larger-type / higher-contrast accessibility mode for difficult rooms
- Add reduced-motion handling for the countdown and kiosk transitions
- Add a steward-configurable max recording duration instead of keeping it browser-only
- Add optional headphone or monitor-check mode for setup and microphone testing

### Audience / room effect
- Push beyond metadata-derived mood shaping into a room state that responds to context
  - learn from time-of-day or room activity patterns
  - explore whether semantic or transcript-aware grouping is worth the complexity

### Operator / stewardship
- Add one-command firewall / restart-on-boot setup for a specific server OS target

## Later

### User / speaker
- Add participant-facing revocation guidance that can be shown without exposing full steward controls
- Add installation-specific speaker prompts or writing prompts that can shift the emotional tone of the room
- Add optional steward-authored session themes that influence idle copy and submission framing
- Add alternate kiosk layouts for seated booths, standing kiosks, and wall-mounted enclosures

### Audience / room effect
- Add audience-presence or ambient-volume sensing so the room can react to actual occupancy
- Add installation-specific "personalities" that package movement, tone, gap, and wear behavior together
- Add shared-pool or federated-pool options for multi-room installations
- Add richer visual layers such as projected fossils, spectrogram drift, or low-light companion displays
- Add semantic or transcript-aware grouping if metadata-only composition plateaus
- Add room-state transitions driven by recent recording activity, not just playback history
- Add crossfaded movement transitions instead of hard scene-to-scene pacing changes
- Add optional performance mode for steward-led events where certain moods or movements can be emphasized live

### Operator / stewardship
- Add structured export bundles with manifests, checksums, and import instructions for archival handoff
- Add multi-node stewardship tooling if more than one installation is deployed
- Add role-based steward access if the installation grows beyond one trusted operator
- Add long-term retention policy controls that can differ by consent mode or installation
- Add a documented disaster-recovery rehearsal flow rather than only backup and restore commands
- Add a fuller external-storage migration story for moving beyond MinIO if scale or policy changes

## Later Research Questions
- Whether browser-side normalization is sufficient, or if server-side loudness analysis is worth the added complexity
- Whether the pool should learn from time-of-day or room activity patterns
- Whether the kiosk should expose revocation and moderation tools directly, or keep those fully steward-side
- Whether transcripts, embeddings, or other semantic grouping would meaningfully improve scene composition
- Whether the audience experience should remain audio-only or eventually include light, projection, or fossil visuals
- Whether multiple kiosks should share a pool or remain strictly room-local
- Whether revocation should stay steward-mediated or gain a participant-facing path using the receipt code
- Whether the room should ever adapt to audience presence sensing, ambient volume, or time since last recording
- Whether wear should remain global per artifact or vary by room, node, or playback context
- Whether the system should support installation-specific "personalities" as first-class presets rather than ad hoc tuning
- Whether steward moderation should happen before playback in some installations rather than after the fact
