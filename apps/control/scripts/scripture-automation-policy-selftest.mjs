#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";
import { activeAssignedEdgeCount, decideScriptureAutomation, recentlyLiveReference } from "../src/lib/scripture-automation.ts";

const base = {
  mode: "auto_live",
  organizationAutoLiveEnabled: true,
  serviceStatus: "live",
  armed: true,
  detectionMethod: "reference",
  confidence: 98,
  referenceThreshold: 98,
  quoteThreshold: 96,
  stale: false,
  competingMatches: 1,
  alreadyLiveSameReference: false,
  activeEdgeCount: 1,
  localBibleReady: true,
  asrConfidence: 0.95,
};

const cases = [
  ["manual stays detect-only", { mode: "manual" }, "detect", "manual_mode"],
  ["auto preview prepares a valid detection", { mode: "auto_preview" }, "preview", "auto_preview"],
  ["eligible explicit reference goes live", {}, "live", "eligible_auto_live"],
  ["null ASR confidence does not disqualify trusted local ingest", { asrConfidence: null }, "live", "eligible_auto_live"],
  ["low ASR confidence falls back to preview", { asrConfidence: 0.84 }, "preview", "low_asr_confidence"],
  ["organization permission off falls back to preview", { organizationAutoLiveEnabled: false }, "preview", "organization_auto_live_disabled"],
  ["non-live service falls back to preview", { serviceStatus: "ready" }, "preview", "service_not_live"],
  ["unarmed service falls back to preview", { armed: false }, "preview", "automation_not_armed"],
  ["no active assigned Edge falls back to preview", { activeEdgeCount: 0 }, "preview", "no_active_edge"],
  ["missing local Bible cannot automate", { localBibleReady: false }, "detect", "local_bible_unavailable"],
  ["stale detection cannot automate", { stale: true }, "detect", "stale_detection"],
  ["competing references remain in Next instead of choosing one", { competingMatches: 2 }, "detect", "competing_references"],
  ["same reference already live suppresses re-take", { alreadyLiveSameReference: true }, "detect", "same_reference_already_live"],
  ["context navigation never auto-lives", { detectionMethod: "context", confidence: 100 }, "preview", "method_not_auto_live"],
  ["manual provenance never auto-lives", { detectionMethod: "manual", confidence: 100 }, "preview", "method_not_auto_live"],
  ["reference below threshold falls back to preview", { confidence: 98, referenceThreshold: 99 }, "preview", "below_reference_threshold"],
  ["reference at raised threshold can go live", { confidence: 99, referenceThreshold: 99 }, "live", "eligible_auto_live"],
  ["quote exactly at product ceiling and threshold 96 can go live", { detectionMethod: "quote", confidence: 96, quoteThreshold: 96 }, "live", "eligible_auto_live"],
  ["admin-raised quote threshold above 96 intentionally blocks 96 quote", { detectionMethod: "quote", confidence: 96, quoteThreshold: 96.01 }, "preview", "below_quote_threshold"],
];

for (const [name, override, action, reason] of cases) {
  const decision = decideScriptureAutomation({ ...base, ...override });
  assert.equal(decision.action, action, `${name}: action`);
  assert.equal(decision.reason, reason, `${name}: reason`);
}

const ingestSource = await readFile(new URL("../src/lib/transcript-ingest.ts", import.meta.url), "utf8");
assert.match(ingestSource, /decideScriptureAutomation/, "transcript ingest must use the deterministic policy evaluator");
assert.match(ingestSource, /activeAssignedEdgeCount/, "transcript ingest must gate auto-live on assigned active Edge truth");
assert.match(ingestSource, /recentlyLiveReference/, "transcript ingest must suppress repeated live references");
assert.match(ingestSource, /transitionScriptureState/, "auto-live must use the shared Scripture state authority");
assert.match(ingestSource, /requireEdgeForLive:\s*true/, "auto-live transition must re-check physical Edge authority");

if (!process.env.DATABASE_URL) {
  console.log(JSON.stringify({ ok: true, mode: "local-contract", cases: cases.length, database: "deferred-to-ci" }));
  process.exit(0);
}

assertWritableSelfTestDatabase(process.env.DATABASE_URL);
const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const org = randomUUID(), campus = randomUUID(), user = randomUUID(), service = randomUUID(), edge = randomUUID(), detection = randomUUID();
try {
  await client.query("begin");
  await client.query(`insert into organizations(id,name,slug,country_code,timezone) values ($1,'Automation Policy Church',$2,'GH','Africa/Accra')`, [org, `auto-policy-${org}`]);
  await client.query(`insert into campuses(id,organization_id,name,slug,city,country_code) values ($1,$2,'Main','main','Accra','GH')`, [campus, org]);
  await client.query(`insert into users(id,email,display_name,status) values ($1,$2,'Automation Operator','active')`, [user, `automation-${user}@example.invalid`]);
  await client.query(`insert into services(id,organization_id,campus_id,title,status,scheduled_start,started_at,active_bible_version,scripture_automation_mode,scripture_automation_armed_at,scripture_automation_armed_by) values ($1,$2,$3,'Automation Policy Service','live',now(),now(),'WEBP','auto_live',now(),$4)`, [service, org, campus, user]);
  assert.equal(await activeAssignedEdgeCount(client, org, service), 0);
  await client.query(`insert into edge_devices(id,organization_id,name,platform,status,last_seen_at,active_service_id) values ($1,$2,'Sanctuary Edge','windows','active',now(),$3)`, [edge, org, service]);
  assert.equal(await activeAssignedEdgeCount(client, org, service), 1);

  await client.query(`insert into scripture_detections(id,service_id,scripture_reference,book,chapter,verse_start,verse_end,bible_version,confidence,state,detection_method,source_observed_at,source_ordinal) values ($1,$2,'John 3:16','John',3,16,16,'WEBP',98,'live','reference',now(),0)`, [detection, service]);
  assert.equal(await recentlyLiveReference(client, service, 'John 3:16', new Date()), true, "currently live reference must suppress a repeat regardless of detection age");
  await client.query(`update scripture_detections set state='played' where id=$1`, [detection]);
  await client.query(`insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details,created_at) values ($1,'automation',$2,'scripture.state.changed','scripture_detection',$3,$4::jsonb,clock_timestamp())`, [org, user, detection, JSON.stringify({ reference: 'John 3:16', from: 'detected', to: 'live' })]);
  assert.equal(await recentlyLiveReference(client, service, 'John 3:16', new Date()), true, "recent live audit must suppress rapid retake after another passage");
  assert.equal(await recentlyLiveReference(client, service, 'Romans 8:28', new Date()), false);

  await client.query("rollback");
  console.log(JSON.stringify({ ok: true, mode: "postgres", cases: cases.length, edgeHelper: true, recentLiveHelper: true, transcriptIntegration: true }));
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
} finally {
  await client.end();
}
