import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import process from "node:process";
import pg from "pg";
import ts from "typescript";

process.loadEnvFile?.(".env.local");
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
  extractOperatorPresentationFields,
} = await importTypescriptModule("../src/lib/edge-operator-catalog.ts");
const {
  EDGE_OPERATOR_ACTIVE_SERVICE_SQL,
  EDGE_OPERATOR_BIBLE_VERSIONS_SQL,
  EDGE_OPERATOR_PRESENTATION_ITEMS_SQL,
  EDGE_OPERATOR_SCRIPTURE_SERVICE_SQL,
  EDGE_OPERATOR_SCRIPTURE_VERSION_SQL,
  EDGE_OPERATOR_SCRIPTURE_BOOK_SQL,
  EDGE_OPERATOR_SCRIPTURE_CHAPTER_SQL,
  EDGE_OPERATOR_SCRIPTURE_RANGE_SQL,
} = await importTypescriptModule("../src/lib/edge-operator-catalog-queries.ts");

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
assert.match(scriptureRoute, /authenticateEdgeDevice\(request\)/);
assert.match(scriptureRoute, /EDGE_OPERATOR_SCRIPTURE_SERVICE_SQL/);
assert.match(scriptureRoute, /EDGE_OPERATOR_SCRIPTURE_RANGE_SQL/);

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

  console.log("Edge operator catalog PostgreSQL isolation self-test passed.");
} finally {
  await client.query("rollback");
  await client.end();
}

console.log("Edge operator catalog self-test passed.");
