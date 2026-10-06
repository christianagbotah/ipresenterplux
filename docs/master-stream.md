# iPresenterPlux master-stream architecture

## Product truth

A configured or enabled destination is not a live broadcast. A stream may be shown as live only after an Edge master-stream publisher is running and the transport/router reports authoritative state.

The first shared Edge contract is `IMasterStreamPublisher`. `stream.start` and `stream.stop` are recognized by the shared command processor, but production hosts intentionally return `stream_unavailable` until a real Windows/macOS publisher is injected.

## Target flow

```text
Program video source + mixer audio
              |
              v
      Edge master encoder
              |
       one contribution stream
              |
              v
      iPresenterPlux router
       /       |        \
 YouTube   Facebook   TikTok ...
```

Reuse one encoded master stream whenever destination requirements permit. Platform fan-out belongs in the router, not in the presentation UI and not as one independent encoder per social destination.

## Shared lifecycle

`IMasterStreamPublisher` owns:

- start for one assigned service;
- stop;
- active-service reconciliation;
- bounded, non-secret state/metrics.

Its status may expose publisher state, service ID, bitrate, frames per second, dropped frames, reconnect count, last successful send, and an allowlisted error code. It must never expose stream keys, OAuth credentials, raw contribution tokens, or full authenticated URLs.

The durable completed-command journal remains outside the publisher and must persist a command result before Edge acknowledgement. This prevents normal restart redelivery after a completed command, but cannot by itself guarantee exactly-once hardware/network side effects across the crash window between starting an external encoder and persisting the result. Publisher implementations should therefore make start/stop idempotent for the same service wherever possible.

## Required platform implementations

### Windows

Preferred primitives:

- Program frames from a native/shared render path or Windows Graphics Capture;
- Media Foundation hardware H.264/HEVC where supported;
- vetted bundled FFmpeg fallback where native support is insufficient;
- mixer audio integrated without blocking the capture callback, ASR, or local recording.

### macOS

Preferred primitives:

- Program frames from a native/shared render path or ScreenCaptureKit;
- VideoToolbox hardware encoding;
- vetted bundled FFmpeg fallback where native support is insufficient;
- mixer audio integrated without blocking CoreAudio, ASR, or local recording.

The long-term renderer should prefer a direct frame-producing Program pipeline over repeatedly screen-capturing a browser window. Screen/window capture is acceptable as an intermediate compatibility adapter, not as the architectural source of truth.

## Contribution and secrets

The Edge Agent should request a short-lived, device/service-scoped contribution configuration from an authenticated Edge-only control endpoint. Social destination credentials remain server-side and are consumed by the stream router.

Never put secrets in:

- browser payloads;
- `edge_control_commands.arguments`;
- audit details;
- health telemetry;
- application logs;
- test fixtures/snapshots;
- source-controlled environment files.

SRT is preferred for resilient contribution when the router supports it. RTMP/RTMPS or WHIP may be used where topology or interoperability requires them.

## Failure model

- Internet publishing failure must not stop local Program/projector output.
- Internet publishing failure must not stop local recording.
- One destination failure must not stop healthy destinations.
- Service reassignment must stop or reconcile a publisher for the old service before accepting a new start.
- A publisher that cannot confirm a usable media source/encoder must fail closed.
- `Start Broadcast` in the web UI remains locked until a real publisher is wired into the production Edge hosts and router state is realtime-authoritative.
