import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import process from "node:process";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";
import ts from "typescript";

process.loadEnvFile?.(".env.local");
assertWritableSelfTestDatabase(process.env.DATABASE_URL);
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");

const source = await readFile(new URL("../src/lib/speech-synthesis-jobs.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
const { enqueueSpeechSynthesisJob } = await import(moduleUrl);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query("begin");
try {
  const base = await client.query(
    `select o.id::text as organization_id,c.id::text as campus_id,uor.user_id::text as user_id
     from organizations o
     join campuses c on c.organization_id=o.id
     join user_organization_roles uor on uor.organization_id=o.id and uor.role_id in ('owner','admin')
     order by o.created_at,c.created_at limit 1`
  );
  assert.ok(base.rows[0]?.organization_id, "Expected an organization/campus/admin");
  const { organization_id: organizationId, campus_id: campusId, user_id: userId } = base.rows[0];

  const audioChannel = await client.query(
    `select id::text,language_code from language_channels
     where organization_id=$1 and enabled=true and channel_mode='translation_audio'
     order by created_at limit 1`,
    [organizationId]
  );
  assert.ok(audioChannel.rows[0]?.id, "Expected an enabled translation_audio channel");

  const service = await client.query(
    `insert into services(organization_id,campus_id,title,status,active_bible_version)
     values ($1,$2,'Speech synthesis self-test','live','WEBP') returning id::text`,
    [organizationId, campusId]
  );
  const segment = await client.query(
    `insert into transcript_segments(service_id,text,source_observed_at,source_language,speaker_id,speaker_source)
     values ($1,'Synthesis self-test transcript',clock_timestamp(),'en','speaker-001','asr') returning id::text`,
    [service.rows[0].id]
  );
  const translation = await client.query(
    `insert into transcript_translation_jobs
      (transcript_segment_id,language_channel_id,target_language_code,channel_mode,status,translated_text,provider,completed_at)
     values ($1,$2,$3,'translation_audio','succeeded','Bonjour à tous','selftest',clock_timestamp())
     returning id::text`,
    [segment.rows[0].id, audioChannel.rows[0].id, audioChannel.rows[0].language_code]
  );
  const translationJobId = translation.rows[0].id;

  const queued = await enqueueSpeechSynthesisJob(client, translationJobId);
  assert.ok(queued?.id, "Expected one speech synthesis job");
  assert.equal(queued.organization_id, organizationId);
  assert.equal(queued.language_channel_id, audioChannel.rows[0].id);
  const duplicateQueue = await enqueueSpeechSynthesisJob(client, translationJobId);
  assert.equal(duplicateQueue?.id, queued.id, "Requeue must reuse the same synthesis row");
  assert.equal(duplicateQueue?.status, "pending");

  await client.query(
    `update speech_synthesis_jobs
     set status='succeeded',provider='selftest',audio_storage_key='audio/selftest.mp3',
         audio_content_type='audio/mpeg',duration_ms=1200,completed_at=clock_timestamp()
     where id=$1`,
    [queued.id]
  );
  const sameText = await enqueueSpeechSynthesisJob(client, translationJobId);
  assert.equal(sameText?.id, queued.id);
  assert.equal(sameText?.status, "succeeded", "Identical translation text must preserve valid audio");
  const preservedAudio = await client.query(
    `select provider,audio_storage_key,audio_content_type,duration_ms
     from speech_synthesis_jobs where id=$1`,
    [queued.id]
  );
  assert.equal(preservedAudio.rows[0]?.audio_storage_key, "audio/selftest.mp3");
  assert.equal(preservedAudio.rows[0]?.audio_content_type, "audio/mpeg");
  assert.equal(preservedAudio.rows[0]?.duration_ms, 1200);

  const beforeConsent = await client.query("savepoint before_bad_consent");
  void beforeConsent;
  let blockedUnconsentedVoice = false;
  try {
    await client.query(
      `insert into voice_profiles(organization_id,display_name,consent_status,provider,provider_voice_id)
       values ($1,'Unsafe voice','pending','google','voice-unsafe')`,
      [organizationId]
    );
  } catch {
    blockedUnconsentedVoice = true;
    await client.query("rollback to savepoint before_bad_consent");
  }
  assert.equal(blockedUnconsentedVoice, true, "Unconsented personalized provider voice must be rejected");

  const profile = await client.query(
    `insert into voice_profiles
      (organization_id,display_name,source_speaker_id,consent_status,consented_at,consent_method,consent_reference,
       consent_recorded_by,provider,provider_voice_id,created_by)
     values ($1,'Consented speaker',null,'consented',clock_timestamp(),'written','SELFTEST-CONSENT',
             $2,'google','voice-consented',$2)
     returning id::text`,
    [organizationId, userId]
  );
  await client.query(
    `insert into service_speaker_voice_bindings
      (service_id,organization_id,speaker_id,voice_profile_id,set_by)
     values ($1,$2,'speaker-001',$3,$4)`,
    [service.rows[0].id, organizationId, profile.rows[0].id, userId]
  );
  const bound = await enqueueSpeechSynthesisJob(client, translationJobId);
  assert.equal(bound?.voice_profile_id, profile.rows[0].id, "Service-scoped consented voice must be selected");
  assert.equal(bound?.status, "pending", "Binding a personalized voice must invalidate prior generic audio");

  await client.query(
    "update transcript_translation_jobs set translated_text='Bonjour corrigé',updated_at=clock_timestamp() where id=$1",
    [translationJobId]
  );
  const corrected = await enqueueSpeechSynthesisJob(client, translationJobId);
  assert.equal(corrected?.id, queued.id);
  assert.equal(corrected?.status, "pending", "Changed translation text must requeue synthesis");
  const resetAudio = await client.query(
    `select status,provider,audio_storage_key,audio_content_type,duration_ms,completed_at,voice_profile_id::text
     from speech_synthesis_jobs where id=$1`,
    [queued.id]
  );
  assert.equal(resetAudio.rows[0]?.provider, null);
  assert.equal(resetAudio.rows[0]?.audio_storage_key, null);
  assert.equal(resetAudio.rows[0]?.audio_content_type, null);
  assert.equal(resetAudio.rows[0]?.duration_ms, null);
  assert.equal(resetAudio.rows[0]?.completed_at, null);
  assert.equal(resetAudio.rows[0]?.voice_profile_id, profile.rows[0].id, "Consented voice selection must survive text correction");

  let blockedFakeSuccess = false;
  await client.query("savepoint before_fake_audio");
  try {
    await client.query(
      "update speech_synthesis_jobs set status='succeeded' where id=$1",
      [queued.id]
    );
  } catch {
    blockedFakeSuccess = true;
    await client.query("rollback to savepoint before_fake_audio");
  }
  assert.equal(blockedFakeSuccess, true, "Succeeded synthesis must require a real audio asset");

  console.log("Speech synthesis self-test passed (audio queue, safe requeue, consent gate, tenant integrity, real-asset success gate).");
} finally {
  await client.query("rollback");
  await client.end();
}
