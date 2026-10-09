#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";

const cameras = await import("../src/lib/camera-sources.ts");
assert.equal(typeof cameras.listCameraSources, "function");
assert.equal(typeof cameras.setCameraPreference, "function");
assert.equal(typeof cameras.clearCameraPreference, "function");

const pageSource = await readFile(new URL("../src/app/cameras/page.tsx", import.meta.url), "utf8");
assert.match(pageSource, /CameraWorkspace/);
assert.doesNotMatch(pageSource, /StudioReadinessPage/);
const workspaceSource = await readFile(new URL("../src/components/cameras/CameraWorkspace.tsx", import.meta.url), "utf8");
for (const copy of ["Edge camera sources", "Preferred source", "Permission required", "Manage Edge Devices"]) {
  assert.ok(workspaceSource.includes(copy), `Camera workspace must surface '${copy}'`);
}
assert.doesNotMatch(workspaceSource, /getUserMedia|mediaDevices/, "browser capture must not be claimed by Camera workspace");
const apiSource = await readFile(new URL("../src/app/api/v1/cameras/preferences/route.ts", import.meta.url), "utf8");
assert.doesNotMatch(apiSource, /getUserMedia|mediaDevices/);

if (!process.env.DATABASE_URL) {
  console.log(JSON.stringify({ ok: true, mode: "local-contract", database: "deferred-to-ci", browserCaptureClaimed: false }));
  process.exit(0);
}

assertWritableSelfTestDatabase(process.env.DATABASE_URL);
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
const orgA = randomUUID();
const orgB = randomUUID();
const admin = randomUUID();
const viewer = randomUUID();
const edge = randomUUID();
const otherEdge = randomUUID();
const freshCamera = randomUUID();
const staleCamera = randomUUID();
const permissionCamera = randomUUID();
const unsupportedCamera = randomUUID();
const now = new Date("2099-01-01T12:00:00.000Z");

async function expectCameraError(action, code) {
  try {
    await action();
    assert.fail(`expected ${code}`);
  } catch (error) {
    assert.ok(error instanceof cameras.CameraSourceError, `expected CameraSourceError for ${code}`);
    assert.equal(error.code, code);
  }
}

try {
  await client.query("begin");
  await client.query(
    `insert into organizations(id,name,slug,country_code,timezone) values
      ($1,'Camera Test A',$2,'GH','Africa/Accra'),
      ($3,'Camera Test B',$4,'GH','Africa/Accra')`,
    [orgA, `camera-a-${orgA}`, orgB, `camera-b-${orgB}`]
  );
  await client.query(
    `insert into users(id,email,display_name,status) values
      ($1,$2,'Camera Admin','active'),
      ($3,$4,'Camera Viewer','active')`,
    [admin, `camera-admin-${admin}@example.invalid`, viewer, `camera-view-${viewer}@example.invalid`]
  );
  await client.query(
    `insert into user_organization_roles(user_id,organization_id,role_id) values
      ($1,$2,'admin'),($3,$2,'viewer')`,
    [admin, orgA, viewer]
  );
  await client.query(
    `insert into edge_devices(id,organization_id,name,platform,status,last_seen_at,capabilities) values
      ($1,$3,'Sanctuary Edge','windows','active',$4,'{"camera.capture":"available"}'::jsonb),
      ($2,$5,'Foreign Edge','macos','active',$4,'{"camera.capture":"available"}'::jsonb)`,
    [edge, otherEdge, orgA, now, orgB]
  );
  await client.query(
    `insert into media_sources(id,organization_id,name,source_type,status,edge_device_id,source_key,last_seen_at,metadata,public_config) values
      ($1,$5,'Main Camera','camera','ready',$6,'camera-main',$7,'{"permission":"granted","captureSupported":"true"}'::jsonb,'{"previewUrl":"https://edge.example.invalid/preview/main"}'::jsonb),
      ($2,$5,'Balcony Camera','video_input','ready',$6,'camera-balcony',$8,'{"permission":"granted","captureSupported":"true"}'::jsonb,'{}'::jsonb),
      ($3,$5,'Choir Camera','video_capture','warning',$6,'camera-choir',$7,'{"permission":"denied","captureSupported":"true"}'::jsonb,'{}'::jsonb),
      ($4,$5,'Legacy Camera','camera','ready',$6,'camera-legacy',$7,'{"permission":"granted","captureSupported":"false"}'::jsonb,'{}'::jsonb)`,
    [
      freshCamera, staleCamera, permissionCamera, unsupportedCamera, orgA, edge,
      new Date(now.getTime() - 30_000),
      new Date(now.getTime() - 180_000)
    ]
  );

  const listed = await cameras.listCameraSources(client, admin, orgA, { now });
  assert.equal(listed.hasPairedEdge, true);
  assert.equal(listed.sources.length, 4);
  const byName = Object.fromEntries(listed.sources.map((source) => [source.name, source]));
  assert.equal(byName["Main Camera"].status, "available");
  assert.equal(byName["Main Camera"].reportingDevice.name, "Sanctuary Edge");
  assert.equal(byName["Main Camera"].previewUrl, "https://edge.example.invalid/preview/main");
  assert.equal(byName["Balcony Camera"].status, "disconnected");
  assert.equal(byName["Choir Camera"].status, "permission_required");
  assert.equal(byName["Legacy Camera"].status, "unsupported");

  const viewerList = await cameras.listCameraSources(client, viewer, orgA, { now });
  assert.equal(viewerList.sources.length, 4, "view-only membership may inspect camera truth");
  await expectCameraError(() => cameras.listCameraSources(client, admin, orgB, { now }), "camera_forbidden");

  await cameras.setCameraPreference(client, admin, {
    organizationId: orgA,
    mediaSourceId: freshCamera,
    operatorLabel: "Pulpit close-up",
    preferred: true
  });
  const preferred = await cameras.listCameraSources(client, admin, orgA, { now });
  const main = preferred.sources.find((source) => source.id === freshCamera);
  assert.equal(main?.operatorLabel, "Pulpit close-up");
  assert.equal(main?.preferred, true);

  await expectCameraError(
    () => cameras.setCameraPreference(client, viewer, {
      organizationId: orgA,
      mediaSourceId: freshCamera,
      operatorLabel: "Viewer edit",
      preferred: false
    }),
    "camera_admin_required"
  );

  await cameras.clearCameraPreference(client, admin, { organizationId: orgA, mediaSourceId: freshCamera });
  const cleared = await cameras.listCameraSources(client, admin, orgA, { now });
  assert.equal(cleared.sources.find((source) => source.id === freshCamera)?.operatorLabel, null);

  const audit = await client.query(
    `select action from audit_events
     where organization_id=$1 and entity_id=$2
       and action in ('camera.preference.updated','camera.preference.cleared')
     order by id`,
    [orgA, freshCamera]
  );
  assert.deepEqual(new Set(audit.rows.map((row) => row.action)), new Set(["camera.preference.updated", "camera.preference.cleared"]));

  await client.query("rollback");
  console.log(JSON.stringify({
    ok: true,
    edgeTelemetryTruth: true,
    staleThresholdSeconds: 120,
    statuses: ["available", "disconnected", "permission_required", "unsupported"],
    viewOnlyStatus: true,
    adminMutationOnly: true,
    tenantIsolation: true,
    browserCaptureClaimed: false
  }));
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
