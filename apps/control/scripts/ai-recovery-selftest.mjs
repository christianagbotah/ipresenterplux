#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const recovery = await import("../src/lib/translation-recovery.ts");
const { enqueueSpeechSynthesisJob } = await import("../src/lib/speech-synthesis-jobs.ts");
assert.equal(typeof recovery.retryTranslationJob, "function");
assert.equal(typeof recovery.retrySpeechSynthesisForTranslation, "function");
assert.equal(typeof recovery.TranslationRecoveryError, "function");

const translationRoute = await readFile(new URL("../src/app/api/v1/translations/jobs/[id]/retry/route.ts", import.meta.url), "utf8");
const audioRoute = await readFile(new URL("../src/app/api/v1/translations/jobs/[id]/audio/retry/route.ts", import.meta.url), "utf8");
const desk = await readFile(new URL("../src/components/translations/TranslationDesk.tsx", import.meta.url), "utf8");
for (const route of [translationRoute, audioRoute]) {
  assert.match(route, /auth\(\)/, "AI recovery routes must require an authenticated user");
  assert.match(route, /TranslationRecoveryError/, "AI recovery routes must preserve domain error status");
}
assert.match(translationRoute, /translation\.retry\.requested|translation\.job\.retried/, "translation retry must publish or audit recovery");
assert.match(audioRoute, /tts\.retry\.requested|tts\.job\.retried/, "audio retry must publish or audit recovery");
assert.match(desk, /Retry translation/, "Translation Desk must expose terminal translation recovery");
assert.match(desk, /Retry audio/, "Translation Desk must expose terminal audio recovery");
assert.doesNotMatch(`${translationRoute}\n${audioRoute}`, /Program|takeLive|state=['\"]live/i, "AI recovery must not gain Program authority");

if (!process.env.DATABASE_URL) {
  console.log(JSON.stringify({ ok: true, mode: "local-contract", database: "deferred-to-ci", recovery: ["translation", "audio"], directProgramAuthority: false }));
  process.exit(0);
}

const pg = await import("pg");
const { randomUUID } = await import("node:crypto");
const { grantAudioEntitlement } = await import("./ai-selftest-entitlement.mjs");
const { assertWritableSelfTestDatabase } = await import("./selftest-db-safety.mjs");
assertWritableSelfTestDatabase(process.env.DATABASE_URL);
const client = new pg.default.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query("begin");
try {
  const org=randomUUID(), campus=randomUUID(), user=randomUUID(), service=randomUUID(), channel=randomUUID(), segment=randomUUID(), job=randomUUID();
  await client.query(`insert into bible_versions(id,name,abbreviation,language_code,license_kind,local_enabled) values ('WEBP','World English Bible','WEBP','en','public_domain',true) on conflict(id) do nothing`);
  await client.query(`insert into organizations(id,name,slug,country_code,timezone) values($1,'AI Recovery',$2,'GH','Africa/Accra')`,[org,`ai-recovery-${org}`]);
  await client.query(`insert into campuses(id,organization_id,name,slug,city,country_code) values($1,$2,'Main','main','Accra','GH')`,[campus,org]);
  await client.query(`insert into users(id,email,display_name,status) values($1,$2,'Recovery Operator','active')`,[user,`recovery-${user}@example.invalid`]);
  await client.query(`insert into user_organization_roles(user_id,organization_id,role_id) values($1,$2,'admin')`,[user,org]);
  await client.query(`insert into services(id,organization_id,campus_id,title,status,active_bible_version) values($1,$2,$3,'Recovery Service','live','WEBP')`,[service,org,campus]);
  await client.query(`insert into language_channels(id,organization_id,language_code,language_name,channel_mode,enabled) values($1,$2,'fr','French','translation_audio',true)`,[channel,org]);
  await client.query(`insert into transcript_segments(id,service_id,text,source_observed_at,source_language) values($1,$2,'Grace and peace',clock_timestamp(),'en')`,[segment,service]);
  await client.query(`insert into transcript_translation_jobs(id,transcript_segment_id,language_channel_id,target_language_code,channel_mode,status,attempts,error_code,completed_at) values($1,$2,$3,'fr','translation_audio','failed',5,'provider_request_failed',clock_timestamp())`,[job,segment,channel]);
  await grantAudioEntitlement(client,org,"ai-recovery-selftest");
  await client.query(`update subscription_plans set features=features || '{"translations.text":true}'::jsonb where id=(select plan_id from organization_subscriptions where organization_id=$1 order by created_at desc limit 1)`,[org]);

  const retried=await recovery.retryTranslationJob(client,user,job);
  assert.equal(retried.status,"pending");
  assert.equal(retried.attempts,0);
  const row=(await client.query(`select status,attempts,error_code,lease_token,next_attempt_at from transcript_translation_jobs where id=$1`,[job])).rows[0];
  assert.equal(row.status,"pending"); assert.equal(row.attempts,0); assert.equal(row.error_code,null); assert.equal(row.lease_token,null);

  await client.query(`update transcript_translation_jobs set status='succeeded',translated_text='Grâce et paix',provider='selftest',completed_at=clock_timestamp() where id=$1`,[job]);
  const synthesis=await enqueueSpeechSynthesisJob(client,job);
  assert.equal(synthesis.status,"pending");
  await client.query(`update speech_synthesis_jobs set status='failed',attempts=5,error_code='provider_request_failed',completed_at=clock_timestamp() where translation_job_id=$1`,[job]);
  const audioRetried=await recovery.retrySpeechSynthesisForTranslation(client,user,job);
  assert.equal(audioRetried.status,"pending");
  assert.equal(audioRetried.attempts,0);
  const audio=(await client.query(`select status,attempts,error_code,provider,audio_storage_key,lease_token from speech_synthesis_jobs where translation_job_id=$1`,[job])).rows[0];
  assert.equal(audio.status,"pending"); assert.equal(audio.attempts,0); assert.equal(audio.error_code,null); assert.equal(audio.provider,null); assert.equal(audio.audio_storage_key,null); assert.equal(audio.lease_token,null);

  const audits=await client.query(`select action from audit_events where organization_id=$1 and entity_id=$2 order by created_at`,[org,job]);
  assert.ok(audits.rows.some((x)=>x.action==='translation.job.retried'));
  assert.ok(audits.rows.some((x)=>x.action==='tts.job.retried'));
  console.log(JSON.stringify({ok:true,translationRetry:true,audioRetry:true,attemptReset:true,audited:true,directProgramAuthority:false}));
} finally {
  await client.query("rollback").catch(()=>{});
  await client.end();
}
