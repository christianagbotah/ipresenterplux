#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";

const director = await import("../src/lib/ai-director.ts");
assert.equal(typeof director.getAIDirectorState, "function");
assert.equal(typeof director.updateAIDirectorSettings, "function");

const migration = await readFile(new URL("../db/039_ai_director_settings.sql", import.meta.url), "utf8");
assert.match(migration, /add column if not exists ai_enabled boolean not null default true/i);

const pageSource = await readFile(new URL("../src/app/ai-director/page.tsx", import.meta.url), "utf8");
assert.match(pageSource, /AIDirectorWorkspace/);
assert.doesNotMatch(pageSource, /StudioReadinessPage/);
const workspaceSource = await readFile(new URL("../src/components/ai-director/AIDirectorWorkspace.tsx", import.meta.url), "utf8");
for (const copy of ["AI Director", "Advisory only", "Auto-preview threshold", "Recent recommendations"]) {
  assert.ok(workspaceSource.includes(copy), `AI Director workspace must surface '${copy}'`);
}
assert.doesNotMatch(workspaceSource, /TAKE.{0,12}PROGRAM|take.?live/i, "AI Director must not expose direct Program authority");
const settingsRoute = await readFile(new URL("../src/app/api/v1/ai/director/settings/route.ts", import.meta.url), "utf8");
assert.doesNotMatch(settingsRoute, /scriptures\/.+state|presentation.+live|state\s*=\s*['\"]live/i, "settings route must not mutate Program state");
const ingestSource = await readFile(new URL("../src/lib/transcript-ingest.ts", import.meta.url), "utf8");
assert.match(ingestSource, /service\.ai_enabled\s*&&/i, "disabled AI must prevent automatic Preview promotion");

if (!process.env.DATABASE_URL) {
  console.log(JSON.stringify({ ok: true, mode: "local-contract", database: "deferred-to-ci", directProgramAuthority: false }));
  process.exit(0);
}

assertWritableSelfTestDatabase(process.env.DATABASE_URL);
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
const org = randomUUID();
const campus = randomUUID();
const admin = randomUUID();
const viewer = randomUUID();
const service = randomUUID();
const edge = randomUUID();
const audioSource = randomUUID();
const plan = randomUUID();
const subscription = randomUUID();
const now = new Date("2099-01-01T12:00:00.000Z");

async function expectDirectorError(action, code) {
  try {
    await action();
    assert.fail(`expected ${code}`);
  } catch (error) {
    assert.ok(error instanceof director.AIDirectorError, `expected AIDirectorError for ${code}`);
    assert.equal(error.code, code);
  }
}

try {
  await client.query("begin");
  await client.query(
    `insert into organizations(id,name,slug,country_code,timezone)
     values ($1,'AI Director Test',$2,'GH','Africa/Accra')`,
    [org, `ai-director-${org}`]
  );
  await client.query(
    `insert into campuses(id,organization_id,name,slug,city,country_code)
     values ($1,$2,'Main Campus','main-campus','Accra','GH')`,
    [campus, org]
  );
  await client.query(
    `insert into users(id,email,display_name,status) values
      ($1,$2,'AI Admin','active'),($3,$4,'AI Viewer','active')`,
    [admin, `ai-admin-${admin}@example.invalid`, viewer, `ai-view-${viewer}@example.invalid`]
  );
  await client.query(
    `insert into user_organization_roles(user_id,organization_id,role_id) values
      ($1,$2,'admin'),($3,$2,'viewer')`,
    [admin, org, viewer]
  );
  await client.query(
    `insert into services(id,organization_id,campus_id,title,status,active_bible_version,auto_preview_threshold,ai_enabled)
     values ($1,$2,$3,'AI Service','live','WEBP',90,true)`,
    [service, org, campus]
  );
  await client.query(
    `insert into edge_devices(id,organization_id,campus_id,name,platform,status,last_seen_at)
     values ($1,$2,$3,'Sanctuary Edge','windows','active',$4)`,
    [edge, org, campus, now]
  );
  await client.query(
    `insert into media_sources(id,organization_id,name,source_type,status,edge_device_id,source_key,last_seen_at,metadata,public_config)
     values ($1,$2,'Mixer','audio_input','live',$3,'mixer-1',$4,$5::jsonb,'{}'::jsonb)`,
    [audioSource, org, edge, new Date(now.getTime() - 15_000), JSON.stringify({ asrWorkerStatus: "ready", asrWorkerEngine: "whisper", transcriptionLastSuccessAt: new Date(now.getTime() - 20_000).toISOString() })]
  );
  await client.query(
    `insert into translation_worker_status(worker_id,provider,state,software_version,observed_at,updated_at)
     values ('translation-test','openai','ready','1.0',$1,$1)`,
    [new Date(now.getTime() - 20_000)]
  );
  await client.query(
    `insert into tts_worker_status(worker_id,provider,state,software_version,error_code,observed_at,updated_at)
     values ('tts-test','openai','degraded','1.0','provider_slow',$1,$1)`,
    [new Date(now.getTime() - 30_000)]
  );
  await client.query(
    `insert into scripture_detections
      (service_id,scripture_reference,book,chapter,verse_start,bible_version,source_text,confidence,state,detection_method,source_observed_at,source_ordinal)
     values
      ($1,'John 3:16','John',3,16,'WEBP','For God so loved the world',95,'preview','reference',$2,0),
      ($1,'Psalm 23:1','Psalms',23,1,'WEBP','The Lord is my shepherd',82,'detected','quote',$3,0)`,
    [service, new Date(now.getTime() - 10_000), new Date(now.getTime() - 40_000)]
  );
  await client.query(
    `insert into subscription_plans(id,code,name,enabled,billing_interval,default_device_seat_limit,features,numeric_limits)
     values ($1,'ai-director-test','AI Director Test',true,'custom',2,'{"ai.director":true}'::jsonb,'{}'::jsonb)`,
    [plan]
  );
  await client.query(
    `insert into organization_subscriptions(id,organization_id,plan_id,status,starts_at,expires_at,grace_until)
     values ($1,$2,$3,'active','2098-01-01T00:00:00Z','2100-01-01T00:00:00Z','2100-01-08T00:00:00Z')`,
    [subscription, org, plan]
  );

  const state = await director.getAIDirectorState(client, admin, { organizationId: org, serviceId: service, now });
  assert.equal(state.service?.id, service);
  assert.equal(state.service?.aiEnabled, true);
  assert.equal(state.service?.autoPreviewThreshold, 90);
  assert.equal(state.health.asr.state, "healthy");
  assert.equal(state.health.translation.state, "healthy");
  assert.equal(state.health.tts.state, "degraded");
  assert.equal(state.recommendations.length, 2);
  assert.equal(state.recommendations[0].reference, "John 3:16");
  assert.equal(state.recommendations[0].confidence, 95);
  assert.match(state.recommendations[0].evidence, /For God so loved/);

  await director.updateAIDirectorSettings(client, admin, {
    organizationId: org,
    serviceId: service,
    aiEnabled: false,
    autoPreviewThreshold: 85,
    now
  });
  const updated = await client.query(
    `select ai_enabled,auto_preview_threshold::float8 as threshold from services where id=$1`,
    [service]
  );
  assert.equal(updated.rows[0].ai_enabled, false);
  assert.equal(updated.rows[0].threshold, 85);

  await expectDirectorError(
    () => director.updateAIDirectorSettings(client, viewer, {
      organizationId: org, serviceId: service, aiEnabled: true, autoPreviewThreshold: 90, now
    }),
    "ai_director_role_required"
  );
  await expectDirectorError(
    () => director.updateAIDirectorSettings(client, admin, {
      organizationId: org, serviceId: service, aiEnabled: true, autoPreviewThreshold: 20, now
    }),
    "ai_director_threshold_invalid"
  );

  await client.query(`update subscription_plans set features='{}'::jsonb where id=$1`, [plan]);
  await expectDirectorError(
    () => director.updateAIDirectorSettings(client, admin, {
      organizationId: org, serviceId: service, aiEnabled: true, autoPreviewThreshold: 90, now
    }),
    "ai_director_entitlement_required"
  );

  await client.query(
    `update translation_worker_status set observed_at=$1,updated_at=$1 where worker_id='translation-test'`,
    [new Date(now.getTime() - 180_000)]
  );
  const stale = await director.getAIDirectorState(client, admin, { organizationId: org, serviceId: service, now });
  assert.equal(stale.health.translation.state, "offline");

  const audit = await client.query(
    `select action from audit_events where organization_id=$1 and entity_id=$2 and action='ai.director.settings.updated'`,
    [org, service]
  );
  assert.equal(audit.rowCount, 1);

  await client.query("rollback");
  console.log(JSON.stringify({
    ok: true,
    healthStates: ["healthy", "degraded", "offline"],
    recommendationEvidence: true,
    thresholdValidation: true,
    entitlementAndRbac: true,
    directProgramAuthority: false
  }));
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
