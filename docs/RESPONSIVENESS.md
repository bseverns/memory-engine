# Responsiveness Ladder (Design Principle)

These machines are both public-facing instruments and learning tools. Every deployment should preserve a clear feedback ladder.

## 1) Immediate acknowledgement (sub-second)

Participant acts, machine responds *now*.

Current examples:

- arm/record state changes and mic status chips
- meter response while waiting/recording
- countdown and button state transitions

## 2) Near-immediate reflection / preview

Participant gets a fast reflection of what they just offered.

Current examples:

- review-stage playback preview
- quiet-take warning and keep/retake decision
- mode choice and submission status updates

## 3) Ambient afterlife in room/archive

Offering returns over time in the room/archive, not as instant UI confirmation.

Current examples:

- room loop resurfacing with wear and lane pacing
- fossil/residue survival beyond raw-audio lifetime
- operator summary visibility in `/ops/`

## Practical guidance for new deployments

- Never trade away step 1 to add complexity to step 3.
- Keep the acknowledgement chain local and robust under weak network conditions.
- Add deployment-specific behavior by adjusting policy/copy first, not by delaying baseline feedback.
- Treat responsiveness as part of trust: participants need to know they were heard before any long-tail behavior occurs.

## Cross-deployment rule

Even when tone changes (`question` urgency, `repair` utility, `oracle` ceremony), the ladder does not change:

1. immediate local acknowledgment
2. near-immediate reflection
3. ambient afterlife over time

No deployment gets to skip step 1.
