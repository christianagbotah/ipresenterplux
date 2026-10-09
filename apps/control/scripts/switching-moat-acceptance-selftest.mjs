#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";
import { listConfiguredCoexistenceBridges } from "../src/lib/imports/coexistence.ts";

const componentSource = await readFile(new URL("../src/components/imports/CoexistenceBridge.tsx", import.meta.url), "utf8");
const pageSource = await readFile(new URL("../src/app/media/import/page.tsx", import.meta.url), "utf8");
const cockpitSource = await readFile(new URL("../src/components/cockpit/ProgramPreviewStage.tsx", import.meta.url), "utf8");

assert.match(componentSource, /Import existing content/i, "migration UI must expose the import phase");
assert.match(componentSource, /Coexist/i, "migration UI must expose the coexist phase");
assert.match(componentSource, /Replace later/i, "migration UI must expose the replace-later phase");
assert.match(componentSource, /not native project compatibility|not native compatibility/i, "coexistence UI must disclaim proprietary project compatibility");
assert.match(componentSource, /EasyWorship/i);
assert.match(componentSource, /ProPresenter/i);
assert.match(componentSource, /vMix/i);
assert.match(componentSource, /OBS/i);
assert.doesNotMatch(componentSource, /import (?:an? )?(?:EasyWorship|ProPresenter|vMix|OBS) project/i, "UI must never claim proprietary project import");
assert.doesNotMatch(componentSource, /program\.show|program\.clear|\/api\/v1\/scriptures\/.*state/, "coexistence guidance must never mutate Program");
assert.match(pageSource, /listConfiguredCoexistenceBridges/, "import page must derive bridge availability from authoritative configuration");
assert.match(pageSource, /CoexistenceBridge/, "import page must render the migration bridge");
assert.match(cockpitSource, /Preview is the safety boundary before Program/, "existing Preview to Program authority must remain explicit");

if (!process.env.DATABASE_URL) {
  console.log(JSON.stringify({ok:true,mode:"local-contract",database:"deferred-to-ci",phases:["import","coexist","replace_later"],programAuthority:"unchanged"}));
  process.exit(0);
}
assertWritableSelfTestDatabase(process.env.DATABASE_URL);
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
const org = randomUUID();
try {
  await client.query("begin");
  await client.query(`insert into organizations(id,name,slug,country_code,timezone) values ($1,'Switching Church',$2,'GH','Africa/Accra')`, [org, `switching-${org}`]);
  await client.query(`insert into output_destinations(organization_id,name,destination_type,enabled,status,public_config) values
    ($1,'NDI Program','ndi',true,'ready','{"format":"1080p30"}'::jsonb),
    ($1,'Church Web','web_webrtc',true,'ready','{"protocol":"WebRTC"}'::jsonb),
    ($1,'Legacy downstream','custom_rtmp',false,'disconnected','{"protocol":"RTMPS"}'::jsonb),
    ($1,'YouTube Live','youtube',true,'ready','{"protocol":"RTMPS"}'::jsonb),
    ($1,'Mystery adapter','obs_project',true,'ready','{}'::jsonb)`, [org]);
  const bridges = await listConfiguredCoexistenceBridges(client, org);
  assert.deepEqual(bridges.map((bridge) => bridge.type), ["ndi", "web_webrtc", "custom_rtmp"], "only supported protocol bridges configured for this church may be advertised");
  assert.deepEqual(bridges.map((bridge) => bridge.protocol), ["NDI", "WebRTC", "RTMPS"]);
  assert.equal(bridges[0].enabled, true);
  assert.equal(bridges[2].enabled, false, "configured-but-disabled bridge should be visible as unavailable, not invented as active");
  assert.ok(bridges.every((bridge) => !["youtube","facebook","tiktok","obs_project"].includes(bridge.type)), "social/unknown destinations must not be mislabeled as migration bridges");
  await client.query("rollback");
  console.log(JSON.stringify({ok:true,phases:["import","coexist","replace_later"],bridges:bridges.map((x)=>x.type),proprietaryProjectCompatibility:false,programAuthority:"unchanged"}));
} catch (error) {
  await client.query("rollback").catch(()=>{});
  throw error;
} finally {
  client.release();
  await pool.end();
}
