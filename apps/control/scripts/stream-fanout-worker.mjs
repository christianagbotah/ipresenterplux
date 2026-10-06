#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import process from "node:process";
import pg from "pg";
import { createClient } from "redis";
import {
  buildFfmpegArgs,
  buildRtmpsTarget,
  buildRtspSource,
  decryptSecretEnvelope,
  destinationTypeIsFanout,
  normalizeRtmpsIngestUrl
} from "./stream-fanout-core.mjs";
import { fetchYouTubeBroadcastLiveState, fetchYouTubeLiveStreamEvidence } from "./stream-provider-health-core.mjs";
import {
  decryptProviderTokenEnvelope,
  encryptProviderTokenEnvelope,
  findYouTubeStreamIdByKey,
  refreshGoogleAccessToken
} from "./stream-provider-oauth-core.mjs";

process.loadEnvFile?.(".env.local");

const [routerPath] = process.argv.slice(2);
const pathPattern = /^service\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!routerPath || !pathPattern.test(routerPath)) {
  console.error("Fan-out worker rejected invalid router path");
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("Fan-out worker database is not configured");
  process.exit(3);
}
if (!process.env.IPRESENTERPLUX_DESTINATION_SECRET_KEY?.trim()) {
  console.error("Fan-out worker destination secret key is not configured");
  process.exit(4);
}

const workerId = `fanout-${process.pid}-${randomUUID()}`;
const ffmpegPath = process.env.IPRESENTERPLUX_FFMPEG_PATH?.trim() || "ffmpeg";
const sourceBaseUrl = process.env.IPRESENTERPLUX_FANOUT_RTSP_URL?.trim() || "rtsp://127.0.0.1:8554";
const heartbeatMs = 5_000;
const maxRetryMs = 30_000;
const providerPollMs = 30_000;
const providerMaxBackoffMs = 5 * 60_000;
let shuttingDown = false;
const children = new Set();
const retryWaiters = new Set();
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const realtime = createClient({
  url: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  socket: {
    connectTimeout: 1_000,
    reconnectStrategy: false
  }
});
realtime.on("error", () => {});

function addressIsPrivate(address) {
  const family = isIP(address);
  if (family === 4) {
    const p = address.split(".").map(Number);
    return p[0] === 0 || p[0] === 10 || p[0] === 127 || (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) ||
      (p[0] >= 224 && p[0] <= 255);
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    return lower === "::" || lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") ||
      /^fe[89ab]/.test(lower) || lower.startsWith("ff");
  }
  return true;
}

function retryDelay(ms) {
  if (shuttingDown) return Promise.resolve();
  return new Promise((resolve) => {
    const waiter = { timer: null, resolve };
    waiter.timer = setTimeout(() => {
      retryWaiters.delete(waiter);
      resolve();
    }, ms);
    retryWaiters.add(waiter);
  });
}

async function assertPublicResolution(ingestUrl) {
  const url = new URL(normalizeRtmpsIngestUrl(ingestUrl));
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => addressIsPrivate(entry.address))) {
    throw new Error("destination_ingest_resolution_invalid");
  }
}

async function currentSession() {
  const result = await client.query(
    `select ss.id::text,ss.service_id::text,ss.status,s.organization_id::text
     from stream_sessions ss
     join services s on s.id=ss.service_id
     where ss.router_path=$1
       and ss.status='live'
     order by ss.created_at desc
     limit 1`,
    [routerPath]
  );
  return result.rows[0] ?? null;
}

async function updateDestination(id, sessionId, values) {
  const sets = [];
  const params = [id, sessionId];
  for (const [column, value] of Object.entries(values)) {
    params.push(value);
    sets.push(`${column}=$${params.length}`);
  }
  if (!sets.length) return;
  sets.push("updated_at=now()");
  await client.query(
    `update stream_session_destinations
     set ${sets.join(",")}
     where id=$1::uuid
       and stream_session_id=$2::uuid
       and worker_id=$${params.length + 1}`,
    [...params, workerId]
  );
}

async function claimDestination(destination, sessionId) {
  const claimed = await client.query(
    `update stream_session_destinations
     set worker_id=$3,
         worker_started_at=coalesce(worker_started_at,now()),
         last_heartbeat_at=now(),
         status=case when status='live' then 'warning' else 'connecting' end,
         attempt_count=attempt_count+1,
         process_started_at=now(),
         process_exited_at=null,
         last_error_code=null,
         updated_at=now()
     where id=$1::uuid
       and stream_session_id=$2::uuid
       and status in ('pending','connecting','live','warning','error')
       and (
         worker_id is null
         or worker_id=$3
         or last_heartbeat_at is null
         or last_heartbeat_at < now()-interval '20 seconds'
       )
     returning attempt_count,status`,
    [destination.id, sessionId, workerId]
  );
  return claimed.rows[0] ?? null;
}

async function markTerminalError(destination, sessionId, code) {
  await updateDestination(destination.id, sessionId, {
    status: "error",
    last_error_code: code,
    process_exited_at: new Date(),
    last_heartbeat_at: new Date()
  });
}

async function runAttempt(destination, sessionId, targetUrl, sourceUrl, hasBeenLive) {
  const claim = await claimDestination(destination, sessionId);
  if (!claim) return { retry: false, live: hasBeenLive };

  const args = buildFfmpegArgs(sourceUrl, targetUrl);
  const child = spawn(ffmpegPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env }
  });
  children.add(child);

  let observedLive = hasBeenLive;
  let stdoutBuffer = "";
  let spawnFailed = false;
  let exitCode = null;
  let exitSignal = null;

  const heartbeat = setInterval(() => {
    updateDestination(destination.id, sessionId, { last_heartbeat_at: new Date() }).catch(() => {});
  }, heartbeatMs);
  heartbeat.unref?.();

  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => {
    stdoutBuffer += chunk;
    let newline;
    while ((newline = stdoutBuffer.indexOf("\n")) >= 0) {
      const line = stdoutBuffer.slice(0, newline).trim();
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      const separator = line.indexOf("=");
      if (separator < 1) continue;
      const key = line.slice(0, separator);
      const value = line.slice(separator + 1);
      if ((key === "out_time_us" || key === "out_time_ms" || key === "total_size") && Number(value) > 0 && !observedLive) {
        observedLive = true;
        updateDestination(destination.id, sessionId, {
          status: "live",
          last_error_code: null,
          last_heartbeat_at: new Date()
        }).catch(() => {});
      }
      if (key === "progress" && value === "continue") {
        updateDestination(destination.id, sessionId, { last_heartbeat_at: new Date() }).catch(() => {});
      }
    }
  });

  // Never relay FFmpeg stderr because authenticated RTMPS targets can appear in errors.
  child.stderr?.resume();

  await new Promise((resolve) => {
    let settled = false;
    const settle = (code, signal) => {
      if (settled) return;
      settled = true;
      exitCode = code;
      exitSignal = signal;
      resolve();
    };
    child.once("error", () => {
      spawnFailed = true;
      settle(127, null);
    });
    child.once("close", settle);
    if (shuttingDown && child.exitCode === null) child.kill("SIGINT");
  });

  clearInterval(heartbeat);
  children.delete(child);

  if (shuttingDown || exitSignal === "SIGINT" || exitSignal === "SIGTERM") {
    return { retry: false, live: observedLive };
  }

  const session = await currentSession();
  if (!session || session.id !== sessionId) return { retry: false, live: observedLive };

  const errorCode = spawnFailed || exitCode === 127 ? "fanout_ffmpeg_unavailable" : "fanout_transport_failed";
  await updateDestination(destination.id, sessionId, {
    status: observedLive ? "warning" : "error",
    last_error_code: errorCode,
    process_exited_at: new Date(),
    last_heartbeat_at: new Date()
  });
  return { retry: true, live: observedLive };
}

async function runDestination(destination, sessionId) {
  if (!destinationTypeIsFanout(destination.destination_type)) return;
  const ingestUrl = destination.public_config?.ingestUrl;
  if (typeof ingestUrl !== "string" || !ingestUrl.trim() || !destination.secret_ciphertext) {
    await claimDestination(destination, sessionId);
    await markTerminalError(destination, sessionId, "fanout_destination_not_configured");
    return;
  }

  let streamKey;
  let targetUrl;
  try {
    await assertPublicResolution(ingestUrl);
    streamKey = decryptSecretEnvelope(destination.secret_ciphertext, process.env.IPRESENTERPLUX_DESTINATION_SECRET_KEY).streamKey;
    targetUrl = buildRtmpsTarget(ingestUrl, streamKey);
  } catch {
    await claimDestination(destination, sessionId);
    await markTerminalError(destination, sessionId, "fanout_destination_configuration_invalid");
    return;
  }

  const sourceUrl = buildRtspSource(routerPath, sourceBaseUrl);
  let hasBeenLive = false;
  let attempt = 0;
  while (!shuttingDown) {
    const session = await currentSession();
    if (!session || session.id !== sessionId) break;

    const outcome = await runAttempt(destination, sessionId, targetUrl, sourceUrl, hasBeenLive);
    hasBeenLive = outcome.live;
    if (!outcome.retry || shuttingDown) break;
    attempt += 1;
    const delay = Math.min(maxRetryMs, 1_000 * 2 ** Math.min(attempt, 5));
    await retryDelay(delay);
  }

  // Avoid retaining decrypted material in long-lived references after this loop.
  streamKey = undefined;
  targetUrl = undefined;
}

async function publishProviderEvent(serviceId, destinationId, evidence) {
  try {
    if (!realtime.isOpen) await realtime.connect();
    await realtime.publish(
      `ipresenterplux:service:${serviceId}`,
      JSON.stringify({
        type: "stream.provider.changed",
        serviceId,
        payload: {
          destinationId,
          providerHealthState: evidence.providerHealthState,
          providerLiveState: evidence.providerLiveState,
          providerErrorCode: evidence.providerErrorCode
        },
        emittedAt: new Date().toISOString()
      })
    );
  } catch {
    // Realtime delivery is advisory; persisted provider evidence remains authoritative.
  }
}

async function updateProviderEvidence(destination, session, evidence) {
  const updated = await client.query(
    `update stream_session_destinations
     set provider_health_state=$4,
         provider_live_state=$5,
         provider_checked_at=now(),
         provider_error_code=$6,
         provider_issue_codes=$7::text[],
         updated_at=now()
     where id=$1::uuid
       and stream_session_id=$2::uuid
       and worker_id=$3
     returning output_destination_id::text`,
    [
      destination.id,
      session.id,
      workerId,
      evidence.providerHealthState,
      evidence.providerLiveState,
      evidence.providerErrorCode,
      (evidence.providerIssueCodes ?? []).slice(0, 8)
    ]
  );
  if (updated.rowCount) await publishProviderEvent(session.service_id, destination.output_destination_id, evidence);
}

function providerDelay(errorCode, failures) {
  if (errorCode === "provider_quota_limited") return providerMaxBackoffMs;
  if (!errorCode) return providerPollMs;
  return Math.min(providerMaxBackoffMs, providerPollMs * 2 ** Math.min(failures, 3));
}

async function loadYouTubeProvider(destination, sessionId) {
  const result = await client.query(
    `select pa.token_ciphertext,pa.provider_stream_id,pa.token_expires_at,
            c.secret_ciphertext as stream_secret_ciphertext,ssd.worker_id,ssd.status
     from stream_session_destinations ssd
     left join output_destination_provider_accounts pa
       on pa.output_destination_id=ssd.output_destination_id and pa.provider='youtube'
     left join output_destination_credentials c
       on c.output_destination_id=ssd.output_destination_id
     where ssd.id=$1::uuid and ssd.stream_session_id=$2::uuid`,
    [destination.id, sessionId]
  );
  return result.rows[0] ?? null;
}

async function runYouTubeProviderHealth(destination, sessionId) {
  if (destination.destination_type !== "youtube") return;
  let failures = 0;
  while (!shuttingDown) {
    const session = await currentSession();
    if (!session || session.id !== sessionId) break;
    const account = await loadYouTubeProvider(destination, sessionId);
    if (!account || account.worker_id !== workerId) {
      await retryDelay(1_000);
      continue;
    }
    if (!account.token_ciphertext) {
      await updateProviderEvidence(destination, session, {
        providerHealthState: "unverified",
        providerLiveState: "unknown",
        providerErrorCode: null,
        providerIssueCodes: []
      });
      break;
    }
    if (!process.env.IPRESENTERPLUX_PROVIDER_SECRET_KEY?.trim() ||
        !process.env.IPRESENTERPLUX_GOOGLE_OAUTH_CLIENT_ID?.trim() ||
        !process.env.IPRESENTERPLUX_GOOGLE_OAUTH_CLIENT_SECRET?.trim()) {
      await updateProviderEvidence(destination, session, {
        providerHealthState: "error",
        providerLiveState: "unknown",
        providerErrorCode: "provider_auth_missing",
        providerIssueCodes: []
      });
      break;
    }

    let tokens;
    let streamKey;
    try {
      tokens = decryptProviderTokenEnvelope(account.token_ciphertext, process.env.IPRESENTERPLUX_PROVIDER_SECRET_KEY);
      streamKey = decryptSecretEnvelope(account.stream_secret_ciphertext, process.env.IPRESENTERPLUX_DESTINATION_SECRET_KEY).streamKey;
    } catch {
      await updateProviderEvidence(destination, session, {
        providerHealthState: "error",
        providerLiveState: "unknown",
        providerErrorCode: "provider_auth_invalid",
        providerIssueCodes: []
      });
      break;
    }

    let accessToken = tokens.accessToken;
    const expiresAt = account.token_expires_at ? Date.parse(account.token_expires_at) : 0;
    if (!expiresAt || expiresAt < Date.now() + 90_000) {
      const refreshed = await refreshGoogleAccessToken({
        refreshToken: tokens.refreshToken,
        clientId: process.env.IPRESENTERPLUX_GOOGLE_OAUTH_CLIENT_ID,
        clientSecret: process.env.IPRESENTERPLUX_GOOGLE_OAUTH_CLIENT_SECRET
      });
      if (!refreshed.ok) {
        failures += 1;
        const evidence = { providerHealthState: "error", providerLiveState: "unknown", providerErrorCode: refreshed.errorCode, providerIssueCodes: [] };
        await updateProviderEvidence(destination, session, evidence);
        await retryDelay(providerDelay(refreshed.errorCode, failures));
        continue;
      }
      accessToken = refreshed.accessToken;
      const refreshedCiphertext = encryptProviderTokenEnvelope({ accessToken, refreshToken: tokens.refreshToken }, process.env.IPRESENTERPLUX_PROVIDER_SECRET_KEY);
      await client.query(
        `update output_destination_provider_accounts
         set token_ciphertext=$2,token_expires_at=now()+($3::int*interval '1 second'),refreshed_at=now(),updated_at=now()
         where output_destination_id=$1::uuid and provider='youtube'`,
        [destination.output_destination_id, refreshedCiphertext, refreshed.expiresIn]
      );
    }

    let streamId = account.provider_stream_id;
    if (!streamId) {
      const found = await findYouTubeStreamIdByKey({ accessToken, streamKey });
      if (!found.ok) {
        failures += 1;
        const evidence = { providerHealthState: "error", providerLiveState: "unknown", providerErrorCode: found.errorCode, providerIssueCodes: [] };
        await updateProviderEvidence(destination, session, evidence);
        await retryDelay(providerDelay(found.errorCode, failures));
        continue;
      }
      streamId = found.streamId;
      await client.query(
        `update output_destination_provider_accounts set provider_stream_id=$2,updated_at=now()
         where output_destination_id=$1::uuid and provider='youtube'`,
        [destination.output_destination_id, streamId]
      );
    }

    const evidence = await fetchYouTubeLiveStreamEvidence({ accessToken, streamId });
    if (evidence.providerLiveState === "receiving" && !evidence.providerErrorCode) {
      const broadcast = await fetchYouTubeBroadcastLiveState({ accessToken, streamId });
      if (broadcast.confirmedLive) evidence.providerLiveState = "live";
    }
    await updateProviderEvidence(destination, session, evidence);
    failures = evidence.providerErrorCode ? failures + 1 : 0;
    await retryDelay(providerDelay(evidence.providerErrorCode, failures));
  }
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const waiter of retryWaiters) {
    clearTimeout(waiter.timer);
    waiter.resolve();
  }
  retryWaiters.clear();
  for (const child of children) {
    if (child.exitCode === null) child.kill(signal === "SIGTERM" ? "SIGTERM" : "SIGINT");
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

try {
  await client.connect();
  const session = await currentSession();
  if (!session) {
    console.error("Fan-out worker found no authoritative live stream session");
    process.exitCode = 5;
  } else {
    const destinations = await client.query(
      `select ssd.id::text,od.id::text as output_destination_id,od.destination_type,od.public_config,c.secret_ciphertext
       from stream_session_destinations ssd
       join output_destinations od on od.id=ssd.output_destination_id
       left join output_destination_credentials c on c.output_destination_id=od.id
       where ssd.stream_session_id=$1::uuid
         and od.enabled=true
         and od.destination_type=any($2::text[])
         and ssd.status in ('pending','connecting','live','warning','error')
       order by od.name,od.id`,
      [session.id, ["youtube", "facebook", "tiktok", "tiktok_rtmp", "custom_rtmp"]]
    );

    await Promise.all(destinations.rows.flatMap((destination) => [
      runDestination(destination, session.id),
      runYouTubeProviderHealth(destination, session.id).catch(async () => {
        const current = await currentSession().catch(() => null);
        if (current?.id === session.id) {
          await updateProviderEvidence(destination, current, {
            providerHealthState: "error",
            providerLiveState: "unknown",
            providerErrorCode: "provider_worker_failed",
            providerIssueCodes: []
          }).catch(() => {});
        }
      })
    ]));
  }
} catch (error) {
  console.error(`Fan-out worker failed: ${error instanceof Error ? error.message.replace(/rtmps:\/\/[^\s]+/gi, "rtmps://[REDACTED]") : "unknown"}`);
  process.exitCode = 6;
} finally {
  await shutdown("SIGINT");
  if (realtime.isOpen) await realtime.quit().catch(() => realtime.destroy());
  await client.end().catch(() => {});
}
