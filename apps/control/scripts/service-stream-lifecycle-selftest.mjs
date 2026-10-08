#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";

process.loadEnvFile?.(".env.local");
assertWritableSelfTestDatabase(process.env.DATABASE_URL);
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");

const lifecycle = await import("../src/lib/service-stream-lifecycle.ts");
assert.ok(lifecycle?.finalizeStreamsForEndedService, "service stream lifecycle helper must exist");
const { finalizeStreamsForEndedService } = lifecycle;

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query("begin");

const orgId = randomUUID();
const campusId = randomUUID();
const actorId = randomUUID();

async function insertService(label) {
  const id = randomUUID();
  await client.query(
    `insert into services(id,organization_id,campus_id,title,status,active_bible_version)
     values ($1,$2,$3,$4,'live','WEBP')`,
    [id, orgId, campusId, `Lifecycle ${label}`]
  );
  return id;
}

async function insertPublisher(serviceId, label, status = "active") {
  const id = randomUUID();
  await client.query(
    `insert into edge_devices(id,organization_id,campus_id,name,platform,status,active_service_id,last_seen_at)
     values ($1,$2,$3,$4,'windows',$5,$6,now())`,
    [id, orgId, campusId, `lifecycle-${label}-${id}`, status, serviceId]
  );
  return id;
}

async function insertStream(serviceId, publisherId, status) {
  const id = randomUUID();
  await client.query(
    `insert into stream_sessions(id,service_id,status,router_path,publisher_edge_device_id,started_at,updated_at)
     values ($1,$2,$3,$4,$5,case when $3='live' then now() else null end,now())`,
    [id, serviceId, status, `service/${serviceId}`, publisherId]
  );
  const outputId = randomUUID();
  await client.query(
    `insert into output_destinations(id,organization_id,name,destination_type,enabled,status,public_config)
     values ($1,$2,$3,'web_webrtc',true,'ready','{}'::jsonb)`,
    [outputId, orgId, `Lifecycle Web ${outputId}`]
  );
  await client.query(
    `insert into stream_session_destinations(stream_session_id,output_destination_id,status,started_at)
     values ($1,$2,$3,case when $3='live' then now() else null end)`,
    [id, outputId, status === "stopping" ? "live" : status]
  );
  const grantId = randomUUID();
  await client.query(
    `insert into edge_stream_contribution_sessions
      (id,organization_id,edge_device_id,service_id,protocol,stream_path,token_hash,router_authority,expires_at,last_seen_at)
     values ($1,$2,$3,$4,'srt',$5,$6,'router.example.test:8890',now()+interval '5 minutes',now())`,
    [grantId, orgId, publisherId, serviceId, `service/${serviceId}`, randomUUID().replaceAll("-", "").padEnd(64, "0")]
  );
  return { id, outputId, grantId };
}

async function assertTerminal(stream) {
  const session = await client.query("select status,ended_at from stream_sessions where id=$1", [stream.id]);
  assert.equal(session.rows[0].status, "ended");
  assert.ok(session.rows[0].ended_at, "terminalized stream must record ended_at");
  const destination = await client.query(
    "select status,ended_at from stream_session_destinations where stream_session_id=$1 and output_destination_id=$2",
    [stream.id, stream.outputId]
  );
  assert.equal(destination.rows[0].status, "ended");
  assert.ok(destination.rows[0].ended_at, "terminalized destination must record ended_at");
  const grant = await client.query("select revoked_at from edge_stream_contribution_sessions where id=$1", [stream.grantId]);
  assert.ok(grant.rows[0].revoked_at, "terminalized stream must revoke contribution access");
}

try {
  await client.query(
    `insert into organizations(id,name,slug,country_code,timezone)
     values ($1,'Lifecycle Test',$2,'GH','Africa/Accra')`,
    [orgId, `stream-lifecycle-${orgId}`]
  );
  await client.query(
    `insert into campuses(id,organization_id,name,slug,city,country_code)
     values ($1,$2,'Lifecycle Campus',$3,'Accra','GH')`,
    [campusId, orgId, `lifecycle-${campusId}`]
  );
  await client.query(
    `insert into users(id,email,display_name,status) values ($1,$2,'Lifecycle Operator','active')`,
    [actorId, `lifecycle-${actorId}@example.invalid`]
  );

  const liveServiceId = await insertService("live");
  const livePublisherId = await insertPublisher(liveServiceId, "live");
  const liveStream = await insertStream(liveServiceId, livePublisherId, "live");
  const liveResult = await finalizeStreamsForEndedService(client, {
    serviceId: liveServiceId,
    organizationId: orgId,
    actorId
  });
  assert.deepEqual(liveResult.endedSessionIds, [liveStream.id]);
  assert.equal(liveResult.stopRequestedForDeviceId, livePublisherId, "active publisher should receive one best-effort stop command");
  await assertTerminal(liveStream);
  await client.query("update services set status='ended',ended_at=now() where id=$1", [liveServiceId]);
  const liveCommands = await client.query(
    `select count(*)::int as count from edge_control_commands
     where service_id=$1 and edge_device_id=$2 and command_type='stream.stop'`,
    [liveServiceId, livePublisherId]
  );
  assert.equal(liveCommands.rows[0].count, 1, "service end must enqueue exactly one stop request");

  const stoppingServiceId = await insertService("stopping");
  const stoppingPublisherId = await insertPublisher(stoppingServiceId, "stopping");
  const stoppingStream = await insertStream(stoppingServiceId, stoppingPublisherId, "stopping");
  const stoppingResult = await finalizeStreamsForEndedService(client, {
    serviceId: stoppingServiceId,
    organizationId: orgId,
    actorId
  });
  assert.deepEqual(stoppingResult.endedSessionIds, [stoppingStream.id]);
  assert.equal(stoppingResult.stopRequestedForDeviceId, stoppingPublisherId);
  await assertTerminal(stoppingStream);
  await client.query("update services set status='ended',ended_at=now() where id=$1", [stoppingServiceId]);

  const offlineServiceId = await insertService("offline");
  const offlinePublisherId = await insertPublisher(offlineServiceId, "offline", "offline");
  const offlineStream = await insertStream(offlineServiceId, offlinePublisherId, "live");
  const offlineResult = await finalizeStreamsForEndedService(client, {
    serviceId: offlineServiceId,
    organizationId: orgId,
    actorId
  });
  assert.deepEqual(offlineResult.endedSessionIds, [offlineStream.id]);
  assert.equal(offlineResult.stopRequestedForDeviceId, null, "offline Edge must not block service-end terminalization");
  await assertTerminal(offlineStream);
  await client.query("update services set status='ended',ended_at=now() where id=$1", [offlineServiceId]);

  const noStreamServiceId = await insertService("no-stream");
  await insertPublisher(noStreamServiceId, "no-stream");
  assert.deepEqual(
    await finalizeStreamsForEndedService(client, { serviceId: noStreamServiceId, organizationId: orgId, actorId }),
    { endedSessionIds: [], stopRequestedForDeviceId: null }
  );
  assert.deepEqual(
    await finalizeStreamsForEndedService(client, { serviceId: liveServiceId, organizationId: orgId, actorId }),
    { endedSessionIds: [], stopRequestedForDeviceId: null },
    "repeated finalization must be idempotent"
  );

  const routeSource = await readFile(new URL("../src/app/api/v1/services/[id]/state/route.ts", import.meta.url), "utf8");
  const lifecycleCall = routeSource.indexOf("await finalizeStreamsForEndedService");
  const clearAssignment = routeSource.indexOf("set active_service_id=null");
  assert.ok(lifecycleCall >= 0, "service state route must invoke stream finalization");
  assert.ok(clearAssignment >= 0 && lifecycleCall < clearAssignment, "stream finalization must run before Edge assignment is cleared");
  assert.match(routeSource, /stream\.session\.changed/, "service end must publish stream/session realtime change after commit");
  assert.match(
    routeSource,
    /when \$2='ended' then coalesce\(ended_at,now\(\)\)/,
    "repeated ended requests must preserve the original service ended_at timestamp"
  );

  console.log(JSON.stringify({ ok: true, activeStop: true, stoppingFinalized: true, offlineBestEffort: true, noStreamSafe: true, idempotent: true }));
} finally {
  await client.query("rollback");
  await client.end();
}
