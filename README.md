# iPresenterPlux

iPresenterPlux is Lightworld Technologies' AI-native church presentation, broadcast, interpretation and audience-engagement platform.

The product is designed to operate independently and optionally feed or interoperate with EasyWorship, OBS, vMix, ProPresenter, NDI, social-live platforms and other production systems.

## Current foundation — v0.1.0

The running VPS foundation currently includes:

- Next.js/TypeScript/Tailwind control plane.
- PostgreSQL multi-tenant-ready domain model.
- Presentation service/session foundation.
- Preview and Program operator surfaces.
- Deterministic live scripture-reference detection.
- Transcript ingestion API.
- Scripture detection queue persisted in PostgreSQL.
- Livestream-destination model for YouTube, Facebook, TikTok, Church Web and NDI.
- Audience language-channel model for original audio, captions and translations.
- Integration registry for EasyWorship, OBS/vMix, ProPresenter and NDI.
- Audit-event foundation.
- Persistent systemd service on local port 3011.
- Webuzo/Nginx reverse-proxy configuration for ipresenterplux.lightworldtech.com.

## Project layout

```text
ipresenterplux/
├── apps/
│   └── control/           # Operator console + HTTP APIs
│       ├── db/            # SQL migrations
│       ├── scripts/       # Migration/maintenance scripts
│       └── src/
│           ├── app/       # Next.js UI and APIs
│           ├── components/
│           └── lib/
├── docs/
│   ├── architecture.md
│   └── agent-protocol.md
└── package.json
```

## VPS runtime

- Service: `ipresenterplux.service`
- App path: `/home/lightworld/webapps/ipresenterplux`
- Control plane: `127.0.0.1:3011`
- PostgreSQL database: `lightworld_iplux`
- Public hostname planned: `ipresenterplux.lightworldtech.com`

The application listens only on loopback. Nginx is the public-facing reverse proxy.

## Development

```bash
cd /home/lightworld/webapps/ipresenterplux/apps/control
pnpm install
pnpm db:migrate
pnpm dev
```

## Production

GitHub `main` is deployed by the VPS-side pull deployer. A one-minute systemd timer accepts fast-forwards only, validates a candidate Control Plane build and migrations as `lightworld`, swaps only the Control Plane build/runtime dependencies, and requires both local and public health checks. Failed swap/restart/health gates restore the prior code/build SHA automatically.

```bash
systemctl status ipresenterplux-deploy.timer --no-pager
cat /home/lightworld/deployments/ipresenterplux/last_successful_sha
curl -fsS http://127.0.0.1:3011/api/v1/health
```

See `docs/vps-pull-deployer.md` for installation, rollback, audit and recovery details.

## Current APIs

### Health

`GET /api/v1/health`

### Transcript ingestion

`POST /api/v1/ai/transcript`

Example payload:

```json
{
  "text": "Turn with me to John chapter 3 verse 16."
}
```

The API currently performs deterministic reference recognition and stores detections for the active/ready service. Semantic quotation matching and streaming ASR are separate upcoming AI layers.

## Product direction

Major modules are:

- Present — scriptures, songs, media, slides, announcements, lower thirds and stage output.
- AI — ASR, scripture intelligence, translation, captions, sermon intelligence and AI Director.
- Live — cameras, mixer audio, scenes, recording, multistreaming and health telemetry.
- Audience — QR/PWA joining, live video, captions, translations, scripture and engagement.
- Connect — EasyWorship, OBS, vMix, ProPresenter, NDI, ATEM and external outputs.
- Archive — recordings, searchable transcripts, scriptures, summaries and clips.
- Church — future membership, attendance, finance, giving, welfare, groups, pastoral care and events.

See `docs/architecture.md` for the system boundary and `docs/agent-protocol.md` for the local Windows-agent contract.
