#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import process from "node:process";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";
import { loadPlannerServiceDetail } from "../src/lib/planner-service-queries.ts";
import {
  previewPortableImport,
  commitPortableImport,
  undoPortableImport
} from "../src/lib/imports/import-service.ts";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be configured for portable import service verification");
assertWritableSelfTestDatabase(process.env.DATABASE_URL);

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const setup = await pool.connect();
const org = randomUUID();
const otherOrg = randomUUID();
const campus = randomUUID();
const otherCampus = randomUUID();
const user = randomUUID();
const otherUser = randomUUID();
const service = randomUUID();
const otherService = randomUUID();
const email = `portable-${user}@example.invalid`;
const otherEmail = `portable-${otherUser}@example.invalid`;

const songSource = {
  kind: "song_text",
  filename: "amazing-grace.txt",
  content: `Amazing Grace\n\n[Verse 1]\nAmazing grace how sweet the sound\n\n[Chorus]\nI once was lost but now am found`
};

try {
  await setup.query(`insert into organizations(id,name,slug,country_code,timezone) values ($1,'Portable Church',$2,'GH','Africa/Accra'),($3,'Other Portable Church',$4,'GH','Africa/Accra')`, [org, `portable-${org}`, otherOrg, `portable-${otherOrg}`]);
  await setup.query(`insert into campuses(id,organization_id,name,slug,city,country_code) values ($1,$2,'Main','main','Accra','GH'),($3,$4,'Other','other','Accra','GH')`, [campus, org, otherCampus, otherOrg]);
  await setup.query(`insert into users(id,email,display_name,status) values ($1,$2,'Portable Owner','active'),($3,$4,'Other Owner','active')`, [user, email, otherUser, otherEmail]);
  await setup.query(`insert into user_organization_roles(user_id,organization_id,role_id) values ($1,$2,'owner'),($3,$4,'owner')`, [user, org, otherUser, otherOrg]);
  await setup.query(`insert into services(id,organization_id,campus_id,title,status,active_bible_version) values ($1,$2,$3,'Import Target','draft','WEBP'),($4,$5,$6,'Other Target','draft','WEBP')`, [service, org, campus, otherService, otherOrg, otherCampus]);

  const beforePreview = await setup.query(`select (select count(*) from portable_import_batches)::int as batches,(select count(*) from media_library_items where organization_id=$1)::int as library`, [org]);
  const preview = await previewPortableImport(setup, user, { organizationId: org, source: songSource });
  assert.equal(preview.summary.valid, 1);
  const afterPreview = await setup.query(`select (select count(*) from portable_import_batches)::int as batches,(select count(*) from media_library_items where organization_id=$1)::int as library`, [org]);
  assert.deepEqual(afterPreview.rows[0], beforePreview.rows[0], "preview must be non-mutating");

  const first = await commitPortableImport(pool, user, { organizationId: org, source: songSource });
  assert.equal(first.created, 1);
  assert.equal(first.skipped, 0);
  const firstLibrary = await setup.query(`select id::text,title,planner_input,updated_at::text from media_library_items where organization_id=$1 order by created_at,id`, [org]);
  assert.equal(firstLibrary.rowCount, 1);
  assert.equal(firstLibrary.rows[0].title, "Amazing Grace");
  const firstBatch = await setup.query(`select source_fingerprint,duplicate_policy,status,provenance from portable_import_batches where id=$1 and organization_id=$2`, [first.batchId, org]);
  assert.equal(firstBatch.rows[0].status, "committed");
  assert.equal(firstBatch.rows[0].source_fingerprint, preview.sourceFingerprint);
  assert.equal(firstBatch.rows[0].provenance.sourceName, songSource.filename);
  const firstBatchItem = await setup.query(`select disposition,entity_type,entity_id,candidate_fingerprint,provenance from portable_import_batch_items where batch_id=$1 order by ordinal`, [first.batchId]);
  assert.equal(firstBatchItem.rows[0].disposition, "created");
  assert.equal(firstBatchItem.rows[0].entity_type, "media_library_item");
  assert.equal(firstBatchItem.rows[0].entity_id, firstLibrary.rows[0].id);
  assert.match(firstBatchItem.rows[0].candidate_fingerprint, /^[a-f0-9]{64}$/);

  await assert.rejects(
    () => commitPortableImport(pool, user, { organizationId: org, source: songSource }),
    (error) => error?.code === "portable_import_duplicate_policy_required",
    "repeating a committed source fingerprint must require an explicit decision"
  );
  const skipped = await commitPortableImport(pool, user, { organizationId: org, source: songSource, duplicatePolicy: "skip" });
  assert.equal(skipped.created, 0);
  assert.equal(skipped.skipped >= 1, true);
  assert.equal(Number((await setup.query(`select count(*)::int as count from media_library_items where organization_id=$1`, [org])).rows[0].count), 1, "skip must not duplicate library content");

  const copied = await commitPortableImport(pool, user, { organizationId: org, source: songSource, duplicatePolicy: "import_copy" });
  assert.equal(copied.created, 1);
  assert.equal(Number((await setup.query(`select count(*)::int as count from media_library_items where organization_id=$1`, [org])).rows[0].count), 2, "import_copy must be explicit and auditable");

  await assert.rejects(
    () => commitPortableImport(pool, user, {
      organizationId: org,
      source: {
        kind: "service_rundown_json",
        filename: "atomic.json",
        content: JSON.stringify({ items: [
          { type: "slide", title: "Welcome", input: { title: "Welcome", body: "Welcome" } },
          { type: "alien", title: "Unsupported", input: { title: "Unsupported" } }
        ] })
      },
      targetServiceId: service,
      expectedRevision: (await loadPlannerServiceDetail(setup, user, service)).revision
    }),
    /unsupported|invalid|item/i,
    "a later domain validation failure must abort the entire batch"
  );
  assert.equal(Number((await setup.query(`select count(*)::int as count from presentation_items where service_id=$1`, [service])).rows[0].count), 0, "failed rundown commit must rollback earlier items");
  assert.equal(Number((await setup.query(`select count(*)::int as count from portable_import_batches where organization_id=$1 and source_name='atomic.json'`, [org])).rows[0].count), 0, "failed commit must not leave a batch record");

  await assert.rejects(
    () => commitPortableImport(pool, user, {
      organizationId: org,
      source: { kind: "service_rundown_json", filename: "cross-tenant.json", content: JSON.stringify({ items: [{ type: "slide", title: "Welcome", input: { title: "Welcome", body: "Welcome" } }] }) },
      targetServiceId: otherService,
      expectedRevision: "not-a-valid-cross-tenant-revision"
    }),
    (error) => [403, 404].includes(error?.status) || /not found|forbidden/i.test(String(error?.message)),
    "an import may never target another organization service"
  );

  const undoable = await commitPortableImport(pool, user, {
    organizationId: org,
    source: { kind: "song_text", filename: "undoable.txt", content: `Undoable Song\n\n[Verse 1]\nOriginal lyric` }
  });
  const undoResult = await undoPortableImport(pool, user, undoable.batchId);
  assert.equal(undoResult.status, "undone");
  assert.equal(Number((await setup.query(`select count(*)::int as count from media_library_items where id=(select entity_id::uuid from portable_import_batch_items where batch_id=$1 and entity_type='media_library_item' limit 1)`, [undoable.batchId])).rows[0].count), 0, "safe undo removes untouched batch-created library entities");

  const edited = await commitPortableImport(pool, user, {
    organizationId: org,
    source: { kind: "song_text", filename: "edited.txt", content: `Edited Later\n\n[Verse 1]\nOriginal lyric` }
  });
  const editedItem = await setup.query(`select entity_id::uuid as id from portable_import_batch_items where batch_id=$1 and entity_type='media_library_item' limit 1`, [edited.batchId]);
  await setup.query(`update media_library_items set title='User changed title',updated_at=clock_timestamp()+interval '1 second' where id=$1`, [editedItem.rows[0].id]);
  await assert.rejects(
    () => undoPortableImport(pool, user, edited.batchId),
    (error) => error?.code === "portable_import_undo_conflict",
    "undo must refuse later-edited entities"
  );
  assert.equal(Number((await setup.query(`select count(*)::int as count from media_library_items where id=$1`, [editedItem.rows[0].id])).rows[0].count), 1);

  const rundownSource = { kind: "service_rundown_json", filename: "used-rundown.json", content: JSON.stringify({ items: [{ type: "slide", title: "Prayer", input: { title: "Prayer", body: "Let us pray" } }] }) };
  const rundownCommit = await commitPortableImport(pool, user, {
    organizationId: org,
    source: rundownSource,
    targetServiceId: service,
    expectedRevision: (await loadPlannerServiceDetail(setup, user, service)).revision
  });
  const plannerItem = await setup.query(`select entity_id::uuid as id from portable_import_batch_items where batch_id=$1 and entity_type='presentation_item' limit 1`, [rundownCommit.batchId]);
  await setup.query(`update presentation_items set state='preview',updated_at=clock_timestamp()+interval '1 second' where id=$1`, [plannerItem.rows[0].id]);
  await assert.rejects(
    () => undoPortableImport(pool, user, rundownCommit.batchId),
    (error) => error?.code === "portable_import_undo_conflict",
    "undo must refuse imported Planner content after later use/state change"
  );

  const audit = await setup.query(`select action from audit_events where organization_id=$1 and action like 'portable_import.%' order by created_at,id`, [org]);
  assert.ok(audit.rows.some((row) => row.action === "portable_import.committed"));
  assert.ok(audit.rows.some((row) => row.action === "portable_import.undone"));

  const previewRoute = await readFile(new URL("../src/app/api/v1/imports/preview/route.ts", import.meta.url), "utf8");
  const commitRoute = await readFile(new URL("../src/app/api/v1/imports/commit/route.ts", import.meta.url), "utf8");
  const undoRoute = await readFile(new URL("../src/app/api/v1/imports/[id]/undo/route.ts", import.meta.url), "utf8");
  assert.match(previewRoute, /previewPortableImport/);
  assert.match(commitRoute, /commitPortableImport/);
  assert.match(undoRoute, /undoPortableImport/);

  console.log(JSON.stringify({
    ok: true,
    dryRunNonMutating: true,
    atomicCommit: true,
    duplicateDecision: true,
    tenantIsolation: true,
    provenance: true,
    safeUndo: true,
    editedUndoConflict: true,
    usedUndoConflict: true,
    domainRoutes: true
  }));
} finally {
  await setup.query(`delete from organizations where id in ($1,$2)`, [org, otherOrg]).catch(() => {});
  await setup.query(`delete from users where id in ($1,$2)`, [user, otherUser]).catch(() => {});
  setup.release();
  await pool.end();
}
