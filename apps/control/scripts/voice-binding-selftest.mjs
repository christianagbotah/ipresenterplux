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
     order by o.created_at,c.created_at
     limit 1`
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

  const service = await client.query(
    `insert into services(organization_id,campus_id,title,status,active_bible_version,started_at)
     values ($1,$2,'Voice binding self-test','live','WEBP',clock_timestamp()) returning id::text`,
    [organizationId, campusId]
  );
  const segment = await client.query(
    `insert into transcript_segments(service_id,text,source_observed_at,source_language,speaker_id)
     values ($1,'Voice binding test',clock_timestamp(),'en','speaker-selftest') returning id::text`,
    [service.rows[0].id]
  );
  const translation = await client.query(
    `insert into transcript_translation_jobs
      (transcript_segment_id,language_channel_id,target_language_code,channel_mode,status,translated_text,provider,completed_at)
     values ($1,$2,$3,'translation_audio','succeeded','Bonjour test','selftest',clock_timestamp())
     returning id::text`,
    [segment.rows[0].id, channel.rows[0].id, channel.rows[0].language_code]
  );
  const translationJobId = translation.rows[0].id;

  const generic = await enqueueSpeechSynthesisJob(client, translationJobId);
  assert.equal(generic?.voice_profile_id, null, "No bound consented profile must use generic voice");

  const profile = await client.query(
    `insert into voice_profiles
      (organization_id,display_name,source_speaker_id,consent_status,consented_at,
       consent_method,consent_reference,consent_recorded_by,provider,provider_voice_id,created_by)
     values ($1,'Voice binding self-test','speaker-selftest','consented',clock_timestamp(),
             'written','SELFTEST-BIND-CONSENT',$2,'google','fr-FR-Custom-SelfTest',$2)
     returning id::text`,
    [organizationId, userId]
  );
  const profileId = profile.rows[0].id;

  await client.query("savepoint duplicate_speaker");
  let duplicateBlocked = false;
  try {
    await client.query(
      `insert into voice_profiles(organization_id,display_name,source_speaker_id,consent_status,created_by)
       values ($1,'Duplicate speaker','SPEAKER-SELFTEST','pending',$2)`,
      [organizationId, userId]
    );
  } catch {
    duplicateBlocked = true;
    await client.query("rollback to savepoint duplicate_speaker");
  }
  assert.equal(duplicateBlocked, true, "A second active profile must not claim the same speaker ID");

  const personalized = await enqueueSpeechSynthesisJob(client, translationJobId);
  assert.equal(personalized?.voice_profile_id, profileId, "Matching consented/bound speaker must select personalized voice");
  assert.equal(personalized?.status, "pending", "Voice revision change must requeue synthesis");

  await client.query(
    `update speech_synthesis_jobs
     set status='succeeded',provider='selftest',audio_storage_key='audio/selftest.wav',
         audio_content_type='audio/wav',duration_ms=1000,completed_at=clock_timestamp()
     where id=$1`,
    [personalized.id]
  );

  await client.query(
    `update voice_profiles
     set consent_status='revoked',revoked_at=clock_timestamp(),revoked_by=$2,
         revocation_reason='Self-test revoke',provider=null,provider_voice_id=null,updated_at=clock_timestamp()
     where id=$1`,
    [profileId, userId]
  );
  const afterRevoke = await enqueueSpeechSynthesisJob(client, translationJobId);
  assert.equal(afterRevoke?.voice_profile_id, null, "Revoked profile must fall back to generic voice");
  assert.equal(afterRevoke?.status, "pending", "Revocation changes voice revision and must invalidate old audio");

  const reset = await client.query(
    `select audio_storage_key,audio_content_type,duration_ms,provider,lease_token
     from speech_synthesis_jobs where id=$1`,
    [afterRevoke.id]
  );
  assert.equal(reset.rows[0].audio_storage_key, null);
  assert.equal(reset.rows[0].audio_content_type, null);
  assert.equal(reset.rows[0].duration_ms, null);
  assert.equal(reset.rows[0].provider, null);
  assert.equal(reset.rows[0].lease_token, null);

  const replacement = await client.query(
    `insert into voice_profiles(organization_id,display_name,source_speaker_id,consent_status,created_by)
     values ($1,'Replacement pending','speaker-selftest','pending',$2) returning id::text`,
    [organizationId, userId]
  );
  assert.ok(replacement.rows[0]?.id, "Revoked profile must not permanently reserve speaker ID");

  console.log("Voice binding self-test passed (generic fallback, unique active speaker, consented match, revision reset, revoke fallback).");
} finally {
  await client.query("rollback");
  await client.end();
}
