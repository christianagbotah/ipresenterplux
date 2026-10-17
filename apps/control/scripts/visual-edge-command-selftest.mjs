#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";
import {
  VisualEdgeCommandError,
  normalizeVisualCommandArguments,
  requireVisualPreviewSourceForDevice
} from "../src/lib/visual-edge-commands.ts";

const edgeCommandsSource = await readFile(new URL("../src/lib/edge-commands.ts", import.meta.url), "utf8");
for (const type of ["visual.rescan", "visual.preview.select", "visual.preview.clear"]) {
  assert.ok(edgeCommandsSource.includes(`"${type}"`), `Edge command registry must include ${type}`);
}
assert.doesNotMatch(edgeCommandsSource, /"visual\.(?:live|program|take)[^"]*"/i,
  "Control Plane must not introduce a visual live-promotion command");
assert.match(edgeCommandsSource, /return mediaCommands\.has\(type\) \? STREAM_OPERATOR_ROLES : LIVE_OPERATOR_ROLES/,
  "visual commands must inherit LIVE_OPERATOR_ROLES, not stream/admin authority");

const routeSource = await readFile(new URL("../src/app/api/v1/edge/devices/[id]/commands/route.ts", import.meta.url), "utf8");
assert.match(routeSource, /device\.status !== "active"/, "inactive Edge devices must be rejected");
assert.match(routeSource, /userHasAnyRole\(session\.user\.id, device\.organization_id, rolesForEdgeCommand\(payload\.type\)\)/,
  "command creation must keep organization-scoped RBAC");
assert.match(routeSource, /Service does not belong to this organization/,
  "service scope must remain organization-bound");
assert.match(routeSource, /requireVisualPreviewSourceForDevice/,
  "visual Preview selection must validate source ownership before insertion");
assert.match(routeSource, /JSON\.stringify\(commandArguments\)/,
  "only normalized visual command arguments may be persisted");
const auditBlock = routeSource.slice(routeSource.indexOf("insert into audit_events"));
assert.doesNotMatch(auditBlock, /payload\.arguments|commandArguments/,
  "audit detail must not copy visual source arguments/native metadata");

assert.deepEqual(normalizeVisualCommandArguments("visual.rescan", {}), {});
assert.deepEqual(normalizeVisualCommandArguments("visual.preview.clear", {}), {});
assert.deepEqual(
  normalizeVisualCommandArguments("visual.preview.select", { sourceId: "  visual:camera:abc  " }),
  { sourceId: "visual:camera:abc" }
);
assert.deepEqual(normalizeVisualCommandArguments("health.query", { verbose: "true" }), { verbose: "true" },
  "non-visual command arguments must remain backward compatible");

for (const [type,args,code] of [
  ["visual.preview.select", {}, "visual_source_required"],
  ["visual.preview.select", { sourceId: "x", extra: "unsafe" }, "visual_command_arguments_invalid"],
  ["visual.rescan", { sourceId: "x" }, "visual_command_arguments_invalid"],
  ["visual.preview.clear", { sourceId: "x" }, "visual_command_arguments_invalid"]
]) {
  assert.throws(
    () => normalizeVisualCommandArguments(type, args),
    (error) => error instanceof VisualEdgeCommandError && error.code === code
  );
}

if (!process.env.DATABASE_URL) {
  console.log(JSON.stringify({
    ok: true,
    mode: "local-contract",
    database: "deferred-to-ci",
    commands: ["visual.rescan", "visual.preview.select", "visual.preview.clear"],
    livePromotionCommand: false
  }));
  process.exit(0);
}

assertWritableSelfTestDatabase(process.env.DATABASE_URL);
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
const orgA = randomUUID();
const orgB = randomUUID();
const edgeA = randomUUID();
const edgeB = randomUUID();
const edgeForeign = randomUUID();
const sourceA = randomUUID();
const sourceB = randomUUID();
const sourceForeign = randomUUID();

async function expectVisualError(action, code) {
  try {
    await action();
    assert.fail(`expected ${code}`);
  } catch (error) {
    assert.ok(error instanceof VisualEdgeCommandError, `expected VisualEdgeCommandError for ${code}`);
    assert.equal(error.code, code);
  }
}

try {
  await client.query("begin");
  await client.query(
    `insert into organizations(id,name,slug,country_code,timezone) values
      ($1,'Visual Cmd A',$2,'GH','Africa/Accra'),
      ($3,'Visual Cmd B',$4,'GH','Africa/Accra')`,
    [orgA, `visual-cmd-a-${orgA}`, orgB, `visual-cmd-b-${orgB}`]
  );
  await client.query(
    `insert into edge_devices(id,organization_id,name,platform,status,capabilities) values
      ($1,$4,'Edge A','windows','active','{}'::jsonb),
      ($2,$4,'Edge B','windows','active','{}'::jsonb),
      ($3,$5,'Foreign Edge','windows','active','{}'::jsonb)`,
    [edgeA, edgeB, edgeForeign, orgA, orgB]
  );
  await client.query(
    `insert into media_sources(id,organization_id,name,source_type,status,edge_device_id,source_key,metadata,public_config) values
      ($1,$4,'Camera A','camera','ready',$5,'visual:camera:a','{}'::jsonb,'{}'::jsonb),
      ($2,$4,'Window B','window','ready',$6,'visual:window:b','{}'::jsonb,'{}'::jsonb),
      ($3,$7,'Foreign Display','display','ready',$8,'visual:display:foreign','{}'::jsonb,'{}'::jsonb)`,
    [sourceA, sourceB, sourceForeign, orgA, edgeA, edgeB, orgB, edgeForeign]
  );

  const owned = await requireVisualPreviewSourceForDevice(client, {
    organizationId: orgA,
    deviceId: edgeA,
    sourceId: "visual:camera:a"
  });
  assert.equal(owned.id, sourceA);
  assert.equal(owned.sourceKey, "visual:camera:a");

  await expectVisualError(
    () => requireVisualPreviewSourceForDevice(client, { organizationId: orgA, deviceId: edgeA, sourceId: "visual:window:b" }),
    "visual_source_not_found"
  );
  await expectVisualError(
    () => requireVisualPreviewSourceForDevice(client, { organizationId: orgA, deviceId: edgeA, sourceId: "visual:display:foreign" }),
    "visual_source_not_found"
  );
  await expectVisualError(
    () => requireVisualPreviewSourceForDevice(client, { organizationId: orgA, deviceId: edgeA, sourceId: "missing" }),
    "visual_source_not_found"
  );

  await client.query("rollback");
  console.log(JSON.stringify({
    ok: true,
    sourceOwnership: true,
    crossDeviceBlocked: true,
    crossTenantBlocked: true,
    visualLiveCommand: false,
    auditArgumentsExcluded: true
  }));
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
