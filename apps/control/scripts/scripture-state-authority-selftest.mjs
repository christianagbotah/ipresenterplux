#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";
import { ScriptureStateError, transitionScriptureState } from "../src/lib/scripture-state.ts";

const routeSource = await readFile(new URL("../src/app/api/v1/scriptures/[id]/state/route.ts", import.meta.url), "utf8");
const authoritySource = await readFile(new URL("../src/lib/scripture-state.ts", import.meta.url), "utf8");
const dispatchSource = await readFile(new URL("../src/lib/edge-command-dispatch.ts", import.meta.url), "utf8");
assert.match(routeSource,/transitionScriptureState/,"manual route must delegate to shared authority");
assert.doesNotMatch(routeSource,/update scripture_detections/i,"manual route must not duplicate state mutation SQL");
assert.doesNotMatch(routeSource,/enqueueServiceEdgeCommand/,"manual route must not dispatch Program directly");
assert.match(authoritySource,/pg_advisory_xact_lock/,"shared authority must serialize service state transitions");
assert.match(authoritySource,/program\.show/,"shared authority must own Program dispatch");
assert.match(authoritySource,/preview\.prepare/,"shared authority must own Preview dispatch");
assert.match(authoritySource,/program\.clear/,"shared authority must own clear dispatch");
assert.match(authoritySource,/requireEdgeForLive/,"automation must be able to require physical Edge authority before persisting live");
assert.match(dispatchSource,/actorType/,"Edge dispatch audit must support operator vs automation actors");

if (!process.env.DATABASE_URL) {
  console.log(JSON.stringify({ok:true,mode:"local-contract",database:"deferred-to-ci",sharedAuthority:true,edgeRequiredLive:true}));
  process.exit(0);
}

assertWritableSelfTestDatabase(process.env.DATABASE_URL);
const { Client }=pg;
const client=new Client({connectionString:process.env.DATABASE_URL});
await client.connect();
const org=randomUUID(), campus=randomUUID(), operator=randomUUID(), automationUser=randomUUID(), service=randomUUID();
const first=randomUUID(), second=randomUUID(), third=randomUUID(), edge=randomUUID();
try {
  await client.query("begin");
  await client.query(`insert into organizations(id,name,slug,country_code,timezone) values ($1,'Authority Church',$2,'GH','Africa/Accra')`,[org,`authority-${org}`]);
  await client.query(`insert into campuses(id,organization_id,name,slug,city,country_code) values ($1,$2,'Main','main','Accra','GH')`,[campus,org]);
  await client.query(`insert into users(id,email,display_name,status) values ($1,$2,'Manual Operator','active'),($3,$4,'Automation Armer','active')`,[operator,`manual-${operator}@example.invalid`,automationUser,`automation-${automationUser}@example.invalid`]);
  await client.query(`insert into services(id,organization_id,campus_id,title,status,scheduled_start,started_at,active_bible_version) values ($1,$2,$3,'Authority Service','live',now(),now(),'WEBP')`,[service,org,campus]);
  await client.query(`insert into scripture_detections(id,service_id,scripture_reference,book,chapter,verse_start,verse_end,bible_version,confidence,state,detection_method,source_observed_at,source_ordinal) values
    ($1,$4,'John 3:16','John',3,16,16,'WEBP',99,'preview','reference',now(),1),
    ($2,$4,'Genesis 1:1','Genesis',1,1,1,'WEBP',99,'live','reference',now(),2),
    ($3,$4,'Romans 8:28','Romans',8,28,28,'WEBP',99,'preview','reference',now(),3)`,[first,second,third,service]);

  await assert.rejects(
    ()=>transitionScriptureState(client,{detectionId:first,targetState:"live",actor:{type:"automation",userId:automationUser,reason:"auto_scripture_live"},source:"scripture.auto_live",requireEdgeForLive:true}),
    (error)=>error instanceof ScriptureStateError && error.code==="active_edge_required" && error.status===409
  );
  const afterRejected=await client.query(`select state from scripture_detections where id=$1`,[first]);
  assert.equal(afterRejected.rows[0].state,"preview","failed physical preflight must not persist live state");
  assert.equal((await client.query(`select count(*)::int as count from edge_control_commands where service_id=$1`,[service])).rows[0].count,0);

  await client.query(`insert into edge_devices(id,organization_id,name,platform,status,last_seen_at,active_service_id) values ($1,$2,'Sanctuary PC','windows','active',now(),$3)`,[edge,org,service]);
  const automated=await transitionScriptureState(client,{detectionId:first,targetState:"live",actor:{type:"automation",userId:automationUser,reason:"auto_scripture_live"},source:"scripture.auto_live",requireEdgeForLive:true});
  assert.equal(automated.scripture.state,"live");
  assert.equal(automated.fromState,"preview");
  assert.equal(automated.edgeCommandsQueued,1);
  assert.equal((await client.query(`select state from scripture_detections where id=$1`,[second])).rows[0].state,"played","new live Scripture must retire previous live Scripture");

  const autoCommand=await client.query(`select command_type,issued_by::text from edge_control_commands where service_id=$1 order by issued_at desc,id desc limit 1`,[service]);
  assert.equal(autoCommand.rows[0].command_type,"program.show");
  assert.equal(autoCommand.rows[0].issued_by,automationUser);
  const autoAudits=await client.query(`select actor_type,actor_id,action,details from audit_events where organization_id=$1 and actor_id=$2 order by created_at,id`,[org,automationUser]);
  assert.ok(autoAudits.rows.some((row)=>row.actor_type==="automation" && row.action==="scripture.state.changed"));
  assert.ok(autoAudits.rows.some((row)=>row.actor_type==="automation" && row.action==="edge.command.issued"));

  const manual=await transitionScriptureState(client,{detectionId:third,targetState:"live",actor:{type:"operator",userId:operator},source:"scripture.state.live"});
  assert.equal(manual.scripture.state,"live");
  assert.equal(manual.edgeCommandsQueued,1);
  const manualAudits=await client.query(`select actor_type,action from audit_events where organization_id=$1 and actor_id=$2 order by created_at,id`,[org,operator]);
  assert.ok(manualAudits.rows.some((row)=>row.actor_type==="operator" && row.action==="scripture.state.changed"));
  assert.ok(manualAudits.rows.some((row)=>row.actor_type==="operator" && row.action==="edge.command.issued"));

  await client.query("rollback");
  console.log(JSON.stringify({ok:true,mode:"postgres",sharedProgramAuthority:true,automationActorAudited:true,operatorActorAudited:true,edgeRequiredBeforeLive:true}));
} catch(error) {
  await client.query("rollback").catch(()=>{});
  throw error;
} finally {
  await client.end();
}
