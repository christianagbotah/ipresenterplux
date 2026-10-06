import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import process from "node:process";
import pg from "pg";
import ts from "typescript";

process.loadEnvFile?.(".env.local");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");

const source = await readFile(new URL("../src/lib/stream-contribution.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
const { createEdgeContributionGrant, hashContributionToken } = await import(moduleUrl);

const fixedNow = new Date("2026-10-06T01:00:00.000Z");
const grant = createEdgeContributionGrant("srt://router.example.test:8890", fixedNow);
const publishUrl = new URL(grant.publishUrl);
const streamId = publishUrl.searchParams.get("streamid");
assert.equal(publishUrl.protocol, "srt:");
assert.equal(publishUrl.searchParams.get("pkt_size"), "1316");
assert.ok(streamId?.startsWith(`publish:${grant.streamPath}:edge:`), "Expected MediaMTX publish:path:user:password syntax");
const token = streamId.split(":").at(-1);
assert.ok(token && token.length >= 40, "Expected strong one-time token");
assert.equal(hashContributionToken(token), grant.tokenHash, "Stored hash must match the raw publish credential");
assert.equal(grant.expiresAt, "2026-10-06T01:05:00.000Z", "Contribution grants must expire after five minutes");
assert.ok(!grant.publishUrl.includes(grant.tokenHash), "Publish URL must never contain the persisted token hash");

for (const invalid of [
  "http://router.example.test:8890",
  "srt://user:pass@router.example.test:8890",
  "srt://router.example.test:8890?secret=value"
]) {
  assert.throws(() => createEdgeContributionGrant(invalid, fixedNow));
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
  await client.query("update services set status='ready' where id=$1", [serviceId]);

  const device = await client.query(
    `insert into edge_devices(organization_id,campus_id,name,platform,status,active_service_id)
     values ($1,$2,$3,'windows','active',$4)
     returning id::text`,
    [organizationId, campusId, `stream-selftest-${Date.now()}`, serviceId]
  );
  const deviceId = device.rows[0].id;

  await client.query(
    `insert into edge_stream_contribution_sessions
      (id,organization_id,edge_device_id,service_id,protocol,stream_path,token_hash,router_authority,issued_at,expires_at)
     values ($1,$2,$3,$4,'srt',$5,$6,$7,$8,$9)`,
    [grant.sessionId, organizationId, deviceId, serviceId, grant.streamPath, grant.tokenHash, grant.routerAuthority, fixedNow.toISOString(), grant.expiresAt]
  );

  // Use database time anchored inside the grant window so the same authorization predicate
  // used by the MediaMTX callback can be exercised deterministically.
  const accepted = await client.query(
    `select cs.id::text
     from edge_stream_contribution_sessions cs
     join edge_devices d on d.id=cs.edge_device_id
     join services s on s.id=cs.service_id
     where cs.stream_path=$1
       and cs.token_hash=$2
       and cs.protocol='srt'
       and cs.revoked_at is null
       and cs.expires_at > $3::timestamptz
       and d.status='active'
       and d.organization_id=cs.organization_id
       and d.active_service_id=cs.service_id
       and s.organization_id=cs.organization_id
       and s.status in ('ready','live')`,
    [grant.streamPath, hashContributionToken(token), fixedNow.toISOString()]
  );
  assert.equal(accepted.rowCount, 1, "Valid path/token/device/service scope must authorize");

  const wrongToken = await client.query(
    `select 1 from edge_stream_contribution_sessions
     where stream_path=$1 and token_hash=$2 and revoked_at is null`,
    [grant.streamPath, hashContributionToken("wrong-token")]
  );
  assert.equal(wrongToken.rowCount, 0, "Wrong token must not authorize");

  await client.query("update edge_stream_contribution_sessions set revoked_at=$2 where id=$1", [grant.sessionId, fixedNow.toISOString()]);
  const revoked = await client.query(
    `select 1 from edge_stream_contribution_sessions
     where stream_path=$1 and token_hash=$2 and revoked_at is null`,
    [grant.streamPath, grant.tokenHash]
  );
  assert.equal(revoked.rowCount, 0, "Revoked contribution must not authorize");

  console.log("Stream contribution self-test passed (SRT wire format, 5-minute TTL, hashed credential, scope and revocation).");
} finally {
  await client.query("rollback");
  await client.end();
}
