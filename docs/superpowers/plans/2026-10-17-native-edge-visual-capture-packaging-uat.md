# Native Edge Visual Capture v1 — Packaging, CI & Physical UAT Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the native visual-capture implementation packages correctly on Windows and validate actual camera/display/window behavior on real hardware before advertising the capabilities as available.

**Architecture:** Hosted Windows CI proves compilation, unit/integration contracts, packaging, licensing scan, and artifact composition. A separate explicit physical-Windows UAT script records hardware results; only that evidence permits changing Windows platform capability status from `planned` to `available`.

**Tech Stack:** GitHub Actions `windows-latest`, .NET 10, PowerShell, existing self-contained Windows Edge/Desktop packaging, physical Windows 10/11 production workstation.

**Spec:** `docs/superpowers/specs/2026-10-10-native-edge-visual-capture-design.md`

## Global Constraints

- Hosted CI must never be described as proof of physical camera/display/window capture.
- Existing Edge enrollment/physical-UAT issue remains open until real hardware tests pass.
- Windows Desktop package must continue bundling the Windows Edge runtime and libsrt.
- No capability flips to `available` before signed/recorded UAT evidence.
- UAT must preserve the human TAKE boundary and offline Program continuity.

## Review Focus

- Self-contained Windows publish must include every native/WinRT dependency needed on a clean workstation.
- Antivirus/endpoint-security denial must surface as a capture/permission error, not crash startup.
- Multi-monitor DPI/scaling must not corrupt display identity or frame dimensions.
- USB camera reconnect must create a usable fresh session without restarting the whole Edge application.
- Internet loss during native Program capture must not terminate local Program/capture.

---

### Task 1: Harden Edge Agent CI for visual capture

**Files:**
- Modify: `.github/workflows/edge-agent-ci.yml`
- Modify: `apps/edge-agent/scripts/licensing-package-scan.py` only if a newly introduced redistributable requires an allowlist decision.

- [ ] **Step 1: Add Windows visual tests as required gates before publish**

- [ ] **Step 2: Add a package-content assertion that required Windows capture assemblies/native DLLs are present and forbidden development/test assets are absent**

- [ ] **Step 3: Keep existing Core/Desktop tests, SRT build, self-contained publish, and licensing scan unchanged and required**

- [ ] **Step 4: Verify Edge Agent CI green on the implementation PR**

- [ ] **Step 5: Commit**

`git commit -m "ci(edge): gate Windows native visual capture"`

---

### Task 2: Add a physical Windows UAT harness

**Files:**
- Create: `apps/edge-agent/scripts/uat-native-visual-capture.ps1`
- Create: `apps/edge-agent/docs/native-visual-capture-uat.md`

**Interfaces:**
- Script accepts:
  - `-EdgeExe <path>`
  - `-ControlUrl <https-url>`
  - `-DataDir <isolated-dir>`
  - optional `-ExpectedCameraName`, `-ExpectedWindowProcess`.
- Script never stores product keys/tokens in output; pairing remains through normal secure flow.
- Output: timestamped JSON + Markdown result bundle under an operator-chosen evidence directory.

- [ ] **Step 1: Implement preflight only**
  - Windows version/build, GPU adapter summary, monitor count, Edge binary version/hash, network reachability, no secrets.

- [ ] **Step 2: Add operator-confirmed checkpoints for real camera, display, and window discovery**

- [ ] **Step 3: Add timed checks for Preview selection under 1s target where hardware permits and verify Program identity does not change before TAKE**

- [ ] **Step 4: Add Program A / Preview B / TAKE B checks and confirm old Program session release in telemetry**

- [ ] **Step 5: Add live camera disconnect check: last frame <=2s, then safe black + attention; no automatic source switch**

- [ ] **Step 6: Add Internet/control-plane disconnect checkpoint: local Program/capture remains active, then state reconciles after reconnect without duplicate commands**

- [ ] **Step 7: Add contribution check proving H.264 publisher follows Program, not Preview**

- [ ] **Step 8: Commit**

`git commit -m "test(edge): add native visual capture physical UAT"`

---

### Task 3: Run and record physical Windows UAT

**Files:**
- No product-code changes unless a defect is found.
- Evidence belongs in the designated UAT issue/artifact location, not committed if it contains machine-specific identifiers.

- [ ] **Step 1: Run on an actual Windows 10/11 production workstation with at least one USB/integrated camera, one monitor, and one capturable app window**

- [ ] **Step 2: Complete all 11 acceptance scenarios from the design spec**

- [ ] **Step 3: If any scenario fails, keep capability status `planned`, open/fix the defect with TDD, rerun hosted CI, then rerun the failed physical scenario plus adjacent scenarios**

- [ ] **Step 4: Attach redacted evidence to the existing external Windows Edge UAT tracking issue**

---

### Task 4: Flip verified capability profile only after UAT

**Files:**
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Windows/WindowsPlatformProfile.cs`
- Modify: `apps/edge-agent/README.md`
- Modify: relevant capability/profile tests.

- [ ] **Step 1: Write failing test that expects `camera.capture` and `screen.capture` to be `available` only under the post-UAT code revision**

- [ ] **Step 2: Update capability strings with exact verified implementation details**

- [ ] **Step 3: Run full Edge Agent CI and packaging again**

- [ ] **Step 4: Commit with UAT issue/evidence reference in the commit/PR body**

`git commit -m "feat(edge): mark verified Windows visual capture available"`

---

## Release acceptance

- [ ] Edge Agent Windows CI fully green.
- [ ] Control Portal CI fully green for matching control-plane integration.
- [ ] Physical Windows UAT evidence covers camera, display, window, Preview isolation, Program TAKE, two-source concurrency, disconnect fallback, recovery, offline continuity, reconciliation, and H.264 Program following.
- [ ] No raw source frames or sensitive window metadata enter control-plane APIs/logs.
- [ ] Windows package installs/runs on a clean workstation without development SDK requirements.
- [ ] Capabilities remain `planned` until all above checks are true.
