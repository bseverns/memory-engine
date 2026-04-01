# Archive Stewardship

This note defines the social and steward-facing posture around storage, removal, and handoff.

It is intentionally short. The point is to keep archive ethics explicit without turning the project into a bureaucracy.

## Terms

| Term | Meaning in this stack |
|---|---|
| raw | the stored original WAV while it is still retained on the node |
| fossil | a consent posture where the raw sound may expire sooner while a spectrogram and/or low-storage residue can remain locally longer |
| residue / trace | the smaller afterlife material that can outlive the raw WAV for fossil paths |
| active artifact | a contribution still eligible for room resurfacing |
| revoked artifact | a contribution explicitly removed through participant or steward action |
| removed from stack | a narrow steward action to take something out of immediate circulation without widening into a full moderation suite |

## Steward Actions

### Remove from stack

Use when:

- something should leave immediate room circulation now
- the goal is practical de-escalation or quick tending
- the steward is acting inside the live installation context

This is not the same thing as a participant revocation request.

### Revoke entirely

Use when:

- a participant asks for revocation using the local receipt code
- the system is carrying material that should be removed from this node’s retained afterlife, not only from immediate circulation

Revocation is local to the node that issued the receipt and should be described that way.

## Authority Boundaries

- participants can revoke saved recordings on the local node through `/revoke/` with the receipt code
- stewards can use the narrow stack-removal and metadata/status actions in `/ops/`
- broader archival or off-machine handling should be treated as a deliberate stewardship act, not an everyday dashboard gesture

## Export And Handoff

- export bundles should be treated as sensitive local handoff material, not casual share artifacts
- bundle movement between machines or stewards should be logged in whatever local operational notes the installation uses
- a bundle is not automatically permission to reuse material outside the live installation context

## Outside-Installation Use

The default posture should be conservative:

- do not assume recordings or derivatives are available for reuse outside the live installation context
- if an installation wants a broader archival or publication posture, that should be decided explicitly and documented separately

## Still Open

- the exact distinction between `remove from stack` and `preserve but mute from room behavior` may need a clearer technical seam later
- long-term off-node archive policy may need a stronger written posture once real handoff patterns exist
