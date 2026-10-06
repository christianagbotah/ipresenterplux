# Desktop Operator Catalog & Scripture Sync Design

## Intent
Replace the Phase 1 seeded desktop rundown with authoritative service and scripture content while keeping the Avalonia shell credential-free and useful during cloud loss.

Success means a paired Edge workstation can browse the active service catalog, search Bible passages by reference/version, Preview/Take/Clear locally, and keep the last safe catalog available offline without the desktop process ever receiving a device bearer credential or provider secret.

## Security boundary
- The Edge runtime remains the only desktop-side component authenticated to the Control Plane.
- The Avalonia desktop process never receives or persists Edge bearer credentials, pairing codes, OAuth tokens, stream keys, or raw provider payloads.
- Existing loopback HTTP renderer stays read-only.
- Desktop catalog reads and presentation mutations use the existing same-user operator IPC channel.
- Every Control Plane query is scoped to the authenticated device's organization and active service.
- Catalog/read-model responses are bounded and contain presentation-safe data only.

## Control Plane read model
Add `GET /api/v1/edge/operator/catalog` authenticated with `authenticateEdgeDevice`.

When the device has no valid active ready/live service, return `ok: true` with `service: null`, an empty catalog, locally-enabled Bible versions, and an `observedAt` timestamp.

When a service is active, return:
- service id, title, status, active Bible version, scheduled/started timestamps where present;
- locally enabled Bible versions (`id`, `name`, `abbreviation`, `languageCode`), capped at 32;
- service presentation items, capped at 200 and ordered by `sort_order`, normalized to presentation-safe title/body/footer/metadata;
- scripture detections/queue, capped at 200, including resolved passage text from `bible_books`/`bible_verses` with `source_text` fallback;
- a stable catalog revision derived from service/update/content timestamps, not secrets.

Add `GET /api/v1/edge/operator/scripture?reference=John%203%3A16&version=KJV` for direct reference resolution. It must:
- require device auth and an active ready/live service;
- default `version` to the service's active Bible version;
- accept canonical book names plus numeric chapter and optional single/range verses;
- cap ranges to 80 verses and body text to the existing local presentation limit;
- return a presentation-safe item with a deterministic non-secret item id suitable for local Preview;
- reject malformed references with 400, unavailable versions/books/passages with 404, and service-scope failures with 409/404 without tenant leakage.

Free-text full-Bible search is not part of this slice; the desktop search box filters the synced service catalog locally, while explicit scripture references use the resolver endpoint through the Edge runtime.

## Edge runtime cache
Create a versioned `OperatorCatalogSnapshot` model and a file-backed `OperatorCatalogStore` in the per-user Edge data directory.

The cache contains only:
- schema version;
- `syncedAt`, `observedAt`, `catalogRevision`;
- active service metadata;
- Bible version descriptors;
- bounded presentation/scripture items.

Writes are atomic (`.tmp` + replace/move). Corrupt/unknown-version cache files are ignored safely and never prevent runtime startup. Service changes immediately clear old service-scoped items before the next sync. No credential material is serialized.

The runtime uses the existing credential store internally to call the two new endpoints. It refreshes the catalog after assignment changes and on the normal heartbeat loop, but cloud failure leaves the last same-service cache intact and marks it stale rather than deleting it.

## Local operator IPC
Extend the allowlist with read-only catalog commands:
- `catalog.query` returns the cached snapshot plus stale state;
- `scripture.resolve` accepts only bounded `reference` and optional `version` strings.

`scripture.resolve` is handled by the runtime: when online it resolves through the authenticated Control Plane client, persists the resolved item into the current cache when appropriate, and returns presentation-safe content. If offline, it may resolve only exact entries already present in the cache; otherwise it returns a safe `scripture_unavailable_offline` error.

The IPC DTOs contain no credential/token fields and do not allow the desktop to inject organization/service IDs.

## Desktop UX
Replace `OperatorWorkspaceCatalog.Seeded` as the normal source with the cached catalog from `catalog.query`.

The left pane shows:
- current service title/status;
- cache state (`Live`, `Offline cache`, or `Local rehearsal`);
- Bible version selector using synced versions and defaulting to the active service version;
- service rundown/scripture queue, filtered locally by the existing search box and category buttons;
- explicit scripture reference entry/action for references such as `John 3:16` or `Psalm 23`.

Resolved scripture becomes an `OperatorWorkspaceItem` and can be previewed with the existing `preview.render` command, then Take/Clear unchanged.

Seeded sample content is shown only when there is no synced catalog and no active service, clearly labeled as rehearsal/demo content.

## Error and offline behavior
- 401/expired credential: runtime follows existing enrollment/credential behavior; desktop sees no credential detail.
- Control Plane/network error: runtime reports degraded connection and preserves the last same-service cache.
- Active service changes: old service-scoped items are purged before accepting new catalog content.
- Corrupt cache: ignored and replaced on next successful sync.
- Unsupported cache schema: ignored safely.
- Invalid scripture reference: safe user-facing validation; no SQL/provider detail.

## Testing
Control Plane self-test coverage must prove device auth, tenant/service isolation, result caps, default Bible version, valid reference/range resolution, malformed references, and missing passages.

Core tests must prove atomic cache round-trip, corruption recovery, schema rejection, service-change purge, stale-state calculation, bounded/safe DTOs, authenticated HTTP catalog/scripture clients, and offline exact-cache resolution.

Desktop tests must prove catalog-to-rundown filtering, active Bible version selection, rehearsal fallback only without synced content, and scripture resolve -> Preview over local IPC.

Existing Windows/macOS Edge builds, desktop tests, core tests, native bridge and SRT smoke gates remain mandatory.

## Non-goals for this slice
- Full-text Bible search across every verse.
- Editing/creating cloud presentation items from the desktop.
- Songs/media library authoring or upload.
- Multi-service browsing from a single Edge workstation.
- Exposing cloud credentials to the Avalonia shell.
