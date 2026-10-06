#!/usr/bin/env node

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import process from "node:process";
import pg from "pg";
import {
  fetchYouTubeBroadcastLiveState,
  fetchYouTubeLiveStreamEvidence,
  initialProviderEvidence,
  normalizeYouTubeLiveStreamResponse
} from "./stream-provider-health-core.mjs";
import {
  decryptProviderTokenEnvelope,
  encryptProviderTokenEnvelope,
  findYouTubeStreamIdByKey,
  refreshGoogleAccessToken
} from "./stream-provider-oauth-core.mjs";

process.loadEnvFile?.(".env.local");
assert.ok(process.env.DATABASE_URL, "DATABASE_URL must be configured for provider-health self-test");

const providerKey = randomBytes(32).toString("base64url");
const previousProviderKey = process.env.IPRESENTERPLUX_PROVIDER_SECRET_KEY;
process.env.IPRESENTERPLUX_PROVIDER_SECRET_KEY = providerKey;
const providerSecrets = await import("../src/lib/provider-secrets.ts");
const accessSecret = `access-${randomUUID()}`;
const refreshSecret = `refresh-${randomUUID()}`;
const tsEnvelope = providerSecrets.encryptProviderTokens({ accessToken: accessSecret, refreshToken: refreshSecret });
assert.deepEqual(decryptProviderTokenEnvelope(tsEnvelope, providerKey), { accessToken: accessSecret, refreshToken: refreshSecret });
const workerEnvelope = encryptProviderTokenEnvelope({ accessToken: accessSecret, refreshToken: refreshSecret }, providerKey);
assert.deepEqual(providerSecrets.decryptProviderTokens(workerEnvelope), { accessToken: accessSecret, refreshToken: refreshSecret });
if (previousProviderKey === undefined) delete process.env.IPRESENTERPLUX_PROVIDER_SECRET_KEY;
else process.env.IPRESENTERPLUX_PROVIDER_SECRET_KEY = previousProviderKey;

const oauthEnv = {
  clientId: process.env.IPRESENTERPLUX_GOOGLE_OAUTH_CLIENT_ID,
  clientSecret: process.env.IPRESENTERPLUX_GOOGLE_OAUTH_CLIENT_SECRET,
  baseUrl: process.env.IPRESENTERPLUX_PUBLIC_BASE_URL
};
process.env.IPRESENTERPLUX_GOOGLE_OAUTH_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
process.env.IPRESENTERPLUX_GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";
process.env.IPRESENTERPLUX_PUBLIC_BASE_URL = "https://ipresenterplux.example.test";
const youtubeOauth = await import("../src/lib/youtube-oauth.ts");
const oauthState = randomUUID();
const authUrl = new URL(youtubeOauth.buildYouTubeAuthorizationUrl(oauthState));
assert.equal(authUrl.origin, "https://accounts.google.com");
assert.equal(authUrl.searchParams.get("access_type"), "offline");
assert.equal(authUrl.searchParams.get("scope"), "https://www.googleapis.com/auth/youtube.readonly");
assert.equal(authUrl.searchParams.get("state"), oauthState);
assert.ok(!authUrl.toString().includes("test-client-secret"));
const exchanged = await youtubeOauth.exchangeYouTubeAuthorizationCode("test-code", async (_url, options) => {
  const body = String(options?.body);
  assert.ok(body.includes("client_secret=test-client-secret"));
  return { ok: true, status: 200, async json() { return { access_token: "oauth-access", refresh_token: "oauth-refresh", expires_in: 3600, scope: "https://www.googleapis.com/auth/youtube.readonly" }; } };
});
assert.equal(exchanged.accessToken, "oauth-access");
assert.equal(exchanged.refreshToken, "oauth-refresh");
for (const [name, value] of [
  ["IPRESENTERPLUX_GOOGLE_OAUTH_CLIENT_ID", oauthEnv.clientId],
  ["IPRESENTERPLUX_GOOGLE_OAUTH_CLIENT_SECRET", oauthEnv.clientSecret],
  ["IPRESENTERPLUX_PUBLIC_BASE_URL", oauthEnv.baseUrl]
]) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

const refreshed = await refreshGoogleAccessToken({
  refreshToken: refreshSecret,
  clientId: "client-id",
  clientSecret: "client-secret",
  fetchImpl: async (_url, options) => {
    assert.equal(String(options?.body).includes(refreshSecret), true);
    return { ok: true, status: 200, async json() { return { access_token: "renewed-access", expires_in: 3600 }; } };
  }
});
assert.deepEqual(refreshed, { ok: true, accessToken: "renewed-access", expiresIn: 3600 });

const matched = await findYouTubeStreamIdByKey({
  accessToken: accessSecret,
  streamKey: "configured-secret-key",
  fetchImpl: async (url, options) => {
    assert.ok(!String(url).includes(accessSecret));
    assert.equal(options?.headers?.Authorization, `Bearer ${accessSecret}`);
    return {
      ok: true,
      status: 200,
      async json() {
        return { items: [
          { id: "other", cdn: { ingestionInfo: { streamName: "other-key" } } },
          { id: "matched-stream", cdn: { ingestionInfo: { streamName: "configured-secret-key" } } }
        ] };
      }
    };
  }
});
assert.deepEqual(matched, { ok: true, streamId: "matched-stream" });

const healthy = normalizeYouTubeLiveStreamResponse({
  items: [{
    status: {
      streamStatus: "active",
      healthStatus: {
        status: "good",
        configurationIssues: []
      }
    }
  }]
});
assert.deepEqual(healthy, {
  providerHealthState: "healthy",
  providerLiveState: "receiving",
  providerErrorCode: null,
  providerIssueCodes: []
});

const warning = normalizeYouTubeLiveStreamResponse({
  items: [{
    status: {
      streamStatus: "active",
      healthStatus: {
        status: "ok",
        configurationIssues: [
          { type: "bitrateLow", reason: "must-not-persist", description: "raw provider description must not persist" },
          { type: "videoIngestionStarved" },
          { type: "futureUnknownIssue" },
          { type: "bitrateLow" }
        ]
      }
    }
  }]
});
assert.deepEqual(warning, {
  providerHealthState: "warning",
  providerLiveState: "receiving",
  providerErrorCode: null,
  providerIssueCodes: ["bitrateLow", "videoIngestionStarved"]
});
assert.ok(!JSON.stringify(warning).includes("must-not-persist"));
assert.ok(!JSON.stringify(warning).includes("raw provider description"));

assert.equal(normalizeYouTubeLiveStreamResponse({ items: [{ status: { streamStatus: "active", healthStatus: { status: "bad" } } }] }).providerHealthState, "error");
assert.equal(normalizeYouTubeLiveStreamResponse({ items: [{ status: { streamStatus: "active", healthStatus: { status: "noData" } } }] }).providerHealthState, "warning");
assert.equal(normalizeYouTubeLiveStreamResponse({ items: [{ status: { streamStatus: "inactive", healthStatus: { status: "good" } } }] }).providerLiveState, "not_live");
assert.equal(normalizeYouTubeLiveStreamResponse({ items: [] }).providerErrorCode, "provider_stream_not_found");
assert.equal(initialProviderEvidence("youtube").providerHealthState, "unverified");
assert.equal(initialProviderEvidence("facebook").providerHealthState, "unverified");
assert.equal(initialProviderEvidence("custom_rtmp").providerHealthState, "unsupported");

const accessToken = `oauth-${randomUUID()}-secret`;
let observedUrl = "";
let observedAuth = "";
const fetched = await fetchYouTubeLiveStreamEvidence({
  accessToken,
  streamId: "youtube-stream-id",
  fetchImpl: async (url, options) => {
    observedUrl = String(url);
    observedAuth = options?.headers?.Authorization ?? "";
    return {
      ok: true,
      status: 200,
      async json() {
        return { items: [{ status: { streamStatus: "active", healthStatus: { status: "good", configurationIssues: [] } } }] };
      }
    };
  }
});
assert.equal(fetched.providerLiveState, "receiving");
const broadcastLive = await fetchYouTubeBroadcastLiveState({
  accessToken,
  streamId: "youtube-stream-id",
  fetchImpl: async (_url, options) => {
    assert.equal(options?.headers?.Authorization, `Bearer ${accessToken}`);
    return {
      ok: true,
      status: 200,
      async json() {
        return { items: [{ contentDetails: { boundStreamId: "youtube-stream-id" }, status: { lifeCycleStatus: "live" } }] };
      }
    };
  }
});
assert.deepEqual(broadcastLive, { confirmedLive: true });
const broadcastNotLive = await fetchYouTubeBroadcastLiveState({
  accessToken,
  streamId: "youtube-stream-id",
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    async json() { return { items: [{ contentDetails: { boundStreamId: "youtube-stream-id" }, status: { lifeCycleStatus: "testing" } }] }; }
  })
});
assert.deepEqual(broadcastNotLive, { confirmedLive: false });
assert.equal(observedAuth, `Bearer ${accessToken}`);
assert.ok(!observedUrl.includes(accessToken), "OAuth token must never enter provider URL/query string");
assert.ok(!JSON.stringify(fetched).includes(accessToken), "OAuth token must never enter provider evidence");

const authFailure = await fetchYouTubeLiveStreamEvidence({
  accessToken,
  streamId: "youtube-stream-id",
  fetchImpl: async () => ({ ok: false, status: 401 })
});
assert.equal(authFailure.providerErrorCode, "provider_auth_failed");
assert.ok(!JSON.stringify(authFailure).includes(accessToken));

const timeoutFailure = await fetchYouTubeLiveStreamEvidence({
  accessToken,
  streamId: "youtube-stream-id",
  fetchImpl: async () => {
    const error = new Error(`timeout ${accessToken}`);
    error.name = "AbortError";
    throw error;
  }
});
assert.equal(timeoutFailure.providerErrorCode, "provider_api_timeout");
assert.ok(!JSON.stringify(timeoutFailure).includes(accessToken));

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const serviceId = "00000000-0000-4000-8000-000000000003";
const sessionId = randomUUID();
let connected = false;
try {
  await client.connect();
  connected = true;
  const output = await client.query(
    `select id::text from output_destinations
     where organization_id='00000000-0000-4000-8000-000000000001'::uuid
       and destination_type='youtube'
     order by created_at asc limit 1`
  );
  assert.ok(output.rows[0]?.id, "YouTube fixture output is required");
  const outputId = output.rows[0].id;

  await client.query("begin");
  await client.query(
    `insert into stream_sessions(id,service_id,status,video_profile,router_path,metrics,updated_at)
     values ($1::uuid,$2::uuid,'live','1080p30',$3,'{}'::jsonb,now())`,
    [sessionId, serviceId, `service/${serviceId}`]
  );
  await client.query(
    `insert into stream_session_destinations(
       stream_session_id,output_destination_id,status,provider_health_state,provider_live_state,
       provider_checked_at,provider_issue_codes
     ) values ($1::uuid,$2::uuid,'live','healthy','receiving',now(),$3::text[])`,
    [sessionId, outputId, ["bitrateLow"]]
  );
  const persisted = await client.query(
    `select provider_health_state,provider_live_state,provider_checked_at is not null as checked,
            provider_error_code,provider_issue_codes
     from stream_session_destinations
     where stream_session_id=$1::uuid and output_destination_id=$2::uuid`,
    [sessionId, outputId]
  );
  assert.deepEqual(persisted.rows[0], {
    provider_health_state: "healthy",
    provider_live_state: "receiving",
    checked: true,
    provider_error_code: null,
    provider_issue_codes: ["bitrateLow"]
  });
  await assert.rejects(
    client.query(
      `update stream_session_destinations set provider_health_state='invented' where stream_session_id=$1::uuid`,
      [sessionId]
    )
  );
  await client.query("rollback");
} finally {
  if (connected) {
    await client.query("rollback").catch(() => {});
    await client.query("delete from stream_sessions where id=$1::uuid", [sessionId]).catch(() => {});
    await client.end().catch(() => {});
  }
}

console.log(JSON.stringify({ ok: true, youtube: "mapped", providerSecretsLeaked: false, persistence: "bounded" }));
