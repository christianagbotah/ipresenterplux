# Build and release model

GitHub is the intended source of truth for iPresenterPlux. Production services run on the VPS, but compilation and platform validation should happen in CI.

## CI responsibilities

- **Control Portal CI**: Node 22 + pnpm, lint, scripture/transcript self-tests, production Next.js build.
- **Edge Agent CI / Windows**: .NET 10 restore, shared-core + desktop-shell tests, Windows adapter build, pinned libsrt/SRT smoke, self-contained desktop-shell + Edge-runtime bundle upload.
- **Edge Agent CI / macOS**: .NET 10 restore, shared-core + desktop-shell tests, macOS adapter build, Swift media-bridge build, pinned libsrt/SRT smoke, self-contained desktop-shell + Edge-runtime bundle upload.
- **Mobile CI**: TypeScript validation plus Android and iOS native debug builds.
- **ASR Worker CI**: Python compile and contract tests.

## Deployment rule

The VPS is a runtime/deployment target, not the authoritative build workstation. A production deployment should consume a tested commit/artifact rather than repeatedly compiling native clients on the server.

## Desktop shell and packaging status

Edge CI now produces self-contained **desktop application bundles** for both platforms. Each artifact contains the shared Avalonia shell at its root and the proven platform Edge host under `runtime/`, including pinned libsrt and (on macOS) the native Apple media bridge. These bundles are intended for CI/UAT validation and do not require a separately installed .NET runtime.

They are **not yet public production installers**. Public distribution still requires these gates:

1. Windows installer packaging (MSIX/MSI/appropriate installer), app identity/icon metadata and Authenticode signing.
2. macOS `.app`/DMG packaging, Info.plist permission strings, code signing, hardened runtime, entitlements and notarization.
3. Release manifest with SHA-256 checksums tied to the exact Git commit and platform architecture.
4. In-app update channel with signed manifests, staged rollout and rollback protection.
5. Field UAT on real church mixer/camera/projector hardware before calling either desktop build production-ready.

No production signing key, stream key, OAuth token or device credential belongs in the repository, build logs or release manifest.

No production signing key, stream key, OAuth token or device credential belongs in the repository or build logs.
