# Machine Branch

This branch is the structural trunk of the manual.

Use it when you need to understand which layer owns a behavior, where a policy lives, or why the machine acts differently across deployments.

## Read This Branch By Question

| Question | Read this first | Then go to |
|---|---|---|
| what process owns what responsibility | [how-the-stack-works.md](./how-the-stack-works.md) | [AT_A_GLANCE.md](./AT_A_GLANCE.md) |
| where the browser/API boundary actually sits | [surface-contract.md](./surface-contract.md) | [how-the-stack-works.md](./how-the-stack-works.md) |
| what changes between `memory`, `question`, `repair`, `prompt`, `witness`, and `oracle` | [DEPLOYMENT_BEHAVIORS.md](./DEPLOYMENT_BEHAVIORS.md) | [roadmap.md](./roadmap.md) |
| what responsiveness the machine should preserve | [RESPONSIVENESS.md](./RESPONSIVENESS.md) | [DEPLOYMENT_BEHAVIORS.md](./DEPLOYMENT_BEHAVIORS.md) |
| how the current hands-free seam works | [HANDS_FREE_CONTROLS.md](./HANDS_FREE_CONTROLS.md) | [installation-checklist.md](./installation-checklist.md) |

## Pages In This Branch

- [how-the-stack-works.md](./how-the-stack-works.md): process split, data flow, object model, and lifecycle detail
- [surface-contract.md](./surface-contract.md): browser/API boundary and payload ownership
- [DEPLOYMENT_BEHAVIORS.md](./DEPLOYMENT_BEHAVIORS.md): distinct temperament and policy differences by deployment
- [RESPONSIVENESS.md](./RESPONSIVENESS.md): timing and feedback expectations that should survive deployment changes
- [HANDS_FREE_CONTROLS.md](./HANDS_FREE_CONTROLS.md): current Leonardo HID path and enclosure assumptions

## Branch Logic

This branch answers engineering questions such as:

- is this behavior browser-owned or server-owned
- is this a deployment policy issue or a room-loop issue
- is this a new capability or just a copy seam
- does this change widen the machine or deepen an existing grammar
