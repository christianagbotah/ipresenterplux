import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import process from "node:process";
import pg from "pg";
import ts from "typescript";

process.loadEnvFile?.(".env.local");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");

const source = await readFile(new URL("../src/lib/stream-session-authority.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
const { reconcileRouterReadyState, reconcileStreamCommandResult, streamPathForService } = await import(moduleUrl);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query("begin");
try {
  const scope = await client.query(
    `select s.id::text as service_id,s.organization_id::text,c.id::text as campus_id
     from services s
     left join campuses c on c.id=s.campus_id
     order by case when s.status='live' then 0 when s.status='ready' then 1 else 2 end,s.created_at
     limit 1`
  );
  assert.ok(scope.rows[0]?.service_id, "Expected seeded service");
  const { service_id: serviceId, organization_id: organizationId, campus_id: campusId } = scope.rows[0];
  const routerPath = streamPathForService(serviceId);
  await client.query("update services set status='ready' where id=$1", [serviceId]);
  await client.query(
    `update stream_sessions
     set status='ended',ended_at=coalesce(ended_at,now()),updated_at=now()
     where service_id=$1::uuid and status in ('starting','live','stopping')`,
    [serviceId]
  );
  await client.query(
    `update edge_stream_contribution_sessions
     set revoked_at=coalesce(revoked_at,now()),updated_at=now()
     where service_id=$1::uuid and revoked_at is null`,
    [serviceId]
  );

  const publisher = await client.query(
    `insert into edge_devices(organization_id,campus_id,name,platform,status,active_service_id,last_seen_at)
     values ($1,$2,$3,'windows','active',$4,now())
     returning id::text`,
    [organizationId, campusId, `authority-publisher-${Date.now()}`, serviceId]
  );
  const publisherId = publisher.rows[0].id;
  const other = await client.query(
    `insert into edge_devices(organization_id,campus_id,name,platform,status,active_service_id,last_seen_at)
     values ($1,$2,$3,'windows','active',$4,now())
     returning id::text`,
    [organizationId, campusId, `authority-other-${Date.now()}`, serviceId]
  );
  const otherDeviceId = other.rows[0].id;

  let destination = await client.query(
    `select id::text from output_destinations
     where organization_id=$1::uuid and destination_type='web_webrtc'
     order by created_at limit 1`,
    [organizationId]
  );
  if (!destination.rows[0]) {
    destination = await client.query(
      `insert into output_destinations(organization_id,name,destination_type,enabled,status,public_config)
       values ($1::uuid,$2,'web_webrtc',true,'ready','{}'::jsonb)
       returning id::text`,
      [organizationId, `Authority Web ${Date.now()}`]
    );
  }
  const destinationId = destination.rows[0].id;
  await client.query("update output_destinations set enabled=true,status='ready' where id=$1::uuid", [destinationId]);

  async function createSession(status = "starting") {
    const created = await client.query(
      `insert into stream_sessions(service_id,status,router_path,publisher_edge_device_id,updated_at)
       values ($1::uuid,$2,$3,$4::uuid,now())
       returning id::text`,
      [serviceId, status, routerPath, publisherId]
    );
    const streamSessionId = created.rows[0].id;
    await client.query(
      `insert into stream_session_destinations(stream_session_id,output_destination_id,status)
       values ($1::uuid,$2::uuid,'pending')`,
      [streamSessionId, destinationId]
    );
    return streamSessionId;
  }

  async function sessionState(sessionId) {
    const result = await client.query(
      `select status,error_code,started_at,ended_at,metrics,publisher_edge_device_id::text
       from stream_sessions where id=$1::uuid`,
      [sessionId]
    );
    return result.rows[0];
  }

  async function destinationState(sessionId) {
    const result = await client.query(
      `select status,last_error_code from stream_session_destinations
       where stream_session_id=$1::uuid and output_destination_id=$2::uuid`,
      [sessionId, destinationId]
    );
    return result.rows[0];
  }

  async function insertGrant(edgeDeviceId, suffix) {
    const inserted = await client.query(
      `insert into edge_stream_contribution_sessions
        (organization_id,edge_device_id,service_id,protocol,stream_path,token_hash,router_authority,expires_at,last_seen_at)
       values ($1::uuid,$2::uuid,$3::uuid,'srt',$4,$5,$6,now()+interval '5 minutes',now())
       returning id::text`,
      [organizationId, edgeDeviceId, serviceId, routerPath, suffix.repeat(64).slice(0, 64), "router.example.test:8890"]
    );
    return inserted.rows[0].id;
  }

  // Success path: wrong device is ignored; publisher ACK does not imply live;
  // only router availability promotes the session. Stop mirrors that contract.
  const successSessionId = await createSession("starting");
  const wrongDeviceAck = await reconcileStreamCommandResult(client, {
    serviceId,
    edgeDeviceId: otherDeviceId,
    commandType: "stream.start",
    success: true,
    errorCode: null
  });
  assert.equal(wrongDeviceAck, null, "A non-publisher Edge ACK must not mutate the active session");
  assert.equal((await sessionState(successSessionId)).status, "starting");

  const startAck = await reconcileStreamCommandResult(client, {
    serviceId,
    edgeDeviceId: publisherId,
    commandType: "stream.start",
    success: true,
    errorCode: null
  });
  assert.equal(startAck?.status, "starting", "Successful Edge start ACK must remain starting until router evidence arrives");
  assert.equal((await sessionState(successSessionId)).status, "starting");

  const live = await reconcileRouterReadyState(client, routerPath, true);
  assert.equal(live?.status, "live", "Router availability must promote starting to live");
  const liveState = await sessionState(successSessionId);
  assert.equal(liveState.status, "live");
  assert.ok(liveState.started_at, "Live session must record started_at");
  assert.equal(liveState.publisher_edge_device_id, publisherId);
  assert.equal((await destinationState(successSessionId)).status, "live", "WebRTC destination follows master availability");

  await client.query("update stream_sessions set status='stopping',updated_at=now() where id=$1::uuid", [successSessionId]);
  const stopAck = await reconcileStreamCommandResult(client, {
    serviceId,
    edgeDeviceId: publisherId,
    commandType: "stream.stop",
    success: true,
    errorCode: null
  });
  assert.equal(stopAck?.status, "stopping", "Successful Edge stop ACK must remain stopping until router is unavailable");
  assert.equal((await sessionState(successSessionId)).status, "stopping");

  const ended = await reconcileRouterReadyState(client, routerPath, false);
  assert.equal(ended?.status, "ended", "Router unavailable must complete an expected stop");
  const endedState = await sessionState(successSessionId);
  assert.equal(endedState.status, "ended");
  assert.ok(endedState.ended_at, "Ended session must record ended_at");
  assert.equal((await destinationState(successSessionId)).status, "ended");

  // Start failure: session becomes error, pending destinations are skipped, and
  // any contribution right is revoked immediately.
  const startFailureSessionId = await createSession("starting");
  const startFailureGrantId = await insertGrant(publisherId, "a");
  const startFailure = await reconcileStreamCommandResult(client, {
    serviceId,
    edgeDeviceId: publisherId,
    commandType: "stream.start",
    success: false,
    errorCode: "encoder_start_failed"
  });
  assert.equal(startFailure?.status, "error");
  const startFailureState = await sessionState(startFailureSessionId);
  assert.equal(startFailureState.status, "error");
  assert.equal(startFailureState.error_code, "encoder_start_failed");
  assert.equal((await destinationState(startFailureSessionId)).status, "skipped");
  const startGrant = await client.query("select revoked_at from edge_stream_contribution_sessions where id=$1::uuid", [startFailureGrantId]);
  assert.ok(startGrant.rows[0].revoked_at, "Start failure must revoke the contribution grant");

  // Stop failure: a live session already moved to stopping becomes error rather
  // than falsely reporting ended, and its active grant is revoked.
  const stopFailureSessionId = await createSession("live");
  await client.query(
    `update stream_session_destinations set status='live',started_at=now(),updated_at=now()
     where stream_session_id=$1::uuid`,
    [stopFailureSessionId]
  );
  await client.query("update stream_sessions set status='stopping',started_at=now(),updated_at=now() where id=$1::uuid", [stopFailureSessionId]);
  const stopFailureGrantId = await insertGrant(publisherId, "b");
  const stopFailure = await reconcileStreamCommandResult(client, {
    serviceId,
    edgeDeviceId: publisherId,
    commandType: "stream.stop",
    success: false,
    errorCode: "publisher_stop_failed"
  });
  assert.equal(stopFailure?.status, "error");
  const stopFailureState = await sessionState(stopFailureSessionId);
  assert.equal(stopFailureState.status, "error");
  assert.equal(stopFailureState.error_code, "publisher_stop_failed");
  assert.equal((await destinationState(stopFailureSessionId)).status, "error");
  const stopGrant = await client.query("select revoked_at from edge_stream_contribution_sessions where id=$1::uuid", [stopFailureGrantId]);
  assert.ok(stopGrant.rows[0].revoked_at, "Stop failure must revoke the contribution grant");

  console.log("Stream session authority self-test passed (publisher isolation, router authority, safe stop, and command failures).");
} finally {
  await client.query("rollback");
  await client.end();
}
