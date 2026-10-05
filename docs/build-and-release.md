# Build and release model

GitHub is the intended source of truth for iPresenterPlux. Production services run on the VPS, but compilation and platform validation should happen in CI.

## CI responsibilities

- **Control Portal CI**: Node 22 + pnpm, lint, scripture/transcript self-tests, production Next.js build.
- **Edge Agent CI / Windows**: .NET 10 restore, shared-core tests, Windows adapter build, portable Windows artifact upload.
- **Edge Agent CI / macOS**: .NET 10 restore, shared-core tests, macOS adapter build, Swift media-bridge build, portable macOS artifact upload.
- **Mobile CI**: TypeScript validation plus Android and iOS native debug builds.
- **ASR Worker CI**: Python compile and contract tests.

## Deployment rule

The VPS is a runtime/deployment target, not the authoritative build workstation. A production deployment should consume a tested commit/artifact rather than repeatedly compiling native clients on the server.

## Desktop packaging roadmap

The current Windows/macOS artifacts are CI validation packages. Public installers add these gates before release:

1. Windows installer packaging and Authenticode signing.
2. macOS `.app`/DMG packaging, code signing, hardened runtime, entitlements and notarization.
3. Release manifest with SHA-256 checksums.
4. In-app update channel with signed manifests and staged rollout.

No production signing key, stream key, OAuth token or device credential belongs in the repository or build logs.
