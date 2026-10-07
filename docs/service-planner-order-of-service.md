# Service Planner → Edge Order of Service

This document describes the production workflow introduced by Service Planner & Rundown Phase 1.

## 1. Author in the Control Plane

Operators open `/planner`, create or choose a service, and build the order of service from typed cues:

- Scripture
- Song
- Slide
- Announcement
- Lower third
- Media
- Camera
- Custom

The browser uses the planner APIs with optimistic-concurrency revisions. Reorder submits the complete ordered cue list, and all persisted mutations are organization/service scoped and audited.

Planner Preview is an authoring-only rendering path. It never invokes Edge Program output.

## 2. Validate readiness

A draft service must pass the shared server-side readiness validator before becoming `ready`.

Validation checks include scheduling, Bible-version availability, campus scope, rundown size/order/state, supported cue types, resolvable Scripture and approved media/camera references.

Readiness issues that belong to a cue carry that cue's item ID so the UI can navigate directly to the affected cue.

A `ready` service that is edited is atomically returned to `draft` and its Edge assignment is cleared. This prevents partially changed plans from remaining production-authoritative.

## 3. Synchronize to Edge

Only `ready` and `live` services are eligible for the authenticated Edge operator catalog.

The runtime fetches a bounded, presentation-safe catalog and writes it to the existing durable local cache. The Avalonia shell does not receive the device bearer credential.

The catalog keeps canonical service order and exposes only safe presentation fields. Private media URLs, source IDs, credentials, provider tokens and operator-only notes are excluded.

Cloud loss preserves the last valid same-service cache as **OFFLINE CACHE**. A synchronized no-service state remains empty rather than reviving stale cues.

## 4. Operate on Windows/macOS

When a synchronized service exists, the desktop left pane becomes **Order of Service**.

Each row keeps its canonical sequence number and may show:

- `CURRENT` — the cue currently on Program
- `PREVIEW` — the cue currently prepared in Preview
- `NEXT` — the canonical cue immediately after Current

These states come from authoritative Edge runtime snapshots, not optimistic UI assumptions.

### Preview / Take / Clear

- **Preview Selected** renders only the selected cue to Preview.
- **Take → Program** is explicit.
- After a successful Take acknowledgement, the desktop advances the *selection* by exactly one cue.
- The next cue is not automatically Previewed or Taken.
- A failed Take does not move the selection.
- At the last cue, selection stays on the last cue.
- An ad-hoc Program item outside the canonical rundown is labeled **Ad-hoc Program** and does not redefine service order.

### Keyboard navigation

Existing output shortcuts remain:

- `F6` — Preview selected
- `F8` — Take Preview to Program
- `F7` — Clear Program
- `F5` — Restart Edge

Order-of-service selection adds `Ctrl+Up` / `Ctrl+Down`. These navigation shortcuts do not run while focus is inside text-entry or combo-box controls.

## 5. Concurrency and failure handling

Planner browser mutations carry the latest `If-Match` revision. If another operator changes the same service first, the server returns `planner_revision_conflict`.

The browser then freezes create/save/delete/duplicate/reorder/Ready/Draft mutations and offers **Reload latest**. It does not silently retry a stale mutation.

Visual reorder is the only optimistic planner state change; the previous order is restored if the server rejects it.

## 6. Security boundaries

- Organization scope comes from authenticated membership, not a client-provided tenant selector.
- Ready validation cannot be bypassed through the legacy service-state endpoint.
- Planner content uses strict typed schemas; there is no raw JSON or raw executable/HTML authoring escape hatch.
- Edge loopback Preview/Program HTTP endpoints remain read-only.
- Desktop output mutations use the existing same-user local IPC channel.
- Device credentials, OAuth tokens, pairing codes and stream keys are excluded from planner/catalog/desktop UI DTOs.

## 7. Verification

The milestone is covered by:

- Service Planner contract/RBAC self-test
- Service list/create/detail API integration test
- Typed cue + safe Preview integration test
- Transactional mutation/reorder/concurrency test
- Readiness/lifecycle/assignment test
- Planner responsive UI contract test
- Planner-to-Edge catalog integration test using all eight cue types
- Desktop Order-of-Service navigator xUnit tests
- Desktop source-wiring tests
- Full Windows and macOS Edge CI, including native bridge/libsrt/SRT smoke and self-contained artifact packaging
