#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";
import { enqueueTranslationJobs } from "../src/lib/translation-jobs.ts";
import { claimTranslationJobs, completeTranslationJob } from "../src/lib/translation-worker.ts";
import { enqueueSpeechSynthesisJob } from "../src/lib/speech-synthesis-jobs.ts";
import { claimTtsJobs, completeTtsJob } from "../src/lib/tts-worker.ts";
import { retrySpeechSynthesisForTranslation } from "../src/lib/translation-recovery.ts";
import { resolveAudienceChannelReadiness } from "../src/lib/audience-readiness.ts";
import { detectScriptureReferences } from "../src/lib/scripture.ts";
import { upsertCockpitRecommendation } from "../src/lib/cockpit/recommendations.ts";
import { getAIDirectorState } from "../src/lib/ai-director.ts";
import { buildServiceMemory } from "../src/lib/service-intelligence/memory.ts";

const packageJson=JSON.parse(await readFile(new URL("../package.json",import.meta.url),"utf8"));
const workflow=await readFile(new URL("../../../.github/workflows/control-ci.yml",import.meta.url),"utf8");
const ingestSource=await readFile(new URL("../src/lib/transcript-ingest.ts",import.meta.url),"utf8");
const directorWorkspace=await readFile(new URL("../src/components/ai-director/AIDirectorWorkspace.tsx",import.meta.url),"utf8");
assert.equal(packageJson.scripts?.["test:ai-feature-completion"],"node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/ai-feature-completion-selftest.mjs");
assert.match(workflow,/test:ai-feature-completion/,"Control CI must gate the whole AI sermon chain");
assert.match(ingestSource,/enqueueTranslationJobs/,"transcript ingest must enqueue language work");
assert.match(ingestSource,/upsertCockpitRecommendation/,"transcript ingest must turn detected Scripture into AI recommendations");
assert.doesNotMatch(directorWorkspace,/TAKE.{0,12}PROGRAM|take.?live/i,"AI Director must remain advisory-only");

if(!process.env.DATABASE_URL){
  console.log(JSON.stringify({ok:true,mode:"local-contract",database:"deferred-to-ci",languages:["en","fr","ak","ee"],directProgramAuthority:false}));
  process.exit(0);
}
assertWritableSelfTestDatabase(process.env.DATABASE_URL);
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
const client=await pool.connect();
const org=randomUUID(),campus=randomUUID(),user=randomUUID(),service=randomUUID(),segment=randomUUID();
const now=new Date();
try{
  await client.query("begin");
  await client.query(`insert into bible_versions(id,name,abbreviation,language_code,license_kind,local_enabled) values ('WEBP','World English Bible','WEBP','en','public_domain',true) on conflict(id) do nothing`);
  await client.query(`insert into bible_books(version_id,book_code,canonical_name,book_order,testament) values ('WEBP','JOH','John',43,'NT') on conflict(version_id,book_code) do nothing`);
  await client.query(`insert into bible_verses(version_id,book_code,chapter,verse,text) values ('WEBP','JOH',3,16,'For God so loved the world, that he gave his one and only Son.') on conflict(version_id,book_code,chapter,verse) do update set text=excluded.text`);
  await client.query(`insert into organizations(id,name,slug,country_code,timezone) values($1,'AI Completion Church',$2,'GH','Africa/Accra')`,[org,`ai-completion-${org}`]);
  await client.query(`insert into campuses(id,organization_id,name,slug,city,country_code) values($1,$2,'Main','main','Accra','GH')`,[campus,org]);
  await client.query(`insert into users(id,email,display_name,status) values($1,$2,'AI Operator','active')`,[user,`ai-completion-${user}@example.invalid`]);
  await client.query(`insert into user_organization_roles(user_id,organization_id,role_id) values($1,$2,'admin')`,[user,org]);
  await client.query(`insert into services(id,organization_id,campus_id,title,service_type,status,started_at,active_bible_version,ai_enabled,auto_preview_threshold) values($1,$2,$3,'AI Completion Service','sunday_service','live',$4,'WEBP',true,90)`,[service,org,campus,now]);
  await client.query(`insert into subscription_plans(code,name,enabled,features,numeric_limits) values($1,'AI Completion',true,$2::jsonb,'{}'::jsonb)`,[`ai-completion-${org}`,JSON.stringify({"ai.director":true,"translations.text":true,"translations.audio":true})]);
  await client.query(`insert into organization_subscriptions(organization_id,plan_id,status,starts_at,expires_at,grace_until) select $1,id,'active',$2::timestamptz-interval '1 day',$2::timestamptz+interval '1 day',$2::timestamptz+interval '8 days' from subscription_plans where code=$3`,[org,now,`ai-completion-${org}`]);

  const channels=[];
  for(const [code,name,mode] of [["en","English","translation_text"],["fr","French","translation_audio"],["ak","Twi / Akan","translation_audio"],["ee","Ewe","translation_audio"]]){
    const id=randomUUID(); channels.push({id,code,name,mode});
    await client.query(`insert into language_channels(id,organization_id,language_code,language_name,channel_mode,enabled) values($1,$2,$3,$4,$5,true)`,[id,org,code,name,mode]);
  }
  await client.query(`insert into transcript_segments(id,service_id,text,source_observed_at,source_language,speaker_id,speaker_source,asr_confidence) values($1,$2,'Please open John 3:16. For God so loved the world.',$3,'gaa','pastor-main','asr',.96)`,[segment,service,now]);
  const jobs=await enqueueTranslationJobs(client,segment,org,"gaa");
  assert.deepEqual(jobs.map(x=>x.target_language_code).sort(),["ak","ee","en","fr"]);

  const detected=detectScriptureReferences("Please open John 3:16. For God so loved the world.");
  assert.equal(detected[0]?.reference,"John 3:16");
  const scriptureId=randomUUID();
  await client.query(`insert into scripture_detections(id,service_id,scripture_reference,book,chapter,verse_start,verse_end,bible_version,source_text,confidence,state,detection_method,source_observed_at,source_ordinal) values($1,$2,'John 3:16','John',3,16,16,'WEBP','Please open John 3:16',98,'detected','reference',$3,0)`,[scriptureId,service,now]);
  await upsertCockpitRecommendation(client,{organizationId:org,serviceId:service,sourceKey:`scripture:${scriptureId}`,recommendationType:"scripture.detected",targetType:"scripture_detection",targetId:scriptureId,payload:{reference:"John 3:16",bibleVersion:"WEBP"},confidence:98,reason:"John 3:16 detected from sermon",evidence:"Please open John 3:16",sourceObservedAt:now,expiresAt:new Date(now.getTime()+120000),state:"suggested",now});

  const claimed=await claimTranslationJobs(client,"ai-completion-translation",10,45);
  assert.equal(claimed.length,4);
  const translations={en:"God loved the world",fr:"Dieu a aimé le monde",ak:"Onyankopɔn dɔɔ wiase",ee:"Mawu lɔ̃ xexeame"};
  for(const job of claimed){
    const completed=await completeTranslationJob(client,job.id,job.lease_token,translations[job.target_language_code],"selftest");
    assert.ok(completed);
    if(job.channel_mode==="translation_audio") await enqueueSpeechSynthesisJob(client,job.id);
  }

  const akJob=claimed.find(x=>x.target_language_code==="ak");
  assert.ok(akJob);
  await client.query(`update speech_synthesis_jobs set status='failed',attempts=5,error_code='provider_request_failed',completed_at=clock_timestamp() where translation_job_id=$1`,[akJob.id]);
  const beforeRetry=resolveAudienceChannelReadiness({serviceLive:true,channelMode:"translation_audio",transcriptAvailable:true,translationStatus:"succeeded",synthesisStatus:"failed"});
  assert.equal(beforeRetry.text?.state,"ready"); assert.equal(beforeRetry.voice?.state,"attention");
  await retrySpeechSynthesisForTranslation(client,user,akJob.id);

  const synthesis=await claimTtsJobs(client,"ai-completion-tts",10,45);
  assert.equal(synthesis.length,3);
  for(const job of synthesis){
    const completed=await completeTtsJob(client,job.id,job.lease_token,"selftest",`translation-audio/${job.id}.wav`,`audio/wav`,1200);
    assert.ok(completed);
  }
  const afterRetry=resolveAudienceChannelReadiness({serviceLive:true,channelMode:"translation_audio",transcriptAvailable:true,translationStatus:"succeeded",synthesisStatus:"succeeded"});
  assert.equal(afterRetry.text?.state,"ready"); assert.equal(afterRetry.voice?.state,"ready");

  await client.query(`insert into translation_worker_status(worker_id,provider,state,software_version,observed_at,updated_at) values('completion-translation','selftest','ready','1.0',$1,$1)`,[now]);
  await client.query(`insert into tts_worker_status(worker_id,provider,state,software_version,observed_at,updated_at) values('completion-tts','selftest','ready','1.0',$1,$1)`,[now]);
  for(const channel of channels){ await client.query(`insert into audience_sessions(id,service_id,language_channel_id,created_at,last_seen_at,updated_at) values($1,$2,$3,$4,$4,$4)`,[randomUUID(),service,channel.id,now]); }
  const director=await getAIDirectorState(client,user,{organizationId:org,serviceId:service,now});
  assert.equal(director.recommendations[0]?.reference,"John 3:16");
  assert.deepEqual(director.languageDemand.map(x=>x.languageCode).sort(),["ak","ee","en","fr"]);
  for(const language of director.languageDemand.filter(x=>x.channelMode==="translation_audio")){
    assert.equal(language.readiness.text?.state,"ready");
    assert.equal(language.readiness.voice?.state,"ready");
  }

  await client.query(`update services set status='ended',ended_at=$2 where id=$1`,[service,new Date(now.getTime()+3600000)]);
  const memory=await buildServiceMemory(client,user,service,{now:new Date(now.getTime()+3660000)});
  assert.equal(memory.memory.status,"ready");
  assert.ok(memory.memory.keyScriptures.some(x=>x.reference==="John 3:16"));
  assert.equal(memory.memory.languagesOutputs.translations.succeeded,4);
  assert.equal(memory.memory.languagesOutputs.audience.uniqueSessions,4);

  console.log(JSON.stringify({ok:true,transcript:true,scriptureRecommendation:true,languages:["en","fr","ak","ee"],textVoiceDegradation:true,audioRecovery:true,audienceDemand:true,serviceMemory:true,directProgramAuthority:false}));
  await client.query("rollback");
}catch(error){await client.query("rollback").catch(()=>{});throw error;}finally{client.release();await pool.end();}
