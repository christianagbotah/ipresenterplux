import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import process from "node:process";
import pg from "pg";
import ts from "typescript";

process.loadEnvFile?.(".env.local");
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
  assert.ok(base.rows[0]?.organization_id, "Expected organization/campus/admin");
  const { organization_id: organizationId, campus_id: campusId, user_id: userId } = base.rows[0];

  const channel = await client.query(
    `select id::text,language_code from language_channels
     where organization_id=$1 and enabled=true and channel_mode='translation_audio'
     order by created_at limit 1`,
    [organizationId]
  );
  assert.ok(channel.rows[0]?.id, "Expected translation_audio channel");

  async function createService(title) {
    const service = await client.query(
      `insert into services(organization_id,campus_id,title,status,active_bible_version,started_at)
       values ($1,$2,$3,'live','WEBP',clock_timestamp()) returning id::text`,
      [organizationId, campusId, title]
    );
    return service.rows[0].id;
  }

  async function createAudioTranslation(serviceId, text) {
    const segment = await client.query(
      `insert into transcript_segments
        (service_id,text,source_observed_at,source_language,speaker_id,speaker_source)
       values ($1,$2,clock_timestamp(),'en','speaker-001','asr') returning id::text`,
      [serviceId, text]
    );
    const translation = await client.query(
      `insert into transcript_translation_jobs
        (transcript_segment_id,language_channel_id,target_language_code,channel_mode,status,translated_text,provider,completed_at)
       values ($1,$2,$3,'translation_audio','succeeded',$4,'selftest',clock_timestamp())
       returning id::text`,
      [segment.rows[0].id, channel.rows[0].id, channel.rows[0].language_code, `Bonjour ${text}`]
    );
    return translation.rows[0].id;
  }

  const serviceA = await createService("Voice binding service A");
  const serviceB = await createService("Voice binding service B");
  const translationA = await createAudioTranslation(serviceA, "service A");
  const translationB = await createAudioTranslation(serviceB, "service B");

  const profile = await client.query(
    `insert into voice_profiles
      (organization_id,display_name,source_speaker_id,consent_status,consented_at,
       consent_method,consent_reference,consent_recorded_by,provider,provider_voice_id,created_by)
     values ($1,'Consented service voice',null,'consented',clock_timestamp(),
             'written','SELFTEST-SERVICE-BIND',$2,'google','fr-FR-Custom-SelfTest',$2)
     returning id::text`,
    [organizationId, userId]
  );
  const profileId = profile.rows[0].id;

  const genericA = await enqueueSpeechSynthesisJob(client, translationA);
  assert.equal(genericA?.voice_profile_id, null,
    "An ASR label must not select an organization-wide voice without a service binding");

  await client.query(
    `insert into service_speaker_voice_bindings
      (service_id,organization_id,speaker_id,voice_profile_id,set_by)
     values ($1,$2,'speaker-001',$3,$4)`,
    [serviceA, organizationId, profileId, userId]
  );
  const personalizedA = await enqueueSpeechSynthesisJob(client, translationA);
  assert.equal(personalizedA?.voice_profile_id, profileId,
    "A service-scoped ASR binding must select the consented provider voice");
  assert.equal(personalizedA?.status, "pending",
    "Changing from generic to personalized voice must regenerate audio");

  const genericB = await enqueueSpeechSynthesisJob(client, translationB);
  assert.equal(genericB?.voice_profile_id, null,
    "The same anonymous speaker label in another service must remain generic");

  await client.query(
    `update speech_synthesis_jobs
     set status='succeeded',provider='selftest',audio_storage_key='tts/00000000-0000-4000-8000-000000000001.wav',
         audio_content_type='audio/wav',duration_ms=1000,completed_at=clock_timestamp()
     where id=$1`,
    [personalizedA.id]
  );
  await client.query(
    `delete from service_speaker_voice_bindings
     where service_id=$1 and lower(speaker_id)='speaker-001'`,
    [serviceA]
  );
  const unboundA = await enqueueSpeechSynthesisJob(client, translationA);
  assert.equal(unboundA?.voice_profile_id, null, "Removing the service binding must fall back to generic voice");
  assert.equal(unboundA?.status, "pending", "Removing a voice binding must invalidate personalized audio");
  const reset = await client.query(
    `select audio_storage_key,audio_content_type,duration_ms,provider,lease_token
     from speech_synthesis_jobs where id=$1`,
    [unboundA.id]
  );
  assert.equal(reset.rows[0].audio_storage_key, null);
  assert.equal(reset.rows[0].audio_content_type, null);
  assert.equal(reset.rows[0].duration_ms, null);
  assert.equal(reset.rows[0].provider, null);
  assert.equal(reset.rows[0].lease_token, null);

  console.log("Voice binding self-test passed (no global anonymous match, service-local consented binding, cross-service isolation, generic fallback). ");
} finally {
  await client.query("rollback");
  await client.end();
}
