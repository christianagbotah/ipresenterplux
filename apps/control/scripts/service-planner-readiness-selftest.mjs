#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";

const readinessModule = await import("../src/lib/planner-readiness.ts");
const serviceQueries = await import("../src/lib/planner-service-queries.ts");

const {
  PlannerReadinessError,
  validatePlannerReadiness,
  markPlannerServiceReady,
  returnPlannerServiceToDraft
} = readinessModule;
const { loadPlannerServiceDetail } = serviceQueries;

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
const ids = {
  orgA: randomUUID(),
  orgB: randomUUID(),
  campusA: randomUUID(),
  campusB: randomUUID(),
  user: randomUUID(),
  edge: randomUUID(),
  unsafeMedia: randomUUID()
};

async function insertService({ title, scheduled = true, bible = "WEBP", campusId = ids.campusA, status = "draft" }) {
  const id = randomUUID();
  await client.query(
    `insert into services(id,organization_id,campus_id,title,status,active_bible_version,scheduled_start)
     values ($1,$2,$3,$4,$5,$6,case when $7 then now()+interval '1 hour' else null end)`,
    [id, ids.orgA, campusId, title, status, bible, scheduled]
  );
  return id;
}

async function insertItem(serviceId, itemType, title, content, state = "queued", sortOrder = 1000) {
  const id = randomUUID();
  await client.query(
    `insert into presentation_items(id,service_id,item_type,title,content,sort_order,state)
     values ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
    [id, serviceId, itemType, title, JSON.stringify(content), sortOrder, state]
  );
  return id;
}

function codes(result) {
  return new Set(result.issues.map((issue) => issue.code));
}

async function expectIssue(serviceId, issueCode) {
  const result = await validatePlannerReadiness(client, serviceId, ids.orgA);
  assert.equal(result.ready, false, `${serviceId} must not be ready`);
  assert.ok(codes(result).has(issueCode), `expected readiness issue ${issueCode}; got ${[...codes(result)].join(",")}`);
}

try {
  await client.query("begin");
  await client.query(
    `insert into organizations(id,name,slug,country_code,timezone)
     values ($1,'Readiness A',$2,'GH','Africa/Accra'),($3,'Readiness B',$4,'GH','Africa/Accra')`,
    [ids.orgA, `ready-a-${ids.orgA}`, ids.orgB, `ready-b-${ids.orgB}`]
  );
  await client.query(
    `insert into campuses(id,organization_id,name,slug,city,country_code)
     values ($1,$2,'Ready A','ready-a','Accra','GH'),($3,$4,'Ready B','ready-b','Kumasi','GH')`,
    [ids.campusA, ids.orgA, ids.campusB, ids.orgB]
  );
  await client.query(
    `insert into users(id,email,display_name,status) values ($1,$2,'Readiness Planner','active')`,
    [ids.user, `ready-${ids.user}@example.invalid`]
  );
  await client.query(
    `insert into user_organization_roles(user_id,organization_id,role_id) values ($1,$2,'presenter_operator')`,
    [ids.user, ids.orgA]
  );
  await client.query(
    `insert into bible_versions(id,name,abbreviation,language_code,license_kind,source_revision,local_enabled)
     values ('READOFF','Readiness Disabled','READOFF','en','public_domain','readiness-test',false)
     on conflict (id) do update set local_enabled=false`
  );
  await client.query(
    `insert into media_sources(id,organization_id,name,source_type,status,public_config)
     values ($1,$2,'Unsafe Ready Media','asset','ready',$3::jsonb)`,
    [ids.unsafeMedia, ids.orgA, JSON.stringify({ assetUrl: "javascript:alert(1)", mediaKind: "video" })]
  );

  const noSchedule = await insertService({ title: "No schedule", scheduled: false });
  await insertItem(noSchedule, "slide", "Welcome", { title: "Welcome", body: "Hello", footer: null, style: "default" });
  await expectIssue(noSchedule, "scheduled_start_required");

  const disabledBible = await insertService({ title: "Disabled Bible", bible: "READOFF" });
  await insertItem(disabledBible, "slide", "Welcome", { title: "Welcome", body: "Hello", footer: null, style: "default" });
  await expectIssue(disabledBible, "bible_version_unavailable");

  const missingBible = await insertService({ title: "Missing Bible", bible: "NO_SUCH_VERSION" });
  await insertItem(missingBible, "slide", "Welcome", { title: "Welcome", body: "Hello", footer: null, style: "default" });
  await expectIssue(missingBible, "bible_version_unavailable");

  const empty = await insertService({ title: "Empty rundown" });
  await expectIssue(empty, "rundown_empty");

  const malformed = await insertService({ title: "Malformed cue" });
  await insertItem(malformed, "slide", "Malformed", {});
  await expectIssue(malformed, "item_invalid");

  const unresolvedScripture = await insertService({ title: "Unresolved Scripture" });
  await insertItem(unresolvedScripture, "scripture", "Imaginary 1:1", {
    reference: "Imaginary 1:1",
    version: "WEBP",
    passageText: "stale text",
    body: "stale text",
    footer: "WEBP"
  });
  await expectIssue(unresolvedScripture, "scripture_unresolved");

  const unsafeMedia = await insertService({ title: "Unsafe Media" });
  await insertItem(unsafeMedia, "media", "Unsafe", {
    title: "Unsafe",
    sourceId: ids.unsafeMedia,
    mediaKind: "video",
    assetUrl: "javascript:alert(1)",
    body: "",
    footer: null
  });
  await expectIssue(unsafeMedia, "media_source_unsafe");

  const dismissedItem = await insertService({ title: "Dismissed Item" });
  await insertItem(dismissedItem, "slide", "Dismissed", { title: "Dismissed", body: "Body", footer: null, style: "default" }, "dismissed");
  await expectIssue(dismissedItem, "item_state_invalid");

  const campusMismatch = await insertService({ title: "Campus mismatch", campusId: ids.campusB });
  await insertItem(campusMismatch, "slide", "Campus mismatch", { title: "Campus mismatch", body: "Body", footer: null, style: "default" });
  await expectIssue(campusMismatch, "service_campus_scope_invalid");

  const tooMany = await insertService({ title: "Too many items" });
  for (let index = 0; index < 201; index += 1) {
    await insertItem(tooMany, "slide", `Cue ${index + 1}`, { title: `Cue ${index + 1}`, body: "Body", footer: null, style: "default" }, "queued", (index + 1) * 1000);
  }
  await expectIssue(tooMany, "rundown_item_limit");

  const valid = await insertService({ title: "Valid service" });
  await insertItem(valid, "slide", "Welcome", { title: "Welcome", body: "Welcome to worship", footer: null, style: "default" });
  const validResult = await validatePlannerReadiness(client, valid, ids.orgA);
  assert.deepEqual(validResult, { ready: true, issues: [] }, "valid service must have zero readiness issues");

  await client.query(
    `insert into edge_devices(id,organization_id,campus_id,name,platform,status,active_service_id)
     values ($1,$2,$3,$4,'windows','active',null)`,
    [ids.edge, ids.orgA, ids.campusA, `ready-edge-${ids.edge}`]
  );
  const validDetail = await loadPlannerServiceDetail(client, ids.user, valid);
  const marked = await markPlannerServiceReady(client, ids.user, valid, validDetail.revision);
  assert.equal(marked.service.status, "ready");
  const assigned = await client.query("select active_service_id::text from edge_devices where id=$1", [ids.edge]);
  assert.equal(assigned.rows[0].active_service_id, valid, "ready transition must preserve eligible Edge auto-assignment");

  const readyDetail = await loadPlannerServiceDetail(client, ids.user, valid);
  const drafted = await returnPlannerServiceToDraft(client, ids.user, valid, readyDetail.revision);
  assert.equal(drafted.service.status, "draft");
  const cleared = await client.query("select active_service_id::text from edge_devices where id=$1", [ids.edge]);
  assert.equal(cleared.rows[0].active_service_id, null, "explicit ready→draft must clear Edge assignment");

  const invalidForTransition = await insertService({ title: "Transition blocked", scheduled: false });
  await insertItem(invalidForTransition, "slide", "Welcome", { title: "Welcome", body: "Hello", footer: null, style: "default" });
  const invalidDetail = await loadPlannerServiceDetail(client, ids.user, invalidForTransition);
  try {
    await markPlannerServiceReady(client, ids.user, invalidForTransition, invalidDetail.revision);
    assert.fail("invalid service must not transition ready");
  } catch (error) {
    assert.ok(error instanceof PlannerReadinessError);
    assert.equal(error.code, "readiness_failed");
    assert.ok(error.issues.some((issue) => issue.code === "scheduled_start_required"));
  }
  const invalidState = await client.query("select status from services where id=$1", [invalidForTransition]);
  assert.equal(invalidState.rows[0].status, "draft", "failed readiness must leave service draft");

  const genericStateRoute = await fs.readFile(new URL("../src/app/api/v1/services/[id]/state/route.ts", import.meta.url), "utf8");
  assert.match(genericStateRoute, /validatePlannerReadiness/, "generic service-state ready path must use shared readiness validator");
  assert.match(genericStateRoute, /readiness_failed/, "generic service-state ready path must return structured readiness failure");

  const plannerReadyRoute = await fs.readFile(new URL("../src/app/api/v1/planner/services/[id]/ready/route.ts", import.meta.url), "utf8");
  assert.match(plannerReadyRoute, /markPlannerServiceReady/, "planner ready endpoint must use shared transition helper");

  await client.query("rollback");
  console.log(JSON.stringify({
    ok: true,
    readinessCases: 10,
    validService: true,
    edgeAssignment: true,
    readyBypassClosed: true
  }));
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
