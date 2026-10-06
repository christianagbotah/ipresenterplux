#!/usr/bin/env node

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import process from "node:process";
import pg from "pg";
import {
  fetchYouTubeLiveStreamEvidence,
  initialProviderEvidence,
  normalizeYouTubeLiveStreamResponse
} from "./stream-provider-health-core.mjs";

process.loadEnvFile?.(".env.local");
assert.ok(process.env.DATABASE_URL, "DATABASE_URL must be configured for provider-health self-test");

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
