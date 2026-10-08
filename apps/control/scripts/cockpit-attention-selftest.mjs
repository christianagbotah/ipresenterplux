#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";
import { buildCockpitAttention, loadCockpitAttention } from "../src/lib/cockpit/attention.ts";

const now = new Date("2099-07-01T10:00:00.000Z");
const incidents = buildCockpitAttention({
  now,
  serviceLive: true,
  edge: { name:"Sanctuary Edge", status:"offline", lastSeenAt:new Date(now.getTime()-300_000).toISOString() },
  asr: { name:"Mixer", status:"ready", lastSeenAt:new Date(now.getTime()-10_000).toISOString(), workerStatus:"degraded", engine:"Whisper" },
  translation: { languages:["French"], worker:{ provider:"local", state:"degraded", errorCode:"worker_down", observedAt:new Date(now.getTime()-10_000).toISOString() } },
  tts: { languages:["Ewe"], worker:{ provider:"local", state:"degraded", errorCode:"voice_worker_down", observedAt:new Date(now.getTime()-10_000).toISOString() } },
  streamDestinations: [{ name:"YouTube", destinationType:"youtube", status:"error", providerHealthState:"error", providerLiveState:"not_live", observedAt:new Date(now.getTime()-5_000).toISOString(), errorCode:"provider_not_live", issueCodes:["provider_not_live"] }],
  subscription: { status:"past_due", expiresAt:new Date(now.getTime()-86_400_000).toISOString(), graceUntil:new Date(now.getTime()+3*86_400_000).toISOString() }
});
assert.ok(incidents.length >= 6);
const edge = incidents.find((item)=>item.affectedCapability==="edge");
assert.ok(edge); assert.match(edge.impact,/Edge|local/i); assert.match(edge.recommendedAction,/device|Edge|reconnect/i);
const asr = incidents.find((item)=>item.affectedCapability==="asr");
assert.ok(asr); assert.match(asr.containment,/manual Scripture.*Media|Scripture.*Media.*available/i);
const translation = incidents.find((item)=>item.affectedCapability==="translations.text");
assert.ok(translation); assert.match(translation.impact,/French/); assert.match(translation.containment,/original/i);
const tts = incidents.find((item)=>item.affectedCapability==="translations.audio");
assert.ok(tts); assert.match(tts.impact,/Ewe/); assert.match(tts.containment,/original/i);
const youtube = incidents.find((item)=>item.affectedCapability==="streaming.youtube");
assert.ok(youtube); assert.match(youtube.impact,/YouTube/); assert.match(youtube.containment,/local Program/i); assert.match(youtube.containment,/other|unrelated/i);
const license = incidents.find((item)=>item.affectedCapability==="subscription");
assert.ok(license); assert.match(license.impact,/grace|renewal/i); assert.match(license.containment,/stop.*read.*history.*settings/i);
for (const item of incidents.filter((item)=>item.severity!=="info")) {
  assert.ok(item.impact.trim()); assert.ok(item.containment.trim()); assert.ok(item.recommendedAction.trim());
}
assert.equal(incidents.some((item)=>item.recoveryIntent && !/^(status\.explain:|navigation\.open:)/.test(item.recoveryIntent)), false, "recovery intents must be safe registered read/navigation actions");
const healthy = buildCockpitAttention({
  now, serviceLive:true,
  edge:{name:"Edge",status:"active",lastSeenAt:new Date(now.getTime()-5_000).toISOString()},
  asr:{name:"Mixer",status:"ready",lastSeenAt:new Date(now.getTime()-5_000).toISOString(),workerStatus:"ready",engine:"Whisper"},
  translation:{languages:["French"],worker:{provider:"local",state:"ready",errorCode:null,observedAt:new Date(now.getTime()-5_000).toISOString()}},
  tts:{languages:["Ewe"],worker:{provider:"local",state:"ready",errorCode:null,observedAt:new Date(now.getTime()-5_000).toISOString()}},
  streamDestinations:[{name:"YouTube",destinationType:"youtube",status:"live",providerHealthState:"healthy",providerLiveState:"live",observedAt:new Date(now.getTime()-5_000).toISOString(),errorCode:null,issueCodes:[]}],
  subscription:{status:"active",expiresAt:new Date(now.getTime()+86_400_000).toISOString(),graceUntil:new Date(now.getTime()+8*86_400_000).toISOString()}
});
assert.deepEqual(healthy,[],"resolved healthy telemetry must not leave a permanent wall of incidents");

const viewSource = await readFile(new URL("../src/lib/cockpit/view-model.ts",import.meta.url),"utf8");
assert.match(viewSource,/loadCockpitAttention/);
const workspaceSource = await readFile(new URL("../src/components/cockpit/CockpitWorkspace.tsx",import.meta.url),"utf8");
assert.match(workspaceSource,/AttentionLayer/);
const focusSource = await readFile(new URL("../src/components/cockpit/FocusMode.tsx",import.meta.url),"utf8");
assert.match(focusSource,/ipresenterplux:attention-open/);

if (!process.env.DATABASE_URL) {
  console.log(JSON.stringify({ok:true,mode:"local-contract",incidentClasses:6,database:"deferred-to-ci"}));
  process.exit(0);
}
assertWritableSelfTestDatabase(process.env.DATABASE_URL);
const {Pool}=pg; const pool=new Pool({connectionString:process.env.DATABASE_URL}); const client=await pool.connect();
const org=randomUUID(), campus=randomUUID(), service=randomUUID(), edgeId=randomUUID(), audio=randomUUID(), plan=randomUUID(), sub=randomUUID(), output=randomUUID(), stream=randomUUID(), destination=randomUUID();
try {
  await client.query("begin");
  await client.query(`insert into organizations(id,name,slug,country_code,timezone) values ($1,'Attention Church',$2,'GH','Africa/Accra')`,[org,`attention-${org}`]);
  await client.query(`insert into campuses(id,organization_id,name,slug,city,country_code) values ($1,$2,'Main','main','Accra','GH')`,[campus,org]);
  await client.query(`insert into services(id,organization_id,campus_id,title,status,scheduled_start,started_at,active_bible_version,updated_at) values ($1,$2,$3,'Attention Live','live',$4,$4,'WEBP',$4)`,[service,org,campus,now]);
  await client.query(`insert into edge_devices(id,organization_id,campus_id,name,platform,status,credential_hash,last_seen_at,active_service_id) values ($1,$2,$3,'Attention Edge','windows','offline',repeat('a',64),$4,$5)`,[edgeId,org,campus,new Date(now.getTime()-300_000),service]);
  await client.query(`insert into media_sources(id,organization_id,name,source_type,status,public_config,edge_device_id,source_key,last_seen_at,metadata) values ($1,$2,'Mixer','audio_input','ready','{}'::jsonb,$3,'audio:mixer',$4,$5::jsonb)`,[audio,org,edgeId,new Date(now.getTime()-10_000),JSON.stringify({asrWorkerStatus:"degraded",asrWorkerEngine:"Whisper"})]);
  await client.query(`insert into language_channels(organization_id,language_code,language_name,channel_mode,enabled,listener_count) values ($1,'fr','French','translation_text',true,3),($1,'ee','Ewe','translation_audio',true,2)`,[org]);
  await client.query(`insert into translation_worker_status(worker_id,provider,state,software_version,claimed_count,completed_count,failed_count,error_code,observed_at,updated_at) values ($1,'local','degraded','test',0,0,1,'worker_down',$2,$2) on conflict(worker_id) do update set state='degraded',error_code='worker_down',observed_at=$2,updated_at=$2`,[`attention-translation-${org}`,new Date(now.getTime()-10_000)]);
  await client.query(`insert into tts_worker_status(worker_id,provider,state,software_version,claimed_count,completed_count,failed_count,error_code,observed_at,updated_at) values ($1,'local','degraded','test',0,0,1,'voice_worker_down',$2,$2) on conflict(worker_id) do update set state='degraded',error_code='voice_worker_down',observed_at=$2,updated_at=$2`,[`attention-tts-${org}`,new Date(now.getTime()-10_000)]);
  await client.query(`insert into output_destinations(id,organization_id,name,destination_type,enabled,status,public_config,updated_at) values ($1,$2,'YouTube','youtube',true,'error','{}'::jsonb,$3)`,[output,org,now]);
  await client.query(`insert into stream_sessions(id,service_id,status,video_profile,started_at,created_at,updated_at) values ($1,$2,'live','720p',$3,$3,$3)`,[stream,service,now]);
  await client.query(`insert into stream_session_destinations(id,stream_session_id,output_destination_id,status,provider_health_state,provider_live_state,provider_checked_at,provider_error_code,provider_issue_codes,updated_at) values ($1,$2,$3,'error','error','not_live',$4,'provider_not_live',ARRAY['provider_not_live'],$4)`,[destination,stream,output,new Date(now.getTime()-5_000)]);
  await client.query(`insert into subscription_plans(id,code,name,enabled,billing_interval,default_device_seat_limit,features,numeric_limits) values ($1,$2,'Attention Plan',true,'custom',3,'{}'::jsonb,'{}'::jsonb)`,[plan,`attention-${plan}`]);
  await client.query(`insert into organization_subscriptions(id,organization_id,plan_id,status,starts_at,expires_at,grace_until) values ($1,$2,$3,'past_due','2098-01-01T00:00:00Z',$4,$5)`,[sub,org,plan,new Date(now.getTime()-86_400_000),new Date(now.getTime()+3*86_400_000)]);
  const loaded=await loadCockpitAttention(client,{organizationId:org,serviceId:service,serviceLive:true,now});
  for(const capability of ["edge","asr","translations.text","translations.audio","streaming.youtube","subscription"]){ assert.ok(loaded.some((item)=>item.affectedCapability===capability),`DB loader must project ${capability}`); }
  await client.query("rollback");
  console.log(JSON.stringify({ok:true,impactFirst:true,containment:true,recovery:true,quietHealthy:true,dbProjection:true}));
} catch(error){await client.query("rollback").catch(()=>{});throw error;} finally {client.release();await pool.end();}
