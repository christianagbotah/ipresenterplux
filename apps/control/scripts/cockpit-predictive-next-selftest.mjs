#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";
import { projectPredictiveNext } from "../src/lib/cockpit/predictive-next.ts";
import { setServicePin, upsertCockpitRecommendation } from "../src/lib/cockpit/recommendations.ts";

const viewModelSource = await readFile(new URL("../src/lib/cockpit/view-model.ts", import.meta.url), "utf8");
assert.match(viewModelSource, /projectPredictiveNext/, "Cockpit view model must consume the shared Predictive Next projection");
const transcriptSource = await readFile(new URL("../src/lib/transcript-ingest.ts", import.meta.url), "utf8");
assert.match(transcriptSource, /upsertCockpitRecommendation/, "Scripture source truth must persist recommendations during transcript ingest");
const edgeSource = await readFile(new URL("../src/app/api/v1/edge/media-source/route.ts", import.meta.url), "utf8");
assert.match(edgeSource, /upsertCockpitRecommendation/, "Camera source truth must persist recommendations during authenticated Edge ingest");
const nextRailSource = await readFile(new URL("../src/components/cockpit/NextRail.tsx", import.meta.url), "utf8");
assert.match(nextRailSource, /NextItemActions/, "Next rail must render explicit Predictive Next actions");
const actionsSource = await readFile(new URL("../src/components/cockpit/NextItemActions.tsx", import.meta.url), "utf8").catch(() => null);
assert.ok(actionsSource, "NextItemActions component must exist");
assert.match(actionsSource, /state:\s*["']preview["']/, "Scripture recommendations must reuse the existing Preview state API");
assert.match(actionsSource, /api\/v1\/cockpit\/recommendations/, "Recommendation dismiss/prepared state must use the Cockpit recommendation API");
assert.match(actionsSource, /api\/v1\/cockpit\/pins/, "Pin actions must use the shared Cockpit pin API");
assert.doesNotMatch(actionsSource, /program\.show|state:\s*["']live["']/, "Predictive Next actions must not contain a direct Program mutation");

if (!process.env.DATABASE_URL) {
  console.log(JSON.stringify({ ok: true, mode: "local-contract", database: "deferred-to-ci" }));
  process.exit(0);
}
assertWritableSelfTestDatabase(process.env.DATABASE_URL);
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
const now = new Date("2099-05-02T10:00:00.000Z");
const org = randomUUID(), campus = randomUUID(), user = randomUUID(), service = randomUUID();
const plannedA = randomUUID(), plannedB = randomUUID();
const dismissedScripture = randomUUID(), suggestedScripture = randomUUID(), staleScripture = randomUUID();
const freshEdge = randomUUID(), staleEdge = randomUUID(), freshCamera = randomUUID(), staleCamera = randomUUID();

try {
  await client.query("begin");
  await client.query(`insert into organizations(id,name,slug,country_code,timezone) values ($1,'Predictive Church',$2,'GH','Africa/Accra')`, [org, `predictive-${org}`]);
  await client.query(`insert into campuses(id,organization_id,name,slug,city,country_code) values ($1,$2,'Main','main','Accra','GH')`, [campus, org]);
  await client.query(`insert into users(id,email,display_name,status) values ($1,$2,'Predictive Operator','active')`, [user, `predictive-${user}@example.invalid`]);
  await client.query(`insert into user_organization_roles(user_id,organization_id,role_id) values ($1,$2,'presenter_operator')`, [user, org]);
  await client.query(`insert into services(id,organization_id,campus_id,title,status,scheduled_start,started_at,active_bible_version,updated_at) values ($1,$2,$3,'Sunday Live','live',$4,$4,'WEBP',$4)`, [service, org, campus, now]);
  await client.query(`insert into presentation_items(id,service_id,item_type,title,content,sort_order,state,updated_at) values
    ($1,$3,'song','Amazing Grace','{}'::jsonb,10,'queued',$4),
    ($2,$3,'slide','Closing Prayer','{}'::jsonb,20,'queued',$4)`, [plannedA, plannedB, service, now]);
  await client.query(`insert into scripture_detections(id,service_id,scripture_reference,book,chapter,verse_start,verse_end,bible_version,source_text,confidence,state,detected_at,source_observed_at,source_ordinal,detection_method) values
    ($1,$4,'John 3:16','John',3,16,16,'WEBP','For God so loved the world',97,'detected',$5,$5,1,'quote'),
    ($2,$4,'Romans 8:28','Romans',8,28,28,'WEBP','All things work together for good',96,'detected',$6,$6,2,'reference'),
    ($3,$4,'Psalm 23:1','Psalms',23,1,1,'WEBP','The Lord is my shepherd',99,'detected',$7,$7,3,'quote')`,
    [dismissedScripture, suggestedScripture, staleScripture, service, new Date(now.getTime()-10_000), new Date(now.getTime()-12_000), new Date(now.getTime()-300_000)]);
  await client.query(`insert into edge_devices(id,organization_id,campus_id,name,platform,status,credential_hash,last_seen_at,active_service_id) values
    ($1,$3,$4,'Fresh Edge','windows','active',repeat('a',64),$5,$6),
    ($2,$3,$4,'Stale Edge','windows','active',repeat('b',64),$7,$6)`,
    [freshEdge, staleEdge, org, campus, new Date(now.getTime()-20_000), service, new Date(now.getTime()-400_000)]);
  await client.query(`insert into media_sources(id,organization_id,name,source_type,status,public_config,edge_device_id,source_key,last_seen_at,metadata) values
    ($1,$3,'Lectern Camera','camera','ready','{}'::jsonb,$4,'camera:fresh',$6,'{}'::jsonb),
    ($2,$3,'Old Camera','camera','ready','{}'::jsonb,$5,'camera:stale',$7,'{}'::jsonb)`,
    [freshCamera, staleCamera, org, freshEdge, staleEdge, new Date(now.getTime()-15_000), new Date(now.getTime()-350_000)]);

  await setServicePin(client, user, { organizationId: org, serviceId: service, targetType: "presentation_item", targetId: plannedB, title: "Closing Prayer", pinned: true, now });
  await upsertCockpitRecommendation(client, {
    organizationId: org, serviceId: service, sourceKey: `scripture:${dismissedScripture}`, recommendationType: "scripture.detected",
    targetType: "scripture_detection", targetId: dismissedScripture, payload: { reference: "John 3:16", bibleVersion: "WEBP" }, confidence: 97,
    reason: "John 3:16 detected", evidence: "For God so loved the world", sourceObservedAt: new Date(now.getTime()-10_000), expiresAt: new Date(now.getTime()+110_000), state: "dismissed", now: new Date(now.getTime()-30_000)
  });
  await upsertCockpitRecommendation(client, {
    organizationId: org, serviceId: service, sourceKey: `scripture:${suggestedScripture}`, recommendationType: "scripture.detected",
    targetType: "scripture_detection", targetId: suggestedScripture, payload: { reference: "Romans 8:28", bibleVersion: "WEBP" }, confidence: 96,
    reason: "Romans 8:28 detected", evidence: "All things work together for good", sourceObservedAt: new Date(now.getTime()-12_000), expiresAt: new Date(now.getTime()+108_000), state: "suggested", now: new Date(now.getTime()-30_000)
  });
  await upsertCockpitRecommendation(client, {
    organizationId: org, serviceId: service, sourceKey: `camera:${freshCamera}`, recommendationType: "camera.available",
    targetType: "camera_source", targetId: freshCamera, payload: { status: "ready" }, confidence: 70,
    reason: "Lectern Camera is available from the active Edge", evidence: "Fresh Edge camera telemetry", sourceObservedAt: new Date(now.getTime()-20_000), expiresAt: new Date(now.getTime()+100_000), state: "suggested", now: new Date(now.getTime()-30_000)
  });
  await upsertCockpitRecommendation(client, {
    organizationId: org, serviceId: service, sourceKey: `camera:${staleCamera}`, recommendationType: "camera.available",
    targetType: "camera_source", targetId: staleCamera, payload: { status: "ready" }, confidence: 95,
    reason: "Old Camera is available", evidence: "Stale telemetry", sourceObservedAt: new Date(now.getTime()-350_000), expiresAt: new Date(now.getTime()+100_000), state: "suggested", now: new Date(now.getTime()-30_000)
  });

  const before = await client.query(`select id::text,updated_at::text,state from cockpit_recommendations where service_id=$1 order by id`, [service]);
  const first = await projectPredictiveNext(client, { organizationId: org, serviceId: service, now });
  const second = await projectPredictiveNext(client, { organizationId: org, serviceId: service, now });
  const after = await client.query(`select id::text,updated_at::text,state from cockpit_recommendations where service_id=$1 order by id`, [service]);
  assert.deepEqual(after.rows, before.rows, "Predictive projection must not write recommendation state while rendering the Cockpit");
  assert.deepEqual(second, first, "equal inputs must produce deterministic ordering and payloads");
  assert.ok(first.length >= 4, "pin, Scripture/camera recommendations and planned item should be projected");
  assert.equal(first[0].source, "pinned", "manual pins must outrank ordinary planned/recommended items");
  assert.equal(first[0].targetId, plannedB);
  assert.ok(first.some((item) => item.source === "planned" && item.targetId === plannedA), "planned rundown neighborhood must remain available");
  const scripture = first.find((item) => item.targetId === suggestedScripture);
  assert.ok(scripture, "fresh persisted Scripture recommendation must project");
  assert.equal(scripture.confidence, 96);
  assert.match(scripture.reason ?? "", /Romans 8:28/);
  assert.equal(first.some((item) => item.targetId === staleScripture), false, "stale Scripture without a fresh persisted recommendation must not appear");
  assert.equal(first.some((item) => item.targetId === staleCamera), false, "stale camera truth must suppress even an unexpired persisted recommendation");
  assert.ok(first.some((item) => item.targetId === freshCamera && item.source === "recommendation"), "fresh Edge-backed camera truth may be recommended");
  assert.equal(first.some((item) => item.targetId === dismissedScripture), false, "dismissed recommendation must stay dismissed");
  for (const item of first) {
    assert.equal(item.actions.some((action) => /program|live/i.test(action)), false, `Next action ${item.actions.join(',')} must not mutate Program directly`);
  }

  await client.query("rollback");
  console.log(JSON.stringify({ ok: true, deterministic: true, readOnlyProjection: true, pinnedFirst: true, scriptureEvidence: true, staleExpired: true, edgeCameraFreshness: true, directProgramAction: false }));
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
