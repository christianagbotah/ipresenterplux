# YouTube provider health connection

iPresenterPlux keeps three broadcast truths separate:

1. **Master contribution** — Edge SRT reaches MediaMTX.
2. **Destination transport** — FFmpeg/RTMPS is actively sending to YouTube.
3. **Provider confirmation** — YouTube's API confirms it is receiving the configured stream and, separately, whether a bound broadcast is actually live to viewers.

A successful RTMPS connection never becomes a provider-confirmed live claim on its own.

## Google Cloud setup

Create a Google OAuth 2.0 **Web application** client for the iPresenterPlux deployment and enable the YouTube Data API v3 / Live Streaming API access needed by the project.

Use this exact authorized redirect URI for production:

```text
https://ipresenterplux.lightworldtech.com/api/v1/provider/youtube/oauth/callback
```

iPresenterPlux requests only:

```text
https://www.googleapis.com/auth/youtube.readonly
```

This is sufficient for `liveStreams.list` and `liveBroadcasts.list`. Offline access is requested so the server can refresh an access token while a broadcast is running without asking the operator to sign in again.

## Required runtime variables

Control plane (`apps/control/.env.local`):

```text
IPRESENTERPLUX_PUBLIC_BASE_URL=https://ipresenterplux.lightworldtech.com
IPRESENTERPLUX_PROVIDER_SECRET_KEY=<32-byte base64url or 64-char hex key>
IPRESENTERPLUX_GOOGLE_OAUTH_CLIENT_ID=<google web client id>
IPRESENTERPLUX_GOOGLE_OAUTH_CLIENT_SECRET=<google web client secret>
```

MediaMTX/fan-out runtime (`config/.env.runtime`):

```text
IPRESENTERPLUX_PROVIDER_SECRET_KEY=<same provider encryption key>
IPRESENTERPLUX_GOOGLE_OAUTH_CLIENT_ID=<same google web client id>
IPRESENTERPLUX_GOOGLE_OAUTH_CLIENT_SECRET=<same google web client secret>
```

The provider encryption key must be identical in both runtimes. The Google client secret, refresh token, access token, stream key and raw provider API responses must never be committed to Git, written to audit payloads or emitted to logs.

After changing runtime variables, restart both services:

```bash
sudo systemctl restart ipresenterplux.service
sudo systemctl restart ipresenterplux-mediamtx.service
```

## Operator flow

1. Configure the YouTube RTMPS ingest URL and stream key in Streaming Studio.
2. Select **Link YouTube** and complete Google's consent screen.
3. Start Broadcast.
4. iPresenterPlux maps the configured stream key to the authenticated channel's YouTube live-stream resource on the server only. The stream key is never returned to the browser.
5. While that destination/session is active, the fan-out worker polls provider evidence with bounded backoff.

The UI can then show independently:

- `RTMPS live`
- `Provider receiving · healthy/warning/error`
- `Provider live · healthy/warning/error` only when the bound YouTube broadcast lifecycle is actually `live`

## Failure behavior

- OAuth/API failure degrades provider evidence only.
- Provider quota responses back off more aggressively.
- RTMPS fan-out continues independently.
- Another destination continues independently.
- Local Program and local recording are not coupled to provider polling.
- Provider polling stops when the authoritative stream session ends.
