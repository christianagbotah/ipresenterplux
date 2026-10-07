#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const mutations = await import("../src/lib/planner-mutations.ts");
const services = await import("../src/lib/planner-service-queries.ts");

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
const orgId = randomUUID();
const campusId = randomUUID();
const userId = randomUUID();

async function expectPlannerError(action, status, code) {
  try {
    await action();
    assert.fail(`expected ${code}`);
  } catch (error) {
    assert.ok(error instanceof services.PlannerServiceError, `expected PlannerServiceError for ${code}`);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
  }
}

async function insertService(status = "draft", title = `${status} planner mutation`) {
  const id = randomUUID();
  await client.query(
    `insert into services(id,organization_id,campus_id,title,status,active_bible_version,scheduled_start)
     values ($1,$2,$3,$4,$5,'WEBP',now()+interval '1 hour')`,
    [id, orgId, campusId, title, status]
  );
  return id;
}

async function insertSlide(serviceId, title, sortOrder) {
  const id = randomUUID();
  await client.query(
    `insert into presentation_items(id,service_id,item_type,title,content,sort_order,state)
     values ($1,$2,'slide',$3,$4::jsonb,$5,'queued')`,
    [id, serviceId, title, JSON.stringify({ title, body: `${title} body`, footer: null }), sortOrder]
  );
  return id;
}

async function detail(serviceId) {
  return services.loadPlannerServiceDetail(client, userId, serviceId);
}

async function assertReadyInvalidated(serviceId, edgeId) {
  const service = await client.query("select status from services where id=$1", [serviceId]);
  assert.equal(service.rows[0].status, "draft", "ready mutation must demote service to draft");
  const edge = await client.query("select active_service_id::text from edge_devices where id=$1", [edgeId]);
  assert.equal(edge.rows[0].active_service_id, null, "ready mutation must clear Edge assignment");
}

async function makeReadyFixture(label) {
  const serviceId = await insertService("ready", `Ready ${label}`);
  const first = await insertSlide(serviceId, `${label} A`, 1000);
  const second = await insertSlide(serviceId, `${label} B`, 2000);
  const edgeId = randomUUID();
  await client.query(
    `insert into edge_devices(id,organization_id,campus_id,name,platform,status,active_service_id)
     values ($1,$2,$3,$4,'windows','active',$5)`,
    [edgeId, orgId, campusId, `edge-${label}-${edgeId}`, serviceId]
  );
  return { serviceId, first, second, edgeId };
}

try {
  await client.query("begin");
  await client.query(
    `insert into organizations(id,name,slug,country_code,timezone)
     values ($1,'Planner Mutation Test',$2,'GH','Africa/Accra')`,
    [orgId, `planner-mutation-${orgId}`]
  );
  await client.query(
    `insert into campuses(id,organization_id,name,slug,city,country_code)
     values ($1,$2,'Mutation Campus','mutation-campus','Accra','GH')`,
    [campusId, orgId]
  );
  await client.query(
    `insert into users(id,email,display_name,status) values ($1,$2,'Mutation Planner','active')`,
    [userId, `planner-mutation-${userId}@example.invalid`]
  );
  await client.query(
    `insert into user_organization_roles(user_id,organization_id,role_id) values ($1,$2,'presenter_operator')`,
    [userId, orgId]
  );

  const capService = await insertService();
  const capValues = [];
  const capParams = [];
  for (let index = 0; index < 200; index += 1) {
    const base = capParams.length;
    capValues.push(`($${base + 1},$${base + 2},'slide',$${base + 3},$${base + 4}::jsonb,$${base + 5},'queued')`);
    capParams.push(randomUUID(), capService, `Cap ${index + 1}`, JSON.stringify({ body: `Cap ${index + 1}` }), (index + 1) * 1000);
  }
  await client.query(
    `insert into presentation_items(id,service_id,item_type,title,content,sort_order,state) values ${capValues.join(",")}`,
    capParams
  );
  const capDetail = await detail(capService);
  await expectPlannerError(
    () => mutations.createPlannerItem(client, userId, capService, capDetail.revision, {
      itemType: "slide",
      input: { title: "201", body: "Must reject" }
    }),
    409,
    "planner_item_limit"
  );

  const serviceId = await insertService();
  const firstId = await insertSlide(serviceId, "First", 1000);
  const secondId = await insertSlide(serviceId, "Second", 2000);
  const foreignService = await insertService();
  const foreignItem = await insertSlide(foreignService, "Foreign", 1000);

  const initial = await detail(serviceId);
  const created = await mutations.createPlannerItem(client, userId, serviceId, initial.revision, {
    itemType: "slide",
    input: { title: "Created", body: "SENSITIVE BODY MUST NOT AUDIT", footer: "Private footer" }
  });
  assert.notEqual(created.revision, initial.revision);
  assert.equal(created.item.title, "Created");

  await expectPlannerError(
    () => mutations.updatePlannerItem(client, userId, serviceId, created.item.id, initial.revision, {
      itemType: "slide",
      input: { title: "Stale", body: "Stale" }
    }),
    409,
    "planner_revision_conflict"
  );

  let current = await detail(serviceId);
  for (const action of [
    () => mutations.updatePlannerItem(client, userId, serviceId, foreignItem, current.revision, { itemType: "slide", input: { title: "Foreign", body: "No" } }),
    () => mutations.deletePlannerItem(client, userId, serviceId, foreignItem, current.revision),
    () => mutations.duplicatePlannerItem(client, userId, serviceId, foreignItem, current.revision)
  ]) {
    await expectPlannerError(action, 404, "planner_item_not_found");
  }

  current = await detail(serviceId);
  const updated = await mutations.updatePlannerItem(client, userId, serviceId, created.item.id, current.revision, {
    itemType: "slide",
    input: { title: "Created Updated", body: "Updated body" }
  });
  assert.equal(updated.item.title, "Created Updated");

  current = await detail(serviceId);
  const duplicated = await mutations.duplicatePlannerItem(client, userId, serviceId, firstId, current.revision);
  assert.notEqual(duplicated.item.id, firstId);
  const orderedAfterDuplicate = await client.query(
    `select id::text from presentation_items where service_id=$1 order by sort_order,id`,
    [serviceId]
  );
  const sourceIndex = orderedAfterDuplicate.rows.findIndex((row) => row.id === firstId);
  assert.equal(orderedAfterDuplicate.rows[sourceIndex + 1].id, duplicated.item.id, "duplicate must be placed immediately after source");

  current = await detail(serviceId);
  const deleted = await mutations.deletePlannerItem(client, userId, serviceId, duplicated.item.id, current.revision);
  assert.equal(deleted.deletedItemId, duplicated.item.id);

  current = await detail(serviceId);
  const currentIds = current.items.map((item) => item.id);
  await expectPlannerError(
    () => mutations.reorderPlannerItems(client, userId, serviceId, current.revision, currentIds.slice(1)),
    422,
    "planner_reorder_set_mismatch"
  );
  await expectPlannerError(
    () => mutations.reorderPlannerItems(client, userId, serviceId, current.revision, [currentIds[0], currentIds[0], ...currentIds.slice(2)]),
    422,
    "planner_reorder_set_mismatch"
  );
  await expectPlannerError(
    () => mutations.reorderPlannerItems(client, userId, serviceId, current.revision, [foreignItem, ...currentIds.slice(1)]),
    422,
    "planner_reorder_set_mismatch"
  );

  const reversed = [...currentIds].reverse();
  const reordered = await mutations.reorderPlannerItems(client, userId, serviceId, current.revision, reversed);
  assert.deepEqual(reordered.items.map((item) => item.id), reversed);
  assert.deepEqual(reordered.items.map((item) => item.sortOrder), reversed.map((_, index) => (index + 1) * 1000));

  const beforeRollback = await detail(serviceId);
  await client.query("savepoint planner_reorder_rollback");
  try {
    await mutations.reorderPlannerItems(client, userId, serviceId, beforeRollback.revision, [...beforeRollback.items.map((item) => item.id)].reverse());
    throw new Error("simulated post-reorder failure");
  } catch {
    await client.query("rollback to savepoint planner_reorder_rollback");
  }
  const afterRollback = await detail(serviceId);
  assert.deepEqual(afterRollback.items.map((item) => item.id), beforeRollback.items.map((item) => item.id), "transaction rollback must restore old order");

  const readyCases = [
    ["create", async (fixture, revision) => mutations.createPlannerItem(client, userId, fixture.serviceId, revision, { itemType: "slide", input: { title: "New", body: "Body" } })],
    ["update", async (fixture, revision) => mutations.updatePlannerItem(client, userId, fixture.serviceId, fixture.first, revision, { itemType: "slide", input: { title: "Updated", body: "Body" } })],
    ["delete", async (fixture, revision) => mutations.deletePlannerItem(client, userId, fixture.serviceId, fixture.first, revision)],
    ["duplicate", async (fixture, revision) => mutations.duplicatePlannerItem(client, userId, fixture.serviceId, fixture.first, revision)],
    ["reorder", async (fixture, revision) => mutations.reorderPlannerItems(client, userId, fixture.serviceId, revision, [fixture.second, fixture.first])]
  ];
  for (const [label, action] of readyCases) {
    const fixture = await makeReadyFixture(label);
    const readyDetail = await detail(fixture.serviceId);
    await action(fixture, readyDetail.revision);
    await assertReadyInvalidated(fixture.serviceId, fixture.edgeId);
  }

  for (const status of ["live", "ended", "archived"]) {
    const lockedService = await insertService(status);
    const lockedDetail = await detail(lockedService);
    await expectPlannerError(
      () => mutations.createPlannerItem(client, userId, lockedService, lockedDetail.revision, {
        itemType: "slide",
        input: { title: "Blocked", body: "Blocked" }
      }),
      409,
      "service_not_editable"
    );
  }

  const audit = await client.query(
    `select details from audit_events
     where organization_id=$1 and action like 'planner.item.%'
     order by id`,
    [orgId]
  );
  assert.ok(audit.rowCount > 0, "item mutations must be audited");
  for (const row of audit.rows) {
    const text = JSON.stringify(row.details);
    assert.ok(text.length < 2000, "item audit metadata must stay bounded");
    assert.doesNotMatch(text, /SENSITIVE BODY MUST NOT AUDIT/);
    assert.doesNotMatch(text, /https?:\/\/[^\s]*@/);
  }

  await client.query("rollback");
  console.log(JSON.stringify({
    ok: true,
    itemLimit: 200,
    staleRevisionRejected: true,
    foreignItemsHidden: true,
    duplicatePlacement: true,
    reorderExactSet: true,
    rollbackSafe: true,
    readyInvalidationClasses: readyCases.length,
    auditBounded: true
  }));
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
