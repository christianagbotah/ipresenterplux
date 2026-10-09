#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";
import { getCockpitViewModel } from "../src/lib/cockpit/view-model.ts";

if (!process.env.DATABASE_URL) {
  console.log(JSON.stringify({ ok: true, mode: "local-contract", database: "deferred-to-ci" }));
  process.exit(0);
}

assertWritableSelfTestDatabase(process.env.DATABASE_URL);
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
const org = randomUUID();
const campus = randomUUID();
const user = randomUUID();
const liveService = randomUUID();
const readyService = randomUUID();
const plan = randomUUID();
const subscription = randomUUID();
const previewItem = randomUUID();
const queuedItem = randomUUID();
const liveScripture = randomUUID();
const edge = randomUUID();
const camera = randomUUID();
const audio = randomUUID();
const outputReady = randomUUID();
const outputFailed = randomUUID();
const languageFr = randomUUID();
const now = new Date("2099-04-12T10:00:00.000Z");

try {
  await client.query("begin");
  await client.query(
    `insert into organizations(id,name,slug,country_code,timezone)
     values ($1,'Cockpit Church',$2,'GH','Africa/Accra')`,
    [org, `cockpit-${org}`]
  );
  await client.query(
    `insert into campuses(id,organization_id,name,slug,city,country_code)
     values ($1,$2,'Main Auditorium','main','Accra','GH')`,
    [campus, org]
  );
  await client.query(
    `insert into users(id,email,display_name,status)
     values ($1,$2,'Cockpit Operator','active')`,
    [user, `cockpit-${user}@example.invalid`]
  );
  await client.query(
    `insert into user_organization_roles(user_id,organization_id,role_id)
     values ($1,$2,'owner')`,
    [user, org]
  );
  await client.query(
    `insert into subscription_plans(id,code,name,enabled,billing_interval,default_device_seat_limit,features,numeric_limits)
     values ($1,$2,'Cockpit Plan',true,'custom',5,$3::jsonb,'{}'::jsonb)`,
    [plan, `cockpit-${plan}`, JSON.stringify({
      "core.presentation": true,
      "ai.director": true,
      "translations.text": true,
      "translations.audio": true,
      "streaming.web": true,
      "streaming.social": true
    })]
  );
  await client.query(
    `insert into organization_subscriptions(id,organization_id,plan_id,status,starts_at,expires_at,grace_until)
     values ($1,$2,$3,'active','2099-01-01T00:00:00Z','2100-01-01T00:00:00Z','2100-01-08T00:00:00Z')`,
    [subscription, org, plan]
  );
  await client.query(
    `insert into services(id,organization_id,campus_id,title,status,scheduled_start,started_at,active_bible_version,updated_at) values
       ($1,$2,$3,'Live Worship','live','2099-04-12T09:00:00Z','2099-04-12T09:02:00Z','WEBP','2099-04-12T09:59:00Z'),
       ($4,$2,$3,'Later Ready Service','ready','2099-04-13T09:00:00Z',null,'WEBP','2099-04-12T09:59:30Z')`,
    [liveService, org, campus, readyService]
  );
  await client.query(
    `insert into presentation_items(id,service_id,item_type,title,content,sort_order,state,updated_at) values
       ($1,$2,'song','Amazing Grace',$3::jsonb,20,'preview','2099-04-12T09:59:40Z'),
       ($4,$2,'slide','Closing Prayer',$5::jsonb,30,'queued','2099-04-12T09:59:45Z')`,
    [previewItem, liveService, JSON.stringify({ sections: [{ label: "Verse 1", text: "Amazing grace" }] }), queuedItem, JSON.stringify({ body: "Thank you" })]
  );
  await client.query(
    `insert into scripture_detections(id,service_id,scripture_reference,book,chapter,verse_start,verse_end,bible_version,source_text,confidence,state,detected_at,source_observed_at,source_ordinal,detection_method)
     values ($1,$2,'John 3','John',3,null,null,'WEBP','John chapter three',97,'live','2099-04-12T09:59:42Z','2099-04-12T09:59:41Z',1,'reference')`,
    [liveScripture, liveService]
  );
  await client.query(
    `insert into transcript_segments(service_id,text,source_observed_at,source_language,speaker_id,asr_confidence,speaker_source)
     values ($1,'For God so loved the world','2099-04-12T09:59:50Z','en','pastor-1',0.94,'asr')`,
    [liveService]
  );
  await client.query(
    `insert into edge_devices(id,organization_id,campus_id,name,platform,status,credential_hash,capabilities,last_seen_at,active_service_id)
     values ($1,$2,$3,'Sanctuary Edge','windows','active',$4,'{}'::jsonb,'2099-04-12T09:57:30Z',$5)`,
    [edge, org, campus, "a".repeat(64), liveService]
  );
  await client.query(
    `insert into media_sources(id,organization_id,name,source_type,status,public_config,edge_device_id,source_key,last_seen_at,metadata) values
       ($1,$2,'Pulpit Camera','camera','ready','{}'::jsonb,$3,'cam:pulpit','2099-04-12T09:57:20Z','{}'::jsonb),
       ($4,$2,'Mixer Audio','audio_input','ready','{}'::jsonb,$3,'audio:mixer','2099-04-12T09:59:50Z',$5::jsonb)`,
    [camera, org, edge, audio, JSON.stringify({ asrWorkerStatus: "ready", asrStatus: "ready" })]
  );
  await client.query(
    `insert into output_destinations(id,organization_id,name,destination_type,enabled,status,public_config) values
       ($1,$2,'Projector','ndi',true,'ready','{}'::jsonb),
       ($3,$2,'YouTube','youtube',true,'error','{}'::jsonb)`,
    [outputReady, org, outputFailed]
  );
  await client.query(
    `insert into language_channels(id,organization_id,language_code,language_name,channel_mode,enabled,listener_count)
     values ($1,$2,'fr','French','translation_audio',true,7)`,
    [languageFr, org]
  );

  const model = await getCockpitViewModel(client, user, { organizationId: org, now });
  assert.equal(model.service?.id, liveService, "live service must outrank a newer ready service");
  assert.equal(model.service?.title, "Live Worship");
  assert.equal(model.program?.source, "scripture_detection");
  assert.equal(model.program?.id, liveScripture);
  assert.equal(model.program?.title, "John 3");
  const expectedChapter = await client.query(
    `select bv.text
       from bible_books bb
       join bible_verses bv on bv.version_id=bb.version_id and bv.book_code=bb.book_code
      where bb.version_id='WEBP' and lower(bb.canonical_name)=lower('John') and bv.chapter=3
      order by bv.verse`,
  );
  assert.ok(expectedChapter.rowCount >= 2, "whole-chapter fixture must contain multiple verses");
  assert.equal(
    model.program?.body,
    expectedChapter.rows.map((row) => row.text).join(" "),
    "whole-chapter detection must include every local verse in canonical order"
  );
  assert.equal(model.preview?.source, "presentation_item");
  assert.equal(model.preview?.id, previewItem);
  assert.equal(model.preview?.title, "Amazing Grace");
  assert.equal(model.now.speakerId, "pastor-1");
  assert.equal(model.now.transcriptText, "For God so loved the world");
  assert.equal(model.next.some((item) => item.id === queuedItem && item.source === "planned"), true, "queued Planner neighborhood must be present");
  assert.equal(model.systems.camera.freshness, "stale", "camera older than 120 seconds must be non-current");
  assert.equal(model.systems.edge.freshness, "stale", "Edge older than 120 seconds must be non-current");
  assert.equal(model.systems.audio.freshness, "current", "fresh audio telemetry must remain current");
  assert.deepEqual(model.systems.outputs, { total: 2, enabled: 2, healthy: 1, degraded: 1 });
  assert.deepEqual(model.systems.languages, { enabled: 1, listeners: 7 });
  assert.equal(model.systems.audience.listeners, 7);
  assert.equal(model.capabilities.canLiveControl, true);
  assert.equal(model.capabilities.canMedia, true);
  assert.equal(model.capabilities.canStreaming, true);
  assert.equal(model.authority.programMutation, "existing_domain_paths_only");
  assert.equal(model.authority.edgeOwnsPhysicalTruth, true);

  await client.query("rollback");
  console.log(JSON.stringify({
    ok: true,
    liveBeforeReady: true,
    programPreviewSeparated: true,
    staleBoundarySeconds: 120,
    plannerNeighborhood: true,
    edgeTruth: true,
    wholeChapterBody: true
  }));
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
