#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";
import { buildServiceMemory } from "../src/lib/service-intelligence/memory.ts";

const stateRoute=await readFile(new URL("../src/app/api/v1/services/[id]/state/route.ts",import.meta.url),"utf8");
const memorySource=await readFile(new URL("../src/lib/service-intelligence/memory.ts",import.meta.url),"utf8");
assert.match(stateRoute,/buildEndedServiceMemoryBestEffort/);
const commitIndex=stateRoute.indexOf('await client.query("commit")');
const memoryIndex=stateRoute.indexOf('await buildEndedServiceMemoryBestEffort');
assert.ok(commitIndex>=0 && memoryIndex>commitIndex,"service must commit ended state before best-effort memory generation");
assert.doesNotMatch(memorySource,/program\.show|program\.clear|scripture_detections set state|presentation_items set state/i,"memory builder must not mutate Program/live presentation state");
assert.match(memorySource,/audience_sessions/i,"service memory must derive audience participation from anonymous service sessions");
assert.doesNotMatch(memorySource,/select[^;`]*listener_count|listener_count from language_channels/i,"service memory must not use the obsolete static listener_count as historical audience truth");

if(!process.env.DATABASE_URL){console.log(JSON.stringify({ok:true,mode:"source-contract",database:"deferred-to-ci"}));process.exit(0);}
assertWritableSelfTestDatabase(process.env.DATABASE_URL);
const {Pool}=pg; const pool=new Pool({connectionString:process.env.DATABASE_URL}); const client=await pool.connect();
const org=randomUUID(), otherOrg=randomUUID(), campus=randomUUID(), otherCampus=randomUUID(), user=randomUUID(), outsider=randomUUID();
const service=randomUUID(), sparse=randomUUID(), otherService=randomUUID(), output=randomUUID(), stream=randomUUID(), artifact=randomUUID(), audienceA=randomUUID(), audienceB=randomUUID();
const t0=new Date("2099-07-01T09:00:00Z");
try{
 await client.query("begin");
 await client.query(`insert into organizations(id,name,slug,country_code,timezone) values($1,'Memory Loop Church',$2,'GH','Africa/Accra'),($3,'Other Church',$4,'GH','Africa/Accra')`,[org,`memory-loop-${org}`,otherOrg,`other-loop-${otherOrg}`]);
 await client.query(`insert into campuses(id,organization_id,name,slug,city,country_code) values($1,$2,'Main','main','Accra','GH'),($3,$4,'Other','other','Kumasi','GH')`,[campus,org,otherCampus,otherOrg]);
 await client.query(`insert into users(id,email,display_name,status) values($1,$2,'Memory Operator','active'),($3,$4,'Outsider','active')`,[user,`memory-${user}@example.invalid`,outsider,`out-${outsider}@example.invalid`]);
 await client.query(`insert into user_organization_roles(user_id,organization_id,role_id) values($1,$2,'presenter_operator'),($3,$4,'presenter_operator')`,[user,org,outsider,otherOrg]);
 await client.query(`insert into services(id,organization_id,campus_id,title,service_type,status,started_at,ended_at,active_bible_version) values
   ($1,$2,$3,'Memory Sunday','sunday_service','ended',$4,$5,'WEBP'),
   ($6,$2,$3,'Sparse Service','special','ended',$4,$5,'WEBP'),
   ($7,$8,$9,'Other Memory','sunday_service','ended',$4,$5,'WEBP')`,[service,org,campus,t0,new Date(t0.getTime()+60*60*1000),sparse,otherService,otherOrg,otherCampus]);
 await client.query(`insert into presentation_items(service_id,item_type,title,content,sort_order,state,updated_at) values
   ($1,'song','Amazing Grace','{"title":"Amazing Grace"}'::jsonb,1000,'played',$2),
   ($1,'slide','Closing Prayer','{"body":"Pray"}'::jsonb,2000,'played',$2),
   ($3,'slide','Welcome','{"body":"Welcome"}'::jsonb,1000,'played',$2)`,[service,new Date(t0.getTime()+50*60*1000),sparse]);
 await client.query(`insert into scripture_detections(service_id,scripture_reference,book,chapter,verse_start,verse_end,bible_version,source_text,confidence,state,detection_method,source_observed_at,source_ordinal) values
   ($1,'John 3:16','John',3,16,16,'WEBP','For God so loved',98,'played','quote',$2,1),
   ($1,'Romans 8:38-39','Romans',8,38,39,'WEBP','Nothing separates us',96,'played','reference',$3,2),
   ($4,'Psalm 23:1','Psalms',23,1,1,'WEBP','The Lord is my shepherd',92,'played','reference',$2,1)`,
   [service,new Date(t0.getTime()+5*60*1000),new Date(t0.getTime()+40*60*1000),sparse]);
 const segments=[
   [new Date(t0.getTime()+60*1000),'pastor-main','asr','Welcome church, today we speak about the love of God.'],
   [new Date(t0.getTime()+2*60*1000),'pastor-main','asr','John chapter three verse sixteen shows the heart of the Father.'],
   [new Date(t0.getTime()+8*60*1000),'reader-1','operator_override','The reader continues with the Scripture and prayer.'],
   [new Date(t0.getTime()+9*60*1000),'reader-1','operator_override','We receive the word with faith.'],
   [new Date(t0.getTime()+20*60*1000),'pastor-main','asr','Now we return to the message and closing exhortation.'],
   [new Date(t0.getTime()+21*60*1000),'pastor-main','asr','Nothing can separate us from the love of God.']
 ];
 const segmentIds=[];
 for(const [observed,speaker,source,text] of segments){const r=await client.query(`insert into transcript_segments(service_id,text,source_observed_at,source_language,speaker_id,speaker_source,asr_confidence) values($1,$2,$3,'en',$4,$5,.95) returning id::text`,[service,text,observed,speaker,source]);segmentIds.push(r.rows[0].id);}
 await client.query(`insert into language_channels(organization_id,language_code,language_name,channel_mode,enabled) values($1,'fr','French','translation_text',true)`,[org]);
 const channel=await client.query(`select id::text from language_channels where organization_id=$1 and language_code='fr' and channel_mode='translation_text'`,[org]);
 await client.query(`insert into audience_sessions(id,service_id,language_channel_id,created_at,last_seen_at,updated_at) values ($1,$3,$4,$5,$6,$6),($2,$3,$4,$5,$7,$7)`,[audienceA,audienceB,service,channel.rows[0].id,t0,new Date(t0.getTime()+59*60*1000),new Date(t0.getTime()+58*60*1000)]);
 await client.query(`insert into transcript_translation_jobs(transcript_segment_id,language_channel_id,target_language_code,channel_mode,status,translated_text,provider,completed_at) values($1,$2,'fr','translation_text','succeeded','Bonjour','selftest',$3)`,[segmentIds[0],channel.rows[0].id,new Date(t0.getTime()+3*60*1000)]);
 await client.query(`insert into output_destinations(id,organization_id,name,destination_type,enabled,status,public_config) values($1,$2,'YouTube','youtube',true,'ready','{}'::jsonb)`,[output,org]);
 await client.query(`insert into stream_sessions(id,service_id,status,started_at,ended_at,error_code,metrics,created_at,updated_at) values($1,$2,'ended',$3,$4,'router_disconnect','{}'::jsonb,$3,$4)`,[stream,service,new Date(t0.getTime()+2*60*1000),new Date(t0.getTime()+55*60*1000)]);
 await client.query(`insert into stream_session_destinations(stream_session_id,output_destination_id,status,last_error_code,provider_health_state,provider_live_state,provider_error_code,provider_issue_codes,created_at,updated_at) values($1,$2,'error','rtmp_timeout','error','error','provider_timeout',array['provider_timeout'],$3,$3)`,[stream,output,new Date(t0.getTime()+55*60*1000)]);
 await client.query(`insert into service_artifacts(id,organization_id,service_id,artifact_type,status,storage_kind,storage_locator,metadata) values($1,$2,$3,'recording','available','external','https://example.invalid/private-recording', '{"durationSeconds":3600}'::jsonb)`,[artifact,org,service]);

 const first=await buildServiceMemory(client,user,service,{now:new Date(t0.getTime()+65*60*1000)});
 assert.equal(first.memory.status,'ready'); assert.equal(first.regenerated,true); assert.equal(first.memory.sourceFingerprint?.length,64);
 assert.ok(first.chapters.length>=3,"speaker changes and >4 minute gaps must create chapters"); assert.ok(first.chapters.length<=24);
 assert.ok(first.memory.summary.length<=20000); assert.match(first.memory.summary,/2 Scripture/i); assert.ok(first.memory.keyScriptures.some(x=>x.reference==='John 3:16'));
 assert.ok(first.memory.speakers.some(x=>x.id==='pastor-main')); assert.ok(first.memory.songsMedia.some(x=>x.title==='Amazing Grace'));
 assert.ok(first.memory.incidents.some(x=>String(x.code).includes('router_disconnect')||String(x.code).includes('rtmp_timeout')));
 assert.equal(first.memory.languagesOutputs.translations.succeeded,1); assert.equal(first.memory.languagesOutputs.artifacts.count,1); assert.equal(first.memory.languagesOutputs.audience.uniqueSessions,2); assert.equal(first.memory.languagesOutputs.languages[0].audienceSessions,2);
 const timestampBefore=(await client.query(`select updated_at::text from service_memories where service_id=$1`,[service])).rows[0].updated_at;
 const second=await buildServiceMemory(client,user,service,{now:new Date(t0.getTime()+66*60*1000)});
 const timestampAfter=(await client.query(`select updated_at::text from service_memories where service_id=$1`,[service])).rows[0].updated_at;
 assert.equal(second.regenerated,false); assert.equal(second.memory.sourceFingerprint,first.memory.sourceFingerprint); assert.equal(timestampAfter,timestampBefore,"unchanged source truth must not rewrite memory");
 await client.query(`insert into transcript_segments(service_id,text,source_observed_at,source_language,speaker_id,speaker_source,asr_confidence) values($1,'A final added memory line',$2,'en','pastor-main','asr',.94)`,[service,new Date(t0.getTime()+50*60*1000)]);
 const third=await buildServiceMemory(client,user,service,{now:new Date(t0.getTime()+67*60*1000)}); assert.equal(third.regenerated,true); assert.notEqual(third.memory.sourceFingerprint,first.memory.sourceFingerprint);
 const sparseMemory=await buildServiceMemory(client,user,sparse,{now:new Date(t0.getTime()+67*60*1000)}); assert.equal(sparseMemory.memory.status,'ready'); assert.equal(sparseMemory.chapters.length,1); assert.match(sparseMemory.chapters[0].title,/Service overview/);
 await assert.rejects(()=>buildServiceMemory(client,outsider,service,{now:new Date(t0.getTime()+67*60*1000)}),/not found|forbidden/i);
 await client.query("rollback");
 console.log(JSON.stringify({ok:true,chapters:true,bounded:true,sparse:true,keyScripture:true,speakers:true,incidents:true,translations:true,audienceSessions:true,artifactsMetadataOnly:true,idempotentFingerprint:true,regeneration:true,tenantIsolation:true,noProgramMutation:true}));
}catch(e){await client.query("rollback").catch(()=>{});throw e;}finally{client.release();await pool.end();}
