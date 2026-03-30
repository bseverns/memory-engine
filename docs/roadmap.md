# Roadmap

This file is both a plan and a trail marker.
It should read as the story of how the Engine became what it is:
from a simple recording surface,
to a local-first public artifact machine,
to a memory-first engine with distinct deployment temperaments,
and eventually to something a future maintainer can still steer without guesswork.

If [AT_A_GLANCE.md](./AT_A_GLANCE.md) is the shortest operator map,
this file is the longer memory of what changed, when, and why it mattered.

## Story So Far

### Chapter 1: Make it a real appliance
- The first major push was not aesthetic. It was operational.
- The machine gained a real deployment path with `caddy` + `gunicorn`, health probes, an `/ops/` dashboard, and enough scripts to boot, deploy, check, back up, restore, export, and diagnose a node without improvising every step.
- This was the moment the project stopped being only an app and started becoming an appliance.
- The important shift was stewardship posture: the system learned how to say whether it was `ready`, `degraded`, or `broken`, and the operator finally had somewhere coherent to look first.

### Chapter 2: Separate speaking from listening
- The browser experience split into a dedicated recording station at `/kiosk/` and a separate playback surface at `/room/`.
- Recording became more forgiving and more public-ready: countdown, mic check, silence trimming, light normalization, quiet-take warning, idle reset, and accessibility improvements.
- The keyboard contract on `/kiosk/` also turned out to be more important than it first looked. It created a stable seam for future hands-free hardware without forcing a new browser or API control layer.
- This was the point where participation stopped feeling like a fragile demo flow and started feeling like a repeatable public ritual.

### Chapter 3: Teach the room how to remember
- Playback stopped being a plain shuffle and became a room loop with lanes, density, mood, movement, scarcity, daypart, quiet hours, featured return, and wear.
- Raw recordings gained an afterlife model through fossils and long-form recordings gained windowed playback, so the machine could keep surfacing material without demanding that every return be full-length or fresh.
- This was the point where the room became a composition system instead of a queue.

### Chapter 4: Open the deployment family
- `memory` stopped being an implicit default and became an explicit deployment kind.
- The repo was reframed as one local-first Artifact Engine with a memory-first baseline and planned sibling deployments: `question`, `repair`, `oracle`, `prompt`, and `witness`.
- This was an architectural discipline pass as much as a product pass: distinct temperaments were allowed, but the machine stayed one coherent appliance with shared routes, shared operators, shared storage, and shared room infrastructure.

### Chapter 5: Make deployments behaviorally real
- Deployment differences moved out of copy and into actual playback policy, resurfacing logic, gap timing, wear posture, and room composition.
- `memory` remained the canonical weathered baseline.
- `question` became more inquiry-driven, with unresolved recurrence, topic/status threading, and chorus behavior.
- `repair` became more practical, recent, and clear, with work-thread recurrence and bench-note follow-ons.
- `oracle` became sparser and more ceremonial.
- `prompt` and `witness` also stopped being empty shells and received first-pass behavior.
- This was the point where the Engine became several temperaments living inside one machine.

### Chapter 6: Make stewardship and archaeology possible
- `/ops/` learned lightweight metadata editing for recent artifacts in the active deployment, with deployment-aware status pickers and audit trails.
- Documentation gained an at-a-glance operator map, expanded behavior docs, and code comments started marking why certain seams exist instead of only how they work.
- This was the point where the project stopped assuming the current builder would always be present to explain it.

### Chapter 7: Deepen short-horizon thread behavior
- `question` moved beyond a simple layered pair into the beginning of chorus logic, where a persistent unresolved topic can return as both a layer and a later echo.
- `repair` moved beyond a single same-topic follow-on into a more workbench-like posture, where active practical threads lighten density and tighten breathing room as they continue.
- This is still deliberately small and inspectable, but it marks the beginning of room behavior that remembers not just artifacts, but a short-lived line of attention.

### Chapter 8: Start the hands-free path without widening the stack
- The first hardware control path now begins with an Arduino Leonardo acting as a plain USB keyboard trigger for `/kiosk/`.
- That choice is intentionally conservative: it reuses the kiosk's existing shortcut contract instead of adding a serial bridge, browser plugin, or custom operator path.
- This is only the beginning of the input bucket, but it is the right kind of beginning: inspectable, local, and appliance-friendly.

## Landed So Far

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
- Multilingual kiosk copy, starting with steward-selectable Spanish tuned toward southern Mexico / Central America
- Larger-type / higher-contrast accessibility mode for difficult rooms
- Reduced-motion handling for the countdown and kiosk transitions
- Steward-configurable max recording duration instead of keeping it browser-only
- First Leonardo-based hands-free trigger path for `/kiosk/`, reusing the existing keyboard shortcut model with no host-side bridge


### Mission opening: deployment family groundwork
- First-pass deployment-kind config (`ENGINE_DEPLOYMENT`) with `memory` as explicit default and planned sibling kinds (`question`, `prompt`, `repair`, `witness`, `oracle`)
- Deployment-aware participant copy seams so memory-specific rhetoric can be overridden without rewriting the kiosk flow
- Deployment-aware operator posture so `/ops/` can show active deployment now and gain mode-specific tuning later
- Docs that define Memory Engine as the default deployment of a broader local-first artifact engine (opening, not rebrand)
- Playback policy framing that separates shared room-loop infrastructure from deployment-level behavior intent
- Responsiveness ladder documented as a cross-deployment requirement (immediate acknowledgement, near-immediate reflection, ambient afterlife)
- Real behavioral distinction for the first four deployed temperaments:
  - `memory` remains the canonical weathered baseline
  - `question` now favors unresolved recurrence and topic clustering
  - `repair` now favors recent practical return and higher clarity
  - `oracle` now uses sparser, more ceremonial resurfacing
- First substantive follow-through for the remaining supported deployments:
  - `prompt` now recirculates recent catalytic material sooner
  - `witness` now favors settled contextual return over hyper-recency
- Lightweight deployment metadata use made real in playback:
  - `lifecycle_status` now drives `question` recurrence
  - `topic_tag` now supports loose `question` and `repair` clustering
  - ingest accepts `topic` / `category` and `status` aliases without schema sprawl
- Deployment-specific wear and room-loop posture are now active rather than documented only
- Lightweight `/ops/` metadata editing for recent artifacts in the active deployment
  - topic/category and status only
  - audited through steward actions
  - intentionally kept out of a larger artifact-management surface
- Deployment-specific metadata threading and stewardship refinement
  - `/ops/` now presents deployment-specific status pickers instead of only free text hints
  - `question` room-loop requests can now carry short topic/status threads
  - `repair` room-loop requests can now carry short practical topic/status threads
- Deeper question/repair room composition without widening the control surface
  - `question` can now produce rare same-topic chorus moments for unresolved threaded material
  - `repair` can now produce short same-topic bench-note follow-ons for practical threads
- Second-pass question/repair thread shaping inside the shared room loop
  - sustained `question` threads can now extend beyond a simple pair, using a later echo when the topic has already persisted in recent playback
  - `repair` follow-ons now compress toward lighter-density, shorter-gap bench behavior as an actionable topic remains active
- First documentation orientation pass for future stewards and maintainers
  - new at-a-glance map of surfaces, subsystem ownership, first checks, and first knobs
  - README and runbook now point to the quick orientation path before deeper docs

## Why The Recent Passes Matter

### The machine is no longer only "Memory Engine"
- `memory` is still the home posture, but the codebase now genuinely supports several ways of being in public.
- That matters because future work can deepen a deployment without forking the product or inventing a plugin system to justify the difference.

### Metadata stayed intentionally light
- Recent work made `topic_tag` and `lifecycle_status` pull real weight.
- That matters because the engine now gets meaningful deployment-specific behavior without semantic search, embeddings, transcripts, or a large moderation model.

### The room now has short-term attention
- The most recent playback passes gave `question` and `repair` a limited sense of thread continuity.
- That matters because the room can now sound like it is returning to something, not merely selecting the next clip.

### Documentation is becoming operational memory
- The repo now has both quick-reference docs and more archaeological comments.
- That matters because future maintainers should be able to recover intent from the repo itself instead of from oral tradition.

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
- Windowed playback for long-form recordings so multiple kiosks can feed one shared mix while the room only pulls moving source slices up to 45 seconds at a time
- Rare overlap or layering events so the room can occasionally feel accumulative instead of strictly sequential
- More explicit density balancing so long or heavy material is less likely to cluster by accident
- A "featured return" path for older material that has been absent long enough to feel newly arrived again
- Optional audience-facing fossil visuals via ambient spectrogram drift on the playback surface
- Steward-selectable mood bias so performances or guided sessions can temporarily lean toward one listening posture
- Steward-tunable movement presets so one installation can feel meditative while another feels more active
- Code comments around playback selection, scene composition, room tone, and wear processing
- `README.md` audience-experience notes describing the intended listening effect
- Deployment-aware room-loop posture layered into the shared surface:
  - `question` uses shorter anti-repetition and quicker unresolved return
  - `repair` uses shorter gaps, lower tone bed, lower overlap, and lighter wear
  - `oracle` uses longer gaps, lower overlap, and stronger rarity
- Deployment-aware pool selection now stays within the active deployment when that deployment has playable material, instead of blending by accident

## Still Open Now

### User / speaker
- Expand the hands-free control path beyond the first Leonardo button
  - mode-selection buttons or pedal mappings for `1`, `2`, `3`
  - footswitch enclosure posture
  - browser-focus/reboot recovery notes for unattended HID use

## Next

### Multi-deployment follow-through
- Add deployment-specific intake cards so stewards can tune prompts without touching code
- Add deployment-aware playback policy presets visible in operator status exports
- Add deployment-aware retention/export presets for archival handoff bundles
- Add installation-specific room identities that can be combined with deployment kind (e.g., `repair` + `shared_lab`)
- Add a safe operator-facing way to mark questions `answered` / `resolved` and repairs `fixed` / `obsolete`

### User / speaker
- Add optional headphone or monitor-check mode for setup and microphone testing

### Audience / room effect
- Push beyond metadata-derived mood shaping into a room state that responds to context
- Learn from time-of-day or room activity patterns without losing inspectability
- Decide whether semantic or transcript-aware grouping is worth the complexity later

### Operator / stewardship
- Add one-command firewall / restart-on-boot setup for a specific server OS target
- Continue documentation passes:
  - quick-reference tables for common failure modes by service
  - more explicit env-var grouping by subsystem and risk level
  - one-page operator drill cards for intake, playback, storage, and restore incidents

## Bucket Checkpoint

Open buckets now look like this:

- Input and participation:
  first hands-free Leonardo path has landed; headphone/monitor check, richer hands-free input, revocation guidance, and alternate kiosk layouts remain
- Deployment follow-through:
  the deployment family is behaviorally real, but intake cards, operator-safe state changes, and deployment-aware export posture remain
- Room intelligence:
  the room has short-horizon thread memory now, but not fuller room-state transitions, sensing, or semantic grouping decisions
- Steward tooling:
  `/ops/` is useful and lightweight, but it still stops short of fuller deployment-aware tuning, multi-node stewardship, and richer export/recovery posture
- Documentation and operations:
  the story, quick map, and archaeology work have started, but drill cards, failure matrices, and more explicit env-var grouping remain

## Later

### User / speaker
- Add participant-facing revocation guidance that can be shown without exposing full steward controls
- Add installation-specific speaker prompts or writing prompts that can shift the emotional tone of the room
- Add deployment-specific prompt packs so `memory`, `question`, and `repair` can diverge without branching app logic
- Add optional steward-authored session themes that influence idle copy and submission framing
- Add alternate kiosk layouts for seated booths, standing kiosks, and wall-mounted enclosures

### Audience / room effect
- Add audience-presence or ambient-volume sensing so the room can react to actual occupancy
- Add installation-specific and deployment-specific "personalities" that package movement, tone, gap, and wear behavior together
- Extend the now-real deployment-specific playback policies instead of keeping them as stubs:
  - fuller `question` chorus / thread behavior beyond the current rare layered return plus later echo
  - fuller `repair` workbench / bench-notebook behavior beyond the current thread-length-aware follow-ons
  - deeper `oracle` ceremony controls
  - more explicit prompt chains and witness context handling, now that first-pass behavior exists
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
- Add deployment-aware operator controls so stewardship UI can expose mode-specific tuning safely, without turning `/ops/` into a giant behavior console
- Add long-term retention policy controls that can differ by consent mode, artifact type, or installation
- Add artifact-type-aware export posture so handoff bundles can preserve deployment semantics
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
