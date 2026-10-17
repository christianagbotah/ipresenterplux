# Native Edge Visual Capture v1 — Core Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add platform-neutral visual-source contracts and a bounded Preview/Program router that preserves the existing human TAKE boundary and feeds the existing `IProgramVideoSource` encoder path.

**Architecture:** Edge Core owns normalized source descriptors, capture-session contracts, stable identity, and a two-slot router. The router wraps the existing rendered presentation source as the default Program family; native Preview never changes Program until `program.take`, and Program source loss holds the last frame for exactly 2 seconds before deterministic black.

**Tech Stack:** .NET 10, C#, xUnit, existing `IProgramVideoSource` / `ProgramVideoFrame`, existing durable Edge command processor.

**Spec:** `docs/superpowers/specs/2026-10-10-native-edge-visual-capture-design.md`

## Global Constraints

- Preview and Program remain separate safety domains; source selection prepares Preview only.
- `program.take` remains the sole live-promotion authority.
- At most two native capture sessions may be active: current Program plus next Preview.
- Existing H.264 encoder remains unchanged and consumes only the router's Program-side `IProgramVideoSource`.
- Program source loss: hold last valid frame for 2 seconds, then safe black; never auto-switch.
- Raw frames never traverse ordinary control-plane APIs.
- No macOS native visual implementation in this plan.

## Review Focus

- Re-selecting the same physical source already on Program must not open a second device handle.
- A failed Preview start must leave Program and its capture session untouched.
- Concurrent TAKE/clear/select operations must serialize without leaking an intermediate source to Program.
- A Program frame that resumes within the 2-second hold window must cancel black fallback without an automatic TAKE.
- Switching back to presentation content must release the native Program session and restore the existing rendered source deterministically.

---

### Task 1: Normalize visual source contracts and stable identity

**Files:**
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Models/VisualSourceDescriptor.cs`
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Abstractions/IVisualSourceCatalog.cs`
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Abstractions/IVisualCaptureSession.cs`
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Abstractions/IVisualCaptureFactory.cs`
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/VisualSourceIdentity.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/VisualSourceIdentityTests.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/VisualSourceContractTests.cs`

**Interfaces:**
- Produces:
  - `enum VisualSourceKind { Camera, Display, Window }`
  - `enum VisualSourceAvailability { Available, Busy, PermissionRequired, Disconnected, Unsupported, Error }`
  - `sealed record VisualCaptureMode(int Width, int Height, int FramesPerSecond, string PixelFormat)`
  - `sealed record VisualSourceDescriptor(string SourceId, VisualSourceKind Kind, string Name, string NativeKey, VisualSourceAvailability Availability, IReadOnlyList<VisualCaptureMode> Modes, DateTimeOffset ObservedAt, string? ErrorCode, IReadOnlyDictionary<string,string> Metadata)`
  - `sealed record VisualCaptureOptions(int Width, int Height, int FramesPerSecond, string PixelFormat = "bgra32")`
  - `sealed record VisualCaptureStatus(bool IsRunning, VisualSourceAvailability Availability, long FramesCaptured, long DroppedFrames, DateTimeOffset? LastFrameAt, string? ErrorCode)`
  - `IVisualSourceCatalog.ScanAsync(CancellationToken) -> Task<IReadOnlyList<VisualSourceDescriptor>>`
  - `IVisualCaptureSession.Source`, `.Status`, `.LatestFrame`, `StartAsync`, `StopAsync`
  - `IVisualCaptureFactory.CreateAsync(VisualSourceDescriptor, VisualCaptureOptions, CancellationToken) -> ValueTask<IVisualCaptureSession>`
  - `VisualSourceIdentity.Create(string platform, VisualSourceKind kind, string nativeKey) -> string`

- [ ] **Step 1: Write failing contract/identity tests**
  - Same `(platform, kind, nativeKey)` produces the same SourceId.
  - Different kind/native key produces a different SourceId.
  - SourceId is bounded, lowercase, and contains no raw native path/title.
  - Descriptor rejects blank IDs/names/native keys and invalid capture dimensions/fps.

- [ ] **Step 2: Run the focused tests and observe RED**

Run from `apps/edge-agent` on Windows CI or a .NET 10 workstation:
`dotnet test tests/iPresenterPlux.Edge.Core.Tests/iPresenterPlux.Edge.Core.Tests.csproj -c Release --filter "VisualSource"`

Expected: FAIL because the contracts/identity helper do not exist.

- [ ] **Step 3: Implement the contracts and SHA-256-based stable ID helper**
  - Format: `visual:{kind-lower}:{first-32-hex-of-sha256(platform + "\n" + nativeKey)}`.
  - Never include raw `NativeKey` in `SourceId`.

- [ ] **Step 4: Re-run focused tests; expect PASS**

- [ ] **Step 5: Commit**

`git commit -m "feat(edge): add visual source contracts"`

---

### Task 2: Add the two-slot visual Program router

**Files:**
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Abstractions/IVisualProgramRouter.cs`
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/VisualProgramRouter.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/VisualProgramRouterTests.cs`

**Interfaces:**
- Consumes Task 1 contracts plus the existing `IProgramVideoSource` fallback.
- Produces:
  - `sealed record VisualRouteSlot(string SourceId, VisualSourceKind Kind, VisualSourceAvailability Availability, bool Confirmed, string? ErrorCode)`
  - `sealed record VisualRouteSnapshot(VisualRouteSlot? Preview, VisualRouteSlot? Program, bool UsingRenderedProgram)`
  - `IVisualProgramRouter : IProgramVideoSource, IAsyncDisposable`
  - `Snapshot { get; }`
  - `SelectPreviewAsync(string sourceId, CancellationToken)`
  - `ClearPreviewAsync(CancellationToken)`
  - `TakePreviewAsync(CancellationToken)`
  - `UseRenderedProgramAsync(CancellationToken)`

- [ ] **Step 1: Write RED tests for routing invariants**
  - Preview select starts/prepares only Preview; `GetCurrentFrame()` stays on existing Program/fallback.
  - Program source A + Preview source B yields two sessions maximum.
  - Preview source equal to Program source reuses the Program session.
  - TAKE atomically promotes confirmed Preview, clears Preview, and disposes prior Program only after promotion succeeds.
  - Preview start failure preserves Program exactly.
  - `UseRenderedProgramAsync` releases native Program and returns `GetCurrentFrame()` to fallback.

- [ ] **Step 2: Run `VisualProgramRouterTests`; observe RED**

- [ ] **Step 3: Implement `VisualProgramRouter` with one `SemaphoreSlim` mutation gate**
  - Session ownership is explicit; no unbounded dictionaries or queues.
  - `GetCurrentFrame()` remains synchronous and lock-light by reading the current Program session's latest immutable frame reference or fallback source.

- [ ] **Step 4: Re-run focused Core tests; expect PASS**

- [ ] **Step 5: Commit**

`git commit -m "feat(edge): add visual preview program router"`

---

### Task 3: Implement the 2-second live-source loss policy

**Files:**
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/VisualProgramRouter.cs`
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/ProgramVideoFrames.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/VisualProgramRouterFailureTests.cs`

**Interfaces:**
- `ProgramVideoFrames.Black(int width, int height) -> ProgramVideoFrame`
- Router constructor accepts `TimeProvider? clock = null` for deterministic hold-window tests.

- [ ] **Step 1: Write failing tests using a small test-only `ManualTimeProvider : TimeProvider` (no new package)**
  - Last good Program frame remains returned at +1.999s after disconnect.
  - Safe black is returned at >=2.000s when no new frame arrives.
  - A fresh valid frame at +1.5s cancels fallback and remains Program.
  - Preview disconnect immediately clears/releases Preview and never changes Program.

- [ ] **Step 2: Run focused tests; observe RED**

- [ ] **Step 3: Implement bounded last-frame state and cached black frames by dimensions**

- [ ] **Step 4: Run router/failure tests; expect PASS**

- [ ] **Step 5: Commit**

`git commit -m "feat(edge): fail visual program safely on source loss"`

---

### Task 4: Extend durable command semantics without bypassing TAKE

**Files:**
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/ControlCommandProcessor.cs`
- Modify: `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/ControlCommandProcessorTests.cs`
- Create: `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/VisualControlCommandProcessorTests.cs`

**Interfaces:**
- `ControlCommandProcessor` adds optional constructor dependencies:
  - `IVisualSourceCatalog? visualSourceCatalog = null`
  - `IVisualProgramRouter? visualRouter = null`
- New command semantics:
  - `visual.rescan`: rescan only; no Program mutation.
  - `visual.preview.select`: requires `sourceId`; selects Preview only.
  - `visual.preview.clear`: clears visual Preview only.
  - `preview.prepare`: clears any visual Preview before preparing presentation Preview so TAKE has one unambiguous prepared family.
  - `program.take`: if visual Preview exists, promote it; otherwise preserve existing presentation TAKE and ensure rendered Program route is active.
  - `program.show`: clear visual Preview, perform existing presentation show/take, then ensure rendered Program route is active.
  - `program.clear`: clear existing presentation Program and ensure rendered Program route is active.

- [ ] **Step 1: Write failing command tests for all new semantics and service-scope preservation**

- [ ] **Step 2: Run focused processor tests; observe RED**

- [ ] **Step 3: Implement minimal command integration; do not add a visual “go live” command**

- [ ] **Step 4: Run all Core tests**

`dotnet test tests/iPresenterPlux.Edge.Core.Tests/iPresenterPlux.Edge.Core.Tests.csproj -c Release`

- [ ] **Step 5: Commit**

`git commit -m "feat(edge): route visual commands through existing take authority"`

---

### Task 5: Publish normalized visual source/route telemetry

**Files:**
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Models/MediaSourceState.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/OutboundEventFactory.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/EdgeAgentRuntime.cs`
- Modify: `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/OutboundEventDispatcherTests.cs`
- Create: `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/VisualTelemetryTests.cs`

**Interfaces:**
- Keep the existing `/api/v1/edge/media-source` envelope.
- `sourceType`: `camera`, `display`, or `window`.
- Preserve broad wire `status`: `ready`, `live`, `warning`, `offline`, `error` for backward compatibility.
- Add allowlisted metadata keys only: `captureStatus`, `width`, `height`, `fps`, `previewActive`, `programActive`, `framesCaptured`, `droppedFrames`, `errorCode`, `processName`, `displayPrimary`.
- Never send raw `NativeKey`, arbitrary full window title, paths, credentials, or frame bytes.

- [ ] **Step 1: Write RED telemetry tests for allowlisting and Preview/Program flags**

- [ ] **Step 2: Implement telemetry mapping and bounded string values**

- [ ] **Step 3: Run all Core tests; expect PASS**

- [ ] **Step 4: Commit**

`git commit -m "feat(edge): report visual source route telemetry"`

---

## Phase verification

- [ ] Run the complete Core suite on Windows CI.
- [ ] Confirm existing `RenderedProgramVideoSourceTests`, contribution transport tests, command idempotency tests, recording and audio suites remain green.
- [ ] Confirm no change to `WindowsMediaFoundationEncodedProgramVideoSource` is required for Core phase acceptance.
- [ ] Confirm no command other than `program.take` can promote visual Preview to Program.
