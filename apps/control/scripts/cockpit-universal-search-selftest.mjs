#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";
import { searchCockpit, UNIVERSAL_SEARCH_GROUPS } from "../src/lib/cockpit/search.ts";

assert.deepEqual(UNIVERSAL_SEARCH_GROUPS.map((group) => group.label), ["Scripture", "Songs", "Media", "Service", "Visual Sources", "Actions"]);

const { readFile } = await import("node:fs/promises");
const workflowSource = await readFile(new URL("../../../.github/workflows/control-ci.yml", import.meta.url), "utf8");
assert.match(workflowSource, /test:cockpit-universal-search/, "Control Portal CI must run universal search contract");
const searchRouteSource = await readFile(new URL("../src/app/api/v1/cockpit/search/route.ts", import.meta.url), "utf8").catch(() => null);
assert.ok(searchRouteSource, "authenticated universal search API route must exist");
assert.match(searchRouteSource, /export async function GET/);
assert.match(searchRouteSource, /auth\(\)/);
assert.match(searchRouteSource, /status:\s*401/);
assert.match(searchRouteSource, /forcePasswordChange/);
assert.match(searchRouteSource, /status:\s*403/);
assert.match(searchRouteSource, /q:\s*z\.string\(\)\.trim\(\)\.min\(1\)\.max\(120\)/);
assert.match(searchRouteSource, /limit:[\s\S]*?min\(1\)[\s\S]*?max\(8\)/);
assert.match(searchRouteSource, /searchCockpit/);
assert.match(searchRouteSource, /NextResponse\.json\(\{\s*ok:\s*true,\s*search/);
assert.doesNotMatch(searchRouteSource, /client\.query\(["'`]\s*(?:begin|commit|insert|update|delete)/i, "search route must not create its own DB mutation path");

const blankClient = { query: async () => { throw new Error("blank query must not touch the database"); } };
const blank = await searchCockpit(blankClient, "00000000-0000-4000-8000-000000000001", { query: "   " });
assert.equal(blank.query, "");
assert.deepEqual(blank.groups, []);

if (!process.env.DATABASE_URL) {
  console.log(JSON.stringify({ ok:true, mode:"local-contract", groups:UNIVERSAL_SEARCH_GROUPS.map((group)=>group.id), blankReadOnly:true, database:"deferred-to-ci" }));
  process.exit(0);
}

assertWritableSelfTestDatabase(process.env.DATABASE_URL);
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
const org=randomUUID(), otherOrg=randomUUID(), campus=randomUUID(), operator=randomUUID(), viewer=randomUUID(), service=randomUUID(), plan=randomUUID(), subscription=randomUUID(), foreignMedia=randomUUID();
const song=randomUUID(), media=randomUUID(), slide=randomUUID(), mediaSource=randomUUID(), edge=randomUUID(), visual=randomUUID();
const now=new Date("2099-06-01T10:00:00.000Z");
try {
  await client.query("begin");
  await client.query(`insert into organizations(id,name,slug,country_code,timezone) values ($1,'Universal Search Church',$2,'GH','Africa/Accra'),($3,'Other Church',$4,'GH','Africa/Accra')`,[org,`search-${org}`,otherOrg,`search-${otherOrg}`]);
  await client.query(`insert into campuses(id,organization_id,name,slug,city,country_code) values ($1,$2,'Main','main','Accra','GH')`,[campus,org]);
  await client.query(`insert into users(id,email,display_name,status) values ($1,$2,'Search Operator','active'),($3,$4,'Search Viewer','active')`,[operator,`search-op-${operator}@example.invalid`,viewer,`search-view-${viewer}@example.invalid`]);
  await client.query(`insert into user_organization_roles(user_id,organization_id,role_id) values ($1,$2,'media_operator'),($3,$2,'viewer')`,[operator,org,viewer]);
  await client.query(`insert into services(id,organization_id,campus_id,title,status,scheduled_start,started_at,active_bible_version,ai_enabled,updated_at) values ($1,$2,$3,'Sunday Celebration','live',$4,$4,'WEBP',true,$4)`,[service,org,campus,now]);
  await client.query(`insert into subscription_plans(id,code,name,enabled,billing_interval,default_device_seat_limit,features,numeric_limits) values ($1,$2,'Search Plan',true,'custom',3,$3::jsonb,'{}'::jsonb)`,[plan,`search-${plan}`,JSON.stringify({"core.presentation":true,"ai.director":true,"streaming.web":true,"streaming.social":true})]);
  await client.query(`insert into organization_subscriptions(id,organization_id,plan_id,status,starts_at,expires_at,grace_until) values ($1,$2,$3,'active','2098-01-01T00:00:00Z','2100-01-01T00:00:00Z','2100-01-08T00:00:00Z')`,[subscription,org,plan]);
  await client.query(`insert into media_sources(id,organization_id,name,source_type,status,public_config) values ($1,$2,'Welcome Video Asset','media_file','ready',$3::jsonb)`,[mediaSource,org,JSON.stringify({assetUrl:'https://example.invalid/welcome.mp4',mediaKind:'video'})]);
  await client.query(`insert into media_library_items(id,organization_id,item_type,title,planner_input,media_source_id,created_by,updated_at) values
    ($1,$4,'song','Way Maker',$5::jsonb,null,$8,$9),
    ($2,$4,'media','Welcome Video',$6::jsonb,$7,$8,$9),
    ($3,$4,'slide','Welcome Visitors',$10::jsonb,null,$8,$9)`,[
      song,media,slide,org,
      JSON.stringify({title:"Way Maker",sections:[{label:"Verse",text:"Way maker"}]}),
      JSON.stringify({title:"Welcome Video",sourceId:mediaSource,mediaKind:"video"}),mediaSource,operator,now,
      JSON.stringify({title:"Welcome Visitors",body:"We are glad you are here"})
    ]);
  await client.query(`insert into media_library_items(id,organization_id,item_type,title,planner_input,created_by,updated_at) values ($1,$2,'slide','Welcome Secret Other Church',$3::jsonb,$4,$5)`,[foreignMedia,otherOrg,JSON.stringify({title:"Welcome Secret Other Church",body:"Private other church slide"}),operator,now]);
  await client.query(`insert into presentation_items(service_id,item_type,title,content,sort_order,state,updated_at) values ($1,'announcement','Offering Time',$2::jsonb,10,'queued',$3)`,[service,JSON.stringify({body:"Giving"}),now]);
  await client.query(`insert into edge_devices(id,organization_id,name,platform,status,last_seen_at,active_service_id) values ($1,$2,'Sanctuary PC','windows','active',$3,$4)`,[edge,org,now,service]);
  await client.query(`insert into media_sources(id,organization_id,name,source_type,status,last_seen_at,edge_device_id,source_key,metadata,public_config) values ($1,$2,'Pulpit Camera','camera','ready',$3,$4,'camera:pulpit',$5::jsonb,'{}'::jsonb)`,[visual,org,now,edge,JSON.stringify({captureStatus:"ready",reportedName:"Pulpit Camera"})]);

  const scripture = await searchCockpit(client,operator,{query:"John 3:16",limitPerGroup:3,now});
  assert.equal(scripture.query,"John 3:16");
  assert.ok(scripture.groups.find((group)=>group.id==="scripture")?.items.some((item)=>item.title.includes("John 3:16")),"direct Scripture reference must resolve locally");

  const songSearch = await searchCockpit(client,operator,{query:"Way Maker",limitPerGroup:3,now});
  assert.ok(songSearch.groups.find((group)=>group.id==="songs")?.items.some((item)=>item.id===song));
  assert.ok(!songSearch.groups.find((group)=>group.id==="media")?.items.some((item)=>item.id===song),"song must not leak into Media group");

  const mediaSearch = await searchCockpit(client,operator,{query:"Welcome",limitPerGroup:8,now});
  assert.ok(mediaSearch.groups.find((group)=>group.id==="media")?.items.some((item)=>item.id===media));
  assert.ok(mediaSearch.groups.find((group)=>group.id==="media")?.items.some((item)=>item.id===slide));
  assert.ok(!mediaSearch.groups.some((group)=>group.items.some((item)=>item.id===foreignMedia)),"search must not leak results from another organization");

  const serviceSearch = await searchCockpit(client,operator,{query:"Offering",limitPerGroup:3,now});
  assert.ok(serviceSearch.groups.find((group)=>group.id==="service")?.items.some((item)=>item.title==="Offering Time"));

  const visualSearch = await searchCockpit(client,operator,{query:"Pulpit",limitPerGroup:3,now});
  assert.ok(visualSearch.groups.find((group)=>group.id==="visual_sources")?.items.some((item)=>item.id===visual));

  const zero = await searchCockpit(client,operator,{query:"zzzz-no-match-zzzz",limitPerGroup:2,now});
  assert.ok(zero.groups.some((group)=>group.items.length===0),"accessible zero-result groups must be preserved by the service");

  const bounded = await searchCockpit(client,operator,{query:`  ${"x".repeat(180)}  `,limitPerGroup:999,now});
  assert.equal(bounded.query.length,120);
  for (const group of bounded.groups) assert.ok(group.items.length<=8,"limitPerGroup must clamp to 8");

  await client.query(`update subscription_plans set features='{}'::jsonb where id=$1`,[plan]);
  const filtered = await searchCockpit(client,operator,{query:"Welcome",limitPerGroup:5,now});
  assert.equal(filtered.groups.some((group)=>group.id==="media"),false,"Media group must be omitted without capability");
  assert.equal(filtered.groups.some((group)=>group.id==="songs"),false,"Songs group must be omitted without capability");
  assert.equal(filtered.groups.some((group)=>group.id==="visual_sources"),false,"Visual Sources group must be omitted without capability");
  assert.equal(filtered.groups.find((group)=>group.id==="actions")?.items.some((item)=>item.href==="/scripture"),false,"Scripture action must also obey core.presentation entitlement");

  const writesBefore = await client.query(`select count(*)::int as count from audit_events where organization_id=$1`,[org]);
  await searchCockpit(client,viewer,{query:"Offering",limitPerGroup:2,now});
  const writesAfter = await client.query(`select count(*)::int as count from audit_events where organization_id=$1`,[org]);
  assert.equal(writesAfter.rows[0].count,writesBefore.rows[0].count,"search must remain read-only");

  await client.query("rollback");
  console.log(JSON.stringify({ok:true,groups:UNIVERSAL_SEARCH_GROUPS.map((group)=>group.id),scripture:true,songMediaSplit:true,service:true,visual:true,capabilityFiltering:true,bounded:true,readOnly:true}));
} catch(error) {
  await client.query("rollback").catch(()=>{});
  throw error;
} finally { client.release(); await pool.end(); }
