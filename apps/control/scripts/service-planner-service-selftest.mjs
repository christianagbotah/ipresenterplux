#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const {
  PlannerServiceError,
  listPlannerServices,
  createPlannerService,
  loadPlannerServiceDetail,
  updatePlannerServiceMetadata
} = await import("../src/lib/planner-service-queries.ts");

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();

const ids = {
  orgA: randomUUID(),
  orgB: randomUUID(),
  campusA: randomUUID(),
  campusB: randomUUID(),
  planner: randomUUID(),
  viewer: randomUUID(),
  outsider: randomUUID(),
  foreignService: randomUUID(),
  readyService: randomUUID(),
  liveService: randomUUID(),
  endedService: randomUUID(),
  archivedService: randomUUID(),
  edge: randomUUID()
};

async function expectPlannerError(promise, status, code) {
  try {
    await promise;
    assert.fail(`expected ${code}`);
  } catch (error) {
    assert.ok(error instanceof PlannerServiceError, `expected PlannerServiceError, got ${error?.constructor?.name}`);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
  }
}

try {
  await client.query("begin");

  await client.query(
    `insert into organizations(id,name,slug,country_code,timezone)
     values ($1,'Planner Test A',$2,'GH','Africa/Accra'),($3,'Planner Test B',$4,'GH','Africa/Accra')`,
    [ids.orgA, `planner-a-${ids.orgA}`, ids.orgB, `planner-b-${ids.orgB}`]
  );
  await client.query(
    `insert into campuses(id,organization_id,name,slug,city,country_code)
     values ($1,$2,'Campus A','campus-a','Accra','GH'),($3,$4,'Campus B','campus-b','Kumasi','GH')`,
    [ids.campusA, ids.orgA, ids.campusB, ids.orgB]
  );
  await client.query(
    `insert into users(id,email,display_name,status)
     values ($1,$2,'Planner User','active'),($3,$4,'Viewer User','active'),($5,$6,'Outsider User','active')`,
    [
      ids.planner, `planner-${ids.planner}@example.invalid`,
      ids.viewer, `viewer-${ids.viewer}@example.invalid`,
      ids.outsider, `outsider-${ids.outsider}@example.invalid`
    ]
  );
  await client.query(
    `insert into user_organization_roles(user_id,organization_id,role_id)
     values ($1,$2,'presenter_operator'),($3,$2,'viewer'),($4,$5,'owner')`,
    [ids.planner, ids.orgA, ids.viewer, ids.outsider, ids.orgB]
  );
  await client.query(
    `insert into bible_versions(id,name,abbreviation,language_code,license_kind,source_revision,local_enabled)
     values ('PLANOFF','Planner Disabled','PLANOFF','en','public_domain','planner-test',false)
     on conflict (id) do update set local_enabled=false`
  );

  for (let index = 0; index < 55; index += 1) {
    await client.query(
      `insert into services(organization_id,campus_id,title,status,active_bible_version,scheduled_start)
       values ($1,$2,$3,'draft','WEBP',now() + ($4 || ' hours')::interval)`,
      [ids.orgA, ids.campusA, `Planner List ${index + 1}`, String(index + 1)]
    );
  }
  await client.query(
    `insert into services(id,organization_id,campus_id,title,status,active_bible_version)
     values ($1,$2,$3,'Foreign Service','draft','WEBP')`,
    [ids.foreignService, ids.orgB, ids.campusB]
  );

  const plannerList = await listPlannerServices(client, ids.planner, { limit: 50, offset: 0 });
  assert.equal(plannerList.services.length, 50, "planner list must be capped at 50 rows");
  assert.ok(plannerList.services.every((service) => service.organizationId === ids.orgA), "planner list must be membership scoped");
  const viewerList = await listPlannerServices(client, ids.viewer, { limit: 10, offset: 0 });
  assert.ok(viewerList.services.length > 0, "read-only planner roles must be able to view services");

  await expectPlannerError(
    createPlannerService(client, ids.viewer, {
      organizationId: ids.orgA,
      title: "Viewer cannot create",
      serviceType: "sunday_service",
      campusId: ids.campusA,
      activeBibleVersion: "WEBP"
    }),
    403,
    "planner_forbidden"
  );
  await expectPlannerError(
    createPlannerService(client, ids.planner, {
      organizationId: ids.orgA,
      title: "Foreign campus",
      serviceType: "sunday_service",
      campusId: ids.campusB,
      activeBibleVersion: "WEBP"
    }),
    404,
    "campus_not_found"
  );
  await expectPlannerError(
    createPlannerService(client, ids.planner, {
      organizationId: ids.orgA,
      title: "Disabled Bible",
      serviceType: "sunday_service",
      campusId: ids.campusA,
      activeBibleVersion: "PLANOFF"
    }),
    422,
    "bible_version_unavailable"
  );

  const created = await createPlannerService(client, ids.planner, {
    organizationId: ids.orgA,
    title: "Created Planner Service",
    serviceType: "sunday_service",
    campusId: ids.campusA,
    activeBibleVersion: "WEBP",
    scheduledStart: null
  });
  assert.equal(created.service.status, "draft");
  assert.match(created.revision, /^[0-9a-f]{24}$/);

  await expectPlannerError(loadPlannerServiceDetail(client, ids.planner, ids.foreignService), 404, "service_not_found");

  const updatedDraft = await updatePlannerServiceMetadata(client, ids.planner, created.service.id, created.revision, {
    title: "Created Planner Service Updated"
  });
  assert.equal(updatedDraft.service.title, "Created Planner Service Updated");
  assert.equal(updatedDraft.service.status, "draft");
  assert.notEqual(updatedDraft.revision, created.revision);

  await expectPlannerError(
    updatePlannerServiceMetadata(client, ids.viewer, created.service.id, updatedDraft.revision, { title: "Viewer edit" }),
    403,
    "planner_forbidden"
  );

  await client.query(
    `insert into services(id,organization_id,campus_id,title,status,active_bible_version,scheduled_start)
     values ($1,$2,$3,'Ready Planner Service','ready','WEBP',now()+interval '1 hour')`,
    [ids.readyService, ids.orgA, ids.campusA]
  );
  await client.query(
    `insert into edge_devices(id,organization_id,campus_id,name,platform,status,active_service_id)
     values ($1,$2,$3,$4,'windows','active',$5)`,
    [ids.edge, ids.orgA, ids.campusA, `planner-edge-${ids.edge}`, ids.readyService]
  );
  const readyDetail = await loadPlannerServiceDetail(client, ids.planner, ids.readyService);
  const editedReady = await updatePlannerServiceMetadata(client, ids.planner, ids.readyService, readyDetail.revision, { title: "Ready Edited" });
  assert.equal(editedReady.service.status, "draft", "editing ready service must demote it to draft");
  const assignment = await client.query("select active_service_id::text from edge_devices where id=$1", [ids.edge]);
  assert.equal(assignment.rows[0].active_service_id, null, "editing ready service must clear its Edge assignment atomically");

  for (const [serviceId, status] of [[ids.liveService, "live"], [ids.endedService, "ended"], [ids.archivedService, "archived"]]) {
    await client.query(
      `insert into services(id,organization_id,campus_id,title,status,active_bible_version,scheduled_start)
       values ($1,$2,null,$3,$4,'WEBP',now())`,
      [serviceId, ids.orgA, `${status} planner service`, status]
    );
    const detail = await loadPlannerServiceDetail(client, ids.planner, serviceId);
    await expectPlannerError(
      updatePlannerServiceMetadata(client, ids.planner, serviceId, detail.revision, { title: `${status} changed` }),
      409,
      "service_not_editable"
    );
  }

  const audit = await client.query(
    `select action,details from audit_events
     where organization_id=$1 and actor_id=$2 and action like 'planner.service.%'
     order by id desc`,
    [ids.orgA, ids.planner]
  );
  assert.ok(audit.rowCount >= 2, "planner service mutations must be audited");
  for (const row of audit.rows) {
    const serialized = JSON.stringify(row.details);
    assert.ok(serialized.length < 2000, "planner audit metadata must stay bounded");
    assert.equal(Object.hasOwn(row.details, "content"), false, "planner service audit must not contain cue content");
  }

  await client.query("rollback");
  console.log(JSON.stringify({ ok: true, listCap: 50, tenantIsolation: true, roleEnforcement: true, readyDemotion: true, auditBounded: true }));
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
