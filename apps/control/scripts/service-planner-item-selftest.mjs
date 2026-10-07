#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const schemas = await import("../src/lib/planner-item-schemas.ts");
const normalizer = await import("../src/lib/planner-item-normalize.ts");
const scripture = await import("../src/lib/planner-scripture.ts");

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
const orgId = randomUUID();
const mediaId = randomUUID();
const unsafeMediaId = randomUUID();
const cameraId = randomUUID();

function expectItemError(action, code) {
  return Promise.resolve()
    .then(action)
    .then(() => assert.fail(`expected ${code}`))
    .catch((error) => {
      assert.ok(error instanceof schemas.PlannerItemError, `expected PlannerItemError for ${code}`);
      assert.equal(error.code, code);
    });
}

try {
  await client.query("begin");
  await client.query(
    `insert into organizations(id,name,slug,country_code,timezone)
     values ($1,'Planner Item Test',$2,'GH','Africa/Accra')`,
    [orgId, `planner-item-${orgId}`]
  );
  await client.query(
    `insert into media_sources(id,organization_id,name,source_type,status,public_config)
     values
       ($1,$4,'Worship Video','asset','ready',$5::jsonb),
       ($2,$4,'Unsafe Video','asset','ready',$6::jsonb),
       ($3,$4,'Main Camera','camera','ready',$7::jsonb)`,
    [
      mediaId,
      unsafeMediaId,
      cameraId,
      orgId,
      JSON.stringify({ assetUrl: "https://media.example.test/worship.mp4", mediaKind: "video" }),
      JSON.stringify({ assetUrl: "javascript:alert(1)", mediaKind: "video" }),
      JSON.stringify({ label: "Main Camera" })
    ]
  );

  assert.equal(schemas.parsePlannerItemInput("slide", {
    title: "  Welcome   Church ",
    body: " First line  \r\n second   line ",
    footer: "  Sunday Worship  ",
    style: "default"
  }).title, "Welcome Church");

  await expectItemError(
    () => schemas.parsePlannerItemInput("slide", { title: "Too large", body: "x".repeat(12001) }),
    "planner_body_too_long"
  );
  await expectItemError(
    () => schemas.parsePlannerItemInput("slide", { title: "Footer", body: "OK", footer: "x".repeat(501) }),
    "planner_footer_too_long"
  );
  await expectItemError(
    () => schemas.parsePlannerItemInput("custom", { title: "Unsafe", body: "Text", html: "<script>alert(1)</script>" }),
    "planner_item_invalid"
  );

  const song = await normalizer.normalizePlannerItem(client, orgId, "song", {
    title: "Amazing Grace",
    author: "John Newton",
    sections: [
      { label: "Verse 1", text: "Amazing grace! How sweet the sound" },
      { label: "Verse 2", text: "'Twas grace that taught my heart to fear" }
    ],
    defaultSection: 0
  });
  assert.equal(song.title, "Amazing Grace");
  assert.equal(song.content.sections.length, 2);
  assert.match(song.presentation.body, /Verse 1/);
  assert.match(song.presentation.body, /Amazing grace!/);
  assert.equal(song.presentation.footer, "John Newton");

  await expectItemError(
    () => normalizer.normalizePlannerItem(client, orgId, "song", {
      title: "Too many sections",
      sections: Array.from({ length: 65 }, (_, index) => ({ label: `Verse ${index + 1}`, text: "Public-domain fixture" }))
    }),
    "planner_song_sections_exceeded"
  );

  const resolved = await scripture.resolvePlannerScripture(client, "John 3:16-17", "WEBP");
  assert.equal(resolved.version, "WEBP");
  assert.equal(resolved.book, "John");
  assert.equal(resolved.chapter, 3);
  assert.equal(resolved.verseStart, 16);
  assert.equal(resolved.verseEnd, 17);
  assert.match(resolved.passageText, /For God so loved the world/);

  const scriptureItem = await normalizer.normalizePlannerItem(client, orgId, "scripture", {
    reference: "John 3:16-17",
    version: "WEBP",
    footer: "World English Bible"
  });
  assert.equal(scriptureItem.title, "John 3:16-17");
  assert.match(scriptureItem.presentation.body, /For God so loved the world/);
  assert.equal(scriptureItem.presentation.footer, "World English Bible");

  await expectItemError(
    () => scripture.resolvePlannerScripture(client, "John 3:1-81", "WEBP"),
    "scripture_reference_invalid"
  );
  await expectItemError(
    () => scripture.resolvePlannerScripture(client, "Imaginary 1:1", "WEBP"),
    "scripture_book_not_found"
  );

  const announcement = await normalizer.normalizePlannerItem(client, orgId, "announcement", {
    title: "  Midweek   Service ",
    body: " Wednesday   at 6pm ",
    dateNote: "This Wednesday",
    style: "announcement"
  });
  assert.equal(announcement.title, "Midweek Service");
  assert.equal(announcement.presentation.body, "Wednesday at 6pm");

  const lowerThird = await normalizer.normalizePlannerItem(client, orgId, "lower_third", {
    primaryText: "Rev. Demo Pastor",
    secondaryText: "Lead Pastor",
    durationSeconds: 12
  });
  assert.equal(lowerThird.title, "Rev. Demo Pastor");
  assert.equal(lowerThird.presentation.footer, "Lead Pastor");

  const media = await normalizer.normalizePlannerItem(client, orgId, "media", {
    title: "Worship Video",
    sourceId: mediaId,
    mediaKind: "video",
    operatorNotes: "Fade after playback"
  });
  assert.equal(media.content.sourceId, mediaId);
  assert.equal(media.content.assetUrl, "https://media.example.test/worship.mp4");
  assert.equal(media.content.mediaKind, "video");

  await expectItemError(
    () => normalizer.normalizePlannerItem(client, orgId, "media", {
      title: "Unknown",
      sourceId: randomUUID(),
      mediaKind: "video"
    }),
    "media_source_not_found"
  );
  await expectItemError(
    () => normalizer.normalizePlannerItem(client, orgId, "media", {
      title: "Unsafe",
      sourceId: unsafeMediaId,
      mediaKind: "video"
    }),
    "media_source_unsafe"
  );
  await expectItemError(
    () => schemas.parsePlannerItemInput("media", {
      title: "No raw path",
      sourceId: mediaId,
      mediaKind: "video",
      path: "C:\\church\\video.mp4"
    }),
    "planner_item_invalid"
  );

  const camera = await normalizer.normalizePlannerItem(client, orgId, "camera", {
    sourceId: cameraId,
    label: "Pulpit Camera",
    operatorNote: "Use for sermon"
  });
  assert.equal(camera.title, "Pulpit Camera");
  assert.equal(camera.content.sourceId, cameraId);

  const custom = await normalizer.normalizePlannerItem(client, orgId, "custom", {
    title: "Giving",
    body: "Thank you for your generosity",
    footer: "iPresenterPlux Demo Church",
    style: "default"
  });
  assert.equal(custom.presentation.body, "Thank you for your generosity");

  await client.query("rollback");
  console.log(JSON.stringify({
    ok: true,
    itemTypes: 8,
    scripture: true,
    songPublicDomainFixture: true,
    unsafeMediaRejected: true,
    strictObjects: true
  }));
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
