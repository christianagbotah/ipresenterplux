#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";
import {
  COCKPIT_INTENT_IDS,
  CockpitCommandError,
  executeCockpitIntent,
  resolveCockpitCommand
} from "../src/lib/cockpit/commands.ts";

const context = { organizationId: "00000000-0000-4000-8000-000000000001", serviceId: "00000000-0000-4000-8000-000000000002", defaultBibleVersion: "WEBP" };
const niv = resolveCockpitCommand("Show John 3:16 NIV", context);
assert.equal(niv.status, "ready");
assert.equal(niv.intent?.id, "scripture.preview");
assert.equal(niv.intent?.reference, "John 3:16");
assert.equal(niv.intent?.version, "NIV");
const media = resolveCockpitCommand("Find Amazing Grace", context);
assert.equal(media.status, "ready");
assert.equal(media.intent?.id, "media.search");
assert.equal(media.intent?.query, "Amazing Grace");
const status = resolveCockpitCommand("What is wrong with streaming?", context);
assert.equal(status.status, "ready");
assert.equal(status.intent?.id, "status.explain");
assert.equal(status.intent?.capability, "streaming");
const risky = resolveCockpitCommand("start YouTube", context);
assert.equal(risky.status, "needs_confirmation");
assert.equal(risky.intent, null, "unsupported live mutation must not be guessed into an executable intent");
const sql = resolveCockpitCommand("DROP TABLE services", context);
assert.equal(sql.status, "unknown");
assert.equal(sql.intent, null);
for (const id of COCKPIT_INTENT_IDS) {
  assert.doesNotMatch(id, /program|sql|credential|device\.secret/i, `intent ${id} must not bypass live/device authority`);
}
const { readFile } = await import("node:fs/promises");
const commandRouteSource = await readFile(new URL("../src/app/api/v1/cockpit/command/route.ts", import.meta.url), "utf8").catch(() => null);
assert.ok(commandRouteSource, "typed Cockpit command API route must exist");
assert.match(commandRouteSource, /resolveCockpitCommand/);
assert.match(commandRouteSource, /executeCockpitIntent/);
const paletteSource = await readFile(new URL("../src/components/cockpit/CommandPalette.tsx", import.meta.url), "utf8").catch(() => null);
assert.ok(paletteSource, "Cockpit command palette must exist");
assert.match(paletteSource, /metaKey|ctrlKey/, "palette must support Ctrl\/Cmd keyboard access");
assert.match(paletteSource, /input,textarea|closest\(.*input/, "palette trigger must preserve text-field focus");
assert.match(paletteSource, /state:\s*["']preview["']/, "prepared Scripture command must reuse explicit Preview endpoint");
assert.doesNotMatch(paletteSource, /program\.show|state:\s*["']live["']/, "palette must not perform direct Program mutation");
const cockpitSource = await readFile(new URL("../src/components/cockpit/CockpitWorkspace.tsx", import.meta.url), "utf8");
assert.match(cockpitSource, /CommandPalette/, "normal Cockpit must mount the shared command palette");
const focusSource = await readFile(new URL("../src/components/cockpit/FocusMode.tsx", import.meta.url), "utf8");
assert.match(focusSource, /ipresenterplux:command-open/, "Focus Mode command trigger must open the shared palette");


if (!process.env.DATABASE_URL) {
  console.log(JSON.stringify({ ok:true, mode:"local-contract", typedIntents:COCKPIT_INTENT_IDS.length, database:"deferred-to-ci" }));
  process.exit(0);
}
assertWritableSelfTestDatabase(process.env.DATABASE_URL);
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
const org=randomUUID(), campus=randomUUID(), operator=randomUUID(), viewer=randomUUID(), service=randomUUID(), plan=randomUUID(), subscription=randomUUID(), mediaItem=randomUUID();
const now=new Date("2099-06-01T10:00:00.000Z");
try {
  await client.query("begin");
  await client.query(`insert into organizations(id,name,slug,country_code,timezone) values ($1,'Command Church',$2,'GH','Africa/Accra')`,[org,`command-${org}`]);
  await client.query(`insert into campuses(id,organization_id,name,slug,city,country_code) values ($1,$2,'Main','main','Accra','GH')`,[campus,org]);
  await client.query(`insert into users(id,email,display_name,status) values ($1,$2,'Command Operator','active'),($3,$4,'Command Viewer','active')`,[operator,`command-op-${operator}@example.invalid`,viewer,`command-view-${viewer}@example.invalid`]);
  await client.query(`insert into user_organization_roles(user_id,organization_id,role_id) values ($1,$2,'media_operator'),($3,$2,'viewer')`,[operator,org,viewer]);
  await client.query(`insert into services(id,organization_id,campus_id,title,status,scheduled_start,started_at,active_bible_version,ai_enabled,updated_at) values ($1,$2,$3,'Command Live','live',$4,$4,'WEBP',true,$4)`,[service,org,campus,now]);
  await client.query(`insert into subscription_plans(id,code,name,enabled,billing_interval,default_device_seat_limit,features,numeric_limits) values ($1,$2,'Command Plan',true,'custom',3,$3::jsonb,'{}'::jsonb)`,[plan,`command-${plan}`,JSON.stringify({"core.presentation":true,"ai.director":true,"streaming.web":true,"streaming.social":true})]);
  await client.query(`insert into organization_subscriptions(id,organization_id,plan_id,status,starts_at,expires_at,grace_until) values ($1,$2,$3,'active','2098-01-01T00:00:00Z','2100-01-01T00:00:00Z','2100-01-08T00:00:00Z')`,[subscription,org,plan]);
  await client.query(`insert into media_library_items(id,organization_id,item_type,title,planner_input,created_by,updated_at) values ($1,$2,'song','Amazing Grace',$3::jsonb,$4,$5)`,[mediaItem,org,JSON.stringify({title:"Amazing Grace",sections:[{label:"Verse 1",text:"Amazing grace"}]}),operator,now]);

  const runtimeContext={organizationId:org,serviceId:service,defaultBibleVersion:"WEBP"};
  const scriptureResolution=resolveCockpitCommand("Show John 3:16 WEBP",runtimeContext);
  assert.equal(scriptureResolution.status,"ready");
  const prepared=await executeCockpitIntent(client,operator,scriptureResolution.intent,{now});
  assert.equal(prepared.kind,"prepared");
  assert.equal(prepared.followUp?.type,"scripture_preview");
  assert.ok(prepared.followUp?.detectionId);
  const detection=await client.query(`select state,scripture_reference from scripture_detections where id=$1`,[prepared.followUp.detectionId]);
  assert.equal(detection.rows[0]?.state,"detected","command may prepare selection but must not bypass Preview");
  assert.equal(detection.rows[0]?.scripture_reference,"John 3:16");
  const programCommands=await client.query(`select count(*)::int as count from edge_control_commands where service_id=$1 and command_type like 'program.%'`,[service]);
  assert.equal(programCommands.rows[0].count,0,"command execution must not enqueue Program mutation");

  const searchResolution=resolveCockpitCommand("Find Amazing Grace",runtimeContext);
  const searchResult=await executeCockpitIntent(client,operator,searchResolution.intent,{now});
  assert.equal(searchResult.kind,"media_search");
  assert.ok(searchResult.items.some((item)=>item.id===mediaItem));

  const archiveResolution=resolveCockpitCommand("Open archive",runtimeContext);
  const archiveResult=await executeCockpitIntent(client,operator,archiveResolution.intent,{now});
  assert.equal(archiveResult.kind,"navigation");
  assert.equal(archiveResult.href,"/archive");

  const streamResolution=resolveCockpitCommand("What is wrong with streaming?",runtimeContext);
  const streamResult=await executeCockpitIntent(client,operator,streamResolution.intent,{now});
  assert.equal(streamResult.kind,"status");
  assert.equal(streamResult.href,"/streaming");

  await assert.rejects(()=>executeCockpitIntent(client,viewer,scriptureResolution.intent,{now}),(error)=>error instanceof CockpitCommandError && error.status===403,"viewer must not gain Preview authority from command interpretation");
  await client.query(`update user_organization_roles set role_id='viewer' where user_id=$1 and organization_id=$2`,[operator,org]);
  await assert.rejects(()=>executeCockpitIntent(client,operator,scriptureResolution.intent,{now}),(error)=>error instanceof CockpitCommandError && error.status===403,"server must re-check role changes between render and execution");

  await client.query("rollback");
  console.log(JSON.stringify({ok:true,typedRegistry:true,deterministicResolver:true,scripturePreparedNotLive:true,mediaSearch:true,serverReauthorization:true,noProgramIntent:true}));
} catch(error) {
  await client.query("rollback").catch(()=>{});
  throw error;
} finally { client.release(); await pool.end(); }
