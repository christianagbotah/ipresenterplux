#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";
import { isStudioRouteActive } from "../src/components/navigation/studio-routes.ts";

const archive = await import("../src/lib/archive.ts");
assert.equal(typeof archive.listArchivedServices, "function");
assert.equal(typeof archive.getArchivedService, "function");
assert.equal(typeof archive.resolveArchiveArtifactAccess, "function");
assert.equal(isStudioRouteActive("/archive/00000000-0000-4000-8000-000000000001", "/archive"), true);

const pageSource = await readFile(new URL("../src/app/archive/page.tsx", import.meta.url), "utf8");
assert.match(pageSource, /ArchiveList/);
assert.doesNotMatch(pageSource, /StudioReadinessPage/);
const detailPageSource = await readFile(new URL("../src/app/archive/[id]/page.tsx", import.meta.url), "utf8");
assert.match(detailPageSource, /ArchiveServiceDetail/);
const routeSource = await readFile(new URL("../src/app/api/v1/archive/[id]/artifacts/[artifactId]/route.ts", import.meta.url), "utf8");
assert.doesNotMatch(routeSource, /storage_locator|storageLocator/, "artifact route must not expose raw storage locators");

if (!process.env.DATABASE_URL) {
  console.log(JSON.stringify({ ok: true, mode: "local-contract", database: "deferred-to-ci", nestedArchiveActive: true }));
  process.exit(0);
}

assertWritableSelfTestDatabase(process.env.DATABASE_URL);
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
const org = randomUUID();
const foreignOrg = randomUUID();
const campus = randomUUID();
const foreignCampus = randomUUID();
const user = randomUUID();
const foreignUser = randomUUID();
const ended = randomUUID();
const endedTwo = randomUUID();
const live = randomUUID();
const foreignEnded = randomUUID();
const availableArtifact = randomUUID();
const missingArtifact = randomUUID();
const edgeArtifact = randomUUID();
const plan = randomUUID();
const subscription = randomUUID();
const now = new Date("2099-01-01T12:00:00.000Z");

async function expectArchiveError(action, code) {
  try {
    await action();
    assert.fail(`expected ${code}`);
  } catch (error) {
    assert.ok(error instanceof archive.ArchiveError, `expected ArchiveError for ${code}`);
    assert.equal(error.code, code);
  }
}

try {
  await client.query("begin");
  await client.query(
    `insert into organizations(id,name,slug,country_code,timezone) values
      ($1,'Archive Test Church',$2,'GH','Africa/Accra'),
      ($3,'Foreign Archive Church',$4,'GH','Africa/Accra')`,
    [org, `archive-${org}`, foreignOrg, `archive-${foreignOrg}`]
  );
  await client.query(
    `insert into campuses(id,organization_id,name,slug,city,country_code) values
      ($1,$2,'Main Campus','main','Accra','GH'),
      ($3,$4,'Foreign Campus','foreign','Accra','GH')`,
    [campus, org, foreignCampus, foreignOrg]
  );
  await client.query(
    `insert into users(id,email,display_name,status) values
      ($1,$2,'Archive User','active'),($3,$4,'Foreign Archive User','active')`,
    [user, `archive-${user}@example.invalid`, foreignUser, `archive-${foreignUser}@example.invalid`]
  );
  await client.query(
    `insert into user_organization_roles(user_id,organization_id,role_id) values
      ($1,$2,'presenter_operator'),($3,$4,'viewer')`,
    [user, org, foreignUser, foreignOrg]
  );
  await client.query(
    `insert into services(id,organization_id,campus_id,title,status,scheduled_start,started_at,ended_at,active_bible_version) values
      ($1,$2,$3,'Sunday Celebration','ended',$4,$5,$6,'WEBP'),
      ($7,$2,$3,'Midweek Encounter','ended',$8,$9,$10,'WEBP'),
      ($11,$2,$3,'Current Live','live',now(),now(),null,'WEBP'),
      ($12,$13,$14,'Foreign Ended','ended',now(),now(),now(),'WEBP')`,
    [
      ended, org, campus,
      new Date("2098-12-28T09:00:00Z"), new Date("2098-12-28T09:05:00Z"), new Date("2098-12-28T11:00:00Z"),
      endedTwo, new Date("2098-12-20T18:00:00Z"), new Date("2098-12-20T18:03:00Z"), new Date("2098-12-20T19:30:00Z"),
      live, foreignEnded, foreignOrg, foreignCampus
    ]
  );
  await client.query(
    `insert into presentation_items(service_id,item_type,title,content,sort_order,state) values
      ($1,'song','Way Maker','{"title":"Way Maker","sections":[{"label":"Verse","body":"You are here"}]}'::jsonb,1000,'played'),
      ($1,'slide','Welcome','{"title":"Welcome","body":"Welcome home"}'::jsonb,2000,'played')`,
    [ended]
  );
  await client.query(
    `insert into scripture_detections
      (service_id,scripture_reference,book,chapter,verse_start,bible_version,source_text,confidence,state,detection_method,source_observed_at,source_ordinal)
     values ($1,'John 3:16','John',3,16,'WEBP','For God so loved the world',97,'live','reference',$2,0)`,
    [ended, new Date("2098-12-28T10:15:00Z")]
  );
  const segment = await client.query(
    `insert into transcript_segments(service_id,text,source_observed_at,source_language,asr_confidence)
     values ($1,'Welcome to the service',$2,'en',0.98) returning id::text`,
    [ended, new Date("2098-12-28T09:06:00Z")]
  );
  await client.query(
    `insert into transcript_translation_jobs(transcript_segment_id,language_channel_id,target_language_code,channel_mode,status,translated_text,provider,completed_at)
     select $1,lc.id,'fr','translation_text','succeeded','Bienvenue au service','selftest',$2
       from language_channels lc
      where lc.organization_id='00000000-0000-4000-8000-000000000001'
      order by lc.created_at,lc.id limit 1`,
    [segment.rows[0].id, new Date("2098-12-28T09:06:02Z")]
  ).catch(() => {});
  await client.query(
    `insert into service_artifacts(id,organization_id,service_id,artifact_type,status,storage_kind,storage_locator,metadata) values
      ($1,$2,$3,'recording','available','external','https://cdn.example.test/archive/service.mp4','{"requiredFeature":"core.presentation","label":"Full service recording"}'::jsonb),
      ($4,$2,$3,'recording','missing','metadata_only',null,'{"label":"Backup recording"}'::jsonb),
      ($5,$2,$3,'recording','available','edge_local','C:\\private\\service.mp4','{"requiredFeature":"core.presentation","label":"Edge master"}'::jsonb)`,
    [availableArtifact, org, ended, missingArtifact, edgeArtifact]
  );
  await client.query(
    `insert into subscription_plans(id,code,name,enabled,billing_interval,default_device_seat_limit,features,numeric_limits)
     values ($1,'archive-test','Archive Test',true,'custom',2,'{"core.presentation":true}'::jsonb,'{}'::jsonb)`,
    [plan]
  );
  await client.query(
    `insert into organization_subscriptions(id,organization_id,plan_id,status,starts_at,expires_at,grace_until)
     values ($1,$2,$3,'active','2098-01-01T00:00:00Z','2100-01-01T00:00:00Z','2100-01-08T00:00:00Z')`,
    [subscription, org, plan]
  );

  const list = await archive.listArchivedServices(client, user, { organizationId: org, search: "Sunday" });
  assert.equal(list.services.length, 1);
  assert.equal(list.services[0].id, ended);
  assert.equal(list.services[0].title, "Sunday Celebration");
  assert.equal(list.services.some((service) => service.id === live), false, "live services must not appear in Archive");
  assert.equal(list.services.some((service) => service.id === foreignEnded), false, "foreign tenant services must not appear");

  const detail = await archive.getArchivedService(client, user, ended);
  assert.equal(detail.service.id, ended);
  assert.equal(detail.rundown.length, 2);
  assert.equal(detail.scriptureHistory.length, 1);
  assert.equal(detail.scriptureHistory[0].reference, "John 3:16");
  assert.equal(detail.transcript.count, 1);
  assert.equal(detail.artifacts.length, 3);
  assert.equal(Object.hasOwn(detail.artifacts[0], "storageLocator"), false, "archive detail must not expose storage locators");
  assert.ok(detail.artifacts.some((artifact) => artifact.status === "missing"), "missing artifacts must remain visible as metadata");

  await expectArchiveError(() => archive.getArchivedService(client, user, foreignEnded), "archive_service_not_found");
  await expectArchiveError(() => archive.getArchivedService(client, foreignUser, ended), "archive_service_not_found");

  const external = await archive.resolveArchiveArtifactAccess(client, user, ended, availableArtifact, { now });
  assert.equal(external.kind, "redirect");
  assert.equal(external.url, "https://cdn.example.test/archive/service.mp4");

  const missing = await archive.resolveArchiveArtifactAccess(client, user, ended, missingArtifact, { now });
  assert.equal(missing.kind, "unavailable");
  assert.equal(missing.status, "missing");

  const edgeOnly = await archive.resolveArchiveArtifactAccess(client, user, ended, edgeArtifact, { now });
  assert.equal(edgeOnly.kind, "unavailable");
  assert.equal(edgeOnly.status, "edge_local_only");
  assert.equal(JSON.stringify(edgeOnly).includes("C:\\private"), false, "raw Edge paths must never leave archive access service");

  await client.query(`update subscription_plans set features='{}'::jsonb where id=$1`, [plan]);
  await expectArchiveError(
    () => archive.resolveArchiveArtifactAccess(client, user, ended, availableArtifact, { now }),
    "archive_entitlement_required"
  );

  await client.query("rollback");
  console.log(JSON.stringify({
    ok: true,
    endedOnly: true,
    tenantIsolation: true,
    rundownAndHistory: true,
    missingArtifactResilient: true,
    rawLocatorHidden: true,
    nestedArchiveActive: true
  }));
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
