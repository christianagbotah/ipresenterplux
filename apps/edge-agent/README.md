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
including organization and optional campus. The control plane now exposes pairing, enrollment, rotation and revocation endpoints,
and the desktop adapters use Windows Credential Manager or macOS Keychain for secret
material. Pairing codes and credential material must never be logged, serialized into
diagnostics, or retained in event queues.
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

`InMemoryOutboundEventQueue` remains the synchronized reference implementation for
tests and prototyping. `FileOutboundEventQueue` is the first restart-safe production
adapter and persists attempts, leases, retry times, acknowledgements and recent
tombstones using atomic file replacement. It is intentionally single-process; a
future SQLite adapter can replace it if field deployments require multi-process
locking or stronger power-loss journaling. Queue failures must never interrupt local
presentation or recording. Transport delivery carries at-least-once semantics, so
the control plane must deduplicate stable Edge event IDs.

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
## Offline outbound event durability

`FileOutboundEventQueue` is the dependency-free durable queue for the first desktop runtime. It stores transcript, health and media events in the platform host's per-user application-data directory and preserves enqueue order, claim leases, retries, acknowledgements and recent delivered-ID tombstones across normal process restarts. State updates are flushed to a same-directory temporary file before replacement so a process crash does not intentionally truncate the last complete state.

The queue is deliberately a **single Edge-Agent writer**. Platform installers must protect its application-data directory with the logged-in user's normal OS file permissions. It is not a database and does not claim multi-process locking or power-loss journaling. If those requirements appear in field deployments, the `IOutboundEventQueue` contract allows a SQLite adapter without changing capture or transport code.

The dispatcher provides at-least-once delivery. Control-plane ingestion is now durably idempotent through `edge_event_receipts`: every transcript, health and media event carries its stable Edge event ID, and the receipt plus database effect commit in the same transaction. An identical retry is a successful no-op; reusing an event ID with different normalized content is rejected. Receipt rows are retained until an explicit future retention policy is introduced, so server deduplication does not expire before local queue tombstones.

## Protected device identity and credentials

`DeviceEnrollmentManager` owns the shared enroll → rotate → revoke state machine. A successful enrollment persists only non-secret `AgentIdentity` metadata to `FileAgentIdentityStore`; secret bearer material is committed through `IDeviceCredentialStore`. Rotation validates the returned tenant/device and replacement chain before compare-and-swap persistence, and the control plane keeps the prior credential usable only for its short rotation grace window. Revocation replaces local secret material with a metadata-only tombstone.

Windows uses Generic Credentials in Windows Credential Manager scoped by organization/device. macOS uses a Generic Password item in Keychain with `AfterFirstUnlockThisDeviceOnly`, so credentials do not migrate to another Mac. Both adapters zero temporary managed/native buffers where practical. These stores assume the production host enforces one running Edge Agent instance per user profile; multi-process compare-and-swap is not claimed.

## Headless runtime host

The Windows and macOS projects are now executable Edge hosts. They require `IPRESENTERPLUX_CONTROL_URL`; remote control-plane URLs must use HTTPS, while plain HTTP is accepted only for loopback development. The hosts use the normal per-user application-data directory unless `IPRESENTERPLUX_DATA_DIR` is set. On first launch only, a short-lived pairing code may be supplied through `IPRESENTERPLUX_PAIRING_CODE` or entered interactively; it is never persisted. Subsequent launches recover non-secret identity metadata from disk and the bearer credential from Windows Credential Manager or macOS Keychain. A production default URL should only be baked into signed installers after the public DNS record is live.

The shared `EdgeAgentRuntime` rotates credentials three days before expiry, emits a heartbeat every 15 seconds, writes it to the durable queue first, then flushes up to 100 queued transcript/health/media events. Temporary network or rotation failures mark the runtime degraded without deleting queued work. A missing, revoked or already-expired credential stops authenticated operation and requires re-pairing. The headless host is the service/runtime foundation; the production operator UI will sit on top of the same runtime rather than replace it.

## Recoverable enrollment and rotation

The control plane keeps newly issued Edge credential material only as AES-256-GCM recovery ciphertext for a ten-minute handoff window. Enrollment recovery is bound to the exact consumed pairing record; rotation recovery is bound to the exact previous credential through `replaces_credential_id`. Retrying after a lost HTTP response returns the same new credential rather than minting another one. The first successful authentication with that new credential clears its recovery ciphertext and, for rotations, immediately revokes the old grace credential. This prevents a lost response or process restart from forcing a healthy device into re-pairing while still minimizing the period in which two credentials can authenticate.

## Windows mixer/audio capture

Windows audio input is implemented through stable `NAudio.Wasapi` 3.1.0 (MIT). `WindowsWasapiAudioCaptureService` enumerates active WASAPI capture endpoints, identifies the multimedia default, captures in event-driven shared mode with a 50 ms buffer, and copies every NAudio callback buffer before publishing `AudioFrame` because NAudio owns and reuses the callback memory. The shared frame contract now distinguishes integer PCM from IEEE float samples, and `AudioLevelMeter` computes RMS dB for 16/24/32-bit PCM and 32-bit float. This keeps mixer metering and later ASR normalization format-correct.

## macOS mixer/audio capture

The macOS Swift bridge API v3 now provides real system-default audio capture through `AVAudioEngine`. The bridge exposes only the device it can start reliably today, reports its AVFoundation identity and native sample rate/channel count, interleaves native Float32 or Int16 channel buffers, and calls the .NET host through a stable C callback. `MacOSAudioCaptureService` immediately copies the native callback buffer before raising the shared `AudioFrameCaptured` event. Arbitrary non-default macOS input switching is intentionally deferred until this baseline is compiled and exercised on macOS CI/hardware; users can select the desired church mixer as the macOS system input in the meantime.

## Speech normalization and ASR handoff

The Edge runtime now has a provider-neutral speech pipeline. Captured Float32 or 16/24/32-bit integer PCM is downmixed to mono and streaming-resampled to 16 kHz PCM16, then buffered into five-second speech chunks on a bounded background channel so the realtime audio callback is never blocked by inference. If the channel is saturated the pipeline counts dropped frames instead of stalling audio capture. `IPRESENTERPLUX_ASR_URL` enables `HttpSpeechRecognitionEngine`, which posts `pcm_s16le_mono` chunks to `/v1/transcribe`; optional `IPRESENTERPLUX_ASR_TOKEN` is moved into the HTTP Authorization header and removed from the process environment. Plain HTTP is accepted only for loopback workers; remote ASR workers must use HTTPS. When no ASR URL is configured, live capture/metering continues without transcription. Successful ASR text is converted into the existing durable transcript event, with no service ID required—the control plane resolves the device-scoped current live/ready service.
## ASR resilience and silence gating

The speech pipeline is deliberately isolated from realtime capture. Audio callbacks only submit frames to a bounded channel; if inference falls behind, frames are counted as dropped instead of blocking the mixer/capture thread. Each five-second normalized PCM16 chunk is inspected in 200 ms windows. At least two windows at or above -50 dBFS RMS are required before local Whisper inference; otherwise the chunk is counted as silence and skipped. This preserves short spoken phrases while rejecting prolonged silence and isolated energy bursts. The gate is deliberately provider-neutral and can later be augmented with a dedicated VAD without changing capture or recognition contracts.

Recognition/network exceptions no longer terminate the transcription worker. The worker records consecutive/total failures and uses bounded exponential backoff while audio capture, presentation and local service continuity remain alive. Transcript persistence failures are tracked separately from recognition failures, and enqueue retries reuse one stable Edge event ID so server deduplication remains valid. Media telemetry reports capture level, dropped frames, recognized/delivered/silent/failed chunks, separate ASR and delivery states, and the last successful ASR timestamp. Only allowlisted error codes cross the control-plane boundary. Capture health and ASR health are intentionally separate so a healthy mixer is not shown as offline merely because speech inference is unavailable.
## Local ASR worker supervision

When the configured speech engine supports `ISpeechRecognitionHealthProbe`, the shared Edge runtime probes the local worker once per heartbeat with a two-second budget. Worker reachability is independent from inference health and transcript persistence: telemetry reports `Worker`, `ASR`, and `Delivery` separately. A dead or hung worker therefore becomes `offline` without blocking mixer capture, presentation, recording, heartbeat delivery, or queued events. The health adapter exports only bounded safe tokens (worker version, engine, device class and model-loaded state); configured model paths and arbitrary worker diagnostics are never forwarded to the control plane.

## Authenticated control-command channel

The control plane now persists operator-issued Edge commands in `edge_control_commands` and delivers them only to the enrolled target device using its bearer credential. Commands are tenant/device scoped, expire automatically, retain a stable command ID across redelivery, and require an authoritative Edge acknowledgement. Issuance and completion are written to the organization audit trail.

`HttpEdgeCommandClient` implements the shared `IControlPlaneCommandStream` contract. The first transport is credential-authenticated HTTP polling so the command semantics are testable and restart-safe at the server before a later WebSocket/gRPC transport replaces the wire mechanism. `EdgeAgentRuntime` runs the receiver independently of heartbeat/transcript delivery; command-channel network failures mark connectivity degraded without stopping local presentation or audio capture.

`ControlCommandProcessor` enforces the currently assigned service before executing service-scoped commands. `health.query` works without an output adapter. Preview/Program/output commands execute only when an `IMediaOutputService` implementation is injected; unsupported recording/stream/scene/language commands fail closed until their local adapters exist. During one agent process, repeated delivery of the same command ID reuses the prior result rather than re-executing it. A durable local completed-command journal must be added before non-idempotent hardware/media mutations are enabled for production.

## Local Program output and projector kiosk

The Edge host now owns a dependency-free local Preview/Program renderer. By default it listens only on loopback at `http://127.0.0.1:49321`; it is never exposed on the church LAN. Preview and Program content is persisted atomically under the normal Edge application-data directory so the last live scripture can recover after an Edge restart or an Internet outage. When the control plane later reports a different or empty service assignment, stale content from the old service is cleared before new commands are accepted.

Interactive Windows and macOS launches automatically try to open the local Program URL in a dedicated Chromium-family kiosk session. Background/service hosts do not auto-open a display unless explicitly enabled. Supported configuration:

- `IPRESENTERPLUX_PROGRAM_PORT` — loopback renderer port, default `49321`.
- `IPRESENTERPLUX_PROGRAM_AUTO_OPEN` — `true/false`, `yes/no`, `on/off`, or `1/0`.
- `IPRESENTERPLUX_PROGRAM_BROWSER_PATH` — optional absolute Edge/Chrome/Chromium/Brave executable override.
- `IPRESENTERPLUX_PROGRAM_POSITION` — optional `x,y` projector origin; negative coordinates are allowed for displays left/above the primary monitor.
- `IPRESENTERPLUX_PROGRAM_SIZE` — optional `width,height`; requires a position.

Windows searches common Microsoft Edge and Google Chrome install locations. macOS searches Google Chrome, Microsoft Edge, Brave and Chromium under `/Applications`. The kiosk uses its own browser profile inside the Edge data directory so an already-open personal browser session cannot absorb the projector process. If no supported Chromium browser is found, the Edge host keeps the renderer alive and prints the loopback Program URL for manual opening instead of failing the service.
