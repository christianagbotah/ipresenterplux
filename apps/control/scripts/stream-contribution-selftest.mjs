import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import process from "node:process";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";
import ts from "typescript";

process.loadEnvFile?.(".env.local");
assertWritableSelfTestDatabase(process.env.DATABASE_URL);
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");

const source = await readFile(new URL("../src/lib/stream-contribution.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
const { createEdgeContributionGrant, hashContributionToken } = await import(moduleUrl);

const fixedNow = new Date("2026-10-06T01:00:00.000Z");
const fixturePath = "service/11111111-1111-4111-8111-111111111111";
const fixtureGrant = createEdgeContributionGrant("srt://router.example.test:8890", fixedNow, fixturePath);
const fixturePublishUrl = new URL(fixtureGrant.publishUrl);
const fixtureStreamId = fixturePublishUrl.searchParams.get("streamid");
assert.equal(fixtureGrant.streamPath, fixturePath, "Production grants must preserve the authoritative router path");
assert.equal(fixturePublishUrl.protocol, "srt:");
assert.equal(fixturePublishUrl.searchParams.get("pkt_size"), "1316");
assert.ok(fixtureStreamId?.startsWith(`publish:${fixturePath}:edge:`), "Expected MediaMTX publish:path:user:password syntax");
const fixtureToken = fixtureStreamId.split(":").at(-1);
assert.ok(fixtureToken && fixtureToken.length >= 40, "Expected strong one-time token");
assert.equal(hashContributionToken(fixtureToken), fixtureGrant.tokenHash, "Stored hash must match the raw publish credential");
assert.equal(fixtureGrant.expiresAt, "2026-10-06T01:05:00.000Z", "Contribution grants must expire after five minutes");
assert.ok(!fixtureGrant.publishUrl.includes(fixtureGrant.tokenHash), "Publish URL must never contain the persisted token hash");

for (const invalid of [
  "http://router.example.test:8890",
  "srt://user:pass@router.example.test:8890",
  "srt://router.example.test:8890?secret=value"
]) {
  assert.throws(() => createEdgeContributionGrant(invalid, fixedNow, fixturePath));
}
for (const invalidPath of ["/service/bad", "service/../bad", "service/bad/", "service/bad path", ""]) {
  assert.throws(() => createEdgeContributionGrant("srt://router.example.test:8890", fixedNow, invalidPath));
}

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
  const authoritativePath = `service/${serviceId}`;
  await client.query("update services set status='ready' where id=$1", [serviceId]);
  await client.query(
    `update stream_sessions
     set status='ended',ended_at=coalesce(ended_at,now()),updated_at=now()
     where service_id=$1::uuid and status in ('starting','live','stopping')`,
    [serviceId]
  );

  const publisher = await client.query(
    `insert into edge_devices(organization_id,campus_id,name,platform,status,active_service_id)
     values ($1,$2,$3,'windows','active',$4)
     returning id::text`,
    [organizationId, campusId, `stream-publisher-selftest-${Date.now()}`, serviceId]
  );
  const publisherId = publisher.rows[0].id;
  const other = await client.query(
    `insert into edge_devices(organization_id,campus_id,name,platform,status,active_service_id)
     values ($1,$2,$3,'windows','active',$4)
     returning id::text`,
    [organizationId, campusId, `stream-other-selftest-${Date.now()}`, serviceId]
  );
  const otherDeviceId = other.rows[0].id;

  const streamSession = await client.query(
    `insert into stream_sessions(service_id,status,router_path,publisher_edge_device_id,updated_at)
     values ($1::uuid,'starting',$2,$3::uuid,now())
     returning id::text`,
    [serviceId, authoritativePath, publisherId]
  );
  assert.ok(streamSession.rows[0]?.id, "Expected active authoritative stream session");

  const grant1 = createEdgeContributionGrant("srt://router.example.test:8890", fixedNow, authoritativePath);
  const token1 = new URL(grant1.publishUrl).searchParams.get("streamid")?.split(":").at(-1);
  assert.ok(token1);
  await client.query(
    `insert into edge_stream_contribution_sessions
      (id,organization_id,edge_device_id,service_id,protocol,stream_path,token_hash,router_authority,issued_at,expires_at)
     values ($1,$2,$3,$4,'srt',$5,$6,$7,$8,$9)`,
    [grant1.sessionId, organizationId, publisherId, serviceId, grant1.streamPath, grant1.tokenHash, grant1.routerAuthority, fixedNow.toISOString(), grant1.expiresAt]
  );

  const authSql = `select cs.id::text
     from edge_stream_contribution_sessions cs
     join edge_devices d on d.id=cs.edge_device_id
     join services s on s.id=cs.service_id
     join stream_sessions ss
       on ss.service_id=cs.service_id
      and ss.publisher_edge_device_id=cs.edge_device_id
      and ss.router_path=cs.stream_path
      and ss.status in ('starting','live')
     where cs.stream_path=$1
       and cs.token_hash=$2
       and cs.protocol='srt'
       and cs.revoked_at is null
       and cs.expires_at > $3::timestamptz
       and d.status='active'
       and d.organization_id=cs.organization_id
       and d.active_service_id=cs.service_id
       and s.organization_id=cs.organization_id
       and s.status in ('ready','live')`;

  const accepted = await client.query(authSql, [authoritativePath, hashContributionToken(token1), fixedNow.toISOString()]);
  assert.equal(accepted.rowCount, 1, "Publisher path/token/device/session scope must authorize");

  const wrongToken = await client.query(authSql, [authoritativePath, hashContributionToken("wrong-token"), fixedNow.toISOString()]);
  assert.equal(wrongToken.rowCount, 0, "Wrong token must not authorize");

  await client.query("update edge_stream_contribution_sessions set revoked_at=$2,updated_at=now() where id=$1", [grant1.sessionId, fixedNow.toISOString()]);

  // Even with a structurally valid contribution record, a different assigned Edge
  // cannot publish the session owned by the selected publisher.
  const impostorNow = new Date(fixedNow.getTime() + 60_000);
  const impostorGrant = createEdgeContributionGrant("srt://router.example.test:8890", impostorNow, authoritativePath);
  const impostorToken = new URL(impostorGrant.publishUrl).searchParams.get("streamid")?.split(":").at(-1);
  assert.ok(impostorToken);
  await client.query(
    `insert into edge_stream_contribution_sessions
      (id,organization_id,edge_device_id,service_id,protocol,stream_path,token_hash,router_authority,issued_at,expires_at)
     values ($1,$2,$3,$4,'srt',$5,$6,$7,$8,$9)`,
    [impostorGrant.sessionId, organizationId, otherDeviceId, serviceId, authoritativePath, impostorGrant.tokenHash, impostorGrant.routerAuthority, impostorNow.toISOString(), impostorGrant.expiresAt]
  );
  const impostorAccepted = await client.query(authSql, [authoritativePath, hashContributionToken(impostorToken), impostorNow.toISOString()]);
  assert.equal(impostorAccepted.rowCount, 0, "Non-publisher Edge must not authorize even when assigned to the service");
  await client.query("update edge_stream_contribution_sessions set revoked_at=$2,updated_at=now() where id=$1", [impostorGrant.sessionId, impostorNow.toISOString()]);

  // The authoritative service path is reusable for the next short-lived grant once
  // the previous owner is revoked; history remains intact.
  const renewalNow = new Date(fixedNow.getTime() + 120_000);
  const grant2 = createEdgeContributionGrant("srt://router.example.test:8890", renewalNow, authoritativePath);
  const token2 = new URL(grant2.publishUrl).searchParams.get("streamid")?.split(":").at(-1);
  assert.ok(token2);
  await client.query(
    `insert into edge_stream_contribution_sessions
      (id,organization_id,edge_device_id,service_id,protocol,stream_path,token_hash,router_authority,issued_at,expires_at)
     values ($1,$2,$3,$4,'srt',$5,$6,$7,$8,$9)`,
    [grant2.sessionId, organizationId, publisherId, serviceId, authoritativePath, grant2.tokenHash, grant2.routerAuthority, renewalNow.toISOString(), grant2.expiresAt]
  );
  const renewed = await client.query(authSql, [authoritativePath, hashContributionToken(token2), renewalNow.toISOString()]);
  assert.equal(renewed.rowCount, 1, "Publisher renewal on the stable service path must authorize");
  const pathHistory = await client.query(
    `select count(*)::int as total,count(*) filter (where revoked_at is null)::int as active
     from edge_stream_contribution_sessions where stream_path=$1`,
    [authoritativePath]
  );
  assert.ok(pathHistory.rows[0].total >= 3, "Contribution history must retain prior grants for the stable path");
  assert.equal(pathHistory.rows[0].active, 1, "Exactly one unrevoked grant may own the stable path");

  console.log("Stream contribution self-test passed (authoritative path, publisher binding, token security, revocation and path reuse).");
} finally {
  await client.query("rollback");
  await client.end();
}
