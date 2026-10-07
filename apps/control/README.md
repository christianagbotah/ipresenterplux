# iPresenterPlux Control Plane

The Control Plane is the authenticated web application for church service planning, live operations, Edge-device administration, translations and streaming orchestration.

## Service Planner

`/planner` is the authoritative authoring surface for an organization's order of service.

A planner can create a scheduled service and build a typed rundown using:

- Scripture
- Song
- Slide
- Announcement
- Lower third
- Media
- Camera
- Custom cue

The planner intentionally does not expose a raw JSON editor. Every cue is validated and normalized before persistence. Scripture is resolved against locally enabled Bible data; media and camera cues reference organization-approved sources rather than arbitrary filesystem paths or executable URLs.

### Roles

All organization roles may view the planner. Mutations are limited to the existing operational planner roles:

- Owner
- Administrator
- Pastor
- Presenter Operator
- Media Operator

Read-only roles can inspect services, rundown order and readiness issues without receiving create/edit/reorder/Ready controls.

### Lifecycle

Planner services use the existing service lifecycle:

`draft -> ready -> live -> ended`

Only `ready` and `live` services are eligible for Edge synchronization.

The **Ready for service** action always executes the shared server-side readiness validator. It rejects incomplete schedules, unavailable Bible versions, invalid campus scope, empty/oversized rundowns, unsupported cue types, unresolved Scripture, unsafe media and other incomplete cue data.

Persisted edits to a `ready` service demote it to `draft` and clear that service's Edge assignment in the same database transaction. The planner must explicitly validate and mark the service ready again before it can synchronize to a production workstation.

### Ordering and concurrency

Rundown order is persisted transactionally. The UI supports pointer drag plus independent Move Up/Move Down controls for keyboard accessibility. Reorder requests send one complete ordered item-ID list; partial or foreign item sets are rejected.

Planner mutations use an `If-Match` revision token. A stale revision returns the stable `planner_revision_conflict` response. The browser freezes further mutations and asks the operator to reload the latest server state instead of retrying and overwriting another operator's work.

### Safe authoring Preview

The Planner Preview route normalizes and renders candidate cue content for authoring only. It does not call Edge Program, Take, Show or any other live-output mutation path. Sending content live remains an explicit Edge Operator action.

## Edge synchronization

The existing authenticated Edge catalog remains the cloud-to-workstation read model. No new cloud protocol is required by Service Planner.

Planner-persisted ready/live cues are projected into the bounded presentation-safe catalog:

`{ itemId, itemType, title, body, footer, metadata }`

The catalog is capped at 200 items and keeps organization/campus/service isolation. Planner edits, reorder and deletes change the catalog revision. Demotion to draft removes the service from Edge catalog authority and clears its assignment.

Media/camera source IDs, operator notes, credentials and private source URLs are not copied into the desktop catalog.

See [`../../docs/service-planner-order-of-service.md`](../../docs/service-planner-order-of-service.md) for the end-to-end web-to-desktop workflow.

## Development

From `apps/control`:

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm lint
pnpm build
```

The Control Portal CI also runs the Service Planner contract, service, item/Preview, mutation, readiness and UI self-tests together with the existing RBAC, scripture, Edge catalog and streaming security suites.

## Production safety rules

- Planner APIs derive tenant scope from the authenticated membership; clients do not choose an organization ID.
- Lifecycle transitions and cue mutations are audited with bounded metadata.
- Planner content is typed and normalized; raw HTML/script execution is not part of the cue contract.
- Device credentials, pairing codes, OAuth tokens and stream keys are never returned to the Planner UI.
- Local Edge HTTP Preview/Program renderers remain read-only; desktop mutation commands stay on same-user IPC.
