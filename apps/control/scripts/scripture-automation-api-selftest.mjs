#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";
import {
  ScriptureAutomationSettingsError,
  setOrganizationScriptureAutomationPermission,
  setServiceScriptureAutomation,
  suspendServiceScriptureAutomation,
} from "../src/lib/scripture-automation-settings.ts";

const orgRoute = await readFile(new URL("../src/app/api/v1/settings/scripture-automation/route.ts", import.meta.url), "utf8");
const serviceRoute = await readFile(new URL("../src/app/api/v1/services/[id]/scripture-automation/route.ts", import.meta.url), "utf8");
const serviceStateRoute = await readFile(new URL("../src/app/api/v1/services/[id]/state/route.ts", import.meta.url), "utf8");
const settingsSource = await readFile(new URL("../src/lib/scripture-automation-settings.ts", import.meta.url), "utf8");
assert.match(orgRoute, /setOrganizationScriptureAutomationPermission/, "organization route must delegate to centralized settings authority");
assert.match(serviceRoute, /setServiceScriptureAutomation/, "service route must delegate to centralized settings authority");
assert.match(serviceStateRoute, /suspendServiceScriptureAutomation[\s\S]*service_ended/, "service end must disarm Scripture automation through shared helper");
assert.match(settingsSource, /policy_changed/, "changing an already-armed automation policy must force disarm");

if (!process.env.DATABASE_URL) {
  console.log(JSON.stringify({ ok: true, mode: "local-contract", database: "deferred-to-ci" }));
  process.exit(0);
}

assertWritableSelfTestDatabase(process.env.DATABASE_URL);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const org = randomUUID(), otherOrg = randomUUID(), campus = randomUUID(), noEdgeCampus = randomUUID(), otherCampus = randomUUID();
const owner = randomUUID(), operator = randomUUID(), outsider = randomUUID();
const liveService = randomUUID(), readyService = randomUUID(), noEdgeService = randomUUID(), edge = randomUUID();
try {
  await client.query("begin");
  await client.query(`insert into organizations(id,name,slug,country_code,timezone) values ($1,'Automation Admin Church',$2,'GH','Africa/Accra'),($3,'Other Church',$4,'GH','Africa/Accra')`, [org, `auto-admin-${org}`, otherOrg, `auto-admin-${otherOrg}`]);
  await client.query(`insert into campuses(id,organization_id,name,slug,city,country_code) values
    ($1,$2,'Main','main','Accra','GH'),
    ($3,$2,'Annex','annex','Accra','GH'),
    ($4,$5,'Other','other','Accra','GH')`, [campus, org, noEdgeCampus, otherCampus, otherOrg]);
  await client.query(`insert into users(id,email,display_name,status) values ($1,$2,'Owner','active'),($3,$4,'Operator','active'),($5,$6,'Outsider','active')`, [owner, `owner-${owner}@example.invalid`, operator, `operator-${operator}@example.invalid`, outsider, `outsider-${outsider}@example.invalid`]);
  await client.query(`insert into user_organization_roles(user_id,organization_id,role_id) values ($1,$2,'owner'),($3,$2,'presenter_operator'),($4,$5,'presenter_operator')`, [owner, org, operator, outsider, otherOrg]);
  await client.query(`insert into services(id,organization_id,campus_id,title,status,scheduled_start,started_at,active_bible_version) values
    ($1,$4,$5,'Live Service','live',now(),now(),'WEBP'),
    ($2,$4,$5,'Ready Service','ready',now(),null,'WEBP'),
    ($3,$4,$6,'No Edge Service','live',now(),now(),'WEBP')`, [liveService, readyService, noEdgeService, org, campus, noEdgeCampus]);
  await client.query(`insert into edge_devices(id,organization_id,campus_id,name,platform,status,last_seen_at,active_service_id) values ($1,$2,$3,'Sanctuary Edge','windows','active',now(),$4)`, [edge, org, campus, liveService]);

  await assert.rejects(
    () => setOrganizationScriptureAutomationPermission(client, operator, org, true),
    (error) => error instanceof ScriptureAutomationSettingsError && error.status === 403 && error.code === "scripture_automation_admin_forbidden"
  );
  await assert.rejects(
    () => setServiceScriptureAutomation(client, outsider, liveService, { mode: "auto_live", armed: true }),
    (error) => error instanceof ScriptureAutomationSettingsError && error.status === 403 && error.code === "scripture_automation_operator_forbidden"
  );
  await assert.rejects(
    () => setServiceScriptureAutomation(client, operator, liveService, { mode: "auto_live", armed: true }),
    (error) => error instanceof ScriptureAutomationSettingsError && error.code === "organization_auto_live_disabled"
  );

  const orgEnabled = await setOrganizationScriptureAutomationPermission(client, owner, org, true);
  assert.equal(orgEnabled.autoScriptureLiveEnabled, true);
  const armed = await setServiceScriptureAutomation(client, operator, liveService, { mode: "auto_live", armed: true });
  assert.equal(armed.mode, "auto_live");
  assert.equal(armed.armed, true);
  assert.equal(armed.armedBy, operator);
  assert.equal(armed.referenceThreshold, 98);
  assert.equal(armed.quoteThreshold, 96);

  const changedWhileArmed = await setServiceScriptureAutomation(client, operator, liveService, {
    mode: "auto_live", armed: true, referenceThreshold: 99
  });
  assert.equal(changedWhileArmed.armed, false, "policy change while armed must force disarm even when request asks to stay armed");
  assert.equal(changedWhileArmed.suspendedReason, "policy_changed");
  const afterPolicyChange = await client.query(`select scripture_automation_armed_at,scripture_automation_armed_by,scripture_automation_suspended_reason from services where id=$1`, [liveService]);
  assert.equal(afterPolicyChange.rows[0].scripture_automation_armed_at, null);
  assert.equal(afterPolicyChange.rows[0].scripture_automation_armed_by, null);
  assert.equal(afterPolicyChange.rows[0].scripture_automation_suspended_reason, "policy_changed");

  await assert.rejects(
    () => setServiceScriptureAutomation(client, operator, liveService, { mode: "auto_live", armed: true, referenceThreshold: 97.99 }),
    (error) => error instanceof ScriptureAutomationSettingsError && error.code === "reference_threshold_below_floor"
  );
  await assert.rejects(
    () => setServiceScriptureAutomation(client, operator, liveService, { mode: "auto_live", armed: true, quoteThreshold: 95.99 }),
    (error) => error instanceof ScriptureAutomationSettingsError && error.code === "quote_threshold_below_floor"
  );
  await assert.rejects(
    () => setServiceScriptureAutomation(client, operator, readyService, { mode: "auto_live", armed: true }),
    (error) => error instanceof ScriptureAutomationSettingsError && error.code === "service_not_live"
  );
  await assert.rejects(
    () => setServiceScriptureAutomation(client, operator, noEdgeService, { mode: "auto_live", armed: true }),
    (error) => error instanceof ScriptureAutomationSettingsError && error.code === "no_active_edge"
  );
  await assert.rejects(
    () => setServiceScriptureAutomation(client, operator, liveService, { mode: "auto_preview", armed: true }),
    (error) => error instanceof ScriptureAutomationSettingsError && error.code === "auto_live_required_to_arm"
  );

  const manual = await setServiceScriptureAutomation(client, operator, liveService, { mode: "manual", armed: false, referenceThreshold: 99, quoteThreshold: 97 });
  assert.equal(manual.mode, "manual");
  assert.equal(manual.armed, false);
  assert.equal(manual.referenceThreshold, 99);
  assert.equal(manual.quoteThreshold, 97);

  await setServiceScriptureAutomation(client, operator, liveService, { mode: "auto_live", armed: true });
  const orgDisabled = await setOrganizationScriptureAutomationPermission(client, owner, org, false);
  assert.equal(orgDisabled.autoScriptureLiveEnabled, false);
  const afterDisable = await client.query(`select scripture_automation_armed_at,scripture_automation_armed_by,scripture_automation_suspended_reason from services where id=$1`, [liveService]);
  assert.equal(afterDisable.rows[0].scripture_automation_armed_at, null);
  assert.equal(afterDisable.rows[0].scripture_automation_armed_by, null);
  assert.equal(afterDisable.rows[0].scripture_automation_suspended_reason, "organization_disabled");

  await setOrganizationScriptureAutomationPermission(client, owner, org, true);
  await setServiceScriptureAutomation(client, operator, liveService, { mode: "auto_live", armed: true });
  await suspendServiceScriptureAutomation(client, liveService, "service_ended");
  const afterEnd = await client.query(`select scripture_automation_armed_at,scripture_automation_armed_by,scripture_automation_suspended_reason from services where id=$1`, [liveService]);
  assert.equal(afterEnd.rows[0].scripture_automation_armed_at, null);
  assert.equal(afterEnd.rows[0].scripture_automation_armed_by, null);
  assert.equal(afterEnd.rows[0].scripture_automation_suspended_reason, "service_ended");

  const audits = await client.query(`select action from audit_events where organization_id=$1 and action like 'scripture.automation.%' order by created_at,id`, [org]);
  assert.ok(audits.rows.some((row) => row.action === "scripture.automation.organization.changed"));
  assert.ok(audits.rows.some((row) => row.action === "scripture.automation.service.changed"));

  await client.query("rollback");
  console.log(JSON.stringify({ ok: true, mode: "postgres", adminRbac: true, operatorRbac: true, floors: true, edgeGate: true, organizationDisableDisarms: true, serviceEndDisarms: true, audit: true }));
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
} finally {
  await client.end();
}
