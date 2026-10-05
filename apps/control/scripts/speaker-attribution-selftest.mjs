import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import process from "node:process";
import pg from "pg";
import ts from "typescript";

process.loadEnvFile?.(".env.local");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");

const source = await readFile(new URL("../src/lib/speaker-attribution.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
const { resolveSpeakerAttribution } = await import(moduleUrl);

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

  const service = await client.query(
    `insert into services(organization_id,campus_id,title,status,active_bible_version)
     values ($1,$2,'Speaker attribution self-test','ready','WEBP') returning id::text`,
    [organizationId, campusId]
  );
  const serviceId = service.rows[0].id;

  const profile = await client.query(
    `insert into voice_profiles
      (organization_id,display_name,source_speaker_id,consent_status,consented_at,
       consent_method,consent_reference,consent_recorded_by,created_by)
     values ($1,'Speaker override self-test','speaker-override-selftest','consented',clock_timestamp(),
             'written','SELFTEST-SPEAKER-OVERRIDE',$2,$2)
     returning id::text`,
    [organizationId, userId]
  );

  await client.query(
    `insert into service_speaker_overrides(service_id,organization_id,voice_profile_id,set_by)
     values ($1,$2,$3,$4)`,
    [serviceId, organizationId, profile.rows[0].id, userId]
  );

  const asr = await resolveSpeakerAttribution(client, serviceId, organizationId, "speaker-asr-selftest");
  assert.deepEqual(asr, { speakerId: "speaker-asr-selftest", speakerSource: "asr" }, "ASR speaker must win over manual override");

  const manual = await resolveSpeakerAttribution(client, serviceId, organizationId, null);
  assert.deepEqual(manual, { speakerId: "speaker-override-selftest", speakerSource: "operator_override" }, "Manual override must fill missing ASR speaker");

  const stored = await client.query(
    `insert into transcript_segments
      (service_id,text,source_observed_at,speaker_id,speaker_source)
     values ($1,'Speaker attribution self-test transcript',clock_timestamp(),$2,$3)
     returning speaker_id,speaker_source`,
    [serviceId, manual.speakerId, manual.speakerSource]
  );
  assert.equal(stored.rows[0].speaker_source, "operator_override");

  await client.query("delete from service_speaker_overrides where service_id=$1", [serviceId]);
  const unknown = await resolveSpeakerAttribution(client, serviceId, organizationId, null);
  assert.deepEqual(unknown, { speakerId: null, speakerSource: "unknown" }, "No ASR/override must remain unknown");

  await client.query("savepoint invalid_source");
  let invalidBlocked = false;
  try {
    await client.query(
      `insert into transcript_segments(service_id,text,source_observed_at,speaker_source)
       values ($1,'Invalid source',clock_timestamp(),'guessed')`,
      [serviceId]
    );
  } catch {
    invalidBlocked = true;
    await client.query("rollback to savepoint invalid_source");
  }
  assert.equal(invalidBlocked, true, "Unknown speaker provenance must be rejected");

  console.log("Speaker attribution self-test passed (ASR priority, operator fallback, unknown fallback, provenance constraint).");
} finally {
  await client.query("rollback");
  await client.end();
}
