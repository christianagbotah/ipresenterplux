# Lightworld Desktop Update Hub Design

Date: 2026-10-21
Status: Design approved in conversation; implementation pending written-spec review
Initial client: iPresenterPlux Edge/Desktop
Owner: Lightworld Technologies Limited

## 1. Purpose

Build a reusable software distribution and automatic-update platform for Lightworld desktop products, hosted at `https://updates.lightworldtech.com` on the Lightworld VPS.

The immediate problem is iPresenterPlux Windows UAT: the current CI produces a self-contained application folder, so every fix requires a full manual download and replacement. The new system must provide a normal Windows installer once, then deliver safe in-app updates with minimal bandwidth and no interruption of live church operations.

The same infrastructure must be reusable by TradeOS, SchoolManager/iEduPro, EAM, and future Lightworld desktop products.

## 2. Success Criteria

The first production slice is successful when:

1. A user installs iPresenterPlux once using `iPresenterPlux-Setup.exe`.
2. The installed application can query the Lightworld Update Hub for the newest compatible version.
3. Updates download in the background with resumable transfers.
4. A live presentation, projection, recording, audience stream, or broadcast is never interrupted by an update.
5. Installation happens only when the application reaches a safe restart point or the user explicitly chooses to restart.
6. The updater verifies HTTPS, a Lightworld-signed release manifest, and package SHA-256 before applying an update.
7. The updater can recover to the previous known-good version if the new version cannot start successfully.
8. The server supports stable and beta channels and can pause or roll back a bad release.
9. The design works before Lightworld purchases a public Windows Authenticode certificate. Public CA signing can be added later without redesign.
10. Other Lightworld desktop applications can reuse the same protocol and updater library.

## 3. Non-Goals for the First Slice

- Purchasing or integrating a commercial Windows code-signing certificate.
- Building a full public software marketplace.
- Peer-to-peer update delivery.
- Mandatory telemetry about customer content or church activity.
- Forcing updates during active work.
- Building macOS auto-update in the first implementation slice, although the protocol must remain platform-neutral.

## 4. High-Level Architecture

The system has four independently testable units:

### 4.1 Update Hub API

A small authenticated server application hosted on the VPS behind Nginx at `updates.lightworldtech.com`.

Responsibilities:

- Return latest compatible release metadata by product, channel, platform, architecture, and current version.
- Serve signed release manifests.
- Record release publication state: draft, beta, stable, paused, withdrawn.
- Support staged rollout percentages.
- Expose authenticated administrative actions for publish, promote, pause, withdraw, and rollback.
- Never hold the Windows Authenticode private key.

### 4.2 Immutable Release Storage

Release files live outside the application source tree under a dedicated filesystem hierarchy. Proposed layout:

```text
/home/lightworld/update-hub/
  app/
  releases/
    ipresenterplux/
      windows/
        x64/
          1.0.0/
          1.0.1/
    tradeos/
    schoolmanager/
    eam/
  manifests/
  deltas/
  logs/
```

Published release objects are immutable. A bad release is withdrawn in metadata rather than overwritten in place.

### 4.3 Shared Lightworld Updater Client

A reusable client library and small helper process used by Lightworld desktop applications.

Responsibilities:

- Query update metadata.
- Verify the signed manifest using an embedded Lightworld public key.
- Download full or delta packages with resume support.
- Verify package SHA-256 and declared size.
- Stage the update without replacing running binaries.
- Ask the host application whether it is safe to restart.
- Launch the update helper only after the host exits.
- Preserve the previous known-good version for rollback.
- Report success/failure locally and optionally to the Update Hub using privacy-preserving installation metadata.

### 4.4 Product Adapter

Each desktop product exposes a very small adapter to the shared updater:

- product id
- current semantic version
- update channel
- platform/architecture
- safe-to-restart state
- user-facing update status

For iPresenterPlux, `safe-to-restart` must be false while any of the following is active:

- live presentation/projection
- recording
- audience stream
- church broadcast/stream contribution
- any critical local program session that would be disrupted by process termination

## 5. Server and Nginx Design

`updates.lightworldtech.com` already exists and is proxied through Cloudflare. The origin is configured by Webuzo/Nginx.

Before application deployment, correct the current origin filesystem traversal problem so the Nginx worker can read only the intended public release paths without broadly opening the Lightworld home directory.

The server layout should separate:

- `/api/v1/...` -> Update Hub application
- `/releases/...` -> immutable release binaries
- `/manifests/...` -> immutable signed manifests
- `/` -> optional Lightworld software downloads/status page

Nginx must support:

- HTTPS only
- byte-range requests for resumable downloads
- long-lived cache headers for versioned immutable binaries
- no-cache or short-cache policy for `latest` metadata
- MIME types for installer/update artifacts
- request size limits appropriate for admin publishing
- access logs separated from application logs

Cloudflare may cache versioned release files but must not cache authenticated administrative endpoints.

## 6. Release Manifest and Trust Model

A release manifest is canonical JSON signed by a Lightworld release-signing private key held outside the public release directory.

Minimum fields:

```json
{
  "schemaVersion": 1,
  "product": "ipresenterplux",
  "version": "1.0.1",
  "channel": "stable",
  "platform": "windows",
  "architecture": "x64",
  "minimumVersion": "1.0.0",
  "publishedAt": "2026-10-21T00:00:00Z",
  "releaseNotes": "...",
  "fullPackage": {
    "url": "https://updates.lightworldtech.com/releases/...",
    "size": 0,
    "sha256": "..."
  },
  "deltaPackages": [],
  "rollout": 100
}
```

The signature is stored alongside the canonical manifest or in a detached signature field with an explicitly versioned signing algorithm.

The desktop updater contains only the public verification key. If the VPS is compromised, an attacker who cannot access the private release-signing key must not be able to create a trusted update.

A future CA-issued Authenticode certificate is an additional Windows trust layer, not a replacement for the Update Hub manifest signature.

## 7. Signing Key Handling Without a Public CA Certificate

For the initial implementation, Lightworld will use an internal release-signing key solely for Update Hub manifest/package trust.

Rules:

- Generate the release-signing key off the public web root.
- Do not commit the private key to Git.
- Do not embed the private key in desktop applications.
- Do not expose the private key through the Update Hub API.
- Prefer an offline/admin-controlled signing environment for stable releases.
- Store only the public verification key in the product/updater source.
- Support public-key rotation by allowing a trusted manifest to introduce a next key, with explicit key ids and an overlap period.

The Windows installer will remain unsigned by a public CA initially, so Windows may show `Unknown publisher` or SmartScreen warnings during first installation. Automatic Update Hub verification remains cryptographically enforced after installation.

## 8. Update Check Flow

1. Product starts normally.
2. After startup settles, updater requests `/api/v1/products/{product}/updates/check` with product version, platform, architecture, and configured channel.
3. Server returns either `no-update` or release metadata plus signed manifest location.
4. Client downloads manifest and signature.
5. Client verifies the Lightworld signature before trusting any URLs or hashes in the manifest.
6. Client selects the smallest supported delta from the installed version; otherwise it chooses the full package.
7. Client downloads into a staging directory using resumable range requests.
8. Client verifies file size and SHA-256.
9. Client marks the release `ready` locally.
10. Product UI shows `Update ready - restart when convenient`.
11. When the host reports a safe restart state and the user accepts, or when the user later closes the app, the update helper applies the staged package.
12. Helper starts the new version with a one-time post-update health token.
13. New version reports healthy startup.
14. Previous version is retained for the configured rollback window, then cleaned up.

## 9. Safety Rules for iPresenterPlux

An update may download during active use, but may not replace files, terminate processes, or reboot/restart while live work is active.

The updater UI must distinguish:

- `Checking for updates`
- `Downloading update`
- `Update ready`
- `Waiting for safe restart`
- `Installing update`
- `Updated successfully`
- `Update failed - restored previous version`

If the control plane is unreachable, presentation and recording functionality must continue. Update failure is non-fatal to core iPresenterPlux operations.

## 10. Rollback and Health Verification

Before replacement, the updater preserves the current installed version or enough content to restore it.

A new version is considered healthy only after:

- process starts successfully
- configuration loads
- local runtime bootstrap completes
- the application writes an explicit post-update health marker within a bounded timeout

If startup fails repeatedly or the health marker is not written, the helper restores the previous version and records a rollback reason.

A withdrawn release must not be offered to new installations. Clients that already downloaded a withdrawn but unapplied release discard it.

## 11. Delta Updates

Delta updates are an optimization, not a prerequisite for correctness.

The first updater may ship with full-package updates while preserving the manifest fields and storage model required for deltas. Delta generation is introduced after the full-package installer/update/rollback path is proven end-to-end.

When enabled:

- deltas are generated between specific source and target versions
- deltas have their own size and SHA-256
- the updater falls back to full package if a delta cannot be applied or verified
- the client never chains an unbounded number of deltas

This sequencing reduces implementation risk while still solving the manual replacement problem immediately.

## 12. Windows Installer

The initial Windows distribution becomes `iPresenterPlux-Setup.exe` rather than a manually extracted CI artifact.

Installer requirements:

- per-machine or per-user install choice selected consistently for iPresenterPlux deployment needs
- Start Menu shortcut
- Add/Remove Programs registration
- uninstall support
- repair/reinstall support
- deterministic install directory
- updater helper installation
- initial update channel defaults to stable
- preserves application configuration and enrollment identity during upgrades
- does not expose secrets in installer logs

Public Authenticode signing is deferred until affordable. The installer design must support adding signing later with no change to update protocol.

## 13. Release Administration

The first admin surface may be API/CLI-driven, but the model must support a future Lightworld admin UI.

Administrative capabilities:

- create draft release
- upload/register artifacts
- verify hashes
- attach release notes
- publish to beta
- promote beta to stable
- set rollout percentage
- pause rollout
- withdraw release
- designate rollback target
- inspect adoption/success/failure counts without collecting customer content

Publishing must be authenticated and auditable.

## 14. Data Model

Minimum persistent entities:

- products
- channels
- releases
- release_artifacts
- release_signatures
- rollout_rules
- release_events/audit_log
- optional anonymous install/update outcome records

Binary payloads stay on the filesystem/object storage path; the database stores metadata and immutable artifact references.

## 15. Versioning and Compatibility

Use semantic versions for product releases.

The server must never offer an update incompatible with the requesting platform/architecture or below the client's current version.

`minimumVersion` allows the server to require a full package when a client is too old for a specific delta/protocol path.

The manifest schema is explicitly versioned so future fields can be added without breaking old clients.

## 16. Failure Handling

- DNS/API unavailable: continue application normally; retry later with backoff.
- Download interrupted: preserve partial file and resume.
- Signature invalid: reject release and never execute it.
- Hash mismatch: delete/quarantine staged artifact and retry from a clean state.
- Disk space insufficient: show a clear non-fatal warning before staging.
- Active live session: keep update staged and wait.
- Update helper fails: keep/restore current version and surface actionable status.
- New version health check fails: automatic rollback.
- Update Hub release is withdrawn: do not install it.

## 17. Privacy

Update requests must not contain presentation content, scripture content, audio/video, credentials, or customer business records.

Permitted operational fields are limited to what is needed for compatibility and release health, such as product id, installed version, platform, architecture, channel, anonymous installation id, and coarse update outcome.

## 18. Testing Strategy

Testing follows TDD for implementation.

Required automated coverage:

- manifest canonicalization/signature verification
- tampered manifest rejection
- tampered package/hash rejection
- compatibility selection
- stable/beta channel selection
- staged rollout decision
- interrupted/resumed download
- full-package update
- delta fallback to full package
- safe-restart gating
- iPresenterPlux live-session interruption prevention
- update helper file swap
- successful post-update health confirmation
- failed health check rollback
- withdrawn release behavior
- preservation of enrollment/configuration
- Nginx range/caching behavior smoke tests

End-to-end Windows UAT must test installation from a clean machine, at least one in-app upgrade, one forced failure/rollback, and an update downloaded while a simulated live session is active.

## 19. Delivery Sequence

Implementation will proceed in this order:

1. Repair `updates.lightworldtech.com` origin permissions and establish secure filesystem layout.
2. Build the minimum Update Hub API and release metadata store.
3. Implement release-signing format and verification library.
4. Build the reusable Lightworld updater client/helper.
5. Build the iPresenterPlux Windows installer.
6. Integrate update status and safe-restart gating into iPresenterPlux.
7. Prove full-package update plus rollback end-to-end on Windows.
8. Add administrative release workflow.
9. Add delta generation/application after full-package reliability is established.
10. Generalize product adapter documentation for TradeOS, SchoolManager/iEduPro, EAM, and future products.
11. Add commercial Authenticode signing later when Lightworld purchases a CA-issued certificate.

## 20. Deployment Boundary

GitHub remains the source repository and CI/build environment where useful. Customer-facing distribution and update delivery come from the Lightworld VPS via `updates.lightworldtech.com`.

CI artifacts are build inputs, not the long-term customer distribution mechanism.

The Update Hub will be designed so the binary storage can later move behind a CDN or object-storage provider without changing the desktop update protocol.

## 21. Acceptance Criteria for the First iPresenterPlux Release

A clean Windows machine can:

1. download `iPresenterPlux-Setup.exe` from Lightworld;
2. install it successfully despite the expected unsigned-publisher warning;
3. enroll/pair and operate normally;
4. detect a newer test release from `updates.lightworldtech.com`;
5. download it in the background;
6. continue projecting/recording/streaming without interruption while the update waits;
7. install when the user reaches a safe restart point;
8. restart into the new version with preserved settings/enrollment;
9. automatically restore the previous version when a deliberately broken update is tested.

Meeting these criteria removes the current manual download-and-replace workflow.