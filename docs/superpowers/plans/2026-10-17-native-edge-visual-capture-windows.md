# Native Edge Visual Capture v1 — Windows Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement real Windows camera, display, and window discovery/capture behind the Core visual-source contracts and wire the resulting router into the existing H.264 contribution encoder.

**Architecture:** The Windows project owns Media Foundation camera adapters and Windows Graphics Capture display/window adapters. All native APIs terminate at `IVisualSourceCatalog` / `IVisualCaptureFactory`; the Edge host wires one `VisualProgramRouter` around the existing `RenderedProgramVideoSource`, and the existing `WindowsMediaFoundationEncodedProgramVideoSource` continues reading only `IProgramVideoSource`.

**Tech Stack:** .NET 10, `net10.0-windows10.0.19041.0`, Media Foundation, Windows Graphics Capture, existing `Microsoft.Windows.SDK.NET.Ref` framework reference, existing `SharpMediaFoundationInterop`, GitHub `windows-latest` CI.

**Spec:** `docs/superpowers/specs/2026-10-10-native-edge-visual-capture-design.md`

## Global Constraints

- No browser-mediated sanctuary capture.
- Default capture profile target: 1920x1080 at 30 fps where supported.
- Native adapters output normalized BGRA32 `ProgramVideoFrame` objects.
- Capture callbacks must not block command polling, heartbeat, audio capture, ASR, recording, or contribution transport.
- Stale native frames are dropped; memory growth is bounded.
- Windows capability status remains `planned` until physical Windows UAT passes.
- Do not replace or duplicate the existing H.264 encoder.

## Review Focus

- Device unplug/replug while the catalog remains alive must not retain dead COM/Media Foundation handles.
- Opening a camera already owned by another app must map to `Busy`, not generic `Error`.
- Windows capture permission denial must map to `PermissionRequired` and remain recoverable after rescan.
- Window handles are session-scoped; a relaunched app must become a new current-session Window source rather than reusing a stale handle.
- Disposing a capture session while a native callback is in flight must not invoke managed events after disposal.

---

### Task 1: Add a Windows-only visual adapter test project and compile probe

**Files:**
- Create: `apps/edge-agent/tests/iPresenterPlux.Edge.Windows.Tests/iPresenterPlux.Edge.Windows.Tests.csproj`
- Create: `apps/edge-agent/tests/iPresenterPlux.Edge.Windows.Tests/WindowsGraphicsCaptureInteropTests.cs`
- Modify: `apps/edge-agent/iPresenterPlux.Edge.sln`
- Modify: `.github/workflows/edge-agent-ci.yml`

**Interfaces:**
- The test project targets `net10.0-windows10.0.19041.0` and references Core + Windows projects.
- No new WinRT package is added initially: current restore already supplies `Microsoft.Windows.SDK.NET.Ref` for the Windows target framework.

- [ ] **Step 1: Add a failing compile-level test that references `Windows.Graphics.Capture.GraphicsCaptureItem`, `Windows.Graphics.DirectX.Direct3D11.IDirect3DDevice`, and the HWND/HMONITOR interop boundary used by the adapter**

- [ ] **Step 2: Add Windows test project restore/build/test to the existing `windows-latest` job immediately after Core tests**

- [ ] **Step 3: Push the compile probe and require Windows CI to pass before native implementation continues**
  - If framework projection is insufficient, add the smallest explicit Windows SDK projection dependency in this task only and document the reason in the PR.

- [ ] **Step 4: Commit**

`git commit -m "test(edge): add Windows visual capture adapter gate"`

---

### Task 2: Implement stable Windows source discovery

**Files:**
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Windows/WindowsVisualSourceCatalog.cs`
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Windows/WindowsCameraSourceCatalog.cs`
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Windows/WindowsGraphicsSourceCatalog.cs`
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Windows/WindowsVisualSourceMetadata.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Windows.Tests/WindowsVisualSourceCatalogTests.cs`

**Interfaces:**
- `WindowsVisualSourceCatalog : IVisualSourceCatalog` combines camera + display + window providers and returns a stable sorted snapshot.
- Camera `NativeKey`: Media Foundation symbolic link.
- Display `NativeKey`: monitor/device identity; never ordinal alone.
- Window `NativeKey`: normalized process executable identity + current-session HWND token.
- Window telemetry metadata exposes normalized process name only, not arbitrary full window text.

- [ ] **Step 1: Write RED normalization tests with fake native enumerator results**
  - duplicate native records collapse by SourceId;
  - display order changes do not change SourceId;
  - window HWND change creates a new session-scoped SourceId;
  - iPresenterPlux utility windows are excluded by default.

- [ ] **Step 2: Implement camera enumeration without opening capture**

- [ ] **Step 3: Implement display/top-level-window enumeration without starting capture**

- [ ] **Step 4: Run Windows adapter tests; expect PASS**

- [ ] **Step 5: Commit**

`git commit -m "feat(edge): discover Windows visual sources"`

---

### Task 3: Implement Media Foundation camera capture

**Files:**
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Windows/WindowsCameraCaptureSession.cs`
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Windows/WindowsMediaFoundationCameraReader.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Windows.Tests/WindowsCameraCaptureSessionTests.cs`

**Interfaces:**
- `WindowsCameraCaptureSession : IVisualCaptureSession`
- Internal reader emits immutable/copied BGRA32 frames to a single-slot latest-frame buffer.
- Error mapping tokens: `camera_busy`, `camera_permission`, `camera_unsupported`, `camera_disconnected`, `camera_capture_failed`.

- [ ] **Step 1: Write RED lifecycle/error-mapping tests against a fake camera reader**
  - start/stop/restart;
  - device busy;
  - permission denied;
  - unsupported mode;
  - disconnect during capture;
  - callback after stop ignored;
  - latest-frame buffer replaces stale frames instead of queueing unboundedly.

- [ ] **Step 2: Implement Media Foundation source reader and mode negotiation**
  - Prefer exact requested 1920x1080/30 when available; otherwise select the closest supported mode without exceeding 60 fps.
  - Convert/copy to BGRA32 before publishing into Core.

- [ ] **Step 3: Run Windows camera tests; expect PASS**

- [ ] **Step 4: Commit**

`git commit -m "feat(edge): capture Windows cameras with Media Foundation"`

---

### Task 4: Implement Windows Graphics Capture for displays/windows

**Files:**
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Windows/WindowsGraphicsCaptureSession.cs`
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Windows/GraphicsCaptureItemFactory.cs`
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Windows/Direct3DDeviceFactory.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Windows.Tests/WindowsGraphicsCaptureSessionTests.cs`

**Interfaces:**
- `WindowsGraphicsCaptureSession : IVisualCaptureSession`
- `GraphicsCaptureItemFactory.ForWindow(nint hwnd)` / `.ForMonitor(nint hmonitor)` isolate COM interop.
- Error mapping tokens: `screen_permission`, `screen_disconnected`, `screen_unsupported`, `screen_capture_failed`.

- [ ] **Step 1: Write RED tests around fake frame-pool/device adapters**
  - normalized BGRA32 frame dimensions/stride;
  - resize recreates the frame pool without leaking the previous one;
  - closed window/removed display transitions to Disconnected;
  - stop/dispose are idempotent;
  - callback work is bounded and never blocks the native capture thread.

- [ ] **Step 2: Implement HWND/HMONITOR capture-item interop and Direct3D device setup**

- [ ] **Step 3: Implement frame-pool capture and BGRA32 copy**

- [ ] **Step 4: Run Windows graphics tests; expect PASS**

- [ ] **Step 5: Commit**

`git commit -m "feat(edge): capture Windows displays and windows"`

---

### Task 5: Add the Windows visual capture factory and host wiring

**Files:**
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Windows/WindowsVisualCaptureFactory.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Windows/Program.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Windows/WindowsPlatformProfile.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Windows.Tests/WindowsVisualCaptureFactoryTests.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Windows.Tests/WindowsProgramWiringTests.cs`

**Interfaces:**
- Factory dispatches Camera -> `WindowsCameraCaptureSession`; Display/Window -> `WindowsGraphicsCaptureSession`.
- Host creates:
  1. `RenderedProgramVideoSource renderedProgramSource`;
  2. `WindowsVisualSourceCatalog visualCatalog`;
  3. `WindowsVisualCaptureFactory visualFactory`;
  4. `VisualProgramRouter visualRouter(renderedProgramSource, visualCatalog, visualFactory)`;
  5. existing `WindowsMediaFoundationEncodedProgramVideoSource(visualRouter)`.
- `ControlCommandProcessor` receives the same `visualCatalog` + `visualRouter` through `EdgeAgentRuntime` wiring.

- [ ] **Step 1: Write RED wiring tests proving encoder consumes the router and not a native Preview session directly**

- [ ] **Step 2: Implement factory and host wiring**

- [ ] **Step 3: Keep `screen.capture` and new `camera.capture` platform capabilities at `planned` pending physical UAT; add safe detail strings identifying implemented-but-unverified adapters only in engineering diagnostics**

- [ ] **Step 4: Run all Windows + Core tests**

- [ ] **Step 5: Commit**

`git commit -m "feat(edge): wire native visual capture into Windows Program"`

---

## Phase verification

- [ ] `dotnet restore iPresenterPlux.Edge.sln`
- [ ] `dotnet build tests/iPresenterPlux.Edge.Core.Tests/iPresenterPlux.Edge.Core.Tests.csproj -c Release --no-restore`
- [ ] `dotnet test tests/iPresenterPlux.Edge.Core.Tests/iPresenterPlux.Edge.Core.Tests.csproj -c Release --no-build --no-restore`
- [ ] `dotnet build tests/iPresenterPlux.Edge.Windows.Tests/iPresenterPlux.Edge.Windows.Tests.csproj -c Release --no-restore`
- [ ] `dotnet test tests/iPresenterPlux.Edge.Windows.Tests/iPresenterPlux.Edge.Windows.Tests.csproj -c Release --no-build --no-restore`
- [ ] `dotnet build src/iPresenterPlux.Edge.Windows/iPresenterPlux.Edge.Windows.csproj -c Release --no-restore`
- [ ] Existing Windows publish/package job remains green.
- [ ] No claim of successful real camera/display/window capture until physical UAT plan passes.
