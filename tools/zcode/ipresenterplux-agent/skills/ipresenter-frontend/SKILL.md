---
name: ipresenter-frontend
description: Implement or review iPresenterPlux web frontend work with operator-first UX, accessibility, responsive layouts, and strict live-control safety boundaries.
---

# iPresenterPlux frontend method

Use this skill for web/control-portal frontend implementation and review.

## Product priorities

1. The operator must always understand what is selected, what is in Preview, what is requested for Program, and what the Edge device has actually confirmed.
2. AI recommendations and detections never silently take content live. Explicit human approval remains the default.
3. Live-control status must not imply physical output confirmation when only a cloud request/queue exists.
4. Realtime degradation, stale state, mutation failure, unauthorized state, and offline limitations must be visible rather than silently hidden.
5. Presentation controls outrank diagnostics and decorative telemetry in visual hierarchy.

## Frontend boundaries

- Prefer changes under `apps/control/src/app`, `apps/control/src/components`, and associated styles/tests.
- Read and obey all applicable `AGENTS.md` files.
- Do not alter API/database/Edge/native contracts unless the GitHub issue explicitly authorizes it.
- If the frontend cannot truthfully represent a state with existing data, report the contract gap instead of fabricating confirmation.

## UX standards

- Design desktop operator workflows for common 1280x800 control-room displays as well as larger screens.
- At narrow widths, avoid horizontal page overflow and keep primary actions reachable.
- Make Preview and Program visually unmistakable without relying on color alone.
- Keep dangerous or consequential actions distinct, labeled with their effect, and protected by existing confirmation rules.
- Hide or disable controls appropriately for roles that cannot perform the operation; do not invite a backend rejection as normal UX.
- Async mutations need pending, success, failure, and recovery feedback.
- Realtime/SSE fallback must be disclosed to the operator.

## Accessibility

- Keyboard-only completion of primary workflows.
- Visible focus indicators.
- Accessible names on icon-only controls.
- Live regions or equivalent announced feedback for asynchronous status changes.
- Do not rely on tiny muted text or color alone for operational state.
- Validate at 200% zoom and mobile width when the issue affects responsive UI.

## Validation

For control-plane frontend changes, normally run:

- `pnpm --dir apps/control lint`
- `pnpm --dir apps/control build`
- relevant self-tests required by the touched flow

Also inspect the final diff, preserve authentication/RBAC/audit behavior, and include a concise UI verification note in the PR.
