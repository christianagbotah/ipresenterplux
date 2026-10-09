#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";

const media = await import("../src/lib/media-library.ts");
assert.equal(typeof media.listMediaLibrary, "function");
assert.equal(typeof media.createMediaLibraryItem, "function");
assert.equal(typeof media.addMediaItemToServiceRundown, "function");

const migration = await readFile(new URL("../db/038_media_archive_foundation.sql", import.meta.url), "utf8");
for (const table of ["media_library_items", "service_artifacts", "camera_source_preferences"]) {
  assert.match(migration, new RegExp(`create table if not exists ${table}`, "i"), `${table} must be created by migration 038`);
}
assert.doesNotMatch(migration, /\b(bytea|blob|lo_oid)\b/i, "media/archive foundation must remain metadata-only");

const pageSource = await readFile(new URL("../src/app/media/page.tsx", import.meta.url), "utf8");
assert.match(pageSource, /MediaWorkspace/);
assert.doesNotMatch(pageSource, /StudioReadinessPage/);
const workspaceSource = await readFile(new URL("../src/components/media/MediaWorkspace.tsx", import.meta.url), "utf8");
for (const copy of ["Reusable library", "Add to service", "Preview eligible", "Native only"]) {
  assert.ok(workspaceSource.includes(copy), `Media workspace must surface '${copy}'`);
}

if (!process.env.DATABASE_URL) {
  console.log(JSON.stringify({ ok: true, mode: "local-contract", database: "deferred-to-ci" }));
  process.exit(0);
}

assertWritableSelfTestDatabase(process.env.DATABASE_URL);

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
const orgA = randomUUID();
const orgB = randomUUID();
const campusA = randomUUID();
const userA = randomUUID();
const serviceA = randomUUID();
const supportedSource = randomUUID();
const nativeSource = randomUUID();

async function expectMediaError(action, code) {
  try {
    await action();
    assert.fail(`expected ${code}`);
  } catch (error) {
    assert.ok(error instanceof media.MediaLibraryError, `expected MediaLibraryError for ${code}`);
    assert.equal(error.code, code);
  }
}

try {
  await client.query("begin");
  await client.query(
    `insert into organizations(id,name,slug,country_code,timezone) values
      ($1,'Media Test A',$2,'GH','Africa/Accra'),
      ($3,'Media Test B',$4,'GH','Africa/Accra')`,
    [orgA, `media-a-${orgA}`, orgB, `media-b-${orgB}`]
  );
  await client.query(
    `insert into campuses(id,organization_id,name,slug,city,country_code)
     values ($1,$2,'Media Campus','media-campus','Accra','GH')`,
    [campusA, orgA]
  );
  await client.query(
    `insert into users(id,email,display_name,status) values ($1,$2,'Media Operator','active')`,
    [userA, `media-${userA}@example.invalid`]
  );
  await client.query(
    `insert into user_organization_roles(user_id,organization_id,role_id)
     values ($1,$2,'presenter_operator')`,
    [userA, orgA]
  );
  await client.query(
    `insert into services(id,organization_id,campus_id,title,status,active_bible_version)
     values ($1,$2,$3,'Media Service','draft','WEBP')`,
    [serviceA, orgA, campusA]
  );
  await client.query(
    `insert into media_sources(id,organization_id,name,source_type,status,public_config)
     values
       ($1,$3,'Approved Video','library_media','ready',$4::jsonb),
       ($2,$3,'Sanctuary Local Clip','edge_local','ready',$5::jsonb)`,
    [
      supportedSource,
      nativeSource,
      orgA,
      JSON.stringify({ assetUrl: "https://cdn.example.invalid/worship.mp4", mediaKind: "video" }),
      JSON.stringify({ mediaKind: "video", nativePath: "edge-owned" })
    ]
  );

  const song = await media.createMediaLibraryItem(client, userA, {
    organizationId: orgA,
    itemType: "song",
    input: {
      title: "Amazing Grace",
      author: "John Newton",
      sections: [
        { label: "Verse 1", text: "Amazing grace, how sweet the sound" },
        { label: "Chorus", text: "I once was lost, but now am found" }
      ]
    }
  });
  assert.equal(song.itemType, "song");
  assert.equal(song.previewEligibility, "eligible");

  const slide = await media.createMediaLibraryItem(client, userA, {
    organizationId: orgA,
    itemType: "slide",
    input: { title: "Welcome", body: "Welcome to service", style: "default" }
  });
  assert.equal(slide.previewEligibility, "eligible");

  const supported = await media.createMediaLibraryItem(client, userA, {
    organizationId: orgA,
    itemType: "media",
    input: { title: "Worship opener", sourceId: supportedSource, mediaKind: "video" }
  });
  assert.equal(supported.previewEligibility, "eligible");

  const nativeOnly = await media.createMediaLibraryItem(client, userA, {
    organizationId: orgA,
    itemType: "media",
    input: { title: "Native sanctuary clip", sourceId: nativeSource, mediaKind: "video" }
  });
  assert.equal(nativeOnly.previewEligibility, "native_only");

  const search = await media.listMediaLibrary(client, userA, { organizationId: orgA, search: "amazing" });
  assert.equal(search.items.length, 1);
  assert.equal(search.items[0].id, song.id);

  await expectMediaError(
    () => media.listMediaLibrary(client, userA, { organizationId: orgB }),
    "media_library_forbidden"
  );

  const planner = await import("../src/lib/planner-service-queries.ts");
  const detail = await planner.loadPlannerServiceDetail(client, userA, serviceA);
  const added = await media.addMediaItemToServiceRundown(client, userA, {
    libraryItemId: song.id,
    serviceId: serviceA,
    expectedRevision: detail.revision
  });
  assert.equal(added.item.itemType, "song");
  assert.equal(added.item.state, "queued");

  const refreshed = await planner.loadPlannerServiceDetail(client, userA, serviceA);
  await expectMediaError(
    () => media.addMediaItemToServiceRundown(client, userA, {
      libraryItemId: nativeOnly.id,
      serviceId: serviceA,
      expectedRevision: refreshed.revision
    }),
    "media_not_preview_eligible"
  );

  const crossOrgLibrary = randomUUID();
  await client.query(
    `insert into media_library_items(id,organization_id,item_type,title,planner_input)
     values ($1,$2,'slide','Foreign Slide',$3::jsonb)`,
    [crossOrgLibrary, orgB, JSON.stringify({ title: "Foreign Slide", body: "Other tenant" })]
  );
  await expectMediaError(
    () => media.addMediaItemToServiceRundown(client, userA, {
      libraryItemId: crossOrgLibrary,
      serviceId: serviceA,
      expectedRevision: refreshed.revision
    }),
    "media_library_not_found"
  );

  await client.query("rollback");
  console.log(JSON.stringify({
    ok: true,
    structuredSong: true,
    reusableWithoutService: true,
    search: true,
    tenantIsolation: true,
    addToRundown: true,
    unsupportedBlockedFromPreview: true
  }));
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
