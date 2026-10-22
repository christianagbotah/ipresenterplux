#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";
import {
  decideScriptureAutomation,
  fatalAutoLivePrerequisite,
  isFatalScriptureAutomationReason
} from "../src/lib/scripture-automation.ts";
import {
  applyScriptureAutomationCircuitBreaker,
  recordAutoScriptureLiveTake
} from "../src/lib/scripture-automation-telemetry.ts";

const ingestSource = await readFile(new URL("../src/lib/transcript-ingest.ts", import.meta.url), "utf8");
const telemetrySource = await readFile(new URL("../src/lib/scripture-automation-telemetry.ts", import.meta.url), "utf8");
assert.match(ingestSource, /applyScriptureAutomationCircuitBreaker/, "transcript ingest must apply fatal circuit breaking");
assert.match(ingestSource, /recordAutoScriptureLiveTake/, "eligible auto-live must record safe latency/audit telemetry");
assert.match(ingestSource, /finalizedRecognitionAt/, "ingest must capture finalized recognition time before the auto-live path");
assert.match(ingestSource, /ScriptureStateError[\s\S]*active_edge_required[\s\S]*no_active_edge/, "Edge loss between preflight and Program transition must be converted into safe no-Edge fallback");
assert.match(ingestSource, /active_edge_required[\s\S]*targetState:\s*"preview"/, "Edge-race fallback must retain the passage in Preview instead of aborting transcript ingest");
assert.match(telemetrySource, /programCommandQueuedAt/, "telemetry must record the Program-command queued timestamp");
assert.match(telemetrySource, /serviceId:\s*input\.serviceId/, "auto-take audit details must identify the service");
assert.match(telemetrySource, /bibleVersion:\s*input\.bibleVersion/, "auto-take audit details must identify the projected Bible translation");
assert.match(telemetrySource, /automationMode:\s*"auto_live"/, "auto-take audit details must identify the initiating automation mode");
assert.match(telemetrySource, /programState:\s*"live"/, "auto-take audit details must record resulting Program state");
assert.doesNotMatch(telemetrySource, /source_text|rawAudio|credential|token/i, "auto-live telemetry must not persist raw audio/text credentials or tokens");

for (const reason of ["local_bible_unavailable", "no_active_edge", "organization_auto_live_disabled", "service_not_live"]) {
  assert.equal(isFatalScriptureAutomationReason(reason), true, `${reason} must be fatal while armed`);
}
for (const reason of ["stale_detection", "low_asr_confidence", "competing_references", "same_reference_already_live", "below_reference_threshold", "below_quote_threshold"]) {
  assert.equal(isFatalScriptureAutomationReason(reason), false, `${reason} must remain a per-detection fallback`);
}

assert.equal(fatalAutoLivePrerequisite({ mode: "auto_live", armed: true, organizationAutoLiveEnabled: true, serviceStatus: "live", activeEdgeCount: 0, localBibleReady: true }), "no_active_edge");
assert.equal(fatalAutoLivePrerequisite({ mode: "auto_live", armed: true, organizationAutoLiveEnabled: false, serviceStatus: "live", activeEdgeCount: 1, localBibleReady: true }), "organization_auto_live_disabled");
assert.equal(fatalAutoLivePrerequisite({ mode: "auto_live", armed: true, organizationAutoLiveEnabled: true, serviceStatus: "ready", activeEdgeCount: 1, localBibleReady: true }), "service_not_live");
assert.equal(fatalAutoLivePrerequisite({ mode: "auto_live", armed: true, organizationAutoLiveEnabled: true, serviceStatus: "live", activeEdgeCount: 1, localBibleReady: false }), "local_bible_unavailable");
assert.equal(fatalAutoLivePrerequisite({ mode: "auto_live", armed: false, organizationAutoLiveEnabled: false, serviceStatus: "ready", activeEdgeCount: 0, localBibleReady: false }), null, "already-disarmed service does not need another circuit break");
assert.match(ingestSource, /fatalAutoLivePrerequisite[\s\S]*applyScriptureAutomationCircuitBreaker/, "fatal preflight must run outside the per-detection decision path");

const decisionBase = {
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
  asrConfidence: 0.98,
};
assert.deepEqual(decideScriptureAutomation({ ...decisionBase, competingMatches: 2 }), { action: "detect", reason: "competing_references" });
assert.deepEqual(decideScriptureAutomation({ ...decisionBase, alreadyLiveSameReference: true }), { action: "detect", reason: "same_reference_already_live" });
assert.deepEqual(decideScriptureAutomation({ ...decisionBase, asrConfidence: 0.8 }), { action: "preview", reason: "low_asr_confidence" });

if (!process.env.DATABASE_URL) {
  console.log(JSON.stringify({ ok: true, mode: "local-contract", database: "deferred-to-ci", fatalReasons: 4, nonFatalReasons: 6 }));
  process.exit(0);
}
assertWritableSelfTestDatabase(process.env.DATABASE_URL);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const org = randomUUID(), campus = randomUUID(), armer = randomUUID(), service = randomUUID(), detection = randomUUID();
try {
  await client.query("begin");
  await client.query(`insert into organizations(id,name,slug,country_code,timezone,auto_scripture_live_enabled) values ($1,'Acceptance Church',$2,'GH','Africa/Accra',true)`, [org, `accept-${org}`]);
  await client.query(`insert into campuses(id,organization_id,name,slug,city,country_code) values ($1,$2,'Main','main','Accra','GH')`, [campus, org]);
  await client.query(`insert into users(id,email,display_name,status) values ($1,$2,'Automation Armer','active')`, [armer, `armer-${armer}@example.invalid`]);
  await client.query(`insert into services(id,organization_id,campus_id,title,status,scheduled_start,started_at,active_bible_version,scripture_automation_mode,scripture_automation_armed_at,scripture_automation_armed_by) values ($1,$2,$3,'Acceptance Live','live',now(),now(),'WEBP','auto_live',now(),$4)`, [service, org, campus, armer]);
  await client.query(`insert into scripture_detections(id,service_id,scripture_reference,book,chapter,verse_start,verse_end,bible_version,confidence,state,detection_method,source_observed_at,source_ordinal) values ($1,$2,'John 3:16','John',3,16,16,'WEBP',98,'live','reference',now(),0)`, [detection, service]);

  assert.equal(await applyScriptureAutomationCircuitBreaker(client, {
    organizationId: org, serviceId: service, actorUserId: armer, mode: "auto_live", armed: true, reason: "low_asr_confidence"
  }), false, "non-fatal fallback must not disarm service");
  let policy = await client.query(`select scripture_automation_armed_at,scripture_automation_armed_by,scripture_automation_suspended_reason from services where id=$1`, [service]);
  assert.ok(policy.rows[0].scripture_automation_armed_at);
  assert.equal(policy.rows[0].scripture_automation_armed_by, armer);
  assert.equal(policy.rows[0].scripture_automation_suspended_reason, null);

  assert.equal(await applyScriptureAutomationCircuitBreaker(client, {
    organizationId: org, serviceId: service, actorUserId: armer, mode: "auto_live", armed: true, reason: "no_active_edge"
  }), true, "fatal prerequisite must disarm armed auto-live");
  policy = await client.query(`select scripture_automation_armed_at,scripture_automation_armed_by,scripture_automation_suspended_reason from services where id=$1`, [service]);
  assert.equal(policy.rows[0].scripture_automation_armed_at, null);
  assert.equal(policy.rows[0].scripture_automation_armed_by, null);
  assert.equal(policy.rows[0].scripture_automation_suspended_reason, "no_active_edge");

  const finalizedRecognitionAt = new Date("2099-01-01T10:00:00.000Z");
  const programCommandQueuedAt = new Date("2099-01-01T10:00:00.120Z");
  const telemetry = await recordAutoScriptureLiveTake(client, {
    organizationId: org,
    serviceId: service,
    actorUserId: armer,
    detectionId: detection,
    reference: "John 3:16",
    bibleVersion: "WEBP",
    detectionMethod: "reference",
    confidence: 98,
    observedAt: new Date("2099-01-01T09:59:59.950Z"),
    decisionReason: "eligible_auto_live",
    edgeCommandsQueued: 1,
    finalizedRecognitionAt,
    programCommandQueuedAt
  });
  assert.equal(telemetry.latencyMs, 120);
  assert.equal(telemetry.withinTarget, true);

  const audit = await client.query(`select actor_type,actor_id,action,details from audit_events where organization_id=$1 and action='scripture.automation.auto_take' order by id desc limit 1`, [org]);
  assert.equal(audit.rows[0].actor_type, "automation");
  assert.equal(audit.rows[0].actor_id, armer);
  assert.equal(audit.rows[0].details.detectionId, detection);
  assert.equal(audit.rows[0].details.reference, "John 3:16");
  assert.equal(audit.rows[0].details.serviceId, service);
  assert.equal(audit.rows[0].details.bibleVersion, "WEBP");
  assert.equal(audit.rows[0].details.automationMode, "auto_live");
  assert.equal(audit.rows[0].details.programState, "live");
  assert.equal(audit.rows[0].details.detectionMethod, "reference");
  assert.equal(Number(audit.rows[0].details.confidence), 98);
  assert.equal(audit.rows[0].details.decisionReason, "eligible_auto_live");
  assert.equal(Number(audit.rows[0].details.edgeCommandsQueued), 1);
  assert.equal(Number(audit.rows[0].details.latencyMs), 120);
  assert.equal(audit.rows[0].details.withinTarget, true);
  assert.ok(audit.rows[0].details.observedAt);
  assert.ok(audit.rows[0].details.finalizedRecognitionAt);
  assert.ok(audit.rows[0].details.programCommandQueuedAt);

  const suspensionAudit = await client.query(`select action,details from audit_events where organization_id=$1 and action='scripture.automation.suspended' order by id desc limit 1`, [org]);
  assert.equal(suspensionAudit.rows[0].details.reason, "no_active_edge");

  await client.query("rollback");
  console.log(JSON.stringify({ ok: true, mode: "postgres", fatalDisarm: true, nonFatalFallback: true, duplicateSuppression: true, competingSuppression: true, safeAudit: true, syntheticLatencyMs: 120 }));
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
} finally {
  await client.end();
}
