# iPresenterPlux Engineering Instructions

## Product
iPresenterPlux is an AI-native church presentation, broadcast, interpretation, audience-engagement and future church-management platform.

## Architecture
- Cloud/control plane: Next.js + TypeScript + React + PostgreSQL + Redis.
- Shared desktop Edge Core: C# / .NET 10.
- Windows Edge: WASAPI, Windows Graphics Capture, Media Foundation/FFmpeg, NDI and native display/device adapters.
- macOS Edge: shared .NET core plus a Swift native media bridge using CoreAudio, AVFoundation, ScreenCaptureKit and VideoToolbox.
- AI services: Python workers behind stable contracts.
- Audience: PWA/WebRTC first; native iOS/iPadOS and Android later.
- Media: NDI on LAN, WebRTC for low-latency audience delivery, SRT for resilient contribution, RTMP/RTMPS for social ingest, HLS where delayed scalable playback is appropriate.

## Non-negotiable rules
1. iPresenterPlux must remain fully functional without EasyWorship, OBS, vMix or ProPresenter. Those are optional adapters.
2. Live Program output is human-approved by default. AI may recommend or auto-preview, but must not silently take content live unless an explicit future mode permits it.
3. Presentation and local recording must continue when Internet connectivity fails.
4. Windows and macOS share service logic and contracts. Only hardware/media primitives should be platform-specific.
5. Do not place secrets, stream keys, passwords, OAuth tokens or device credentials in source, logs, browser bundles or test fixtures.
6. Keep tenant/organization boundaries explicit. Media roles must not automatically gain future finance, welfare or pastoral-record access.
7. All live-control mutations must be authenticated, RBAC-authorized and auditable.
8. Prefer additive migrations and preserve existing data.
9. Never weaken security or production safeguards just to make tests pass.
10. Preserve concurrent work. Inspect git status/diff before editing and do not overwrite unrelated changes.

## Current implementation
- VPS project: /home/lightworld/webapps/ipresenterplux
- Control app: apps/control
- Edge agent: apps/edge-agent
- PostgreSQL database: lightworld_iplux
- Redis: local service for realtime events
- Control service: ipresenterplux.service
- Local control port: 127.0.0.1:3011

## Validation
For control-plane changes:
- run database migrations when applicable;
- run pnpm lint;
- run pnpm build;
- verify health and relevant API behavior;
- verify unauthenticated control mutations remain blocked.

For Edge changes:
- keep iPresenterPlux.Edge.Core platform-neutral;
- build Windows code on Windows CI;
- build macOS + Swift bridge on macOS CI;
- add tests around shared contracts before adding hardware-specific behavior.

## Git workflow
- Work in focused commits.
- Prefer isolated worktrees/branches for parallel Codex tasks.
- Do not push broken main.
- Include tests or explicit verification with behavior changes.
