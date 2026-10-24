import assert from "node:assert/strict";
import process from "node:process";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";

process.loadEnvFile?.(".env.local");
assertWritableSelfTestDatabase(process.env.DATABASE_URL);
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query("begin");
try {
  const base = await client.query(`select id::text as organization_id from organizations order by created_at limit 1`);
  assert.ok(base.rows[0]?.organization_id, "Expected an organization fixture");
  const actor = await client.query(
    `insert into users(email,display_name,status)
     values ('voice-consent-selftest@example.invalid','Voice consent self-test','active')
     returning id::text`
  );
  const organizationId = base.rows[0].organization_id;
  const userId = actor.rows[0].id;

  const created = await client.query(
    `insert into voice_profiles(organization_id,display_name,consent_status,created_by)
     values ($1,'Voice consent self-test','pending',$2)
     returning id::text`,
    [organizationId, userId]
  );
  const profileId = created.rows[0].id;

  await client.query("savepoint missing_evidence");
  let blockedMissingEvidence = false;
  try {
    await client.query(
      `update voice_profiles
       set consent_status='consented',consented_at=clock_timestamp(),updated_at=clock_timestamp()
       where id=$1`,
      [profileId]
    );
  } catch {
    blockedMissingEvidence = true;
    await client.query("rollback to savepoint missing_evidence");
  }
  assert.equal(blockedMissingEvidence, true, "Consented status must require consent evidence");

  await client.query(
    `update voice_profiles
     set consent_status='consented',consented_at=clock_timestamp(),consent_method='written',
         consent_reference='SELFTEST-CONSENT-REF',consent_recorded_by=$2,updated_at=clock_timestamp()
     where id=$1`,
    [profileId, userId]
  );
  await client.query(
    `update voice_profiles set provider='google',provider_voice_id='fr-FR-Custom-SelfTest' where id=$1`,
    [profileId]
  );

  await client.query("savepoint revoke_bound_voice");
  let blockedBoundRevocation = false;
  try {
    await client.query(
      `update voice_profiles
       set consent_status='revoked',revoked_at=clock_timestamp(),revoked_by=$2,
           revocation_reason='Self-test revocation',updated_at=clock_timestamp()
       where id=$1`,
      [profileId, userId]
    );
  } catch {
    blockedBoundRevocation = true;
    await client.query("rollback to savepoint revoke_bound_voice");
  }
  assert.equal(blockedBoundRevocation, true, "Revocation must clear provider voice binding");

  await client.query(
    `update voice_profiles
     set consent_status='revoked',revoked_at=clock_timestamp(),revoked_by=$2,
         revocation_reason='Self-test revocation',provider=null,provider_voice_id=null,
         updated_at=clock_timestamp()
     where id=$1`,
    [profileId, userId]
  );

  await client.query("savepoint bind_after_revoke");
  let blockedRebind = false;
  try {
    await client.query(
      `update voice_profiles set provider='google',provider_voice_id='fr-FR-Custom-ShouldFail' where id=$1`,
      [profileId]
    );
  } catch {
    blockedRebind = true;
    await client.query("rollback to savepoint bind_after_revoke");
  }
  assert.equal(blockedRebind, true, "Revoked profile must not accept a provider voice binding");

  console.log("Voice consent self-test passed (evidence gate, consented binding, revocation gate, no rebind after revoke).");
} finally {
  await client.query("rollback");
  await client.end();
}
