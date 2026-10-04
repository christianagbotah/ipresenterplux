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
