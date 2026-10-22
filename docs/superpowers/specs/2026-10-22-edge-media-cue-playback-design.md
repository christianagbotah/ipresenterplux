# Edge Media Cue Playback v1 — Design Specification

Date: 2026-10-22
Status: Approved by user on 2026-10-22; implementation plan prepared for execution-method selection
Base: `14005ee` (`feat(desktop): select Program output display`)
Scope: approved image, video and audio rundown cues rendered reliably by iPresenterPlux Edge on local Preview/Program and contribution output

## 1. Purpose

iPresenterPlux already has a reusable Media Library, typed `media` rundown items, approved organization-scoped `media_sources`, local Preview/Program output, durable service catalogs and a contribution pipeline. The missing capability is production-safe playback of those media cues from the church Edge runtime.

Edge Media Cue Playback v1 adds that capability without turning iPresenterPlux into a generic desktop media player and without weakening the existing Preview → TAKE → Program safety model.

The intended operator experience is simple:

1. Add or reuse an approved image/video/audio item in the service rundown.
2. Edge prepares the file locally before it can go live.
3. Operator sees a deterministic readiness state: `Downloading`, `Ready`, or `Error`.
4. Preview shows the prepared cue without changing Program.
5. TAKE is the only operation that promotes the cue to Program.
6. Local projector output, contribution video and media audio follow one Edge-owned playback state.
7. Internet loss after preparation does not interrupt the cached cue.

## 2. Decision summary

The selected architecture is **Edge-local asset cache + synchronized playback coordinator**.

- Control Plane owns authorization, tenant scope, service/rundown truth and approved media metadata.
- Edge owns downloaded media bytes, local validation, readiness, playback state and offline continuity.
- Chromium Program/Preview may load media only from the Edge loopback server, never directly from arbitrary remote URLs.
- One Edge playback coordinator owns cue state and the authoritative playback clock.
- Windows contribution rendering uses the existing rendered/visual routing stack, extended with a media frame provider driven by that same playback clock.
- macOS keeps its existing Program-window contribution capture path; the captured Program browser renders the same cached asset and playback state.
- Media audio is mixed into contribution audio separately from microphone/ASR capture so a video soundtrack does not depend on room-speaker recapture.
- Native camera/display/window sources remain a separate source family under `VisualProgramRouter`; this milestone does not merge file media with live capture sessions.

This design rejects direct browser playback from remote URLs and rejects replacing the entire output stack with permanent browser-window capture on all platforms.

## 3. Existing foundation to preserve

The implementation must build on the current code rather than create parallel subsystems.

### Control Plane

- `presentation_items` already supports `media` as a typed rundown item.
- Media cue normalization already resolves an organization-scoped `media_source`, validates `mediaKind`, and obtains an approved HTTPS `assetUrl`.
- Media Library already enforces tenant membership/RBAC and rejects sources that are not browser-preview eligible.
- `/api/v1/edge/operator/catalog` already synchronizes ordered rundown items and metadata to the assigned Edge device.
- `/api/v1/edge/presentation/items/[id]` already provides authenticated presentation content, but currently resolves Scripture only.

### Edge Core/Desktop

- `PresentationRenderItem` is the shared render contract.
- `LocalWebProgramOutputService` owns loopback Preview and Program pages and persists the current presentation state.
- The managed Chromium kiosk is restricted to the loopback renderer.
- `OperatorCatalogCoordinator` already caches the active service catalog for offline/rehearsal behavior.
- Desktop operator Preview/Take/Clear already use same-user IPC and the existing deliberate TAKE flow.
- `VisualProgramRouter` already separates rendered presentation output from native camera/display/window Program sources.
- `WindowsMediaFoundationEncodedProgramVideoSource` already encodes the router's `IProgramVideoSource` output.
- macOS contribution already captures the managed Program Chromium window through ScreenCaptureKit/VideoToolbox.
- Contribution audio already passes through a bounded PCM buffer before platform encoding.

### Existing asset-cache pattern

`PresentationThemeAssetCache` already demonstrates the correct security posture for Edge-managed remote assets: HTTPS-only retrieval, bounded files, local storage, safe loopback serving and graceful failure. Media playback must generalize those principles rather than reuse the theme cache directly; media assets are larger, seekable, service-aware and operationally authoritative.

## 4. Scope

### In scope

- Image cues: PNG, JPEG and WebP.
- Video cues: MP4 with H.264 video; AAC audio when present.
- Audio cues: MP3, AAC/M4A and WAV.
- Approved HTTPS source metadata only; no arbitrary local filesystem path in Control Plane data.
- Edge-local media cache with integrity metadata, bounded download policy and quota management.
- Background prefetch for media cues in the assigned active service.
- Preview readiness and blocking of unsafe/unready TAKE.
- Local Preview/Program rendering from loopback cached assets.
- Byte-range support required by Chromium video/audio seek and preload.
- Playback state: ready, playing, paused, ended, error.
- Playback controls: TAKE/autoplay, pause, resume, seek, loop, Clear.
- Optional cue settings: trim start, trim end, loop and volume.
- Image/video fit modes limited to `contain` and `cover` in v1.
- Contribution video parity on Windows and macOS.
- Media-audio contribution mix on Windows and macOS.
- Service change/cache-scope safety and offline use after successful preparation.
- Tests for contracts, security, cache behavior, state transitions and renderer parity.

### Explicitly out of scope for v1

- Media upload UI or managed object-storage upload workflow.
- Cloud transcoding, thumbnail generation or proxy generation.
- MOV, MKV, WebM, ProRes, HEVC/H.265 or arbitrary codec support.
- DRM-protected media.
- Network streams as file-media cues: HLS, DASH, RTSP and live web URLs remain separate future source types.
- Playlist-within-a-cue behavior.
- Layered video compositing, picture-in-picture, alpha video, chroma key or transitions.
- Per-frame effects/color grading.
- Automatic AI TAKE or automatic Program replacement when media fails.
- Feeding media audio into preacher ASR/translation by default.

## 5. Product and safety principles

1. **TAKE remains authoritative.** Selecting or downloading media never changes Program.
2. **No remote URL reaches Chromium.** Browser media `src` values are loopback-only URLs created by Edge.
3. **No unready media can be taken.** If a required asset is missing, corrupt, unsupported or still downloading, Program remains unchanged.
4. **Offline after ready.** A cached, validated cue must continue without the Control Plane or public Internet.
5. **One playback state.** Browser rendering, Windows contribution rendering and media-audio mixing derive timing from one Edge coordinator.
6. **Failure is visible, not surprising.** Media errors surface structured operator states and do not silently fall back to another source.
7. **Service scope is enforced locally.** Media prepared for another service/organization cannot leak into the active service's Program state.
8. **Dynamic media does not auto-resume after a process restart.** Restart recovery must require deliberate operator action before audio/video begins again.

## 6. Control Plane presentation resolution

### 6.1 Unified resolver

Extract the current presentation-item route logic into a reusable server-side resolver used by:

- `/api/v1/edge/presentation/items/[id]`;
- Edge operator catalog shaping where presentation-safe content is required;
- future server-side preview/readiness checks.

Resolution order:

1. Find a `presentation_items` row scoped through the authenticated Edge device's active service and organization.
2. Normalize the supported item type into presentation-safe content.
3. For legacy/live Scripture detection IDs, retain the existing `scripture_detections` lookup as a compatibility fallback.
4. Reject any item outside the Edge device's organization or active service with 404/403 semantics that do not leak cross-tenant existence.

The route must stop being Scripture-only.

### 6.2 Media descriptor

For `itemType=media`, return a typed media descriptor in addition to normal presentation fields. A new Core contract should represent it explicitly instead of forcing playback code to parse arbitrary metadata dictionaries.

Recommended shape:

```text
PresentationMediaDescriptor
- sourceId: UUID
- mediaKind: image | video | audio
- downloadUrl: absolute approved HTTPS URL
- assetVersion: stable server-computed fingerprint
- contentTypeHint: optional
- title: bounded display label
- trimStartSeconds: >= 0, default 0
- trimEndSeconds: optional, > trimStart
- loop: boolean, default false
- volume: 0.0..1.0, default 1.0
- fit: contain | cover, default contain
```

`assetVersion` must change when trusted source metadata that affects the underlying asset changes. It may be derived from source ID + approved URL + relevant source configuration. It is not a claim that the remote host supplied a cryptographic checksum.

The existing `PresentationRenderItem.Metadata` remains for themes and forward compatibility. Media playback code should consume the typed descriptor.

### 6.3 No free-form URL mutation

Planner and Media Library continue to select an approved `media_source`. The Edge presentation endpoint is the only place that translates trusted source configuration into a download descriptor. Desktop operator IPC never accepts a user-supplied media URL.

## 7. Edge media asset cache

Introduce an isolated `MediaAssetCache` in Edge Core with platform-neutral download/validation bookkeeping.

### 7.1 Responsibilities

- validate the descriptor before any network request;
- download with bounded redirects and destination revalidation;
- enforce HTTPS and reject userinfo, loopback, link-local and private network destinations;
- enforce supported media kinds/content types;
- stream to a temporary file rather than buffering large files in memory;
- enforce per-kind size limits while streaming;
- compute SHA-256 while downloading;
- validate enough container/header structure to reject obvious type spoofing;
- atomically promote only complete validated files into the cache;
- persist a sidecar manifest containing descriptor identity, SHA-256, byte length, content type, validated kind and last-access time;
- provide readiness/query events to operator state;
- evict least-recently-used inactive assets when over quota;
- never evict active Preview/Program assets.

### 7.2 Default limits

The defaults are deliberately finite but suitable for church service media:

- image: 25 MiB per asset;
- audio: 500 MiB per asset;
- video: 4 GiB per asset;
- total cache: 20 GiB.

The total cache quota may be configured by Edge settings/environment later, but v1 must have a safe default. Per-asset hard caps remain enforced.

### 7.3 Cache identity

Cache identity must not be a filename or URL basename. Use a stable key derived from:

- Edge organization identity;
- media `sourceId`;
- `assetVersion`.

The file's computed SHA-256 is stored as integrity metadata after download. If a manifest/file pair disagrees, the entry becomes invalid and is redownloaded before Preview can become Ready.

### 7.4 Prefetch

When a service becomes active or the operator catalog revision changes, Edge scans that service's media cues and starts bounded background preparation with a maximum of two simultaneous downloads.

Prefetch is best-effort and must never block catalog synchronization, Scripture operation, local Program output or command processing.

Previewing a not-yet-cached media cue raises its priority and waits for or initiates the same deduplicated cache job rather than starting a second download.

## 8. Media preparation and readiness

Introduce a `MediaPreparationCoordinator` between presentation resolution/catalog data and Program output.

For non-media items it is a no-op.

For media items it:

1. validates the service scope;
2. asks `MediaAssetCache` to resolve/prepare the asset;
3. performs platform decoder probe/metadata validation where required;
4. produces a local `PreparedMediaAsset` containing only local path/asset ID, trusted content type, validated duration when available and playback settings;
5. makes the prepared asset available to Preview/Program state.

Readiness states:

- `not_required`
- `queued`
- `downloading`
- `validating`
- `ready`
- `unsupported`
- `failed`

Structured error codes should distinguish at least:

- `media_download_failed`
- `media_remote_unsafe`
- `media_too_large`
- `media_type_unsupported`
- `media_corrupt`
- `media_cache_full`
- `media_scope_mismatch`

Program TAKE of a media item requires `ready`.

## 9. Local operator IPC and catalog handling

The current desktop flow reconstructs a `LocalOperatorPresentation` from title/body/footer and therefore drops media metadata. It also rejects empty bodies, which makes real media cues unsuitable for `preview.render`.

### 9.1 New item-based Preview command

Add a local operator command such as `preview.prepare_item` whose input is only the selected rundown `itemId`.

The Edge-side handler must:

1. resolve that item from the authenticated/cached active-service catalog;
2. verify active service scope;
3. convert the catalog item into the trusted presentation contract;
4. prepare media if required;
5. set Preview only after successful preparation.

Desktop UI never sends a remote URL or local path.

### 9.2 Backward compatibility

Keep `preview.render` only for locally generated rehearsal/text content and existing Scripture flow while migration is completed. It must not become a bypass for media descriptors.

### 9.3 Operator states

Each media rundown row should expose a compact state:

- cloud/download icon while queued/downloading;
- `READY` when locally validated;
- `ERROR` with concise recovery guidance when preparation failed;
- `LIVE`/`PAUSED`/`ENDED` when it is the active Program cue.

The operator should not need to open a separate Media Library page during a service to understand readiness.

## 10. Playback coordinator

Introduce one `MediaPlaybackCoordinator` in Edge Core. It owns media playback state, not media decoding implementation.

### 10.1 Program playback snapshot

Recommended state:

```text
MediaPlaybackSnapshot
- itemId
- serviceId
- assetId/cacheKey
- mediaKind
- state: ready | playing | paused | ended | error
- startedAtUtc
- pausedAtUtc
- basePositionSeconds
- effectivePositionSeconds
- trimStartSeconds
- trimEndSeconds
- loop
- volume
- fit
- revision
- errorCode
```

The effective position is computed from the coordinator's `TimeProvider`, not from independent browser timers. During stable playback, local Program and contribution video should converge to within 250 ms of the coordinator position after corrections.

### 10.2 TAKE

For a prepared media Preview:

- image: Program becomes the image and remains until next TAKE/Clear;
- video/audio: coordinator sets `playing`, establishes a new playback epoch and starts at trim start;
- Program state mutation and playback epoch publication occur as one serialized operation;
- previous Program media playback is stopped after the new Program state is committed.

### 10.3 Pause/resume/seek

Add typed service-scoped commands for:

- `media.pause`
- `media.resume`
- `media.seek`

Seek is clamped to the configured trim range. Pause/resume/seek update the coordinator revision so both browser and contribution paths resynchronize.

The desktop UI may expose these controls only when the active Program item is audio/video.

### 10.4 End behavior

- If `loop=true`, wrap to trim start using the same playback epoch/state revision.
- If `loop=false`, transition to `ended`.
- Video holds its final decoded frame until Clear/next TAKE.
- Audio transitions to silence while the themed audio background remains visible.
- Ending never auto-advances to another rundown cue in v1.

### 10.5 Restart recovery

Persisting static Program identity remains useful, but dynamic media must not unexpectedly resume after an Edge restart.

On restore:

- image Program may restore if its cache entry still validates;
- video/audio Program restores as `paused/recovery_required` and does not emit audio or advance playhead;
- operator must Preview/Take or explicitly resume after the active service is confirmed.

## 11. Loopback Preview/Program renderer

Extend `LocalWebProgramOutputService` rather than creating a second web server.

### 11.1 State API

`/api/state/program` and `/api/state/preview` should include a media view model when the item is prepared:

- loopback asset URL;
- trusted media kind/content type;
- playback snapshot/revision;
- server time for browser resynchronization;
- fit/volume settings.

No remote source URL is returned to the page.

### 11.2 Asset endpoint

Add a route such as `/api/media-assets/{cacheKey}` that resolves only known validated cache entries.

Requirements:

- GET/HEAD only;
- no path fragments or filesystem traversal;
- correct `Content-Type`;
- `X-Content-Type-Options: nosniff`;
- `Accept-Ranges: bytes`;
- correct 206/`Content-Range` behavior for valid single byte ranges;
- 416 for invalid ranges;
- immutable caching headers for versioned cache keys;
- no directory listing;
- loopback listener remains bound to `127.0.0.1`.

### 11.3 Browser rendering

The existing text/theme stage remains the default. Media behavior:

- image: render a dedicated `<img>` layer using `contain` or `cover`;
- video: render one `<video>` element from the loopback asset;
- audio: keep the themed stage visible and use an `<audio>` element;
- text/theme content layer is hidden for image/video unless a later overlay feature explicitly re-enables it;
- logo/theme may remain available for audio-only cues.

The page must not recreate the media element every 250 ms. It updates only when item/revision/asset identity changes.

For playing audio/video, the page computes the authoritative position from the returned playback snapshot. If local element time drifts beyond a small tolerance (target 250 ms), it seeks to the Edge position. Pause/resume/seek follow state revisions.

Browser autoplay restrictions are mitigated by the managed kiosk launch and an operator-driven TAKE; if Chromium still rejects playback, Edge surfaces `media_browser_playback_blocked` instead of pretending the cue is live.

## 12. Contribution video path

The goal is synchronized content, not a second independent player.

### 12.1 Windows

Windows currently encodes frames from `VisualProgramRouter`, whose rendered source is `RenderedProgramVideoSource` + `SkiaProgramFrameRenderer`.

Replace the rendered-source implementation with a media-aware `PresentationProgramVideoSource` that still implements `IProgramVideoSource` and remains the rendered branch of `VisualProgramRouter`.

Behavior:

- text/Scripture/song/slide/lower-third/custom: use the existing Skia renderer;
- image: decode the validated cached image once, scale/letterbox according to fit and return BGRA32 frames;
- video: request the decoded frame corresponding to `MediaPlaybackCoordinator.EffectivePosition` from a platform `IMediaVideoFrameProvider`;
- audio: render the themed/static audio Program background through Skia while audio is handled by the audio mixer.

The Windows implementation of `IMediaVideoFrameProvider` should use Media Foundation source-reader/decoder primitives against the local cached MP4. It must never fetch a URL itself.

`VisualProgramRouter` remains unchanged in authority: native camera/display/window Program can still replace rendered Program, and `UseRenderedProgramAsync` returns to presentation/media output.

### 12.2 macOS

macOS already captures the managed Chromium Program window for contribution video through ScreenCaptureKit and VideoToolbox. Keep that path for v1.

Because the browser itself consumes the same loopback asset and playback snapshot, contribution video follows the local Program view. No second macOS video decoder is required for v1 contribution parity.

### 12.3 Visual parity rule

The same media cue, fit mode, trim and playback state must be used on local Program and contribution output. Pixel-perfect cross-platform decoder identity is not required, but cue timing, framing semantics and end state must agree.

## 13. Media audio path

Media audio must not rely on microphones hearing the auditorium speakers.

### 13.1 Program audio mixer

Introduce a small `ProgramAudioMixer` in the contribution audio path with two inputs:

1. existing live capture/microphone PCM;
2. decoded active media audio PCM.

The mixer normalizes to the PCM format expected by the existing encoded contribution audio source, applies cue volume to media audio, uses saturation-safe mixing and emits silence for absent/ended media.

Media audio is not fed into ASR/translation by default.

### 13.2 Platform decoding

- Windows: use Media Foundation decoding for audio tracks in supported MP4/M4A/MP3/WAV assets.
- macOS: add a narrowly scoped AVFoundation-based decode bridge alongside the existing native media bridge.

Both decoders are driven by the same playback snapshot/position as video. Seeking or pausing resets decoder position coherently. Contribution media audio should remain within 120 ms of contribution video during stable playback.

### 13.3 Auditorium playback

The Chromium Program page plays the media asset through the selected system audio output. Contribution audio uses the decoded mixer path separately. This avoids depending on OS loopback capture and keeps network contribution deterministic.

A future audio-output selector may route Program audio to a specific device; it is not required for this milestone.

## 14. Cache/service lifecycle

### Service assignment changes

When active service changes:

- Preview clears immediately if scoped to the old service;
- dynamic Program media stops and clears according to existing service-output policy;
- playback coordinator resets;
- in-flight low-priority prefetches for the old service may be cancelled;
- validated old files may remain in cache under quota but are not considered active.

### Control Plane/Internet loss

If the active asset is already validated locally:

- Program continues;
- pause/resume/seek through local desktop continues;
- contribution continues;
- no network read is required.

If an asset is not fully cached, preparation fails/pauses visibly and TAKE is blocked.

### Cache corruption or deletion

A missing/corrupt Preview asset becomes `failed` and cannot be taken.

If an active Program video asset becomes unreadable unexpectedly:

1. hold last good video frame for up to 2 seconds;
2. emit silence for its media-audio contribution;
3. if unrecoverable, show safe black/themed fallback and mark Program media `error`;
4. do not auto-take another cue.

## 15. Security requirements

- Device authentication and active-service scoping remain mandatory for presentation resolution.
- Media descriptor download URLs must be HTTPS, without embedded credentials.
- Redirects are bounded and every redirect target is revalidated before connection.
- Loopback, private, link-local and unsafe IP destinations are rejected unless a future explicitly trusted on-premises media-source type is designed separately.
- DNS rebinding protection must validate the resolved connection destination, not only the original hostname string.
- Browser receives only loopback asset URLs.
- Cached filenames are generated by Edge and never derived directly from remote filenames.
- MIME/format validation must not trust extension alone.
- Downloads stream to temp files and promote atomically only after validation.
- No executable/script media type is accepted.
- No media URL, bearer credential or raw filesystem path is written to normal operator-facing logs.
- Audit events may record source ID, media kind, asset version, readiness result and bounded error code.

## 16. Error handling and operator recovery

Operator-facing failures should describe the action rather than expose stack traces.

Examples:

- `Download failed — check Internet or source availability.`
- `Unsupported video — use MP4 with H.264/AAC.`
- `File is too large for the Edge media policy.`
- `Media file appears corrupt. Replace the source and prepare again.`
- `Not downloaded yet — Preview will become available when preparation completes.`
- `Playback was interrupted — Program is holding the last safe frame.`

Retrying Preview after a transient download failure should retry preparation. Permanent unsupported/corrupt results should not hammer the remote source automatically.

## 17. Testing strategy

Implementation follows TDD. Hardware/network-dependent behavior must have fakeable Core boundaries.

### Control Plane tests

- presentation endpoint resolves all supported `presentation_items`, not just Scripture;
- legacy Scripture detection fallback still works;
- media descriptors contain only approved source metadata;
- cross-tenant/service item IDs return no leaked content;
- unsafe media source configuration is rejected;
- cue trim/loop/volume/fit normalization is bounded.

### Cache/security tests

- supported image/video/audio downloads become ready;
- duplicate prepare requests share one download;
- HTTPS requirement;
- loopback/private/link-local rejection;
- redirect target revalidation;
- size limit enforcement with and without `Content-Length`;
- temp files are removed after cancellation/failure;
- mismatched/corrupt content is rejected;
- hash/manifest mismatch invalidates a cache hit;
- LRU eviction preserves active Preview/Program files;
- quota failure returns `media_cache_full`.

### Playback coordinator tests

- Preview cannot mutate Program;
- TAKE starts at trim start;
- pause freezes effective position;
- resume continues from frozen position;
- seek clamps to trim bounds;
- loop wraps deterministically;
- non-loop transitions to ended;
- Clear stops playback;
- service change clears scoped state;
- restart does not auto-resume dynamic audio/video.

### Loopback renderer tests

- media state exposes loopback URLs only;
- asset endpoint rejects traversal/unknown IDs;
- byte-range 206 and invalid-range 416 behavior;
- image/video/audio markup uses trusted local URL;
- repeated state polls do not recreate active media element;
- browser position correction follows coordinator revision.

### Windows tests

- media-aware Program source delegates text cues to Skia;
- cached image produces BGRA32 Program frames;
- fake video frame provider follows coordinator time rather than item-change caching;
- native visual source routing still overrides rendered media Program when taken;
- Media Foundation decoder adapter is contract-tested with a small fixture;
- contribution encoder receives advancing video frames for a video cue.

### macOS tests

- Program-window capture remains wired to managed Chromium;
- media-audio bridge lifecycle and seek/pause behavior;
- contribution starts/stops cleanly while media is active.

### Desktop/UAT tests

On Windows and macOS customer-like builds:

1. assign a service with one image, one MP4 and one audio cue;
2. confirm prefetch/readiness states;
3. disconnect Internet after readiness;
4. Preview each cue;
5. TAKE each cue and verify selected Program monitor;
6. pause/resume/seek video/audio;
7. verify local projector and contribution output;
8. Clear and TAKE a normal Scripture cue afterward;
9. switch to a native visual source and back to rendered Program on supported platform;
10. restart Edge while video is live and confirm it does not unexpectedly resume audio.

## 18. Backward compatibility and migration

- No destructive database migration is required for core v1 behavior.
- Existing media cues that contain only the current `sourceId` + `mediaKind` remain valid; new playback options default safely.
- Existing text/Scripture render contracts continue to work.
- Existing theme metadata remains unchanged.
- `preview.render` remains supported for rehearsal/text while desktop rundown selection migrates to item-based preparation.
- Existing native visual routing and contribution commands retain their authority.
- Existing cached theme assets remain separate from media-cache storage.

If persisted `PresentationRenderItem` serialization is extended with a typed media descriptor, the new property must be optional so version-1 persisted state files still deserialize.

## 19. Delivery sequence

One implementation plan may contain multiple TDD tasks, but the code should land in reviewable slices:

### Slice A — contract + Control resolution

- typed media descriptor;
- unified presentation resolver;
- all-item Edge presentation route;
- catalog/desktop item-based Preview contract;
- tests only against fake/no-download media preparation initially.

### Slice B — secure Edge cache + readiness

- media cache;
- prefetch;
- readiness states;
- loopback asset endpoint with byte ranges;
- image Preview/Program end-to-end.

### Slice C — video playback

- playback coordinator;
- browser video playback/control;
- Windows media frame provider/decoder;
- synchronized contribution video;
- end/loop/seek behavior.

### Slice D — audio playback/mix

- browser audio/video soundtrack playback;
- program audio mixer;
- Windows/macOS media audio decoders;
- contribution audio synchronization.

### Slice E — desktop polish + packaging/UAT

- readiness badges and media transport controls;
- offline and restart recovery UX;
- Windows/macOS packaging, launch smoke and field UAT fixtures.

Each slice must preserve the existing Scripture/text and native visual-source behavior before the next slice begins.

## 20. Acceptance criteria

This milestone is complete only when all of the following are true:

1. An approved image/video/audio rundown cue resolves through the authenticated Edge presentation contract.
2. The desktop operator never supplies a remote URL or filesystem path to Preview.
3. Edge prepares and validates media locally and visibly reports readiness.
4. An unready/failed cue cannot replace existing Program output.
5. Once Ready, an asset can Preview and Take while the public Internet is disconnected.
6. Chromium loads only loopback media URLs and supports video/audio range requests.
7. Image cues render correctly on Preview, Program and contribution output.
8. MP4 video advances on local Program and contribution output from the same Edge playback state.
9. Pause/resume/seek/loop/ended state stays coherent across local Program and contribution output, with stable video position drift no greater than 250 ms.
10. Media audio reaches local Program speakers and contribution audio without depending on room-microphone recapture, and contribution media audio remains within 120 ms of contribution video during stable playback.
11. Normal microphone/ASR capture continues independently of media-audio playback.
12. Native camera/display/window Program routing continues to work and can safely return to rendered presentation/media Program.
13. Switching service removes the old service's active media authority.
14. Restarting Edge does not unexpectedly restart dynamic media audio/video.
15. Windows and macOS packaging/build/test gates remain green and field UAT passes with offline playback.

## 21. Follow-on milestones

After this v1 is proven, separate designs may add:

- first-party media uploads and managed object storage;
- transcoding/proxy generation and thumbnails;
- additional codecs;
- network/live media source types;
- transition/compositor layers;
- dedicated Program audio-output device selection;
- richer media trim/editor UI;
- pre-service download dashboard for all upcoming services.

Those features must not be pulled into v1 unless required to satisfy the acceptance criteria above.
