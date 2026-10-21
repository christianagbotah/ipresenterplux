# Lightworld Update Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manual iPresenterPlux Windows folder replacement with a one-time installer plus VPS-hosted, cryptographically verified, safe in-app updates, while establishing a reusable Lightworld desktop update protocol.

**Architecture:** Host a dedicated Update Hub service behind `https://updates.lightworldtech.com`, store immutable release payloads on the VPS, and keep publishing metadata in PostgreSQL. iPresenterPlux uses a shared .NET updater library plus an external Windows apply helper; updates download while the app is running but are applied only after a safe exit, with automatic rollback when the new build does not report healthy startup.

**Tech Stack:** Node.js/TypeScript, PostgreSQL, Nginx/Cloudflare, .NET 10/C#, Avalonia, Inno Setup 6, Ed25519 signatures, SHA-256, GitHub Actions for Windows builds.

**Spec:** `docs/superpowers/specs/2026-10-21-lightworld-update-hub-design.md`

## Global Constraints

- `updates.lightworldtech.com` is the customer-facing update/distribution origin; GitHub remains source/CI only.
- Public Authenticode signing is deferred; internal release trust is mandatory from the first updater build.
- Update manifest schema version is `1`.
- Product id is `ipresenterplux`; initial platform/architecture is `windows/x64`; default channel is `stable`.
- Remote update traffic is HTTPS only.
- Manifest verification and package SHA-256 verification happen before any executable update content is trusted or applied.
- The updater never interrupts active Program output, recording, audience/broadcast contribution, or another critical local runtime session.
- Update failure is non-fatal to presentation/recording and must preserve the previous known-good version.
- Desktop settings and enrollment identity remain outside the install tree and must survive install/update/rollback.
- No product keys, bearer credentials, private signing keys, customer presentation content, audio/video, or church records enter update logs or telemetry.
- First implementation proves full-package reliability before enabling delta packages; delta support must fall back to the full package.

## Review Focus

- A compromised VPS serving a tampered manifest or package must not be able to make the desktop execute it without the Lightworld release-signing private key.
- A downloaded update must remain staged and unapplied while local live/recording/output state is unsafe.
- Interrupted downloads must resume without trusting partial bytes as a completed package.
- A bad build that starts but never emits its health marker must roll back to the prior version.
- Installer/update/rollback must preserve settings and Windows Credential Manager enrollment state because those live outside the install directory.

---

### Task 1: Establish the Update Hub VPS service and secure public storage

**Files:**
- Create: `apps/update-hub/package.json`
- Create: `apps/update-hub/tsconfig.json`
- Create: `apps/update-hub/src/config.ts`
- Create: `apps/update-hub/src/server.ts`
- Create: `apps/update-hub/src/storage.ts`
- Create: `apps/update-hub/src/db.ts`
- Create: `apps/update-hub/db/001_update_hub.sql`
- Create: `apps/update-hub/scripts/selftest.mjs`
- Create: `deploy/systemd/lightworld-update-hub.service`
- Create: `deploy/nginx/updates.lightworldtech.com.conf`
- Create: `ops/update-hub/bootstrap-vps.sh`

**Interfaces:**
- HTTP listener: `127.0.0.1:3041` by default.
- Health endpoint: `GET /health` -> `{ "ok": true, "service": "lightworld-update-hub" }`.
- Public immutable roots: `/releases/` and `/manifests/` under `/home/lightworld/update-hub/public`.
- PostgreSQL database: `lightworld_updatehub`; connection only via `UPDATE_HUB_DATABASE_URL`.
- Tables: `products`, `releases`, `release_artifacts`, `release_events`.

- [ ] **Step 1: Write RED server/config/storage self-tests** for HTTPS public-origin validation, path traversal rejection, health response, and immutable release path generation.
- [ ] **Step 2: Run `node apps/update-hub/scripts/selftest.mjs`; expect FAIL because the Update Hub modules do not exist.**
- [ ] **Step 3: Implement the minimal service/config/storage/database migration and package scripts.**
- [ ] **Step 4: Run Update Hub self-test; expect PASS.**
- [ ] **Step 5: Add systemd, Nginx include, and idempotent VPS bootstrap script; bootstrap must grant Nginx read/traverse access only to the Update Hub public tree and preserve private app/log paths.**
- [ ] **Step 6: Run `nginx -t` and a localhost `/health` smoke test in the isolated deployment staging path; expect PASS.**
- [ ] **Step 7: Commit `feat(update-hub): establish secure VPS update service`.**

---

### Task 2: Implement release metadata, compatibility selection, and signed manifests

**Files:**
- Create: `apps/update-hub/src/release-model.ts`
- Create: `apps/update-hub/src/manifest.ts`
- Create: `apps/update-hub/src/signing.ts`
- Create: `apps/update-hub/src/routes/check-update.ts`
- Create: `apps/update-hub/src/routes/releases.ts`
- Create: `apps/update-hub/scripts/release-selftest.mjs`
- Modify: `apps/update-hub/src/server.ts`
- Modify: `apps/update-hub/package.json`

**Interfaces:**
- `GET /api/v1/products/:product/updates/check?version=&channel=&platform=&architecture=&installationId=`.
- Response is either `{ status: "no-update" }` or `{ status: "update", manifestUrl, signatureUrl, version }`.
- Canonical manifest fields and names exactly match schema version 1 in the design spec.
- Stable/beta selection uses semantic version ordering and never returns a withdrawn/paused release or a version <= current version.
- Rollout uses a deterministic SHA-256 bucket from `installationId + releaseId`, producing 0-99.
- Sign/verify algorithm: Ed25519; detached signature file uses base64 and explicit key id.

- [ ] **Step 1: Write RED release tests** covering stable/beta selection, wrong platform/architecture, lower/equal version, withdrawn/paused release, deterministic rollout, canonical JSON, valid Ed25519 verification, and tampered-manifest rejection.
- [ ] **Step 2: Run `pnpm --dir apps/update-hub test:release`; expect FAIL for missing implementation.**
- [ ] **Step 3: Implement release selection, canonicalization, signing/verification utilities, and check endpoint.**
- [ ] **Step 4: Run Update Hub release tests and full self-test; expect PASS.**
- [ ] **Step 5: Commit `feat(update-hub): publish signed compatible releases`.**

---

### Task 3: Build the shared .NET updater client with resume and integrity checks

**Files:**
- Create: `apps/edge-agent/src/Lightworld.Update.Client/Lightworld.Update.Client.csproj`
- Create: `apps/edge-agent/src/Lightworld.Update.Client/UpdateContracts.cs`
- Create: `apps/edge-agent/src/Lightworld.Update.Client/UpdateManifestVerifier.cs`
- Create: `apps/edge-agent/src/Lightworld.Update.Client/UpdateHubClient.cs`
- Create: `apps/edge-agent/src/Lightworld.Update.Client/ResumableDownloader.cs`
- Create: `apps/edge-agent/src/Lightworld.Update.Client/PackageVerifier.cs`
- Create: `apps/edge-agent/tests/Lightworld.Update.Client.Tests/Lightworld.Update.Client.Tests.csproj`
- Create: `apps/edge-agent/tests/Lightworld.Update.Client.Tests/UpdateManifestVerifierTests.cs`
- Create: `apps/edge-agent/tests/Lightworld.Update.Client.Tests/ResumableDownloaderTests.cs`
- Create: `apps/edge-agent/tests/Lightworld.Update.Client.Tests/PackageVerifierTests.cs`
- Modify: `apps/edge-agent/iPresenterPlux.Edge.sln`

**Interfaces:**
- `UpdateHubClient.CheckAsync(UpdateIdentity identity, CancellationToken)` returns `UpdateCheckResult`.
- `UpdateManifestVerifier.Verify(ReadOnlySpan<byte> canonicalManifest, ReadOnlySpan<byte> signature, string keyId)` throws on unknown key or invalid signature.
- `ResumableDownloader.DownloadAsync(Uri source, string destination, long expectedSize, CancellationToken)` uses HTTP Range when a partial destination exists and restarts cleanly if the server ignores Range.
- `PackageVerifier.VerifyAsync(path, expectedSize, expectedSha256, cancellationToken)` rejects size/hash mismatch.

- [ ] **Step 1: Write RED xUnit tests** for valid/tampered signature, unknown key, resumed range request, server ignoring range, interrupted partial preservation, hash mismatch, and size mismatch.
- [ ] **Step 2: Run client tests on Windows CI/local .NET environment; expect FAIL because production types do not exist.**
- [ ] **Step 3: Implement the minimal platform-neutral updater client.**
- [ ] **Step 4: Run updater client tests plus existing Edge Core/Desktop suites; expect PASS.**
- [ ] **Step 5: Commit `feat(edge): add verified resumable update client`.**

---

### Task 4: Build the external Windows apply helper and rollback protocol

**Files:**
- Create: `apps/edge-agent/src/Lightworld.Update.Helper/Lightworld.Update.Helper.csproj`
- Create: `apps/edge-agent/src/Lightworld.Update.Helper/Program.cs`
- Create: `apps/edge-agent/src/Lightworld.Update.Helper/UpdatePlan.cs`
- Create: `apps/edge-agent/src/Lightworld.Update.Helper/AtomicInstallSwitcher.cs`
- Create: `apps/edge-agent/src/Lightworld.Update.Helper/HealthRollbackCoordinator.cs`
- Create: `apps/edge-agent/tests/Lightworld.Update.Helper.Tests/Lightworld.Update.Helper.Tests.csproj`
- Create: `apps/edge-agent/tests/Lightworld.Update.Helper.Tests/AtomicInstallSwitcherTests.cs`
- Create: `apps/edge-agent/tests/Lightworld.Update.Helper.Tests/HealthRollbackCoordinatorTests.cs`
- Modify: `apps/edge-agent/iPresenterPlux.Edge.sln`

**Interfaces:**
- Install root contains `current/`, `previous/`, `staging/`, `state/update-state.json`, and stable helper executable outside `current/`.
- Helper command: `Lightworld.Update.Helper.exe apply --plan <absolute-json-path>`.
- `UpdatePlan` includes product, fromVersion, toVersion, stagedPackagePath, installRoot, desktopExeRelativePath, healthToken, healthTimeoutSeconds.
- Full package is a ZIP whose root is the application payload; extraction forbids absolute paths and `..` traversal.
- Apply flow: verify staged package marker -> create candidate -> rotate current to previous -> candidate to current -> launch desktop with `--update-health-token` -> wait for matching health marker -> keep current or restore previous.

- [ ] **Step 1: Write RED helper tests** for traversal ZIP rejection, atomic current/previous rotation, preserved external state, valid health success, missing health timeout rollback, and failed process-start rollback.
- [ ] **Step 2: Run helper tests; expect FAIL for missing implementation.**
- [ ] **Step 3: Implement helper and rollback coordinator without touching LocalAppData settings/Credential Manager data.**
- [ ] **Step 4: Run helper + updater client + desktop tests; expect PASS.**
- [ ] **Step 5: Commit `feat(edge): apply updates with automatic rollback`.**

---

### Task 5: Integrate safe update status into iPresenterPlux desktop

**Files:**
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/Update/IpresenterUpdateCoordinator.cs`
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/Update/UpdateSafetyPolicy.cs`
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/Update/UpdateStateStore.cs`
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/update-public-keys.json`
- Create: `apps/edge-agent/tests/iPresenterPlux.Edge.Desktop.Tests/UpdateSafetyPolicyTests.cs`
- Create: `apps/edge-agent/tests/iPresenterPlux.Edge.Desktop.Tests/UpdateCoordinatorTests.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/DesktopSettings.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/iPresenterPlux.Edge.Desktop.csproj`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/MainWindow.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/Program.cs`

**Interfaces:**
- `DesktopSettings` gains `UpdateChannel = "stable"` and `UpdateHubUrl = "https://updates.lightworldtech.com"`; product/activation secrets remain absent.
- `UpdateSafetyPolicy.IsSafe(LocalOperatorSnapshot snapshot, EdgeHostSnapshot runtime)` is false when recording is active, Program is not clear, output is running, or runtime reports a critical live session.
- Coordinator states: `Idle`, `Checking`, `Downloading`, `Ready`, `WaitingForSafeRestart`, `Installing`, `Succeeded`, `FailedRolledBack`.
- Startup `--update-health-token <token>` writes the matching health marker only after settings load and local runtime bootstrap reaches a usable state.
- User can invoke `Check for updates`; background check is non-fatal and never blocks app startup.

- [ ] **Step 1: Write RED desktop tests** for each unsafe live state, safe idle state, stable default settings, no secret persistence, update-status transitions, withdrawn staged release discard, and health marker timing contract.
- [ ] **Step 2: Run desktop tests; expect FAIL for missing updater integration.**
- [ ] **Step 3: Implement coordinator, safety policy, settings, key catalog, and UI/status card with `Check for updates` and `Restart & install` controls.**
- [ ] **Step 4: Run all desktop/shared updater tests; expect PASS.**
- [ ] **Step 5: Commit `feat(desktop): add safe in-app update workflow`.**

---

### Task 6: Produce a proper Windows installer and release package in CI

**Files:**
- Create: `apps/edge-agent/installer/windows/iPresenterPlux.iss`
- Create: `apps/edge-agent/scripts/package-update.ps1`
- Create: `apps/edge-agent/scripts/installer-selftest.py`
- Modify: `.github/workflows/edge-agent-ci.yml`

**Interfaces:**
- Installer output: `iPresenterPlux-Setup.exe`.
- Per-user install root: `{localappdata}\Programs\Lightworld Technologies\iPresenterPlux`.
- Application payload initially lives under `current\`; helper lives at install root.
- Start Menu shortcut points to `current\iPresenterPlux.Edge.Desktop.exe` for v1; update helper never removes user settings/enrollment on uninstall unless explicitly selected in a future option.
- CI emits: installer EXE, full update ZIP, manifest template metadata, SHA-256 file.

- [ ] **Step 1: Write RED packaging self-test** asserting expected installer directives, helper/current layout, no embedded product keys/tokens/private keys, and update ZIP structure.
- [ ] **Step 2: Run packaging self-test; expect FAIL for missing installer/package scripts.**
- [ ] **Step 3: Add Inno Setup script and package-update PowerShell script; modify Windows CI to build helper, stage `current/`, build installer, and upload installer/update artifacts.**
- [ ] **Step 4: Run packaging self-test locally and Windows CI; expect PASS.**
- [ ] **Step 5: Commit `build(edge): produce installable self-updating Windows release`.**

---

### Task 7: Add authenticated release publishing, promotion, pause, withdraw, and audit

**Files:**
- Create: `apps/update-hub/src/admin-auth.ts`
- Create: `apps/update-hub/src/routes/admin-releases.ts`
- Create: `apps/update-hub/scripts/publish-release.mjs`
- Create: `apps/update-hub/scripts/admin-selftest.mjs`
- Modify: `apps/update-hub/src/server.ts`
- Modify: `apps/update-hub/package.json`

**Interfaces:**
- Admin bearer token comes only from `UPDATE_HUB_ADMIN_TOKEN` and is never logged.
- Admin endpoints under `/api/v1/admin/releases` support create/register artifact, publish beta/stable, set rollout 0-100, pause, withdraw, and rollback-target metadata.
- Every mutation appends an audit event containing actor label, action, release id, UTC timestamp, and non-secret detail.
- CLI reads signing private key from an explicit path outside public storage, signs canonical manifest locally, uploads/registers immutable artifacts, then publishes metadata.

- [ ] **Step 1: Write RED admin tests** for missing/invalid auth, valid publish, immutable artifact collision, audit event creation, pause/withdraw exclusion from checks, and no token/key leakage in logs/errors.
- [ ] **Step 2: Run admin tests; expect FAIL for missing implementation.**
- [ ] **Step 3: Implement admin routes and publisher CLI.**
- [ ] **Step 4: Run admin + release + Update Hub self-tests; expect PASS.**
- [ ] **Step 5: Commit `feat(update-hub): add audited release administration`.**

---

### Task 8: Add file-level delta packages with full-package fallback

**Files:**
- Create: `apps/update-hub/scripts/build-delta.mjs`
- Create: `apps/edge-agent/src/Lightworld.Update.Helper/FileDeltaApplier.cs`
- Create: `apps/edge-agent/tests/Lightworld.Update.Helper.Tests/FileDeltaApplierTests.cs`
- Modify: `apps/edge-agent/src/Lightworld.Update.Client/UpdateContracts.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/Update/IpresenterUpdateCoordinator.cs`
- Modify: `apps/update-hub/src/manifest.ts`

**Interfaces:**
- Delta package is a ZIP containing `delta.json` plus only added/changed files; `delta.json` includes exact `fromVersion`, `toVersion`, changed paths, deleted paths, resulting full-tree hash catalog, size, and SHA-256.
- Helper clones current into candidate, applies delta overlay/deletions, verifies resulting catalog, then uses the same atomic switch/health rollback path.
- Client selects exactly one matching delta from current -> target only when smaller than full package; any download/apply/verification failure falls back to the full package without applying unverified candidate content.

- [ ] **Step 1: Write RED delta tests** for changed/add/delete files, path traversal rejection, wrong fromVersion, result-catalog mismatch, and full-package fallback decision.
- [ ] **Step 2: Run delta tests; expect FAIL for missing implementation.**
- [ ] **Step 3: Implement delta builder, manifest entry, selection, and helper application.**
- [ ] **Step 4: Run updater/helper/full desktop suites; expect PASS.**
- [ ] **Step 5: Commit `feat(update-hub): add verified incremental desktop updates`.**

---

### Task 9: Deploy Update Hub and publish the first iPresenterPlux UAT release

**Files:**
- Modify as needed from Tasks 1-8 only for deployment fixes discovered by smoke tests.
- Create: `docs/runbooks/update-hub.md`

**Interfaces:**
- VPS app path: `/home/lightworld/update-hub/app`.
- Public storage: `/home/lightworld/update-hub/public/{releases,manifests,deltas}`.
- Service: `lightworld-update-hub.service` bound to `127.0.0.1:3041`.
- Nginx: `/api/` proxies to service; immutable public trees serve with Range and long cache; latest/check/admin responses are no-store; admin endpoints are never Cloudflare-cached.
- Release signing private key is mode `0600` outside the public tree and unreadable by Nginx/update-hub service user; public key is bundled into desktop.

- [ ] **Step 1: Run VPS bootstrap in staging/dry-run mode and verify path ownership/permissions; expect no broad world-readable Lightworld home tree.**
- [ ] **Step 2: Create/update the dedicated PostgreSQL database, run migration, install service, wire Nginx include, and run `nginx -t`.**
- [ ] **Step 3: Start service and verify public `GET /health`, update check, byte-range response, cache headers, and blocked unauthenticated admin mutation.**
- [ ] **Step 4: Generate the internal Ed25519 release key pair securely; store private key outside public/service-readable paths and commit only the public key catalog.**
- [ ] **Step 5: Build Windows CI release containing the pairing timestamp fix plus updater/installer, then publish it as a beta/UAT release to the VPS.**
- [ ] **Step 6: Verify from an external HTTPS request that installer, manifest, signature, full package, and update-check endpoint are reachable and internally consistent.**
- [ ] **Step 7: Run clean-machine UAT: install once, pair, detect newer test version, download while live state is simulated, confirm install is blocked until safe, update successfully, then publish a deliberately unhealthy test build and prove automatic rollback.**
- [ ] **Step 8: Promote the proven build to stable and document release/rollback operations.**
- [ ] **Step 9: Commit `docs(update-hub): document Lightworld desktop release operations`.**

---

## Final Verification

- [ ] `pnpm --dir apps/update-hub test`
- [ ] `pnpm --dir apps/update-hub build` or TypeScript compile command defined by Task 1.
- [ ] Edge updater client tests green on Windows CI.
- [ ] Edge helper tests green on Windows CI.
- [ ] Existing Edge Core/Desktop/Windows tests green.
- [ ] Windows installer packaging self-test green.
- [ ] `nginx -t` green on VPS.
- [ ] `systemctl is-active lightworld-update-hub` returns active.
- [ ] HTTPS `/health` and update check work through Cloudflare.
- [ ] Range request returns `206 Partial Content` for a published package.
- [ ] Tampered manifest/package tests are rejected.
- [ ] Safe-restart tests prove no live interruption.
- [ ] Rollback UAT proves the previous version is restored after failed post-update health.
- [ ] Pairing/enrollment works in the installed corrected build.
- [ ] No private signing key, admin token, product key, bearer credential, or customer content appears in repository history, public storage, package scan, or logs.
