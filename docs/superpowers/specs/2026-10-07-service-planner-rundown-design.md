# Service Planner & Rundown Phase 1 Design

## Intent
Build a production-grade church service planning workflow on top of iPresenterPlux's existing `services` and `presentation_items` model so church teams can prepare an ordered service rundown in the Control Plane and operate that exact rundown from the Windows/macOS desktop during service.

Success means an authorized church user can create an upcoming service, build and reorder a typed rundown, resolve Scripture from the existing Bible database, preview and validate every cue, mark the service ready, pair/assign an Edge workstation, and then see the ordered rundown sync automatically into the desktop Operator workspace. Once synced, the desktop remains usable from its local cache during temporary Internet loss. Planning edits never force Program output live.

## Existing foundation to preserve
The implementation must reuse the current architecture rather than create a parallel planner subsystem:

- `services` is already the authoritative service record with organization, campus, title, service type, status, scheduled start, Bible version and lifecycle timestamps.
- `presentation_items` already supports `scripture`, `song`, `slide`, `media`, `announcement`, `lower_third`, `camera`, and `custom` item types with JSON content, `sort_order`, state and timestamps.
- `GET /api/v1/edge/operator/catalog` already reads ordered `presentation_items`, scopes them to the authenticated device's active service, caps the result and exposes a stable catalog revision.
- The Edge runtime already authenticates to the Control Plane, caches the operator catalog durably and exposes it to the Avalonia shell over same-user IPC.
- The desktop Operator workspace already maps synced catalog items into local categories and can Preview, Take and Clear through local IPC while the loopback renderer remains read-only.
- Existing backend RBAC role lists remain authoritative and must not be loosened.

The planner therefore becomes the authoring layer for data the Edge/desktop path already knows how to consume.

## Product scope
Phase 1 includes four connected surfaces:

1. **Service list / service creation** in the Control Plane.
2. **Service Planner** for metadata, rundown authoring, ordering, preview and readiness validation.
3. **Edge catalog synchronization** of the authored ordered rundown using the existing device-authenticated catalog contract.
4. **Desktop Order of Service UX** that makes the synced rundown usable as a real operator queue with current/next semantics.

A separate reusable Media Library / Asset Manager is explicitly deferred to the next milestone. Phase 1 media cues may reference only approved application-managed media metadata (including an existing organization-scoped `media_sources` record or an HTTPS asset reference already stored by trusted application configuration). The planner does not provide a free-form URL/path field. Arbitrary local filesystem paths and unrestricted uploads are not permitted.

## Roles and authorization
Existing RBAC remains the source of truth.

### Planner mutation roles
The following roles may create/edit services and mutate rundown items:
- `owner`
- `admin`
- `pastor`
- `presenter_operator`
- `media_operator`

### Read-only roles
The following roles may view permitted service/rundown information but cannot mutate it:
- `translator`
- `finance`
- `welfare`
- `group_leader`
- `viewer`

`translator` retains its existing translation-specific mutation permissions elsewhere; this does not grant planner editing.

All planner mutations must verify both:
1. the signed-in user has an allowed role in the target organization; and
2. the target service belongs to that same organization.

No API may accept a client-supplied organization id as authority without deriving/validating it from membership and the service record.

## Service lifecycle
Use the existing service states:
- `draft`
- `ready`
- `live`
- `ended`
- `archived`

### Allowed planner transitions
- New services start as `draft`.
- `draft -> ready` only after readiness validation passes.
- `ready -> draft` is allowed for authorized planners when edits are needed before going live.
- `ready -> live`, `live -> ended`, and archive behavior continue through the existing operational service controls rather than the planner inventing a second lifecycle.
- Planner structural edits are allowed in `draft` and `ready`.
- **Phase 1 uses a conservative ready-edit rule:** any persisted planner metadata/item/reorder mutation against a `ready` service atomically demotes it to `draft` and clears `active_service_id` from Edge devices assigned to that service. The planner must explicitly pass readiness validation and mark it ready again. This prevents a partially edited rundown from remaining eligible for service use.
- Once `live`, destructive structural edits are blocked in Phase 1. Runtime-specific operator actions continue through existing live controls.
- `ended` and `archived` rundowns are read-only.

Draft services are planner-only and do not sync to Edge. The existing Edge catalog intentionally exposes only the active device-assigned service when that service is `ready` or `live`. A ready service demoted to draft therefore disappears from the Edge catalog on the next successful sync, and clearing its device assignment allows a later ready/live service to be assigned normally.

## Service list and creation UX
Add a Service Planner entry point to the Control Room for authorized planner roles.

The planner must not create a second manual device-assignment workflow. Device administration/pairing remains under **Settings → Edge Devices**, while the existing service lifecycle logic may continue automatically assigning eligible campus Edge devices when a service becomes `ready`/`live`. The planner may display assignment status only.

The service list shows:
- title;
- service type;
- campus / organization-wide label;
- scheduled start in the organization's configured timezone;
- status;
- active Bible version;
- rundown item count;
- readiness issue count;
- assigned/active Edge workstation indicator where available.

Filters:
- Upcoming
- Draft
- Ready
- Live
- Ended/Archive
- campus where applicable

Create-service form fields:
- title — required, bounded;
- service type — controlled value, default `sunday_service`;
- campus — optional, restricted to organization campuses;
- scheduled date/time — optional for drafts but required before `ready`;
- active Bible version — required, selected from locally enabled Bible versions.

Creation is transactional and audited.

## Service Planner layout
Desktop-class web layout uses three working regions while remaining responsive on tablets/mobile:

### Left: Order of Service
- ordered cue list with drag handle;
- sequence number;
- item-type icon/badge;
- title;
- compact validation/error badge;
- Preview shortcut;
- duplicate action;
- context menu for edit/delete;
- current selection highlight;
- search/filter by item type.

### Center: Cue editor
Typed editor for the selected item. Raw JSON is never the primary UX.

### Right: Preview and service readiness
- presentation preview using the same normalized title/body/footer semantics consumed by Edge;
- service metadata summary;
- readiness checklist;
- Save / Ready for service actions;
- latest update/audit hint.

On narrow screens these regions collapse into stacked cards/tabs without horizontal overflow.

## Rundown item contract
Continue storing item-specific structured content in `presentation_items.content` JSONB, but define explicit server-side schemas per item type. Every mutation normalizes and validates data before persistence.

All item types share:
- `id`
- `service_id`
- `item_type`
- `title`
- `sort_order`
- `state`
- `content`
- timestamps

Item content remains bounded so the Edge catalog cannot be used as an arbitrary blob transport. Presentation body text is capped at the existing Edge normalization limit of **12,000 characters**; footer/subtitle text is capped at **500 characters**; metadata stays within the existing bounded safe-string map. Item-specific editors may impose stricter limits where appropriate.

### Scripture
Editor fields:
- reference input, e.g. `John 3:16-18`;
- Bible version;
- resolved canonical book/chapter/verse range;
- resolved passage text;
- optional footer/style note.

Behavior:
- Resolve through the existing local Bible tables/parsing rules.
- Store canonical reference + version + resolved presentation text, not only the raw user query.
- Range limits follow the existing scripture resolver safety cap.
- A missing/invalid passage prevents readiness.

### Song
Phase 1 song content:
- title;
- optional author/source note;
- ordered sections, each with a section label (`Verse 1`, `Chorus`, `Bridge`, etc.) and bounded text;
- optional default section to preview first.

The planner edits all sections as one rundown item. Desktop Phase 1 renders the normalized song body; per-section live stepping is a later enhancement unless it can be added without changing the runtime contract.

Do not prepopulate copyrighted song lyrics except content supplied/licensed by the church. Product fixtures/tests use public-domain text only.

### Slide
Fields:
- title;
- body;
- optional footer;
- optional presentation style token from a small allowlist.

### Announcement
Fields:
- title;
- body;
- optional footer/date note;
- optional presentation style token.

### Lower third
Fields:
- primary text;
- secondary text;
- optional duration hint.

No Phase 1 automatic timer is authoritative; the duration is metadata for the operator.

### Media cue
Fields:
- title;
- approved source identifier or HTTPS asset URL from trusted application-managed metadata;
- media kind (`image`, `video`, `audio`);
- optional operator notes.

Phase 1 must reject arbitrary local filesystem paths, executable/script URLs, `javascript:` URLs, and unbounded remote metadata. Actual upload/transcode/thumbnail/local-cache management belongs to the Media Library milestone.

### Camera
Fields:
- source identifier/name from known Edge/media-source inventory when available;
- optional label/operator note.

### Custom
Fields:
- title;
- body;
- footer;
- optional safe style token.

`custom` must not become an escape hatch for raw HTML/JS or arbitrary JSON blobs.

## API surface
Add authenticated web-user planner APIs under a consistent service-planning namespace. Exact filenames may follow existing Next.js conventions, but the logical contract is:

### Services
- `GET /api/v1/planner/services`
  - organization-scoped list with filters/counters.
- `POST /api/v1/planner/services`
  - create draft service.
- `GET /api/v1/planner/services/[id]`
  - service metadata + ordered rundown + readiness summary.
- `PATCH /api/v1/planner/services/[id]`
  - edit bounded service metadata in editable states.
- `POST /api/v1/planner/services/[id]/ready`
  - run readiness validation and transition draft -> ready atomically if valid.
- `POST /api/v1/planner/services/[id]/draft`
  - authorized ready -> draft transition.

### Items
- `POST /api/v1/planner/services/[id]/items`
  - create typed item at requested position/end.
- `PATCH /api/v1/planner/services/[id]/items/[itemId]`
  - typed edit.
- `DELETE /api/v1/planner/services/[id]/items/[itemId]`
  - delete in editable states.
- `POST /api/v1/planner/services/[id]/items/[itemId]/duplicate`
  - duplicate immediately after source with a new id.
- `POST /api/v1/planner/services/[id]/reorder`
  - transactionally apply the complete ordered item-id list for that service.
- `POST /api/v1/planner/services/[id]/preview`
  - normalize/resolve an unsaved or saved item and return presentation-safe preview content without mutating Program.

All JSON requests use bounded strings/arrays and strict item-type validation. Unknown fields are discarded or rejected according to the shared validation layer; secrets/raw HTML are never persisted.

## Ordering and concurrency
The existing integer `sort_order` remains the canonical Edge ordering key in Phase 1.

### Reorder transaction
The reorder endpoint receives the complete ordered list of item ids for the service and must:
1. lock/validate the editable service;
2. verify the submitted ids match the service's current items exactly—no foreign/missing/duplicate ids;
3. update each item to deterministic spaced values (for example `1000, 2000, 3000...`) inside one transaction;
4. update the service `updated_at` so the existing Edge catalog revision changes;
5. audit the reorder;
6. commit atomically.

No partially reordered service may be observable.

### Optimistic concurrency
Planner read responses include a non-secret revision token derived from the service/item update state. Mutating requests send the last observed revision. If another planner changed the service, reject with `409 planner_revision_conflict` and require the UI to refresh/reconcile rather than silently overwrite another person's work.

## Readiness validation
`Ready for service` is an explicit validation gate, not just a status toggle.

Minimum Phase 1 readiness checks:
- scheduled start exists;
- active Bible version exists and is locally enabled;
- at least one rundown item exists;
- every item has valid typed content;
- Scripture passages resolve successfully;
- Media cues use approved/safe source metadata;
- item ordering is unique/contiguous logically;
- no item is left in an unsupported/malformed type/state;
- service/campus references remain inside the organization.

The API returns structured issue codes plus bounded human-readable labels. The UI groups issues by service/item and links directly to the affected cue.

Readiness validation is rerun server-side during the ready transition even if the browser already shows zero issues.

## Preview behavior
Planner Preview is safe and non-live:
- Browser preview uses the same normalization logic used by the Edge catalog contract.
- Previewing in the planner does not write `program.show`, does not mutate the live Program renderer and does not send a remote Edge command.
- An optional future `Send to rehearsal Edge Preview` action is not part of Phase 1.

This separation prevents planning work from accidentally changing what the congregation sees.

## Audit trail
Every planner mutation creates a bounded audit event containing:
- organization/service id;
- actor user id;
- action type;
- affected item id/type where applicable;
- before/after high-level metadata or revision identifiers;
- timestamp.

Do not store entire song bodies, Scripture passages, media URLs with credentials, or raw request payloads in audit metadata. Audit values are bounded and presentation/content secrets are excluded.

## Edge catalog synchronization
Do not create a new planner-to-desktop protocol.

The existing `GET /api/v1/edge/operator/catalog` remains the authoritative transport. Planner mutations update `services.updated_at` and/or `presentation_items.updated_at`, causing a new catalog revision. The already-authenticated Edge runtime refreshes and atomically replaces its local operator catalog.

Required behavior:
- ordered planner items appear in Edge order by `sort_order`;
- item changes generate a new catalog revision;
- deleting/reordering items is reflected after the next successful sync;
- temporary cloud loss preserves the last same-service cached rundown;
- service assignment changes continue to purge old service-scoped content before new content is accepted;
- the Avalonia process still receives no device bearer credential.

## Desktop Operator: Order of Service
Enhance the existing left pane without changing the runtime security boundary.

When a synced service exists, show an **Order of Service** rather than a generic catalog:
- sequence numbers;
- cue type badge;
- cue title and compact secondary detail;
- current Program cue indicator where the runtime can map Program item id;
- Preview cue indicator;
- `NEXT` indicator for the cue immediately after the current/selected cue;
- local search/filter remains available;
- service/cache state badge remains visible.

Interaction:
- single selection updates the center Preview selection details;
- Preview invokes existing local `preview.render` semantics;
- Take invokes the existing runtime-authoritative Preview -> Program path;
- Clear remains unchanged;
- after a successful Take acknowledgement, selection advances to the next rundown cue but does not automatically put it live;
- keyboard shortcuts remain supported and should gain a safe `next selection` / `previous selection` pair if platform-neutral keys can be added without stealing standard text-entry shortcuts;
- offline cache continues to work exactly as before.

No desktop CRUD of cloud rundown items is introduced in Phase 1. Editing remains in the Control Plane planner; the desktop is optimized for operation/rehearsal.

## Current / next state semantics
The runtime remains authoritative for Preview and Program truth.

The desktop must never infer that an item is live merely because the user selected it. Program/current styling comes from acknowledged runtime state. If the Program item cannot be mapped to the current cached rundown (for example ad-hoc Scripture), show it as `Ad-hoc Program` without corrupting the rundown selection.

Auto-advance means only moving the selection focus after a successful Take. It does not issue a second Preview or Program command automatically.

## Error behavior
- `401/403`: safe authorization message; no role/database detail.
- `404`: service/item not found within the caller's organization scope; no cross-tenant existence leakage.
- `409 planner_revision_conflict`: another planner changed the service; browser prompts refresh/reload of latest rundown.
- `409 service_not_editable`: service is live/ended/archived or another lifecycle rule blocks editing.
- `422 readiness_failed`: structured readiness issue list.
- Bible resolver failure: item remains unsaved/invalid; no partial Scripture item.
- DB transaction failure during reorder/duplicate/delete: rollback completely.
- Edge offline: planner saves remain authoritative in cloud; desktop shows its last cache until reconnection.

Errors shown to users are specific enough to fix the problem but do not expose SQL, stack traces, bearer credentials, provider tokens, stream keys or raw infrastructure responses.

## Security requirements
- Existing CSRF/session protections and Auth.js patterns remain in force.
- Mutations require web-user authentication plus organization-role authorization.
- Every service/item query is organization scoped.
- Item bodies are plain presentation content; no raw HTML execution.
- URLs are parsed/allowlisted by scheme and bounded; no local path traversal.
- The planner never receives Edge device credentials or provider OAuth tokens.
- The Edge catalog never receives planner session cookies.
- Audit logs exclude secrets and large raw content.
- Result/request limits prevent oversized rundown/body payloads.

## Performance and limits
Initial Phase 1 limits:
- maximum 200 rundown items per service, matching the existing Edge catalog cap;
- maximum 64 song sections per song item;
- maximum body sizes must not exceed the existing presentation normalization/body limits used by Edge;
- service list uses pagination or a bounded upcoming/archive window rather than unbounded organization history;
- drag reorder sends one complete bounded id list, not one request per row;
- planner UI uses optimistic local drag visuals but does not declare save success until the server acknowledges the transaction.

## Accessibility and UX quality
- Drag-and-drop must also have keyboard-accessible Move Up / Move Down actions.
- All action buttons have accessible names and visible focus states.
- Item type is communicated by text/icon, not color alone.
- Modals/editors use predictable focus and Escape/cancel behavior.
- Destructive delete requires confirmation when the item has meaningful content.
- Mobile/tablet layouts must not horizontally overflow.
- Buttons and form controls use the established modern Control Room sizing rather than tiny/slim controls.

## Testing strategy
### Control Plane database/API tests
Prove:
- create service is organization scoped;
- unauthorized roles cannot mutate;
- cross-tenant service/item ids do not leak;
- typed validation for each Phase 1 item type;
- Scripture canonical resolution/version checks;
- unsafe media URL/path rejection;
- reorder is atomic and rejects missing/foreign/duplicate ids;
- duplicate/delete/edit update revisions;
- revision conflicts return 409;
- readiness returns deterministic issue codes and only valid drafts become ready;
- ready services return to draft when an invalidating edit is made;
- live/ended/archived structural edits are blocked;
- audit events are emitted without raw secrets/oversized bodies.

### Control Plane UI/self-tests
Prove:
- planner role visibility matches existing RBAC policy;
- read-only roles cannot see mutation affordances;
- create/edit typed forms serialize the expected bounded contract;
- drag reorder and keyboard reorder use the same endpoint;
- readiness issues link to affected item;
- planner Preview is non-live and does not issue Edge Program commands;
- responsive structure retains all core actions.

### Edge/Core tests
Prove:
- planner-authored catalog ordering survives serialization/cache round-trip;
- catalog revision changes after item/service mutations;
- same-service offline cache is retained;
- assignment/service changes purge old content;
- no new secret-bearing fields enter cache or IPC.

### Desktop tests
Prove:
- synced order is displayed in sort order;
- current/Preview/next decorations follow acknowledged runtime state;
- successful Take advances selection only;
- failed Take does not advance;
- ad-hoc Program content does not corrupt rundown current state;
- offline cache remains operable;
- keyboard and search/filter behavior remains bounded and deterministic.

Existing Windows/macOS builds, core tests, desktop tests, native bridge verification, SRT smoke tests, Control Portal lint/build and existing security self-tests remain mandatory release gates.

## Deployment and compatibility
Database changes must be backward compatible with the existing foundation. Prefer adding indexes/constraints/helper columns only where the current schema cannot express the contract. `presentation_items` remains the canonical table; do not replace it.

The Control Plane planner may deploy before a new desktop artifact because the current Edge catalog can already consume ordered presentation items. Desktop enhancements are additive and must tolerate services authored before/after the planner deployment.

No migration may reset existing demo/service data.

## Non-goals for Phase 1
- Full reusable Media Library with uploads/transcoding/thumbnails/local asset caching.
- Copyrighted commercial song catalog/licensing integrations.
- Desktop cloud-authoring/editing of rundown items.
- Multi-user CRDT/live collaborative editing; optimistic revision conflict handling is sufficient.
- Automatic Take-to-Program based only on planner order.
- Timeline-based automation/cue durations.
- Stage-display confidence monitor redesign.
- Full church-management scheduling/roster system.

## Acceptance criteria
Phase 1 is complete only when all of the following are true:

1. An authorized planner can create a draft service and build a typed ordered rundown from the web portal.
2. Scripture items resolve from the existing Bible database with selectable enabled versions.
3. Song, slide, announcement, lower-third, media, camera and custom cues use safe typed editors rather than raw JSON.
4. Drag/drop and keyboard reordering persist atomically and generate a new catalog revision.
5. Concurrent stale edits are rejected with a recoverable 409 flow.
6. `Ready for service` runs server-side validation and cannot mark an invalid service ready.
7. Planner Preview is presentation-faithful but cannot alter live Program output.
8. Existing RBAC and tenant isolation remain enforced at API and UI layers.
9. The paired Edge runtime receives the authored ordered rundown through the existing catalog endpoint and preserves it offline.
10. Windows/macOS desktop shows a true Order of Service with current/Preview/next state and safe post-Take selection advance.
11. No planner, Edge cache, IPC DTO or audit event exposes device bearer credentials, pairing codes, OAuth tokens or stream keys.
12. All existing and new Control Portal, Edge and desktop CI gates are green, and production deployment/health verification succeeds.
