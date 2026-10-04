# iPresenterPlux Church Edge Agent

The Edge Agent is the on-premise production runtime for iPresenterPlux.

## Supported desktop targets

| Capability | Windows | macOS |
| --- | --- | --- |
| Shared orchestration | .NET 10 | .NET 10 |
| Mixer / microphone input | WASAPI | CoreAudio |
| Camera input | Media Foundation / vendor SDK | AVFoundation |
| Screen/window capture | Windows Graphics Capture | ScreenCaptureKit |
| Hardware encoding | Media Foundation / FFmpeg | VideoToolbox / FFmpeg |
| Program/Stage display | Native Windows graphics | AppKit / Metal |
| NDI | NDI SDK adapter | NDI SDK adapter |
| OBS/vMix/production integration | Local adapters / NDI | OBS / NDI / local adapters |
| PTZ / ATEM | Network/vendor adapters | Network/vendor adapters |
| Local recording | FFmpeg/native codecs | FFmpeg/VideoToolbox |
| Cloud/control protocol | Shared | Shared |
| Offline service continuity | Shared | Shared |

## Source layout

- `iPresenterPlux.Edge.Core` — platform-neutral service state, contracts, control-plane protocol, queues and orchestration.
- `iPresenterPlux.Edge.Windows` — Windows-specific capture/output/device adapters.
- `iPresenterPlux.Edge.MacOS` — .NET-facing macOS platform adapters.
- `native/macos/iPresenterPlux.MediaBridge` — Swift bridge for Apple media frameworks.

## Architecture rule

Presentation logic, scripture state, service state, AI event contracts, command semantics and offline reconciliation must never be implemented separately per operating system.

Only hardware/media primitives are platform-specific.

That keeps Windows and macOS behavior consistent while allowing each operating system to use its best native APIs.

## Planned shared desktop shell

The production operator shell will use a shared .NET cross-platform UI layer, with native platform services injected underneath it. Media frames do not pass through the cloud UI.

## Apple Silicon

macOS releases will ship for Apple Silicon (`osx-arm64`) first and retain an `osx-x64` build while Intel support remains worthwhile.

## Permissions

The macOS edition will explicitly request and explain only the permissions required for enabled features:

- Microphone/audio input
- Camera
- Screen Recording
- Local Network, when needed for NDI/PTZ/ATEM/device discovery

Permission denial must degrade only the affected capability, not crash the service presentation workflow.

## Shared foundation and validation

`iPresenterPlux.Edge.sln` includes Core, Windows, macOS and the platform-neutral
`tests/iPresenterPlux.Edge.Core.Tests` project (xUnit). From this directory:

```sh
dotnet restore iPresenterPlux.Edge.sln
dotnet build iPresenterPlux.Edge.sln -c Release --no-restore
dotnet test tests/iPresenterPlux.Edge.Core.Tests/iPresenterPlux.Edge.Core.Tests.csproj -c Release --no-build --no-restore
```

CI restores the solution and builds/tests Core on both Windows and macOS. The
Windows job builds the Windows adapter; the macOS job builds the macOS adapter
and Swift bridge. Package compatibility and .NET 10 compilation are validated
by CI; .NET is intentionally not installed on the VPS.

### Enrollment and credential lifecycle

`IDeviceEnrollmentClient` describes one-time, short-lived pairing-code exchange,
rotation and revocation. The control plane assigns the existing `AgentIdentity`,
including organization and optional campus. No server endpoints or credential
vault implementations are included. Pairing codes and credential material must
never be logged, serialized into diagnostics, or retained in event queues.
Sensitive wrappers redact their `ToString`; that does not make arbitrary JSON
serialization safe.

`IDeviceCredentialStore` separates protected material from lifecycle metadata.
Store implementations must scope reads by organization/device, use OS-protected
storage, atomically compare credential IDs during persistence/rotation, and
retain a revoked tombstone while erasing material. Revoked or expired credentials
must not authenticate; `RotationRequired` requests renewal. Rotation must preserve
the assigned device/tenant identity. Remote exchange/revocation and local storage
are separate operations: orchestration must reconcile failures, persist a returned
rotation before switching credentials, and stop authenticated sends on revocation.
The contracts grant no roles or live-control authority.

### Offline outbound events

`IOutboundEventQueue` replaces the unused transcript-only `ILocalServiceStore`.
It carries versioned JSON envelopes for transcript, health and media events,
scoped by organization/device with an optional service ID. Producers serialize
`TranscriptSegment`, `EdgeDeviceHealth` or `MediaSourceState` and retain the same
nonempty event ID across retries. Transcript sequence numbers alone are not
queue identities: they can repeat across services.

Claims are atomic, ordered by enqueue order, bounded, and leased using an explicit
UTC time. Each claim has a new claim ID and incremented attempt count. Only a
current unexpired claim can acknowledge or schedule a retry. At the exact lease
expiry the event becomes eligible again; stale claims return false. Identical
re-enqueues are no-ops, including after acknowledgement; conflicting content
under the same scoped ID is rejected. Delivery is at least once: a receiver must
deduplicate by organization/device/event ID and the sender must acknowledge only
after confirmed acceptance. A lost response can result in repeat delivery.

`InMemoryOutboundEventQueue` is a synchronized reference implementation for tests
and prototyping. It is not restart-safe, has no capacity limit, and retains
acknowledged entries as deduplication tombstones. Before production use, supply a
durable adapter (for example SQLite) with transactional claims, persisted attempts,
leases/retry times and tombstones, and an explicit retention/capacity policy.
Queue failures must not interrupt local presentation or recording. Transport
implementations must carry the envelope ID through delivery; the existing direct
publish contracts alone do not provide receiver deduplication.

### Runtime state parity

`AgentRuntimeState` serializes update functions and publishes copied, read-only
source lists. Failed updates leave the previous snapshot intact. Notifications
run outside the lock after commit; concurrent notifications can arrive out of
order, and subscribers should read `Snapshot` when they need the latest state.
Update functions should be short and free of side effects. Subscriber exceptions
propagate to the caller after state has committed. An injectable `TimeProvider`
allows deterministic timestamp tests. Enrollment, queue and state semantics are
shared on Windows and macOS; only vault, media and hardware primitives belong in
platform adapters. None of these changes authorize automatic Program output.
