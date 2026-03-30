# Deployment Behaviors and Afterlife Posture

This note defines playback/afterlife behavior as a **deployment concern**.

Memory Engine already implements substantial real behavior. Future sibling deployments should branch from the same loop and stewardship machinery, not fork into separate stacks.

## Already real in Memory Engine

Current system behavior already includes:

- wear/decay dynamics across repeated playback
- fresh/mid/worn lane balancing
- cooldown + anti-repetition controls
- movement and daypart pacing
- scarcity and quiet-hours posture
- fossil/residue afterlife for non-room-full retention

## Behavior sketches for sibling deployments (not fully implemented yet)

### Memory Engine (`memory`)
- Weathering, patina, temporal depth.
- Return logic that rewards age and absence.

### Question Engine (`question`)
- Recurrence and unresolved return.
- Clustering around question-like artifacts.
- "Haunting" behavior where unresolved offerings reappear.

### Repair Engine (`repair`)
- Practical resurfacing with recency bias.
- Utility-forward playback windows.
- Faster re-cue cycles for actionable offerings.

### Oracle Engine (`oracle`)
- Rarity and ceremonial timing.
- Prompt-like resurfacing events.
- Sparse but high-signal reappearance.

### Prompt / Witness (planned)
- Prompt: authored cadence and response waves.
- Witness: trace-preserving replay with stewardship-aware pacing.

## Where future policy hooks should live

- `api/memory_engine/deployments.py` for deployment catalog and labels
- kiosk copy selection via deployment-aware lookup in `kiosk-copy.js`
- playback policy branching at room loop policy/composer boundaries (`room_composer.py`, room loop policy JS)
- operator labels and eventual deployment-specific controls in `/ops/`
- retention/export policy branching in steward and reporting layers

## Rule of thumb

If a behavior change can be represented as policy, copy, metadata, or weighting, keep it inside this engine family. Only split systems if the runtime or trust boundary fundamentally changes.
