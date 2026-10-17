#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";
import { upsertEdgeMediaSource } from "../src/lib/edge-media-source-persistence.ts";

const migrationSource = await readFile(new URL("../db/042_visual_source_identity.sql", import.meta.url), "utf8");
assert.match(migrationSource, /organization_id\s*,\s*edge_device_id\s*,\s*source_key/i);
assert.match(migrationSource, /where\s+edge_device_id\s+is\s+not\s+null\s+and\s+source_key\s+is\s+not\s+null/i);
assert.match(migrationSource, /visual_source_identity_duplicate_preflight_failed/i);
assert.doesNotMatch(migrationSource, /drop\s+constraint[^;]*organization_id[^;]*name/i,
  "legacy organization/name uniqueness must remain additive and intact");

const routeSource = await readFile(new URL("../src/app/api/v1/edge/media-source/route.ts", import.meta.url), "utf8");
assert.match(routeSource, /upsertEdgeMediaSource/);
assert.doesNotMatch(routeSource, /on conflict\s*\(organization_id\s*,\s*name\)/i,
  "Edge telemetry must no longer treat the friendly name as physical source identity");

if (!process.env.DATABASE_URL) {
  console.log(JSON.stringify({
    ok: true,
    mode: "local-contract",
    database: "deferred-to-ci",
    stableIdentity: ["organization_id", "edge_device_id", "source_key"],
    legacyNameConstraintPreserved: true
  }));
  process.exit(0);
}

assertWritableSelfTestDatabase(process.env.DATABASE_URL);
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
const organizationId = randomUUID();
const edgeA = randomUUID();
const edgeB = randomUUID();
const legacyId = randomUUID();
const firstObservedAt = new Date("2099-01-01T12:00:00.000Z");
const renameObservedAt = new Date("2099-01-01T12:01:00.000Z");
const staleObservedAt = new Date("2099-01-01T11:59:00.000Z");

try {
  await client.query("begin");
  await client.query(
    `insert into organizations(id,name,slug,country_code,timezone)
     values ($1,'Visual Identity Test',$2,'GH','Africa/Accra')`,
    [organizationId, `visual-identity-${organizationId}`]
  );
  await client.query(
    `insert into edge_devices(id,organization_id,name,platform,status,last_seen_at,capabilities) values
      ($1,$3,'Edge A','windows','active',$5,'{}'::jsonb),
      ($2,$3,'Edge B','windows','active',$5,'{}'::jsonb)`,
    [edgeA, edgeB, organizationId, null, firstObservedAt]
  );
  await client.query(
    `insert into media_sources(id,organization_id,name,source_type,status,metadata,public_config)
     values ($1,$2,'Legacy Manual Camera','camera','ready','{}'::jsonb,'{}'::jsonb)`,
    [legacyId, organizationId]
  );

  const sourceA = await upsertEdgeMediaSource(client, {
    organizationId,
    deviceId: edgeA,
    sourceKey: "windows:camera:usb-main",
    reportedName: "USB Camera",
    sourceType: "camera",
    status: "ready",
    observedAt: firstObservedAt,
    metadata: { captureStatus: "available", previewActive: "false", programActive: "false" },
    publicConfig: { edgeDeviceId: edgeA, sourceId: "windows:camera:usb-main" }
  });
  const sourceB = await upsertEdgeMediaSource(client, {
    organizationId,
    deviceId: edgeB,
    sourceKey: "windows:camera:usb-main",
    reportedName: "USB Camera",
    sourceType: "camera",
    status: "ready",
    observedAt: firstObservedAt,
    metadata: { captureStatus: "available", previewActive: "false", programActive: "false" },
    publicConfig: { edgeDeviceId: edgeB, sourceId: "windows:camera:usb-main" }
  });

  assert.notEqual(sourceA.id, sourceB.id, "same friendly name on separate Edge devices must create separate source rows");
  assert.notEqual(sourceA.storageName, sourceB.storageName, "legacy organization/name uniqueness must be satisfied without conflating source identity");
  assert.equal(sourceA.reportedName, "USB Camera");
  assert.equal(sourceB.reportedName, "USB Camera");

  const renamed = await upsertEdgeMediaSource(client, {
    organizationId,
    deviceId: edgeA,
    sourceKey: "windows:camera:usb-main",
    reportedName: "Pulpit Camera",
    sourceType: "camera",
    status: "live",
    observedAt: renameObservedAt,
    metadata: { captureStatus: "available", previewActive: "false", programActive: "true" },
    publicConfig: { edgeDeviceId: edgeA, sourceId: "windows:camera:usb-main" }
  });
  assert.equal(renamed.id, sourceA.id, "friendly-name changes must update the stable physical source row");
  assert.equal(renamed.reportedName, "Pulpit Camera");
  assert.equal(renamed.status, "live");
  assert.equal(renamed.applied, true);

  const stale = await upsertEdgeMediaSource(client, {
    organizationId,
    deviceId: edgeA,
    sourceKey: "windows:camera:usb-main",
    reportedName: "Stale Wrong Name",
    sourceType: "camera",
    status: "error",
    observedAt: staleObservedAt,
    metadata: { captureStatus: "error", previewActive: "true", programActive: "false", errorCode: "stale" },
    publicConfig: { edgeDeviceId: edgeA, sourceId: "windows:camera:usb-main" }
  });
  assert.equal(stale.id, sourceA.id);
  assert.equal(stale.applied, false, "older observations must not roll source truth backward");

  const persisted = await client.query(
    `select id::text,name,status,last_seen_at::text,metadata
       from media_sources
      where organization_id=$1 and edge_device_id=$2 and source_key=$3`,
    [organizationId, edgeA, "windows:camera:usb-main"]
  );
  assert.equal(persisted.rowCount, 1);
  assert.equal(persisted.rows[0].id, sourceA.id);
  assert.equal(persisted.rows[0].status, "live");
  assert.equal(persisted.rows[0].metadata.reportedName, "Pulpit Camera");
  assert.equal(persisted.rows[0].metadata.captureStatus, "available");
  assert.equal(new Date(persisted.rows[0].last_seen_at).toISOString(), renameObservedAt.toISOString());

  const countA = await client.query(
    `select count(*)::int as count
       from media_sources
      where organization_id=$1 and edge_device_id=$2 and source_key=$3`,
    [organizationId, edgeA, "windows:camera:usb-main"]
  );
  assert.equal(countA.rows[0].count, 1);

  const legacy = await client.query(
    `select id::text,edge_device_id,source_key,name from media_sources where id=$1`,
    [legacyId]
  );
  assert.equal(legacy.rowCount, 1);
  assert.equal(legacy.rows[0].edge_device_id, null);
  assert.equal(legacy.rows[0].source_key, null);
  assert.equal(legacy.rows[0].name, "Legacy Manual Camera");

  const index = await client.query(
    `select indexdef
       from pg_indexes
      where schemaname=current_schema()
        and tablename='media_sources'
        and indexname='uq_media_sources_edge_source_identity'`
  );
  assert.equal(index.rowCount, 1, "stable visual-source identity index must exist");
  assert.match(index.rows[0].indexdef, /organization_id, edge_device_id, source_key/i);
  assert.match(index.rows[0].indexdef, /WHERE \(\(edge_device_id IS NOT NULL\) AND \(source_key IS NOT NULL\)\)/i);

  await client.query("rollback");
  console.log(JSON.stringify({
    ok: true,
    sameFriendlyNameAcrossEdges: true,
    stableRenameIdentity: true,
    staleObservationRejected: true,
    legacyRowsPreserved: true,
    stableIdentityIndex: true
  }));
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
