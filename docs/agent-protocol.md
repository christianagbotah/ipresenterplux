# Church Edge Agent protocol

This document defines the initial contract between the future Windows Church Edge Agent and the iPresenterPlux control plane.

## Current implemented endpoint

### Transcript ingestion

`POST /api/v1/ai/transcript`

Request:

```json
{
  "serviceId": "optional-service-uuid",
  "text": "Turn with me to John chapter 3 verse 16.",
  "bibleVersion": "optional-version"
}
```

Current processing:

1. Resolve the supplied service, or latest live/ready service.
2. Run deterministic scripture-reference recognition.
3. De-duplicate the same reference inside a short window.
4. Persist each detection to PostgreSQL.
5. Return inserted detection IDs/references/confidence.

The current endpoint is useful for development and integration testing. Production streaming ASR will use a persistent event transport instead of one HTTP request per tiny audio segment.

## Planned Edge Agent identity

Each agent will have:

- organization ID;
- campus ID;
- unique device ID;
- human-readable device name;
- signed device credential;
- capabilities manifest;
- last-seen and software-version telemetry.

A church administrator explicitly enrolls an agent before it can publish service events.

## Planned event channel

WebSocket or gRPC streaming will carry compact events such as:

```json
{
  "type": "transcript.partial",
  "serviceId": "...",
  "speakerId": "...",
  "sequence": 10241,
  "startedAt": "...",
  "text": "...",
  "isFinal": false
}
```

Other event families:

- `transcript.final`
- `scripture.detected`
- `audio.level`
- `media.source.status`
- `program.changed`
- `stream.health`
- `stream.destination.status`
- `agent.health`

## Control commands

The cloud/control plane may request actions, subject to local authorization:

- prepare item in Preview;
- take Preview to Program;
- clear Program;
- select scene;
- start/stop recording;
- start/stop stream destinations;
- change language-channel state;
- query device/source health.

The Edge Agent always acknowledges a command with success/failure plus the authoritative resulting state.

## Media is not sent through ordinary JSON APIs

Audio/video uses dedicated media transports:

- NDI inside LAN;
- WebRTC to browsers/PWA;
- SRT for contribution/failover;
- RTMP/RTMPS for platform ingest;
- local device APIs for display/audio.

JSON/WebSocket/gRPC channels carry metadata and control only.

## Security target

Before production church deployment:

- per-device enrollment;
- short-lived tokens or mTLS;
- replay-resistant commands;
- organization/campus authorization;
- secret rotation/revocation;
- command audit trail;
- rate limiting;
- signed software updates;
- local credential storage using Windows-protected storage.

## Offline behavior

If cloud connectivity disappears, the Edge Agent keeps:

- presentation outputs;
- scripture library/cache;
- local media playback;
- local recording;
- local audience delivery where available.

It queues appropriate telemetry/events and reconciles state after connectivity returns.
