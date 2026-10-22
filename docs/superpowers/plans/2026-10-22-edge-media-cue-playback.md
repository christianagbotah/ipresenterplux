# Edge Media Cue Playback v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make approved image, MP4 video, and audio rundown cues prepare locally on Church Edge, Preview safely, TAKE to Program, continue offline once prepared, and stay synchronized across projector and contribution output.

**Architecture:** Control Plane resolves trusted media descriptors; Edge downloads and validates them into a service-aware local cache; a preparation coordinator gates Preview readiness; one playback coordinator owns Program playhead/state; the loopback Program page, Windows rendered contribution frames, and media-audio mixer all consume that same Edge state. Native camera/display/window routing remains a separate Program source family under `VisualProgramRouter`.

**Tech Stack:** Next.js 16/TypeScript/PostgreSQL, .NET 10/C#, Avalonia desktop, SkiaSharp, Windows Media Foundation, macOS Swift 6 + AVFoundation/ScreenCaptureKit/VideoToolbox, HttpListener loopback renderer, xUnit, Node self-tests, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-22-edge-media-cue-playback-design.md`

## Global Constraints

- Base implementation work on `14005ee` plus approved design commit `10ddf37`; do not mutate the detached deployment checkout.
- Preserve Preview → TAKE → Program authority. Download, catalog sync, selection, or readiness changes may never mutate Program.
- Browser media sources are loopback-only. A remote asset URL must never reach Chromium or local operator IPC.
- Supported v1 image formats: PNG, JPEG, WebP. Supported video: MP4/H.264 with optional AAC. Supported audio: MP3, AAC/M4A, WAV.
- Per-asset limits: image 25 MiB; audio 500 MiB; video 4 GiB. Default total cache quota: 20 GiB. Prefetch concurrency: maximum 2 downloads.
- Remote media requires HTTPS with no userinfo; reject loopback, private, link-local, and DNS-rebound destinations; every redirect target is revalidated.
- Stable browser/video synchronization target: <= 250 ms from Edge playback position after correction. Contribution media audio/video target: <= 120 ms during stable playback.
- Dynamic video/audio must not auto-resume after Edge restart. Image Program may restore only when its cached entry still validates.
- Existing Scripture/text/theme behavior, native visual routing, recording, streaming, and microphone/ASR behavior must remain green after every task.
- Media audio is mixed into contribution audio but is not fed into preacher ASR/translation by default.
- No first-party upload workflow, cloud transcoding, new codecs, layered compositor, HLS/DASH/RTSP, AI TAKE, or automatic next-cue advance in this milestone.
- The current VPS does not have the .NET SDK. During execution on this host, use Edge Agent CI for required .NET RED/GREEN proof rather than installing an SDK just for this feature. Node/Control self-tests may run locally.

## Review Focus

- DNS/redirect rebinding: a public hostname or first redirect must not become an allowed tunnel to private/link-local IPs; Task 3 tests both initial and redirected resolution.
- Stale/corrupt cache identity: a manifest/file mismatch or assetVersion change must invalidate the hit and force preparation before Preview; Task 3 tests both cases.
- Repeated/cancelled preparation: concurrent Preview/prefetch calls must share one download and cancellation/failure must remove temp files without poisoning retries; Tasks 3–4 pin this behavior.
- Restart/service change: a persisted dynamic media Program or stale old-service asset must not resume or remain authoritative after restart/assignment change; Tasks 6 and 10 test recovery and scope reset.
- Source-family switching: native camera/display/window TAKE while media is active, then return to rendered Program, must stop media video/audio cleanly without breaking contribution output; Tasks 8–10 test routing and audio teardown.

---

### Task 1: Unified Edge presentation resolution and typed media contract

**Files:**
- Create: `apps/control/src/lib/edge-presentation-resolver.ts`
- Create: `apps/control/scripts/edge-presentation-resolver-selftest.mjs`
- Modify: `apps/control/src/app/api/v1/edge/presentation/items/[id]/route.ts`
- Modify: `apps/control/src/app/api/v1/edge/operator/catalog/route.ts`
- Modify: `apps/control/package.json`
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Contracts/PresentationMediaDescriptor.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Contracts/PresentationRenderItem.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Transport/HttpPresentationContentClient.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/HttpPresentationContentClientTests.cs`

**Interfaces:**
- Produces TS `resolveEdgePresentationItem(client, { deviceId, organizationId, itemId }): Promise<EdgeResolvedPresentation | null>`.
- Produces C# `PresentationMediaDescriptor(Guid SourceId, string MediaKind, Uri DownloadUrl, string AssetVersion, string? ContentTypeHint, string Title, double TrimStartSeconds, double? TrimEndSeconds, bool Loop, double Volume, string Fit)`.
- Extends `PresentationRenderItem` with optional final parameter `PresentationMediaDescriptor? Media = null` so old persisted JSON still deserializes.
- Later tasks consume only the typed descriptor; metadata dictionaries stay for themes/forward compatibility.

- [ ] **Step 1: Write the failing Control resolver tests.**

Add cases named:

```js
resolves_media_descriptor_from_active_service_item
rejects_cross_tenant_or_wrong_service_item_without_leak
rejects_unsafe_media_source_url
normalizes_media_trim_loop_volume_and_fit
keeps_legacy_scripture_detection_fallback
```

Assert media output contains `sourceId`, `mediaKind`, approved absolute HTTPS `downloadUrl`, stable `assetVersion`, defaults `trimStartSeconds=0`, `loop=false`, `volume=1`, `fit="contain"`, and no raw `public_config` object.

- [ ] **Step 2: Run the Control test and confirm RED.**

Run: `cd apps/control && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/edge-presentation-resolver-selftest.mjs`

Expected: FAIL because the unified resolver/route contract does not exist yet.

- [ ] **Step 3: Write the failing .NET transport contract tests.**

Add assertions that `HttpPresentationContentClient.GetAsync()` maps a media payload into `PresentationRenderItem.Media`, rejects mismatched item IDs, rejects invalid media URI/kind/bounds, and still maps a legacy response with no `media` field.

- [ ] **Step 4: Verify the .NET tests are RED.**

Run when SDK is available:
`dotnet test apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/iPresenterPlux.Edge.Core.Tests.csproj --filter HttpPresentationContentClientTests`

On the current VPS: push the test-only commit and confirm Edge Agent CI fails in this test class for missing media contract/resolver support.

- [ ] **Step 5: Implement the unified Control resolver and route integration.**

`resolveEdgePresentationItem` must first resolve `presentation_items` through the authenticated device's active service/organization, normalize supported item types, resolve media source configuration server-side, and then fall back to legacy `scripture_detections` only when no presentation item matches.

- [ ] **Step 6: Implement the typed C# descriptor and HTTP client mapping.**

Validation pins: mediaKind in `image|video|audio`; trim start >= 0; trim end null or > start; volume 0..1; fit `contain|cover`; download URL absolute HTTPS without credentials.

- [ ] **Step 7: Run GREEN verification.**

Run Control self-test plus existing planner/media/catalog tests:
`pnpm test:edge-presentation-resolver && pnpm test:edge-operator-catalog && pnpm test:media-workspace && pnpm test:service-planner-item`

Run/CI the filtered Core tests. Expected: PASS and existing Scripture fallback remains green.

- [ ] **Step 8: Commit.**

```bash
git add apps/control apps/edge-agent/src/iPresenterPlux.Edge.Core/Contracts apps/edge-agent/src/iPresenterPlux.Edge.Core/Transport apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/HttpPresentationContentClientTests.cs
git commit -m "feat(media): resolve trusted edge media descriptors"
```

---

### Task 2: Item-based local Preview contract with preparation boundary

**Files:**
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Abstractions/IMediaPreparationCoordinator.cs`
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/MediaPreparationModels.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/OperatorCatalogModels.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Transport/HttpOperatorCatalogClient.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/LocalOperatorContracts.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/LocalOperatorCommandHandler.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/LocalOperatorClient.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/OperatorWorkspaceCatalog.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/MainWindow.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/HttpOperatorCatalogClientTests.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/LocalOperatorCatalogCommandTests.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/LocalOperatorCommandHandlerTests.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Desktop.Tests/LocalOperatorClientTests.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Desktop.Tests/OperatorWorkspaceCatalogTests.cs`

**Interfaces:**
- Produces `MediaPreparationState` enum: `NotRequired, Queued, Downloading, Validating, Ready, Unsupported, Failed`.
- Produces `PreparedMediaAsset(string ItemId, Guid ServiceId, string CacheKey, string LocalPath, string ContentType, string MediaKind, TimeSpan? Duration, PresentationMediaDescriptor Descriptor)`.
- Produces `MediaPreparationSnapshot(string ItemId, Guid ServiceId, MediaPreparationState State, PreparedMediaAsset? Asset, string? ErrorCode)`.
- Produces `IMediaPreparationCoordinator` with `PrepareAsync(PresentationRenderItem item, CancellationToken)`, `MediaPreparationSnapshot? TryGet(string itemId)`, `Task PrefetchAsync(Guid serviceId, IReadOnlyList<OperatorCatalogItem> items, CancellationToken)`, `IDisposable AcquireReadyLease(string itemId)`, `Task SetActiveServiceAsync(Guid? serviceId, CancellationToken)`, and `event EventHandler<MediaPreparationSnapshot> StatusChanged`; Task 4 provides the real implementation.
- Adds local command `preview.prepare_item` with `ItemId` only. No URL/path may appear in the request.

- [ ] **Step 1: Write failing catalog/IPC tests.**

Assert a synced media row preserves its original `itemType=media`, permits its intentionally empty presentation body, and preserves the typed media descriptor; `preview.prepare_item` carries only item ID; a cross-service item fails `catalog_scope_mismatch`; a media fake coordinator returning `Failed` leaves existing Preview/Program unchanged.

- [ ] **Step 2: Verify RED in Core/Desktop test projects.**

Expected failures: unknown command/request field, no media descriptor on catalog item, and no preparation abstraction.

- [ ] **Step 3: Add preparation contracts and catalog mapping.**

`OperatorCatalogItem` gains optional `PresentationMediaDescriptor? Media = null`. `HttpOperatorCatalogClient` validates the same bounds as Task 1 and remains backward-compatible with catalog entries lacking media.

- [ ] **Step 4: Implement `preview.prepare_item`.**

The handler resolves the selected item from the same-service cached catalog, builds trusted `PresentationRenderItem`, invokes preparation only when `Media != null`, and calls `_mediaOutput.SetPreviewAsync` only after `Ready`/`NotRequired`.

- [ ] **Step 5: Migrate synced desktop rundown selection to item-based Preview.**

`OperatorWorkspaceItem` stores source `ItemType` separately from UI category. `PreviewSelectedAsync` sends `preview.prepare_item` for synced catalog rows and keeps `preview.render` only for local rehearsal/text and resolved Scripture compatibility.

- [ ] **Step 6: Run GREEN verification.**

Run/CI the five affected test classes plus existing desktop tests. Confirm there is no serialized `http://`, `https://`, local path, or media descriptor in a local Preview request fixture.

- [ ] **Step 7: Commit.**

```bash
git add apps/edge-agent/src apps/edge-agent/tests
git commit -m "feat(media): prepare synced cues by trusted item id"
```

---

### Task 3: Secure Edge media asset cache

**Files:**
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Abstractions/IMediaAssetCache.cs`
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/MediaAssetCache.cs`
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/MediaAssetCacheModels.cs`
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/MediaRemoteEndpointPolicy.cs`
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/MediaFormatProbe.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/MediaAssetCacheTests.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/MediaRemoteEndpointPolicyTests.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/MediaFormatProbeTests.cs`

**Interfaces:**
- Produces `MediaAssetCacheOptions(long ImageLimitBytes=26_214_400, long AudioLimitBytes=524_288_000, long VideoLimitBytes=4_294_967_296, long TotalQuotaBytes=21_474_836_480, int MaxConcurrentDownloads=2)`.
- Produces `MediaAssetCacheEntry(string CacheKey, string Path, string ContentType, string MediaKind, string Sha256, long Length, DateTimeOffset LastAccessedAt)`.
- Produces `IMediaAssetCache.PrepareAsync(Guid organizationId, PresentationMediaDescriptor descriptor, CancellationToken)`, `TryGetReady(string cacheKey, out MediaAssetCacheEntry entry)`, and `IDisposable AcquireLease(string cacheKey)`.
- `MediaRemoteEndpointPolicy` owns HTTPS/userinfo/IP/DNS/redirect validation; `MediaAssetCache` never opens a connection before policy approval.

- [ ] **Step 1: Write failing remote-policy tests.**

Cover HTTPS required, embedded credentials rejected, IPv4/IPv6 loopback/private/link-local rejected, public host allowed, DNS resolving to private rejected, and a redirect from public URL to private destination rejected before body read.

- [ ] **Step 2: Write failing cache tests.**

Cover one successful fixture per supported family, exact size limits with/without `Content-Length`, two concurrent callers sharing one transfer, cancellation temp cleanup, corrupt/type-spoof rejection, assetVersion change invalidation, SHA/manifest mismatch invalidation, LRU eviction skipping active leases, and `media_cache_full` when no inactive entry can make room.

- [ ] **Step 3: Verify RED.**

Run/CI the three new Core test classes. Expected: missing cache/policy/probe types.

- [ ] **Step 4: Implement remote endpoint validation.**

Use a connection path that validates the resolved destination actually used for the socket; hostname string checks alone do not satisfy the DNS-rebinding requirement. Bound redirect count to 5 and re-run the full policy on every target.

- [ ] **Step 5: Implement format probes and cache promotion.**

Probe PNG/JPEG/WebP signatures, MP4/M4A container structure sufficient to reject obvious spoofing, WAV RIFF/WAVE, and MP3/AAC signatures. Stream to random temp names, compute SHA-256 incrementally, fsync/close, then atomically move the validated file + sidecar manifest into generated cache-key names.

- [ ] **Step 6: Implement quota/lease/deduplication.**

One in-flight task per cache key; semaphore limits active downloads to 2; LRU considers only unleased valid entries; failure/cancellation removes temp files and the in-flight entry so retry is possible.

- [ ] **Step 7: Run GREEN verification.**

Run/CI all three new test classes repeatedly (`--repeat` equivalent or loop 5 times) to catch download-dedup races. Expected: zero leftover `.tmp` files after each test.

- [ ] **Step 8: Commit.**

```bash
git add apps/edge-agent/src/iPresenterPlux.Edge.Core apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/Media*Tests.cs
git commit -m "feat(media): add secure edge asset cache"
```

---

### Task 4: Preparation coordinator, prefetch, and readiness state

**Files:**
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/MediaPreparationCoordinator.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/MediaPreparationModels.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/EdgeAgentRuntime.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/LocalOperatorCommandHandler.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Windows/Program.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.MacOS/Program.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/MediaPreparationCoordinatorTests.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/LocalOperatorCommandHandlerTests.cs`

**Interfaces:**
- Implements the complete Task 2 `IMediaPreparationCoordinator` using Task 3 `IMediaAssetCache`.
- `TryGet(itemId)` is read-only and never triggers a download. `AcquireReadyLease(itemId)` succeeds only for `Ready` state and delegates to the cache entry lease.

- [ ] **Step 1: Write failing preparation tests.**

Assert transition sequence `Queued -> Downloading -> Validating -> Ready`, transient failure retry, permanent unsupported result does not auto-retry, non-media returns `NotRequired`, wrong service returns `media_scope_mismatch`, duplicate prefetch+Preview shares the cache job, and service switch cancels old low-priority work while preserving validated files as inactive cache entries.

- [ ] **Step 2: Verify RED.**

Expected: no concrete coordinator and runtime has no prefetch wiring.

- [ ] **Step 3: Implement the coordinator state machine.**

State changes are serialized per item ID. Prefetch/Prepare do not pin cache entries; only callers that own Preview/Program authority call `AcquireReadyLease(itemId)`.

- [ ] **Step 4: Wire background prefetch after successful catalog refresh.**

After `OperatorCatalogCoordinator.RefreshAsync`, `EdgeAgentRuntime` reads the same-service snapshot and calls `PrefetchAsync` without awaiting individual downloads. Prefetch exceptions degrade only media readiness; they must not fail catalog refresh or runtime startup.

- [ ] **Step 5: Wire real preparation into local Preview.**

Replace Task 2 fake/optional behavior in production hosts. `preview.prepare_item` waits for the selected item's preparation result; only `Ready` or `NotRequired` may call `SetPreviewAsync`.

- [ ] **Step 6: Run GREEN verification.**

Run/CI preparation + local handler tests and existing operator catalog/runtime tests. Verify an old-service media item cannot be Previewed after assignment change.

- [ ] **Step 7: Commit.**

```bash
git add apps/edge-agent/src apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/MediaPreparationCoordinatorTests.cs apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/LocalOperatorCommandHandlerTests.cs
git commit -m "feat(media): gate preview on edge readiness"
```

---

### Task 5: Loopback asset serving and image Preview/Program

**Files:**
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/HttpByteRange.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/LocalWebProgramOutputService.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/LocalWebProgramOutputServiceTests.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/MediaAssetLoopbackTests.cs`

**Interfaces:**
- Loopback route: `/api/media-assets/{cacheKey}` resolves only `IMediaAssetCache.TryGetReady` entries.
- State payload adds optional `media` view with `assetUrl`, `mediaKind`, `contentType`, `fit`, `volume`, and preparation state; remote `downloadUrl` is never serialized.
- `HttpByteRange.TryParseSingle(string? rangeHeader, long length, out long start, out long end)` handles only one byte range.

- [ ] **Step 1: Write failing loopback/range tests.**

Assert GET and HEAD, `Accept-Ranges: bytes`, valid `bytes=0-99` => 206 + exact `Content-Range`, suffix range, open-ended range, multi-range rejection, invalid/out-of-bounds => 416, unknown/traversal-like key => 404, `nosniff`, immutable cache headers, and state JSON contains only loopback URL.

- [ ] **Step 2: Write failing image-render tests.**

Assert Program/Preview HTML contains one dedicated image layer, uses `object-fit: contain|cover`, hides text content for active image, and never inserts descriptor `DownloadUrl` into markup/state.

- [ ] **Step 3: Verify RED.**

Expected: no media asset endpoint/range parser/image layer.

- [ ] **Step 4: Implement range-safe loopback serving.**

Keep listener on `127.0.0.1`; generated cache key is the only lookup token; never join URL path into a filesystem path. When Preview is set for a ready media item, acquire its preparation lease; release the former Preview lease on replacement, service change, or disposal.

- [ ] **Step 5: Implement image rendering.**

Reuse existing theme stage; change media DOM only when item/cache identity changes, not on each 250 ms poll.

- [ ] **Step 6: Run GREEN verification.**

Run/CI both output test classes plus `PresentationTheme*` tests. Confirm ordinary Scripture output HTML/state is unchanged except additive nullable fields.

- [ ] **Step 7: Commit.**

```bash
git add apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests
git commit -m "feat(media): serve cached assets to local program"
```

---

### Task 6: Authoritative media playback coordinator

**Files:**
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/MediaPlaybackCoordinator.cs`
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/MediaPlaybackModels.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/FileProgramStateStore.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/LocalWebProgramOutputService.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/LocalOperatorContracts.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/LocalOperatorCommandHandler.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/MediaPlaybackCoordinatorTests.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/LocalOperatorCommandHandlerTests.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/LocalWebProgramOutputServiceTests.cs`

**Interfaces:**
- Produces `MediaPlaybackSnapshot` fields from the spec, with `long Revision` and `string State` values `ready|playing|paused|ended|error|recovery_required`.
- Produces `TakeAsync(PreparedMediaAsset asset, CancellationToken)`, `PauseAsync`, `ResumeAsync`, `SeekAsync(double seconds, CancellationToken)`, `ClearAsync`, `SetActiveServiceAsync`, `Snapshot`.
- Effective position is derived from injected `TimeProvider`; consumers do not own independent clocks.

- [ ] **Step 1: Write failing state-machine tests with FakeTimeProvider.**

Cover image TAKE, video/audio start at trim start, pause freeze, resume continuation, seek clamp, loop wrap, non-loop ended, final-frame hold state, Clear, service change reset, and persisted dynamic media restoring as `recovery_required` with no time advance/audio authority.

- [ ] **Step 2: Add Review Focus tests for stale restart/service state.**

Persist a video live at position > 0, recreate the coordinator/output, advance clock, and assert position does not move until deliberate resume after matching active service. Change service and assert old item cannot resume.

- [ ] **Step 3: Verify RED.**

Expected: playback types/commands absent.

- [ ] **Step 4: Implement serialized playback mutations.**

One semaphore/gate owns TAKE/pause/resume/seek/end/Clear/service change. Increment revision for every state/epoch mutation. Loop/end evaluation occurs from `TimeProvider` against trim bounds.

- [ ] **Step 5: Integrate Program TAKE/Clear and persisted recovery.**

`LocalWebProgramOutputService.TakePreviewToProgramAsync` must refuse prepared media that is not Ready, transfer/acquire the ready lease from Preview to Program, commit Program identity, then start the playback epoch as one serialized operation from the operator's perspective. Clear/replacement/service change stops media before releasing the Program lease.

- [ ] **Step 6: Run GREEN verification.**

Run/CI playback, local handler, state-store, and output tests. Existing non-media TAKE behavior must stay green.

- [ ] **Step 7: Commit.**

```bash
git add apps/edge-agent/src/iPresenterPlux.Edge.Core apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests
git commit -m "feat(media): add authoritative program playback state"
```

---

### Task 7: Browser video/audio synchronization and local transport controls

**Files:**
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/LocalWebProgramOutputService.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/LocalOperatorContracts.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/LocalOperatorCommandHandler.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/LocalOperatorClient.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/MainWindow.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/LocalWebProgramOutputServiceTests.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/LocalOperatorCommandHandlerTests.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Desktop.Tests/LocalOperatorClientTests.cs`

**Interfaces:**
- Adds commands `media.pause`, `media.resume`, `media.seek` and payload `LocalOperatorMediaControl(double? PositionSeconds = null)`.
- Program/Preview state media view adds playback snapshot `revision`, `state`, `effectivePositionSeconds`, `serverTimeUtc`.
- Desktop transport controls are enabled only for active Program audio/video; image/text/native visual Program does not expose seek/pause.

- [ ] **Step 1: Write failing browser contract tests.**

Assert exactly one persistent `<video>` and `<audio>` element exists; active element is not recreated on unchanged item/revision polling; play/pause/seek update on revision; if drift exceeds 0.250 s the element seeks to authoritative position; `loop=false` ended does not auto-advance; autoplay rejection POSTs the current item/revision to `/api/media-playback/report`, while stale/unknown reports are rejected.

- [ ] **Step 2: Write failing IPC/control tests.**

Assert pause/resume/seek require active dynamic media, seek input is finite and bounded by coordinator, commands are service-scoped through current Program state, and malformed seek never changes Program.

- [ ] **Step 3: Verify RED.**

Expected: no transport commands/video/audio DOM synchronization.

- [ ] **Step 4: Implement browser media state synchronization.**

Media elements always use loopback asset URL. On each poll, update only when identity/revision requires it; reconcile `currentTime` when absolute drift > 0.250 s. Add loopback-only `POST /api/media-playback/report` accepting bounded `{ itemId, revision, errorCode }`; accept only the current item/revision and only known browser error codes. When `play()` rejects, report `media_browser_playback_blocked` through that endpoint instead of pretending Program is healthy.

- [ ] **Step 5: Implement local controls and desktop visibility.**

Wire buttons/keyboard only when snapshot Program is dynamic media. Keep existing F6/F7/F8 semantics unchanged.

- [ ] **Step 6: Run GREEN verification.**

Run/CI affected Core/Desktop tests and clean desktop launch smoke. Verify no browser state contains a public media URL.

- [ ] **Step 7: Commit.**

```bash
git add apps/edge-agent/src apps/edge-agent/tests
git commit -m "feat(media): synchronize local video and audio playback"
```

---

### Task 8: Media-aware Windows contribution video

**Files:**
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Abstractions/IMediaVideoFrameProvider.cs`
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/PresentationProgramVideoSource.cs`
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Windows/WindowsMediaFoundationMediaVideoFrameProvider.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Windows/Program.cs`
- Create: `apps/edge-agent/tests/fixtures/media/h264-aac-2s.mp4`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/PresentationProgramVideoSourceTests.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Windows.Tests/WindowsMediaVideoFrameProviderTests.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Windows.Tests/WindowsProgramWiringTests.cs`

**Interfaces:**
- Produces synchronous `ProgramVideoFrame IMediaVideoFrameProvider.GetFrame(PreparedMediaAsset asset, double positionSeconds, int width, int height)` because `IProgramVideoSource.GetCurrentFrame()` is synchronous and already runs on the contribution encoder worker thread.
- `PresentationProgramVideoSource : IProgramVideoSource` consumes `LocalWebProgramOutputService`, `IProgramFrameRenderer`, `MediaPlaybackCoordinator`, `IMediaPreparationCoordinator`, and `IMediaVideoFrameProvider`.
- `VisualProgramRouter` remains unchanged and receives `PresentationProgramVideoSource` as its rendered source.

- [ ] **Step 1: Write failing Core source tests.**

Assert text delegates to Skia; image is decoded once and scaled/letterboxed by fit; video asks the provider for the coordinator's current position on every frame request rather than caching one frame per item; audio uses themed/static rendered background.

- [ ] **Step 2: Write failing Windows adapter/wiring tests.**

Use the 2-second generated test-pattern MP4 fixture. Assert decoded BGRA32 dimensions/stride, positions 0.2 s and 1.2 s yield different frame payloads, unsupported/corrupt input returns structured failure, and `WindowsMediaFoundationEncodedProgramVideoSource` receives advancing frames through unchanged `VisualProgramRouter`.

- [ ] **Step 3: Add source-family switching test.**

Take prepared video media, take fake native visual Preview to Program, then `UseRenderedProgramAsync`; assert native frames override media while live and returning to rendered source resumes the current safe rendered/media state without changing TAKE authority.

- [ ] **Step 4: Verify RED.**

Expected: old `RenderedProgramVideoSource` cannot advance video and provider type is absent.

- [ ] **Step 5: Implement `PresentationProgramVideoSource` and Windows decoder.**

Windows provider reads only validated local files and uses Media Foundation source-reader decoding; it must not fetch URLs. Keep existing H.264 contribution encoder unchanged.

- [ ] **Step 6: Replace Windows rendered-source wiring only.**

Do not alter `VisualProgramRouter` command authority or native capture sessions.

- [ ] **Step 7: Run GREEN verification.**

Run/CI new Core/Windows tests, existing visual router tests, Windows platform build, and contribution transport tests. Verify video position drift against fake clock stays <= 250 ms.

- [ ] **Step 8: Commit.**

```bash
git add apps/edge-agent/src apps/edge-agent/tests
git commit -m "feat(media): render video into windows contribution"
```

---

### Task 9: Contribution Program audio mixer and Windows media-audio decoder

**Files:**
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Abstractions/IMediaAudioFrameProvider.cs`
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/ProgramAudioMixer.cs`
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/ProgramAudioMixCoordinator.cs`
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Windows/WindowsMediaFoundationMediaAudioFrameProvider.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Windows/Program.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/ProgramAudioMixerTests.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/ProgramAudioMixCoordinatorTests.cs`
- Create: `apps/edge-agent/tests/fixtures/media/tone-2s.wav`
- Create: `apps/edge-agent/tests/fixtures/media/tone-2s.mp3`
- Create: `apps/edge-agent/tests/fixtures/media/tone-2s.m4a`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Windows.Tests/WindowsMediaAudioFrameProviderTests.cs`

**Interfaces:**
- Produces `IMediaAudioFrameProvider.ReadPcmAsync(PreparedMediaAsset asset, MediaPlaybackSnapshot playback, int sampleRate, int channels, int frameSamples, CancellationToken) -> AudioFrame?`.
- `ProgramAudioMixer.Mix(AudioFrame? live, AudioFrame? media, float mediaVolume) -> AudioFrame` normalizes to 48 kHz stereo signed 16-bit PCM and saturation-clamps sample sums.
- `ProgramAudioMixCoordinator` owns a bounded live-input queue plus a 20 ms output cadence and writes mixed frames to the existing `IContributionAudioBuffer`; absent live input mixes silence + media, absent media passes live audio.

- [ ] **Step 1: Write failing pure mixer tests.**

Assert silence+media, live+silence, volume 0/0.5/1.0, positive/negative saturation, invalid frame rejection, and output format 48 kHz stereo 16-bit.

- [ ] **Step 2: Write failing coordinator sync tests.**

With fake time/provider, assert pause emits no advancing media samples, seek causes provider revision reset, ended media becomes silence, no microphone frames still allows media soundtrack, and media is never submitted to the ASR callback path.

- [ ] **Step 3: Write failing Windows decoder tests.**

Use committed generated sine-wave fixtures `tone-2s.wav`, `tone-2s.mp3`, and `tone-2s.m4a` (no third-party content). Assert PCM frame timestamps follow requested playback position and corrupt/unsupported assets fail without poisoning later reads.

- [ ] **Step 4: Verify RED.**

Expected: mixer/provider types absent.

- [ ] **Step 5: Implement mixer/coordinator and Windows provider.**

The decoder reads local prepared files only. On playback revision change, reset/seek decoder state before emitting the next media frame.

- [ ] **Step 6: Rewire Windows contribution audio.**

Replace direct `contributionAudioBuffer.TrySubmit(frame)` from microphone callback with `ProgramAudioMixCoordinator.TrySubmitLive(frame)`; the mixer alone writes to contribution buffer. Leave ASR's existing audio-capture subscription unchanged so media soundtrack cannot enter transcription.

- [ ] **Step 7: Run GREEN verification.**

Run/CI mixer/coordinator/Windows audio tests plus existing audio buffer, encoded audio, ASR pipeline, and contribution transport tests. Verify stable fake-timeline A/V skew <= 120 ms.

- [ ] **Step 8: Commit.**

```bash
git add apps/edge-agent/src apps/edge-agent/tests
git commit -m "feat(media): mix media audio into windows program"
```

---

### Task 10: macOS media-audio decode bridge and restart/source cleanup

**Files:**
- Create: `apps/edge-agent/native/macos/iPresenterPlux.MediaBridge/Sources/iPresenterPluxMediaBridge/MediaAudioDecoder.swift`
- Modify: `apps/edge-agent/native/macos/iPresenterPlux.MediaBridge/Sources/iPresenterPluxMediaBridge/MediaBridge.swift`
- Modify: `apps/edge-agent/native/macos/iPresenterPlux.MediaBridge/Package.swift`
- Create: `apps/edge-agent/native/macos/iPresenterPlux.MediaBridge/Tests/iPresenterPluxMediaBridgeTests/MediaAudioDecoderTests.swift`
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.MacOS/MacOSMediaAudioFrameProvider.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.MacOS/MacOSNativeMediaBridge.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.MacOS/MacOSEncodedProgramVideoSource.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.MacOS/Program.cs`
- Create: `apps/edge-agent/tests/iPresenterPlux.Edge.MacOS.Tests/iPresenterPlux.Edge.MacOS.Tests.csproj`
- Create: `apps/edge-agent/tests/iPresenterPlux.Edge.MacOS.Tests/MacOSMediaAudioFrameProviderTests.cs`
- Create: `apps/edge-agent/tests/iPresenterPlux.Edge.MacOS.Tests/MacOSProgramWiringTests.cs`
- Test: Swift tests plus the new macOS .NET test project in macOS CI

**Interfaces:**
- Bump native media bridge API version from 4 to 5.
- Swift bridge exposes open/read/seek/close functions that accept only local file path + requested PCM format and return bounded interleaved PCM frames/timestamps.
- `MacOSMediaAudioFrameProvider` implements Task 9 `IMediaAudioFrameProvider`.
- macOS contribution video remains Program-window ScreenCaptureKit capture; do not add a second video decoder in v1.

- [ ] **Step 1: Add failing Swift tests.**

Cover local AAC/M4A or MP4 audio open, position read, seek, pause/reset lifecycle, unsupported/corrupt failure, close idempotency, and no network URL acceptance.

- [ ] **Step 2: Add failing C# bridge-version/wiring tests in `iPresenterPlux.Edge.MacOS.Tests`.**

`MacOSMediaAudioFrameProviderTests` asserts API version 5 is required and provider resets on playback revision. `MacOSProgramWiringTests` asserts Program routes microphone through the shared `ProgramAudioMixCoordinator` while contribution video capture remains pointed at managed Chromium.

- [ ] **Step 3: Verify RED on macOS CI.**

Expected: missing bridge entry points/provider/version.

- [ ] **Step 4: Implement AVFoundation decoder bridge and C# provider.**

Use AVFoundation local-file decoding only. Ensure all native handles are released on stop, service change, Clear, and process shutdown.

- [ ] **Step 5: Wire macOS audio mixer.**

Reuse Task 9 Core mixer/coordinator; do not fork media timing rules on macOS.

- [ ] **Step 6: Add restart/source-family cleanup assertions.**

On restart with dynamic media persisted, mixer/provider remain silent until deliberate resume/Take. When Program changes to a native visual source or old service is cleared, active media audio provider closes and contribution continues with live capture only.

- [ ] **Step 7: Run GREEN verification.**

Run `swift test` in the media bridge on macOS CI, build native bridge, build/publish macOS Edge, run Core audio tests, and ensure existing ScreenCaptureKit contribution tests/build stay green. Confirm <= 120 ms stable fake-timeline skew.

- [ ] **Step 8: Commit.**

```bash
git add apps/edge-agent/native/macos apps/edge-agent/src/iPresenterPlux.Edge.MacOS apps/edge-agent/tests/iPresenterPlux.Edge.MacOS.Tests
git commit -m "feat(media): mix media audio into macos program"
```

---

### Task 11: Operator readiness polish, acceptance gate, packaging, and field UAT

**Files:**
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/OperatorWorkspaceCatalog.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/MainWindow.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Desktop.Tests/OperatorWorkspaceCatalogTests.cs`
- Create: `apps/control/scripts/edge-media-playback-acceptance-selftest.mjs`
- Modify: `apps/control/package.json`
- Create: `docs/qa/edge-media-playback-field-uat.md`
- Create: `apps/control/scripts/edge-media-playback-field-uat-gate.mjs`
- Create: `apps/control/scripts/edge-media-playback-field-uat-gate-selftest.mjs`
- Modify: `.github/workflows/edge-agent-ci.yml`
- Modify: `.github/workflows/windows-desktop-launch-smoke.yml`

**Interfaces:**
- Rundown row states: `DOWNLOADING`, `READY`, `ERROR`, `LIVE`, `PAUSED`, `ENDED`; each maps to concise operator copy from the spec.
- Field UAT gate records explicit Windows and macOS evidence; it never infers physical projector/audio success from CI.

- [ ] **Step 1: Write failing desktop state tests.**

Assert readiness badge mapping, failed cue recovery copy, active Program media transport visibility, disabled TAKE for unready media, and ordinary Scripture rows unchanged.

- [ ] **Step 2: Write failing acceptance/gate self-tests.**

Acceptance self-test must statically/dynamically assert all required contracts are wired. Field gate self-test must reject incomplete evidence, mismatched build commit, skipped offline playback, skipped projector check, skipped contribution A/V check, or dynamic-media restart that auto-resumes.

- [ ] **Step 3: Verify RED.**

Run local Node self-tests and CI desktop tests. Expected: readiness/gate artifacts absent.

- [ ] **Step 4: Implement desktop readiness/error polish.**

Keep the service operator surface compact: badge + concise feedback on the rundown row; no separate media-control workspace is required during service.

- [ ] **Step 5: Add CI/acceptance wiring.**

`edge-agent-ci.yml` must run new Core/Desktop/Windows tests and Swift tests on macOS. Windows launch smoke must exercise a packaged build with a prepared image/media-state fixture without requiring physical hardware.

- [ ] **Step 6: Run full software verification.**

Control:
`cd apps/control && pnpm test:edge-presentation-resolver && pnpm test:edge-operator-catalog && pnpm test:media-workspace && pnpm test:service-planner-item && pnpm test:edge-media-playback-acceptance && pnpm test:edge-media-playback-field-uat-gate`

CI: Edge Agent CI Windows + macOS all green; Windows desktop launch smoke green; packaging/installer artifact verification green.

- [ ] **Step 7: Execute physical field UAT without overstating CI.**

On customer-like Windows and macOS builds: service with image + H.264/AAC MP4 + audio cue; confirm prefetch/readiness; disconnect Internet; Preview/TAKE; selected Program monitor; pause/resume/seek; projector audio/video; contribution audio/video; Clear to Scripture; native visual source and back where supported; restart during video and confirm no automatic resume.

- [ ] **Step 8: Record measured acceptance evidence.**

Record build commit, OS, device, asset fixture IDs, offline result, video drift measurement (<= 250 ms), contribution A/V skew (<= 120 ms), and failures/retries. The gate remains incomplete until both required platforms have physical evidence; software CI success alone is not field UAT success.

- [ ] **Step 9: Commit.**

```bash
git add apps/edge-agent apps/control .github/workflows docs/qa
git commit -m "feat(media): finish edge media playback operator flow"
```

---

## Final branch verification

- [ ] `git diff --check` returns no output.
- [ ] No committed secrets, remote media credentials, bearer tokens, or absolute customer filesystem paths.
- [ ] Control CI passes on the final commit.
- [ ] Edge Agent CI passes Windows and macOS on the final commit.
- [ ] Windows desktop launch smoke passes on the final commit.
- [ ] Windows installer/update artifact validation remains green.
- [ ] Existing pairing/reprovision tests remain green.
- [ ] Existing presentation-theme tests remain green.
- [ ] Existing visual-router/native-capture tests remain green.
- [ ] Existing streaming/contribution tests remain green.
- [ ] Existing ASR/audio-capture tests remain green.
- [ ] Field UAT status is reported separately and truthfully; do not merge “CI green” with “physical projector/audio tested.”

## Planned commit sequence

1. `feat(media): resolve trusted edge media descriptors`
2. `feat(media): prepare synced cues by trusted item id`
3. `feat(media): add secure edge asset cache`
4. `feat(media): gate preview on edge readiness`
5. `feat(media): serve cached assets to local program`
6. `feat(media): add authoritative program playback state`
7. `feat(media): synchronize local video and audio playback`
8. `feat(media): render video into windows contribution`
9. `feat(media): mix media audio into windows program`
10. `feat(media): mix media audio into macos program`
11. `feat(media): finish edge media playback operator flow`
