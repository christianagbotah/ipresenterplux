import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import process from "node:process";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";
import ts from "typescript";

process.loadEnvFile?.(".env.local");
assertWritableSelfTestDatabase(process.env.DATABASE_URL);
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");

async function importTypescriptModule(relativeUrl) {
  const source = await readFile(new URL(relativeUrl, import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
  return import(moduleUrl);
}

const {
  parseOperatorScriptureReference,
  deterministicScriptureItemId,
  normalizeOperatorPresentationBody,
  normalizeOperatorText,
  extractOperatorPresentationFields,
} = await importTypescriptModule("../src/lib/edge-operator-catalog.ts");
const {
  EDGE_OPERATOR_ACTIVE_SERVICE_SQL,
  EDGE_OPERATOR_BIBLE_VERSIONS_SQL,
  EDGE_OPERATOR_PRESENTATION_ITEMS_SQL,
  EDGE_OPERATOR_SCRIPTURE_QUEUE_SQL,
  EDGE_OPERATOR_SCRIPTURE_SERVICE_SQL,
  EDGE_OPERATOR_SCRIPTURE_VERSION_SQL,
  EDGE_OPERATOR_SCRIPTURE_BOOK_SQL,
  EDGE_OPERATOR_SCRIPTURE_CHAPTER_SQL,
  EDGE_OPERATOR_SCRIPTURE_RANGE_SQL,
} = await importTypescriptModule("../src/lib/edge-operator-catalog-queries.ts");
const plannerMutations = await import("../src/lib/planner-mutations.ts");
const plannerServices = await import("../src/lib/planner-service-queries.ts");
const plannerReadiness = await import("../src/lib/planner-readiness.ts");

assert.deepEqual(parseOperatorScriptureReference("John 3:16"), {
  book: "John", chapter: 3, verseStart: 16, verseEnd: 16,
});
assert.deepEqual(parseOperatorScriptureReference("Psalm 23"), {
  book: "Psalm", chapter: 23, verseStart: null, verseEnd: null,
});
assert.deepEqual(parseOperatorScriptureReference("1 Corinthians 13:4-7"), {
  book: "1 Corinthians", chapter: 13, verseStart: 4, verseEnd: 7,
});
assert.equal(parseOperatorScriptureReference("John 3:1-81"), null, "verse ranges above 80 are rejected");
assert.equal(parseOperatorScriptureReference("John 0:16"), null);
assert.equal(parseOperatorScriptureReference("John 3:20-16"), null);
assert.equal(parseOperatorScriptureReference("John 3:abc"), null);

const firstId = deterministicScriptureItemId("KJV", "John", 3, 16, 16);
assert.equal(firstId, deterministicScriptureItemId("KJV", "John", 3, 16, 16));
assert.notEqual(firstId, deterministicScriptureItemId("NIV", "John", 3, 16, 16));
assert.match(firstId, /^local-scripture-[a-f0-9]{24}$/);

assert.equal(normalizeOperatorPresentationBody("  hello   world  "), "hello world");
assert.equal(normalizeOperatorPresentationBody("x".repeat(13000)).length, 12000);
assert.deepEqual(
  extractOperatorPresentationFields({
    body: "  Main   slide text ",
    footer: " Worship Team ",
    metadata: { artist: "  Lightworld Choir ", secret: { nested: true } },
  }),
  { body: "Main slide text", footer: "Worship Team", metadata: { artist: "Lightworld Choir" } },
);
assert.deepEqual(
  extractOperatorPresentationFields({ lines: ["Line one", "Line two"], subtitle: "Verse 1" }),
  { body: "Line one\nLine two", footer: "Verse 1", metadata: {} },
);
assert.deepEqual(extractOperatorPresentationFields(null), { body: "", footer: null, metadata: {} });

const catalogRoute = await readFile(new URL("../src/app/api/v1/edge/operator/catalog/route.ts", import.meta.url), "utf8");
const scriptureRoute = await readFile(new URL("../src/app/api/v1/edge/operator/scripture/route.ts", import.meta.url), "utf8");
assert.match(catalogRoute, /authenticateEdgeDevice\(request\)/);
assert.match(catalogRoute, /EDGE_OPERATOR_ACTIVE_SERVICE_SQL/);
assert.match(catalogRoute, /EDGE_OPERATOR_PRESENTATION_ITEMS_SQL/);
assert.match(catalogRoute, /catalogRevision:\s*revision\(\[service\.id, service\.updated_at, latestPresentation, latestScripture\]\)/,
  "catalog revision must include authoritative service/presentation/scripture timestamps");
assert.match(scriptureRoute, /authenticateEdgeDevice\(request\)/);
assert.match(scriptureRoute, /EDGE_OPERATOR_SCRIPTURE_SERVICE_SQL/);
assert.match(scriptureRoute, /EDGE_OPERATOR_SCRIPTURE_RANGE_SQL/);

function revision(parts) {
  return createHash("sha256").update(parts.filter(Boolean).join("|")).digest("hex").slice(0, 24);
}

async function projectedCatalogSnapshot(client, serviceId) {
  const serviceResult = await client.query(
    `select id::text,title,status,active_bible_version,scheduled_start::text,started_at::text,updated_at::text
     from services where id=$1 limit 1`,
    [serviceId],
  );
  assert.equal(serviceResult.rowCount, 1, "catalog projection service must exist");
  const service = serviceResult.rows[0];
  const presentationResult = await client.query(EDGE_OPERATOR_PRESENTATION_ITEMS_SQL, [serviceId]);
  const scriptureResult = await client.query(EDGE_OPERATOR_SCRIPTURE_QUEUE_SQL, [serviceId]);
  const items = presentationResult.rows.map((row) => {
    const fields = extractOperatorPresentationFields(row.content);
    const title = normalizeOperatorText(row.title, 200);
    return {
      itemId: row.id,
      itemType: normalizeOperatorText(row.item_type, 32),
      title,
      body: fields.body || title,
      footer: fields.footer,
      metadata: {
        ...fields.metadata,
        state: normalizeOperatorText(row.state, 32),
        sortOrder: String(row.sort_order),
      },
    };
  });
  const latestPresentation = presentationResult.rows.reduce(
    (latest, row) => !latest || row.updated_at > latest ? row.updated_at : latest,
    null,
  );
  const latestScripture = scriptureResult.rows.reduce(
    (latest, row) => !latest || row.detected_at > latest ? row.detected_at : latest,
    null,
  );
  return {
    items,
    catalogRevision: revision([service.id, service.updated_at, latestPresentation, latestScripture]),
  };
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query("begin");
try {
  const seeded = await client.query(
    `select s.id::text as service_id,s.organization_id::text,c.id::text as campus_id
     from services s
     join campuses c on c.id=s.campus_id
     order by s.created_at
     limit 1`
  );
  assert.ok(seeded.rows[0]?.service_id, "Expected seeded service/campus fixture");
  const { service_id: serviceId, organization_id: organizationId, campus_id: campusId } = seeded.rows[0];
  await client.query("update services set status='ready',active_bible_version='WEBP' where id=$1", [serviceId]);

  const otherCampus = await client.query(
    `insert into campuses(organization_id,name,slug,city,country_code)
     values ($1,$2,$3,'Accra','GH') returning id::text`,
    [organizationId, "Operator Selftest Other Campus", `operator-other-${Date.now()}`]
  );
  const otherCampusId = otherCampus.rows[0].id;
  const otherService = await client.query(
    `insert into services(organization_id,campus_id,title,service_type,status,active_bible_version)
     values ($1,$2,'Operator Other Service','sunday_service','ready','WEBP') returning id::text`,
    [organizationId, otherCampusId]
  );
  const otherServiceId = otherService.rows[0].id;

  const device = await client.query(
    `insert into edge_devices(organization_id,campus_id,name,platform,status,active_service_id)
     values ($1,$2,$3,'windows','active',$4) returning id::text`,
    [organizationId, campusId, `operator-catalog-selftest-${Date.now()}`, serviceId]
  );
  const deviceId = device.rows[0].id;

  const scoped = await client.query(EDGE_OPERATOR_ACTIVE_SERVICE_SQL, [deviceId, organizationId]);
  assert.equal(scoped.rowCount, 1, "Correct device/org/campus assignment must expose one service");
  assert.equal(scoped.rows[0].id, serviceId);

  await client.query("update edge_devices set active_service_id=$2 where id=$1", [deviceId, otherServiceId]);
  const wrongCampus = await client.query(EDGE_OPERATOR_ACTIVE_SERVICE_SQL, [deviceId, organizationId]);
  assert.equal(wrongCampus.rowCount, 0, "Same-org service from another campus must not leak into the device catalog");
  const wrongCampusScripture = await client.query(EDGE_OPERATOR_SCRIPTURE_SERVICE_SQL, [deviceId, organizationId]);
  assert.equal(wrongCampusScripture.rowCount, 0, "Scripture resolver must enforce the same campus scope");
  await client.query("update edge_devices set active_service_id=$2 where id=$1", [deviceId, serviceId]);

  await client.query(
    `insert into presentation_items(service_id,item_type,title,content,sort_order,state)
     select $1::uuid,'slide','Operator cue '||g,jsonb_build_object('body','Body '||g),10000+g,'queued'
     from generate_series(1,205) g`,
    [serviceId]
  );
  await client.query(
    `insert into presentation_items(service_id,item_type,title,content,sort_order,state)
     values ($1,'slide','FOREIGN SERVICE CUE','{"body":"must not leak"}',1,'queued')`,
    [otherServiceId]
  );
  const cues = await client.query(EDGE_OPERATOR_PRESENTATION_ITEMS_SQL, [serviceId]);
  assert.equal(cues.rowCount, 200, "Service rundown must be hard-capped at 200 items");
  assert.ok(!cues.rows.some((row) => row.title === "FOREIGN SERVICE CUE"), "Another service's cue must never appear");

  // Task 9: prove real Planner persistence is compatible with the existing Edge catalog contract.
  const plannerUserId = randomUUID();
  const plannerServiceId = randomUUID();
  const plannerMediaId = randomUUID();
  const plannerCameraId = randomUUID();
  const plannerDeviceId = randomUUID();
  await client.query(
    `insert into users(id,email,display_name,status) values ($1,$2,'Catalog Planner','active')`,
    [plannerUserId, `catalog-planner-${plannerUserId}@example.invalid`],
  );
  await client.query(
    `insert into user_organization_roles(user_id,organization_id,role_id) values ($1,$2,'presenter_operator')`,
    [plannerUserId, organizationId],
  );
  await client.query(
    `insert into services(id,organization_id,campus_id,title,service_type,status,scheduled_start,active_bible_version)
     values ($1,$2,$3,'Planner Edge Compatibility','sunday_service','draft',now()+interval '2 hours','WEBP')`,
    [plannerServiceId, organizationId, campusId],
  );
  await client.query(
    `insert into media_sources(id,organization_id,name,source_type,status,public_config)
     values
       ($1,$3,'Planner Worship Video','asset','ready',$4::jsonb),
       ($2,$3,'Planner Main Camera','camera','ready',$5::jsonb)`,
    [
      plannerMediaId,
      plannerCameraId,
      organizationId,
      JSON.stringify({ assetUrl: "https://media.example.test/planner-worship.mp4", mediaKind: "video", credential: "must-not-leak" }),
      JSON.stringify({ label: "Planner Main Camera", credential: "must-not-leak" }),
    ],
  );
  await client.query(
    `insert into edge_devices(id,organization_id,campus_id,name,platform,status,active_service_id)
     values ($1,$2,$3,'planner-catalog-edge','windows','active',null)`,
    [plannerDeviceId, organizationId, campusId],
  );

  const plannerInputs = [
    ["scripture", { reference: "John 3:16-17", version: "WEBP" }],
    ["song", { title: "Amazing Grace", author: "John Newton", sections: [
      { label: "Verse 1", text: "Amazing grace! How sweet the sound" },
      { label: "Verse 2", text: "'Twas grace that taught my heart to fear" },
    ], defaultSection: 0 }],
    ["slide", { title: "Welcome", body: "Welcome to worship", footer: "iPresenterPlux" }],
    ["announcement", { title: "Midweek Service", body: "Wednesday at 6pm", dateNote: "This Wednesday", style: "announcement" }],
    ["lower_third", { primaryText: "Rev. Demo Pastor", secondaryText: "Lead Pastor", durationSeconds: 12 }],
    ["media", { title: "Worship Video", sourceId: plannerMediaId, mediaKind: "video", operatorNotes: "Fade after playback" }],
    ["camera", { sourceId: plannerCameraId, label: "Pulpit Camera", operatorNote: "Use for sermon" }],
    ["custom", { title: "Giving", body: "Thank you for your generosity", footer: "Demo Church", style: "default" }],
  ];

  let plannerDetail = await plannerServices.loadPlannerServiceDetail(client, plannerUserId, plannerServiceId);
  const plannerCreatedIds = [];
  for (const [itemType, input] of plannerInputs) {
    const created = await plannerMutations.createPlannerItem(
      client,
      plannerUserId,
      plannerServiceId,
      plannerDetail.revision,
      { itemType, input },
    );
    plannerCreatedIds.push(created.item.id);
    plannerDetail = await plannerServices.loadPlannerServiceDetail(client, plannerUserId, plannerServiceId);
  }
  assert.deepEqual(plannerDetail.items.map((item) => item.itemType), plannerInputs.map(([itemType]) => itemType));

  const draftCatalog = await client.query(EDGE_OPERATOR_ACTIVE_SERVICE_SQL, [plannerDeviceId, organizationId]);
  assert.equal(draftCatalog.rowCount, 0, "Draft Planner service must never become the active Edge catalog");

  const readyDetail = await plannerReadiness.markPlannerServiceReady(
    client,
    plannerUserId,
    plannerServiceId,
    plannerDetail.revision,
  );
  assert.equal(readyDetail.service.status, "ready");
  const readyCatalog = await client.query(EDGE_OPERATOR_ACTIVE_SERVICE_SQL, [plannerDeviceId, organizationId]);
  assert.equal(readyCatalog.rowCount, 1, "Ready Planner service must synchronize to its eligible Edge device");
  assert.equal(readyCatalog.rows[0].id, plannerServiceId);

  const readySnapshot = await projectedCatalogSnapshot(client, plannerServiceId);
  assert.equal(readySnapshot.items.length, 8, "All eight Planner cue types must reach the existing Edge catalog");
  assert.deepEqual(readySnapshot.items.map((item) => item.itemId), plannerCreatedIds, "Edge catalog order must match Planner rundown order");
  assert.deepEqual(readySnapshot.items.map((item) => item.itemType), plannerInputs.map(([itemType]) => itemType));

  const scriptureItem = readySnapshot.items.find((item) => item.itemType === "scripture");
  assert.match(scriptureItem.body, /For God so loved the world/);
  assert.equal(scriptureItem.footer, "WEBP");
  const songItem = readySnapshot.items.find((item) => item.itemType === "song");
  assert.match(songItem.body, /Verse 1\nAmazing grace!/);
  assert.match(songItem.body, /Verse 2\n'Twas grace/);
  assert.equal(songItem.footer, "John Newton");
  const lowerThirdItem = readySnapshot.items.find((item) => item.itemType === "lower_third");
  assert.equal(lowerThirdItem.body, "Rev. Demo Pastor");
  assert.equal(lowerThirdItem.footer, "Lead Pastor");
  const customItem = readySnapshot.items.find((item) => item.itemType === "custom");
  assert.equal(customItem.body, "Thank you for your generosity");
  assert.equal(customItem.footer, "Demo Church");
  const mediaItem = readySnapshot.items.find((item) => item.itemType === "media");
  assert.equal(mediaItem.body, "Worship Video", "body-less media uses its safe title in the Edge catalog");
  const mediaJson = JSON.stringify(mediaItem);
  assert.doesNotMatch(mediaJson, /assetUrl|sourceId|operatorNotes|credential|must-not-leak|planner-worship\.mp4/i,
    "Edge media catalog metadata must not leak Planner source URLs, IDs, notes, or credentials");
  const cameraItem = readySnapshot.items.find((item) => item.itemType === "camera");
  assert.doesNotMatch(JSON.stringify(cameraItem), /sourceId|operatorNote|credential|must-not-leak/i,
    "Edge camera catalog metadata must not leak Planner source IDs, notes, or credentials");

  await client.query("update services set status='live',updated_at=clock_timestamp() where id=$1", [plannerServiceId]);
  const liveCatalog = await client.query(EDGE_OPERATOR_ACTIVE_SERVICE_SQL, [plannerDeviceId, organizationId]);
  assert.equal(liveCatalog.rowCount, 1, "Live Planner service must remain visible to the assigned Edge device");
  await client.query("update services set status='ready',updated_at=clock_timestamp() where id=$1", [plannerServiceId]);
  plannerDetail = await plannerServices.loadPlannerServiceDetail(client, plannerUserId, plannerServiceId);
  await plannerReadiness.returnPlannerServiceToDraft(client, plannerUserId, plannerServiceId, plannerDetail.revision);
  const demotedCatalog = await client.query(EDGE_OPERATOR_ACTIVE_SERVICE_SQL, [plannerDeviceId, organizationId]);
  assert.equal(demotedCatalog.rowCount, 0, "Ready→draft demotion must immediately remove the service from Edge catalog authority");
  const demotedDevice = await client.query("select active_service_id::text from edge_devices where id=$1", [plannerDeviceId]);
  assert.equal(demotedDevice.rows[0].active_service_id, null, "Ready→draft must clear the Edge assignment as well as catalog visibility");

  plannerDetail = await plannerServices.loadPlannerServiceDetail(client, plannerUserId, plannerServiceId);
  await plannerReadiness.markPlannerServiceReady(client, plannerUserId, plannerServiceId, plannerDetail.revision);
  let beforeMutation = await projectedCatalogSnapshot(client, plannerServiceId);
  plannerDetail = await plannerServices.loadPlannerServiceDetail(client, plannerUserId, plannerServiceId);
  const slide = plannerDetail.items.find((item) => item.itemType === "slide");
  const updated = await plannerMutations.updatePlannerItem(
    client,
    plannerUserId,
    plannerServiceId,
    slide.id,
    plannerDetail.revision,
    { itemType: "slide", input: { title: "Welcome Updated", body: "Updated welcome body", footer: "iPresenterPlux" } },
  );
  let afterMutation = await projectedCatalogSnapshot(client, plannerServiceId);
  assert.notEqual(afterMutation.catalogRevision, beforeMutation.catalogRevision, "Planner edit must change the Edge catalog revision inputs");
  assert.equal(afterMutation.items.find((item) => item.itemId === slide.id).body, "Updated welcome body");

  await plannerReadiness.markPlannerServiceReady(client, plannerUserId, plannerServiceId, updated.revision);
  beforeMutation = await projectedCatalogSnapshot(client, plannerServiceId);
  plannerDetail = await plannerServices.loadPlannerServiceDetail(client, plannerUserId, plannerServiceId);
  const reversedIds = [...plannerDetail.items.map((item) => item.id)].reverse();
  const reordered = await plannerMutations.reorderPlannerItems(client, plannerUserId, plannerServiceId, plannerDetail.revision, reversedIds);
  afterMutation = await projectedCatalogSnapshot(client, plannerServiceId);
  assert.notEqual(afterMutation.catalogRevision, beforeMutation.catalogRevision, "Planner reorder must change the Edge catalog revision inputs");
  assert.deepEqual(afterMutation.items.map((item) => item.itemId), reversedIds, "Edge catalog must immediately reflect Planner reorder order");

  await plannerReadiness.markPlannerServiceReady(client, plannerUserId, plannerServiceId, reordered.revision);
  beforeMutation = await projectedCatalogSnapshot(client, plannerServiceId);
  plannerDetail = await plannerServices.loadPlannerServiceDetail(client, plannerUserId, plannerServiceId);
  const deleteTarget = plannerDetail.items.find((item) => item.itemType === "custom");
  const deleted = await plannerMutations.deletePlannerItem(client, plannerUserId, plannerServiceId, deleteTarget.id, plannerDetail.revision);
  afterMutation = await projectedCatalogSnapshot(client, plannerServiceId);
  assert.notEqual(afterMutation.catalogRevision, beforeMutation.catalogRevision, "Planner delete must change the Edge catalog revision inputs");
  assert.equal(afterMutation.items.some((item) => item.itemId === deleteTarget.id), false, "Deleted Planner cue must leave the Edge catalog");

  await plannerReadiness.markPlannerServiceReady(client, plannerUserId, plannerServiceId, deleted.revision);
  const finalActive = await client.query(EDGE_OPERATOR_ACTIVE_SERVICE_SQL, [plannerDeviceId, organizationId]);
  assert.equal(finalActive.rowCount, 1);
  const finalSnapshot = await projectedCatalogSnapshot(client, plannerServiceId);
  assert.equal(finalSnapshot.items.length, 7);

  for (let i = 0; i < 40; i += 1) {
    await client.query(
      `insert into bible_versions(id,name,abbreviation,language_code,license_kind,local_enabled)
       values ($1,$2,$1,'en','public_domain',true) on conflict (id) do update set local_enabled=true`,
      [`OP${String(i).padStart(2, "0")}`, `Operator Version ${String(i).padStart(2, "0")}`]
    );
  }
  const versions = await client.query(EDGE_OPERATOR_BIBLE_VERSIONS_SQL);
  assert.ok(versions.rowCount <= 32, "Enabled Bible versions must be capped at 32");

  const version = await client.query(EDGE_OPERATOR_SCRIPTURE_VERSION_SQL, ["WEBP"]);
  assert.equal(version.rowCount, 1, "Seeded WEBP Bible version must resolve");
  const book = await client.query(EDGE_OPERATOR_SCRIPTURE_BOOK_SQL, ["WEBP", "John"]);
  assert.equal(book.rowCount, 1, "Canonical John book must resolve");
  const chapter = await client.query(EDGE_OPERATOR_SCRIPTURE_CHAPTER_SQL, ["WEBP", book.rows[0].book_code, 3]);
  const chapterVerses = chapter.rows.map((row) => row.verse);
  assert.ok(chapter.rowCount <= 81, "Chapter resolver must enforce its 81-row safety ceiling");
  assert.ok(chapterVerses.includes(16) && chapterVerses.includes(17), "WEBP John 3 fixture must contain verses 16-17");
  const range = await client.query(EDGE_OPERATOR_SCRIPTURE_RANGE_SQL, ["WEBP", book.rows[0].book_code, 3, 16, 17]);
  assert.deepEqual(range.rows.map((row) => row.verse), [16, 17]);

  console.log(JSON.stringify({
    ok: true,
    tenantIsolation: true,
    itemCap: 200,
    plannerCueTypes: 8,
    plannerOrderCompatible: true,
    readyLiveOnly: true,
    plannerDemotionRemovesCatalog: true,
    catalogRevisionTracksMutations: true,
    plannerMetadataBounded: true,
  }));
  console.log("Edge operator catalog PostgreSQL isolation self-test passed.");
} finally {
  await client.query("rollback");
  await client.end();
}

console.log("Edge operator catalog self-test passed.");
