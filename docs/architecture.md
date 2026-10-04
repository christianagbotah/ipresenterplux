# iPresenterPlux architecture

## Design rule

iPresenterPlux is the source of truth. Third-party presentation and broadcast software are optional adapters, never hard dependencies.

## Major runtime planes

### 1. Control plane

The web control plane runs on the VPS and owns:

- organizations/campuses;
- service lifecycle;
- presentation queue;
- scripture detections;
- output configuration;
- language-channel configuration;
- integrations;
- audit events;
- future users/RBAC/licensing.

Current implementation: Next.js + TypeScript + PostgreSQL.

### 2. Church Edge Agent

A Windows-native edge application will run on the church production computer.

Responsibilities:

- capture clean mixer audio through WASAPI/audio interfaces;
- capture camera/screen/NDI sources;
- local low-latency ASR and cloud-ASR fallback;
- media encode/decode with FFmpeg/native codecs;
- local Program and Stage outputs;
- NDI/SRT/RTMP/WebRTC media transport;
- optional EasyWorship/ProPresenter/OBS/vMix control adapters;
- PTZ/ATEM integration;
- buffering during Internet instability;
- offline-first service continuity.

The Edge Agent must continue projector/program operation even when the cloud connection is unavailable.

### 3. AI plane

AI services are independent workers behind stable contracts:

- streaming speech recognition;
- deterministic scripture reference recognition;
- quotation/semantic scripture matching;
- speaker diarization and service-mode awareness;
- live captioning;
- multilingual text translation;
- multilingual TTS;
- authorized speaker-preserving voice conversion;
- AI camera/scene recommendations;
- sermon summarization, chapters, clips and metadata;
- post-service archive search.

Human approval remains the default for actions that alter the live Program output.

### 4. Media plane

The media plane transports live audio/video without routing frames through ordinary web APIs.

Preferred transports by use case:

- NDI for local production networks;
- WebRTC for low-latency browser/mobile viewing;
- SRT for resilient contribution links;
- RTMP/RTMPS for social ingest compatibility;
- HLS for scalable delayed playback;
- local HDMI/display output from the Edge Agent.

### 5. Audience plane

The first audience client is a PWA reachable by QR code.

It will support:

- live program video;
- original audio;
- selectable translation channels;
- captions;
- currently referenced scripture;
- sermon notes/bookmarks;
- prayer/response forms;
- future giving, event registration and member sign-in.

On-site audiences should prefer the church LAN when possible, reducing external bandwidth and latency.

### 6. Church-management plane

This is intentionally a later module on the same tenancy/RBAC foundation:

- members and households;
- attendance/check-in;
- groups and ministries;
- pastors and pastoral care;
- tithes, offerings, pledges and finance;
- welfare;
- events;
- volunteer scheduling;
- communications;
- archives and church analytics.

Sensitive pastoral, financial and welfare data must be permission-separated from ordinary media/operator roles.

## Data tenancy

The current schema starts with organization and campus ownership so a future deployment can support:

```text
Organization / denomination
└── Region (future)
    └── District (future)
        └── Campus / church
            └── Service
```

No media volunteer should receive automatic access to future membership or financial records merely because both live in iPresenterPlux.

## Streaming topology

```text
Mixer / Cameras
      │
      ▼
Church Edge Agent
      ├── Local Projector / Stage
      ├── NDI / OBS / vMix / EasyWorship adapters
      ├── WebRTC audience gateway
      └── Master contribution stream
                  │
                  ▼
             Stream Router
        ┌─────────┼─────────┐
        ▼         ▼         ▼
     YouTube   Facebook   TikTok
        └──── Custom RTMP/SRT targets
```

One encoded master stream should be reused whenever platform requirements permit, rather than re-encoding independently for every destination.

## Reliability principles

- presentation must not depend on Internet availability;
- local recording continues if external streaming fails;
- cloud credentials remain server-side/securely stored;
- all live-output state changes are auditable;
- destination failure is isolated from other destinations;
- media and AI work is asynchronous from the UI request path;
- secrets are never placed in presentation content or browser bundles.
