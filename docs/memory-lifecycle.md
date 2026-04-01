# Memory Lifecycle

This page is the shortest machine-specific explanation of what happens to a memory after someone records it on the kiosk.

Use it when you want the lifecycle model without reading the full architecture walkthrough in [how-the-stack-works.md](./how-the-stack-works.md).

## Current Lifecycle At A Glance

```mermaid
flowchart TD
    start["Participant records on /kiosk/"] --> review["Review + consent choice + optional memory color"]
    review --> saved{"Consent mode"}
    saved -->|ROOM| roomSave["Store raw WAV + create ACTIVE artifact"]
    saved -->|FOSSIL| fossilSave["Store raw WAV + queue derivatives + create ACTIVE artifact"]
    saved -->|NOSAVE| noSave["Create EPHEMERAL artifact + one-time access token"]
    roomSave --> roomLoop["Eligible for /room/ resurfacing"]
    fossilSave --> roomLoop
    roomLoop --> wear["Each heard playback increments play_count and wear"]
    roomLoop --> revoke["Participant later uses /revoke/"]
    revoke --> revoked["Mark REVOKED and remove raw + derivatives"]
    fossilSave --> residue["Essence derivative can outlive raw WAV"]
    residue --> expired["Eventually expire remaining playable material"]
    noSave --> consume["First playback consumes token"]
    consume --> revoked
```

## Saved Ingest Path

The normal saved path uses `POST /api/v1/artifacts/audio`.

```mermaid
sequenceDiagram
    participant Kiosk as /kiosk/
    participant API as Django ingest API
    participant DB as Postgres
    participant Blob as MinIO
    participant Jobs as Celery

    Kiosk->>API: WAV + consent_mode + duration + metadata
    API->>API: validate WAV contract and duration limits
    API->>DB: create ConsentManifest with hashed revoke token
    API->>DB: create ACTIVE Artifact with expires_at
    API->>DB: store memory color metadata when chosen
    API->>Blob: write raw/<artifact_id>/audio.wav
    alt FOSSIL consent
        API->>Jobs: queue spectrogram + essence generation
    end
    API-->>Kiosk: artifact payload + one-time revocation token + /revoke/ URL
```

What matters about this path:

- the revocation token is only returned once
- the raw WAV stays dry in storage even when a participant chooses a memory color
- memory color is metadata and playback shaping, not a second stored render
- `FOSSIL` adds an explicit afterlife path instead of making raw storage permanent

## State Model

The machine uses a small explicit state model rather than a large archive workflow.

```mermaid
stateDiagram-v2
    [*] --> ACTIVE: ROOM or FOSSIL saved ingest
    [*] --> EPHEMERAL: NOSAVE ingest
    ACTIVE --> ACTIVE: playback heard ack advances wear
    ACTIVE --> ACTIVE: raw expires but essence remains for FOSSIL
    ACTIVE --> REVOKED: participant or steward revocation/removal
    ACTIVE --> EXPIRED: no playable raw or derivative remains
    EPHEMERAL --> REVOKED: first consume clears blob
    EPHEMERAL --> REVOKED: safety sweep clears stale entry
    EXPIRED --> [*]
    REVOKED --> [*]
```

The practical consequence is that the stack treats revocation, expiry, and ephemeral disposal as first-class lifecycle events, not afterthoughts.

## Playback And Wear

The room loop is browser-composed but server-governed.

```mermaid
sequenceDiagram
    participant Room as /room/
    participant API as /api/v1/pool/next
    participant DB as Postgres
    participant Media as signed media URL
    participant Blob as MinIO through Django
    participant Heard as /api/v1/pool/heard/<token>

    Room->>API: request next selection with lane/mood/exclusions
    API->>DB: find ACTIVE playable artifact for active deployment
    API-->>Room: audio_url + wear + play_count + thread_signal
    Room->>Media: fetch signed media URL
    Media->>Blob: stream raw WAV or essence residue
    Blob-->>Room: playable audio
    Room->>Room: apply wear-based playback chain
    Room->>Heard: acknowledge audible playback
    Heard->>DB: increment play_count, wear, last_access_at
```

What matters here:

- the server decides eligibility
- the browser shapes the audible patina
- wear changes playback texture, not the stored object
- `question` and `repair` can also carry short `thread_signal` hints through this path

## Revocation And Expiry

Two different endings matter in the current stack:

- `REVOKED`: an explicit participant or steward removal
- `EXPIRED`: the retention window ended and no playable material remains

```mermaid
flowchart LR
    token["Participant enters receipt code on /revoke/"] --> api["POST /api/v1/revoke"]
    api --> consent["Find ConsentManifest by hashed token"]
    consent --> artifacts["Find linked non-revoked artifacts"]
    artifacts --> purgeRaw["Delete raw blobs and blank raw_uri"]
    artifacts --> purgeDerivatives["Delete derivatives and rows"]
    purgeRaw --> done["Artifacts become REVOKED"]
    purgeDerivatives --> done

    ttl["Background expiry task"] --> raw["Remove expired raw objects"]
    raw --> essence{"FOSSIL essence still valid?"}
    essence -->|yes| active["Artifact stays ACTIVE through residue"]
    essence -->|no| expired["Artifact becomes EXPIRED"]
```

## Current Design Boundaries

- one machine, one lifecycle grammar, several deployment temperaments
- small artifact states instead of a moderation workflow tree
- lightweight metadata instead of transcripts or embeddings
- bounded browser DSP instead of arbitrary effect graphs
- public revocation stays local to the node that issued the receipt

If you need the code ownership behind this lifecycle, use [AT_A_GLANCE.md](./AT_A_GLANCE.md). If you need the full architectural explanation, use [how-the-stack-works.md](./how-the-stack-works.md).
