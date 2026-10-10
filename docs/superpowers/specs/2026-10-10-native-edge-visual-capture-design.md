# Native Edge Visual Capture v1 — Design Specification

Date: 2026-10-10
Status: Proposed for implementation after owner review
Scope: Windows-first native visual source discovery, capture, preview, health and routing for iPresenterPlux Edge

## 1. Purpose

iPresenterPlux must become capable of owning live visual capture directly rather than depending on OBS, vMix, EasyWorship, ProPresenter or browser capture. The first production milestone is Native Edge Visual Capture v1: the Windows Edge runtime discovers real local cameras, displays and windows, captures them natively, reports authoritative source health to the control plane, and makes an explicitly taken source available to the existing iPresenterPlux video encoding and contribution pipeline.

This milestone is deliberately narrower than a full video switcher. It establishes first-class native sources and safe routing primitives without introducing a scene compositor, effects engine, multi-layer mixer or third-party-first workflow.

## 2. Product principles

1. iPresenterPlux remains the source of truth. Third-party production tools are optional adapters, never required dependencies.
2. Physical device truth belongs to the Edge runtime. The browser must not simulate, infer or directly enumerate church cameras or displays.
3. Preview and Program remain separate safety domains. Selecting a source prepares it for Preview; only the existing deliberate TAKE action may move prepared content to Program.
4. A temporary control-plane or Internet outage must not terminate an already-running local source, Program output, local recording or contribution encoder.
5. Native capture must integrate with the existing Edge contracts and contribution transport rather than creating a parallel media stack.
6. v1 should be operationally simple enough for a church operator: discover, identify, preview, select, monitor health, recover.

## 3. Existing foundation to preserve

The current architecture already defines the Church Edge Agent as responsible for camera/screen capture, local Program output, encode/decode, transport and offline continuity. The Windows platform profile currently marks screen/window capture as planned while local Program display and recording are available.

The Windows contribution path already includes `WindowsMediaFoundationEncodedProgramVideoSource`, which consumes an `IProgramVideoSource`, validates BGRA32 frames, converts them to NV12 and encodes them to H.264. The Windows host currently supplies a `RenderedProgramVideoSource` backed by the local presentation renderer. This encoder and the contribution publisher must be reused rather than replaced.

The control plane already exposes `/api/v1/edge/media-source` for authenticated, idempotent Edge source telemetry. It upserts `media_sources`, associates the reporting Edge device, preserves source identity through `source_key`, publishes realtime source-status events and can create camera-availability recommendations.

The Cameras workspace already treats Edge as authoritative, supports status, preferred-source metadata and operator labels, and intentionally refuses browser-side sanctuary capture.

## 4. Scope

### In scope

- Platform-neutral visual-source contracts in `iPresenterPlux.Edge.Core`.
- Windows-native discovery of:
  - physical cameras/video-capture devices;
  - displays/monitors;
  - capturable top-level application windows.
- Windows-native camera capture using Media Foundation.
- Windows-native display/window capture using Windows Graphics Capture.
- Stable Edge-owned source identities.
- Capture state, health, frame statistics and structured failure codes.
- Distinct Preview and Program source slots feeding the current `IProgramVideoSource`/H.264 contribution path.
- Safe Preview selection distinct from Program TAKE.
- Edge source telemetry into the existing media-source control-plane route or a strictly compatible extension.
- Cameras workspace evolution into a visual-source operator workspace while preserving current camera preferences.
- Rescan/recovery after devices appear, disappear or permissions change.
- Offline continuity for an already-running local Program source.
- Windows CI/build validation plus unit/integration coverage using fake visual sources where physical hardware is unavailable in CI.

### Explicitly out of scope for v1

- Multi-camera scene composition.
- Picture-in-picture, chroma key, transitions, DVE, overlays or graphics mixing.
- PTZ movement/control.
- ATEM switching.
- NDI input/output.
- OBS/vMix/EasyWorship/ProPresenter control adapters.
- Multi-source simultaneous live mixing.
- macOS native capture implementation; macOS will consume the same Core contract in a later milestone.
- AI-controlled direct Program switching.

## 5. Domain model

### 5.1 Visual source kinds

Define a platform-neutral `VisualSourceKind` with:

- `Camera`
- `Display`
- `Window`

Future kinds such as NDI or capture-card-specific sources must extend the model without changing v1 semantics.

### 5.2 Visual source descriptor

A source descriptor represents Edge-observed truth and includes:

- `SourceId`: stable Edge-local identifier;
- `Kind`;
- `Name`: native friendly name;
- `NativeKey`: platform-specific immutable/stable identifier where available;
- `Status`: `available`, `busy`, `permission_required`, `disconnected`, `unsupported`, `error`;
- optional process/window metadata for Window sources;
- optional display bounds/primary-display flag for Display sources;
- supported capture modes when known: width, height, frame rate, pixel format;
- `ObservedAt`;
- optional structured `ErrorCode`.

`SourceId` must not contain secrets, user content or unbounded raw device metadata.

### 5.3 Stable identity

Identity must survive ordinary rescans and restarts as far as the operating system permits:

- Camera: derive from the Media Foundation device symbolic link or equivalent stable device identifier, hashed/normalized into an Edge-safe source key.
- Display: derive from stable monitor/device identity rather than screen ordinal alone.
- Window: derive from process executable identity plus a native window identity valid for the current session. Window identity is session-scoped because window handles are not durable across application restarts.

The control plane must never use display names as the sole source identity. Existing telemetry may still display friendly names, but upsert/conflict semantics should key primarily on Edge device + source key.

## 6. Core contracts

Add focused abstractions rather than overloading `IEncodedProgramVideoSource`.

### `IVisualSourceCatalog`

Responsibilities:

- enumerate current visual sources;
- rescan on demand;
- publish catalog-change notifications where practical;
- expose only normalized source descriptors.

### `IVisualCaptureSession`

Represents one active native capture session and exposes:

- selected source descriptor;
- capture options;
- current status;
- frame event or latest-frame access;
- `StartAsync` / `StopAsync`;
- frame counters and dropped-frame counters;
- structured failure state.

### `IVisualCaptureFactory`

Creates a capture session for one source. Platform-specific implementations live outside Edge Core.

### Preview/Program video router

Add one Core routing component around the existing `IProgramVideoSource` contract. The router owns two explicit slots:

- **Preview slot** — the source the operator has prepared and is inspecting;
- **Program slot** — the source actually feeding the existing Program encoder/output path.

Preview selection may start a capture session and update only the Preview slot. It must not alter the Program slot.

TAKE is the only operation that may promote the current Preview slot into the Program slot. The promotion must be atomic from the operator's perspective: either the previous Program remains active or the confirmed Preview becomes Program; no intermediate selection request may leak into Program.

The existing `WindowsMediaFoundationEncodedProgramVideoSource` must consume only the router's Program-side `IProgramVideoSource` view. It must never read directly from the Preview slot.

The existing rendered presentation source remains valid. The router must support at least two Program source families:

- presentation-rendered Program source;
- native visual capture source.

The implementation plan may choose concrete interface/class names, but it must preserve this two-slot boundary and must not duplicate the H.264 encoder.

## 7. Windows implementation

### 7.1 Camera discovery and capture

Use Media Foundation device enumeration and capture APIs.

Requirements:

- enumerate video capture devices without starting capture;
- expose usable native capability modes where available;
- prefer a standard BGRA32 output contract to Core, performing native conversion only where required;
- classify device-in-use failures as `busy`, permission failures as `permission_required`, unsupported formats as `unsupported`, and unexpected capture failures as `error`;
- release device handles promptly on stop;
- recover cleanly after unplug/replug through rescan and a fresh session.

### 7.2 Display/window discovery and capture

Use Windows Graphics Capture.

Requirements:

- enumerate capturable displays and top-level windows without forcing a browser-mediated picker for normal Edge operation;
- exclude obvious iPresenterPlux internal utility windows where recursive capture would be harmful unless explicitly enabled later;
- capture to a normalized BGRA32 frame contract;
- detect closed windows or removed displays and transition the session to `disconnected`;
- avoid blocking the Edge runtime thread on frame acquisition.

If Windows security rules prevent silent access to a target, surface `permission_required`; do not fall back to hidden browser capture.

## 8. Routing and Preview/Program safety

Native source selection follows the same deliberate operator safety model as presentation content.

### Desired state

1. Operator chooses a visual source in the control portal.
2. Control plane sends a typed, idempotent Edge command scoped to the active service and assigned Edge device.
3. Edge resolves the requested `SourceId` against its current local catalog.
4. Edge starts or reuses a capture session and binds it to the Preview slot only.
5. Edge reports confirmed Preview readiness; the control portal displays that confirmed source/state.
6. Existing TAKE promotes the confirmed Preview slot to the Program slot.
7. Only after TAKE does the Program-side `IProgramVideoSource` expose that source to local Program/contribution encoding.

Selecting a camera, display or window must never implicitly execute `program.take` or `program.show`.

### Command model

The implementation should extend the existing durable Edge command pipeline with narrowly scoped commands such as:

- `visual.rescan`
- `visual.preview.select`
- `visual.preview.clear`

Exact command names may change during implementation if current command conventions require it, but semantics must remain typed, service-scoped, idempotent and auditable.

`program.take` remains the sole live-promotion authority. Its implementation may coordinate the video router's Preview-to-Program promotion in the same deliberate TAKE operation, but no new visual command may bypass it.

## 9. Source lifecycle and failure policy

### Source unavailable before start

Return a structured failure without changing the existing Program source. Preview shows the failed source state and operator recovery guidance.

### Source disconnect while only in Preview

Preview immediately transitions to unavailable/error. Program remains untouched.

### Source disconnect while live on Program

Safety policy for v1:

1. Preserve the last valid Program frame for up to 2 seconds to absorb transient device renegotiation.
2. If valid frames resume inside that window, continue without automatic Program mutation.
3. If valid frames do not resume after 2 seconds, emit a deterministic safe black Program frame from the routing layer and mark the Program source `disconnected`/`error`.
4. Do not automatically switch to another camera or presentation source.
5. Surface a high-priority operator attention event/recommendation.

This avoids both a hard encoder crash and an unsafe automatic switch.

### Control-plane disconnect

The Edge continues the active Program slot, local Program output and contribution/recording pipeline. Desired-state changes wait until authenticated connectivity returns. Edge continues journaling/reporting local state according to existing offline/durable patterns.

### Encoder failure

Capture and encoder failures remain separately observable. A healthy source with an unavailable encoder reports encoder failure without falsely marking the physical camera disconnected.

## 10. Telemetry and control-plane data

The Edge reports source observations through the existing authenticated media-source telemetry path where compatible.

Required normalized metadata may include:

- source kind;
- width/height;
- frame rate;
- permission/busy state;
- active Preview flag;
- active Program flag when Edge-confirmed;
- frame/drop counters or compact health summary;
- native capability summary that is safe to expose.

The control plane must distinguish:

- desired source state requested by the operator;
- Edge-confirmed Preview slot;
- Edge-confirmed Program slot;
- Program state confirmed by the existing presentation/output authority.

The UI must not label a source Live merely because a request was sent.

The current media-source upsert behavior must be reviewed because source identity may not safely rely on organization + friendly name. If schema/index changes are required, v1 should move source uniqueness to a stable Edge-device/source-key identity while preserving operator labels as mutable presentation metadata.

## 11. Control Portal UX

Evolve the existing Cameras workspace rather than create a disconnected second device-management page.

### Desktop layout

- Source categories: Cameras, Screens, Windows.
- Each source card shows name/operator label, source kind, reporting Edge, availability, last seen and current Preview/Program badges.
- Primary actions:
  - Preview;
  - Rescan;
  - operator label/preference controls where authorized.
- Program promotion continues to happen through the existing Cockpit TAKE control, not from a source-card “Go Live” shortcut.

### Preview behavior

Where a low-bandwidth Edge preview URL is available, the workspace may show it. The browser preview is observational only. The source-of-truth badge must say whether Edge has actually prepared the source.

### Error guidance

Permission, busy, disconnected and unsupported states must have specific operator guidance. Avoid generic “camera failed” messages when the cause is known.

### Accessibility/usability

- all interactive controls have pointer affordance;
- keyboard focus remains visible;
- status is conveyed by text/icon in addition to color;
- source list remains usable at laptop widths;
- no engineering-only diagnostics dominate the normal operator view.

## 12. Security and privacy

- Only authenticated/enrolled Edge devices may report source telemetry.
- Only authorized operator roles may request source selection/rescan.
- Commands remain organization/service/device scoped using existing assignment checks.
- Raw camera frames are not sent through ordinary control-plane APIs.
- Source metadata must exclude credentials, environment variables, full filesystem paths and other secrets.
- Window titles may contain sensitive information; by default telemetry should send a normalized friendly name and process identity, not arbitrary full window text unless explicitly required for operator identification.
- Preview URLs, if exposed, must use existing authenticated/short-lived Edge access patterns rather than a permanently open unauthenticated LAN endpoint.

## 13. Performance targets

These are v1 engineering targets, not public SLA commitments:

- Discovery/rescan result: typically under 2 seconds on ordinary church production PCs.
- First preview frame after selecting an available source: target under 1 second for cameras and displays on supported hardware.
- Default production capture profile: 1920x1080 at 30 fps where the source supports it.
- Capture thread must not block command polling/heartbeat.
- Sustained capture should use bounded buffering; stale frames are dropped rather than allowing unbounded memory growth.
- Existing single-master-encode policy remains: do not independently re-encode the same Program for every destination.

## 14. Testing strategy

### Core unit tests

- stable source identity normalization;
- catalog rescan and disappearance behavior;
- source status transitions;
- distinct Preview and Program routing state;
- Preview selection cannot change Program output;
- TAKE atomically promotes the confirmed Preview source to Program;
- command idempotency;
- last-frame hold then black-frame fallback after Program source loss;
- bounded-frame/drop behavior.

### Windows tests

- camera catalog adapter normalization;
- display/window catalog normalization;
- Media Foundation capture adapter error mapping;
- Windows Graphics Capture adapter error mapping;
- fake/native-frame integration into the existing H.264 encoder through the Program slot;
- start/stop/restart lifecycle and disposal.

Physical hardware tests that cannot run deterministically in hosted CI must be isolated behind explicit Windows UAT scripts and never replaced with claims of successful physical capture.

### Control-plane/UI tests

- Edge telemetry accepts camera/display/window kinds safely;
- stale telemetry transitions sources to disconnected;
- source preference/label behavior remains intact;
- Preview action creates only the visual-preview command;
- no source-card action bypasses TAKE;
- desired vs confirmed status cannot be confused;
- permission/busy/disconnect states render correctly.

### End-to-end acceptance

On a real Windows production workstation:

1. Discover an integrated/USB camera.
2. Discover at least one monitor.
3. Discover a capturable application window.
4. Preview each source independently and confirm Program does not change.
5. TAKE a prepared source to Program through the normal Cockpit action.
6. Unplug/disconnect a live camera and observe 2-second hold followed by safe black plus attention state.
7. Restore/rescan/reselect the source.
8. Drop Internet/control-plane connectivity and confirm existing local Program/capture continues.
9. Reconnect and confirm state reconciliation without duplicate commands.
10. Confirm contribution H.264 frames continue through the existing publisher path and follow Program, not Preview.

The existing external Windows Edge enrollment/UAT issue must remain open until these tests run on an actual Windows machine.

## 15. Delivery sequence

Implementation should be staged so every step preserves a working product:

1. Core source contracts and fake-source tests.
2. Windows source catalog discovery.
3. Native camera capture.
4. Native display/window capture.
5. Two-slot Preview/Program router feeding the existing Program-side `IProgramVideoSource` encoder path.
6. Durable source Preview commands plus TAKE coordination and Edge state reporting.
7. Control-plane telemetry/data-model compatibility adjustments.
8. Cameras workspace operator controls and confirmed-state UX.
9. Windows packaging/CI hardening.
10. Physical Windows UAT and capability-profile update from `planned` to `available` only after verified hardware capture.

## 16. Non-goals and future expansion

This design intentionally creates foundations for later work without implementing it now:

- scene compositor and transitions;
- multi-camera switching;
- AI Director camera recommendations using live source health;
- NDI/SRT source adapters;
- PTZ and ATEM control;
- synchronized local A/V recording;
- macOS native source adapters;
- GPU/HDR/4K optimization profiles.

Future features must continue to consume the same source catalog/capture contracts rather than bypassing them.

## 17. Acceptance criteria

Native Edge Visual Capture v1 is complete only when all of the following are true:

- Windows Edge can enumerate real camera, display and window sources.
- Operator-visible source identity is stable across ordinary rescans.
- Camera and screen/window sources can produce normalized frames on Windows.
- Preview and Program maintain separate Edge-confirmed source slots.
- Existing H.264 contribution encoding consumes only the Program slot and does not change when Preview selection changes.
- Source selection prepares Preview only and cannot bypass TAKE.
- TAKE atomically promotes the confirmed Preview visual source to Program when a visual source is armed.
- Source failure does not crash the Edge runtime or silently switch Program.
- Live Program source loss follows the defined 2-second hold then safe-black policy.
- Existing Program continues during temporary control-plane loss.
- Control Portal displays Edge-confirmed source truth, including permission/busy/disconnect states.
- Automated Core/Control tests and Windows build tests pass.
- Physical Windows UAT verifies actual camera/display/window capture before Windows capability status is changed to `available`.
