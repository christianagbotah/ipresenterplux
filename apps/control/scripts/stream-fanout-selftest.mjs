#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";
import {
  buildFfmpegArgs,
  buildRtmpsTarget,
  buildRtspSource,
  decryptSecretEnvelope,
  normalizeRtmpsIngestUrl,
  redactSensitiveText
} from "./stream-fanout-core.mjs";

process.loadEnvFile?.(".env.local");
assertWritableSelfTestDatabase(process.env.DATABASE_URL);
assert.ok(process.env.DATABASE_URL, "DATABASE_URL must be configured for fan-out self-test");

const key = randomBytes(32);
const rawKey = key.toString("base64url");
const streamKey = `ci-${randomBytes(16).toString("hex")}`;
const iv = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", key, iv);
const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ streamKey }), "utf8"), cipher.final()]);
const envelope = ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");

assert.equal(decryptSecretEnvelope(envelope, rawKey).streamKey, streamKey);
assert.equal(normalizeRtmpsIngestUrl("rtmps://example.com/live/"), "rtmps://example.com/live");
assert.throws(() => normalizeRtmpsIngestUrl("rtmps://127.0.0.1/live"));
assert.throws(() => normalizeRtmpsIngestUrl("rtmp://example.com/live"));
assert.equal(buildRtmpsTarget("rtmps://example.com/live", "abc/def"), "rtmps://example.com/live/abc/def");
const source = buildRtspSource("service/00000000-0000-4000-8000-000000000003");
assert.equal(source, "rtsp://127.0.0.1:8554/service/00000000-0000-4000-8000-000000000003");
const args = buildFfmpegArgs(source, "rtmps://example.com/live/redacted-key");
assert.ok(args.includes("-c") && args.includes("copy"));
assert.ok(args.includes("-progress") && args.includes("pipe:1"));
assert.equal(args.at(-1), "rtmps://example.com/live/redacted-key");
assert.ok(!redactSensitiveText(`failed ${streamKey} rtmps://example.com/live/${streamKey}`, [streamKey]).includes(streamKey));

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "iplux-fanout-"));
const fakeFfmpeg = path.join(tempDir, "fake-ffmpeg.mjs");
const serviceId = "00000000-0000-4000-8000-000000000003";
const routerPath = `service/${serviceId}`;
const sessionId = randomUUID();
let child;
let connected = false;
let failedOutputId = null;

try {
  await fs.writeFile(fakeFfmpeg, `#!/usr/bin/env node\nconsole.log("out_time_us=1000000");\nconsole.log("total_size=1024");\nconsole.log("progress=continue");\nconst timer=setInterval(()=>{console.log("out_time_us=2000000");console.log("progress=continue");},250);\nprocess.on("SIGINT",()=>{clearInterval(timer);process.exit(0)});\nprocess.on("SIGTERM",()=>{clearInterval(timer);process.exit(0)});\n`, { mode: 0o755 });
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
    `update output_destinations
     set enabled=true,status='ready',public_config=jsonb_build_object(
       'protocol','RTMPS','ingestUrl','rtmps://example.com/live','credentialConfigured',true
     ),updated_at=now()
     where id=$1::uuid`,
    [outputId]
  );
  await client.query(
    `insert into output_destination_credentials(output_destination_id,secret_ciphertext,key_version,configured_at,updated_at)
     values ($1::uuid,$2,1,now(),now())
     on conflict (output_destination_id) do update
     set secret_ciphertext=excluded.secret_ciphertext,key_version=1,updated_at=now()`,
    [outputId, envelope]
  );
  await client.query(
    `insert into stream_sessions(id,service_id,status,video_profile,router_path,metrics,updated_at)
     values ($1::uuid,$2::uuid,'live','1080p30',$3,'{}'::jsonb,now())`,
    [sessionId, serviceId, routerPath]
  );
  await client.query(
    `insert into stream_session_destinations(stream_session_id,output_destination_id,status)
     values ($1::uuid,$2::uuid,'pending')`,
    [sessionId, outputId]
  );
  await client.query(
    `insert into output_destination_provider_accounts(
       output_destination_id,provider,token_ciphertext,key_version,scopes,connected_at,updated_at
     ) values ($1::uuid,'youtube','test-provider-envelope',1,array['https://www.googleapis.com/auth/youtube.readonly'],now(),now())
     on conflict (output_destination_id) do update
     set provider='youtube',token_ciphertext=excluded.token_ciphertext,scopes=excluded.scopes,provider_stream_id=null,updated_at=now()`,
    [outputId]
  );

  const failedOutput = await client.query(
    `insert into output_destinations(organization_id,name,destination_type,enabled,status,public_config)
     values ('00000000-0000-4000-8000-000000000001'::uuid,$1,'custom_rtmp',true,'ready',
       jsonb_build_object('protocol','RTMPS','ingestUrl','rtmps://example.com/live','credentialConfigured',false))
     returning id::text`,
    [`Fanout isolated failure ${Date.now()}-${randomUUID()}`]
  );
  failedOutputId = failedOutput.rows[0].id;
  await client.query(
    `insert into stream_session_destinations(stream_session_id,output_destination_id,status)
     values ($1::uuid,$2::uuid,'pending')`,
    [sessionId, failedOutputId]
  );
  await client.query("commit");

  child = spawn(process.execPath, [path.resolve("scripts/stream-fanout-worker.mjs"), routerPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      IPRESENTERPLUX_DESTINATION_SECRET_KEY: rawKey,
      IPRESENTERPLUX_PROVIDER_SECRET_KEY: "",
      IPRESENTERPLUX_GOOGLE_OAUTH_CLIENT_ID: "",
      IPRESENTERPLUX_GOOGLE_OAUTH_CLIENT_SECRET: "",
      IPRESENTERPLUX_FFMPEG_PATH: fakeFfmpeg
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (value) => { stdout += value; });
  child.stderr.on("data", (value) => { stderr += value; });

  let row;
  let failedRow;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = await client.query(
      `select output_destination_id::text,status,attempt_count,worker_id,last_heartbeat_at is not null as heartbeating,last_error_code,provider_health_state,provider_error_code
       from stream_session_destinations
       where stream_session_id=$1::uuid
         and output_destination_id=any($2::uuid[])`,
      [sessionId, [outputId, failedOutputId]]
    );
    row = result.rows.find((item) => item.output_destination_id === outputId);
    failedRow = result.rows.find((item) => item.output_destination_id === failedOutputId);
    if (row?.status === "live" && row?.provider_error_code === "provider_auth_missing" && failedRow?.status === "error") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  assert.equal(row?.status, "live", `healthy fan-out did not become live; stderr=${stderr}`);
  assert.ok(Number(row.attempt_count) >= 1);
  assert.ok(row.worker_id?.startsWith("fanout-"));
  assert.equal(row.heartbeating, true);
  assert.equal(row.provider_health_state, "error");
  assert.equal(row.provider_error_code, "provider_auth_missing", "provider failure must degrade evidence without stopping RTMPS");
  assert.equal(failedRow?.status, "error", "misconfigured sibling destination must fail independently");
  assert.equal(failedRow?.last_error_code, "fanout_destination_not_configured");
  const sessionAfterFailure = await client.query("select status from stream_sessions where id=$1::uuid", [sessionId]);
  assert.equal(sessionAfterFailure.rows[0]?.status, "live", "destination failure must not stop the master session");
  assert.ok(!stdout.includes(streamKey));
  assert.ok(!stderr.includes(streamKey));

  child.kill("SIGINT");
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("fan-out worker did not stop after SIGINT")), 5_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  console.log(JSON.stringify({ ok: true, status: row.status, attempts: Number(row.attempt_count), secretLeaked: false }));
} finally {
  if (child?.exitCode === null) child.kill("SIGKILL");
  if (connected) {
    await client.query("rollback").catch(() => {});
    await client.query("delete from stream_sessions where id=$1::uuid", [sessionId]).catch(() => {});
    if (failedOutputId) {
      await client.query("delete from output_destinations where id=$1::uuid", [failedOutputId]).catch(() => {});
    }
    await client.end().catch(() => {});
  }
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
}
