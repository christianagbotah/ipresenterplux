#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import process from "node:process";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";
import { parsePortableImport, PORTABLE_IMPORT_LIMITS } from "../src/lib/imports/parsers.ts";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be configured for portable import schema verification");
assertWritableSelfTestDatabase(process.env.DATABASE_URL);

assert.deepEqual(PORTABLE_IMPORT_LIMITS, { maxBytes: 2 * 1024 * 1024, maxRows: 500 });

const songText = `Amazing Grace\n\n[Verse 1]\nAmazing grace how sweet the sound\nThat saved a wretch like me\n\n[Chorus]\nI once was lost but now am found`;
const songPreview = parsePortableImport({ kind: "song_text", filename: "amazing-grace.txt", content: songText });
assert.equal(songPreview.kind, "song_text");
assert.equal(songPreview.candidates.length, 1);
assert.equal(songPreview.candidates[0].title, "Amazing Grace");
assert.deepEqual(songPreview.candidates[0].sections.map((section) => section.label), ["Verse 1", "Chorus"]);
assert.equal(songPreview.summary.errors, 0);
assert.match(songPreview.sourceFingerprint, /^[a-f0-9]{64}$/);
assert.equal(
  songPreview.sourceFingerprint,
  parsePortableImport({ kind: "song_text", filename: "renamed.txt", content: songText.replaceAll("\n", "\r\n") }).sourceFingerprint,
  "fingerprints must be deterministic across filename and line-ending changes"
);

const csv = `title,section,text\nBlessed Assurance,Verse 1,Blessed assurance Jesus is mine\nBlessed Assurance,Chorus,This is my story\nDuplicate Song,Verse 1,Same lyric\nDuplicate Song,Verse 1,Same lyric`;
const csvPreview = parsePortableImport({ kind: "song_csv", filename: "songs.csv", content: csv });
assert.equal(csvPreview.candidates.filter((candidate) => candidate.status === "valid").length >= 2, true);
assert.equal(csvPreview.candidates.some((candidate) => candidate.status === "duplicate"), true, "duplicate candidate fingerprints must be explicit in dry-run output");

const malformedCsv = parsePortableImport({ kind: "song_csv", filename: "songs.csv", content: `title,section,text\nGood Song,Verse 1,Good line\n,Verse 1,Missing title` });
assert.equal(malformedCsv.summary.valid, 1);
assert.equal(malformedCsv.summary.errors, 1);
assert.equal(malformedCsv.candidates.some((candidate) => candidate.status === "error"), true, "row validation must preserve errors without partial mutation");

const rundown = parsePortableImport({
  kind: "service_rundown_json",
  filename: "sunday-service.json",
  content: JSON.stringify({ title: "Sunday Service", items: [
    { type: "song", title: "Amazing Grace", input: { title: "Amazing Grace", sections: [{ label: "Verse 1", lines: ["Amazing grace"] }] } },
    { type: "slide", title: "Welcome", input: { title: "Welcome", body: "Welcome to church" } }
  ] })
});
assert.deepEqual(rundown.candidates.map((candidate) => candidate.targetType), ["song", "slide"]);
assert.equal(rundown.summary.errors, 0);

const media = parsePortableImport({
  kind: "media_url_manifest",
  filename: "media.json",
  content: JSON.stringify({ items: [
    { title: "Welcome Loop", url: "https://cdn.example.test/welcome.mp4", mediaType: "video" },
    { title: "Unsafe", url: "http://example.test/unsafe.mp4", mediaType: "video" }
  ] })
});
assert.equal(media.summary.valid, 1);
assert.equal(media.summary.errors, 1);
assert.equal(media.candidates.find((candidate) => candidate.title === "Unsafe")?.status, "error");

for (const filename of ["service.pro", "service.pro6", "library.ewb", "show.vmix", "scene.obs"]) {
  assert.throws(
    () => parsePortableImport({ kind: "song_text", filename, content: "portable text" }),
    (error) => error?.code === "portable_import_proprietary_format" && /documented portable export/i.test(error.message),
    `${filename} must be rejected with migration guidance rather than claimed as native compatibility`
  );
}
assert.throws(
  () => parsePortableImport({ kind: "song_text", filename: "huge.txt", content: "x".repeat(PORTABLE_IMPORT_LIMITS.maxBytes + 1) }),
  (error) => error?.code === "portable_import_too_large"
);
const rows501 = ["title,section,text", ...Array.from({ length: 501 }, (_, index) => `Song ${index},Verse 1,Line ${index}`)].join("\n");
assert.throws(
  () => parsePortableImport({ kind: "song_csv", filename: "too-many.csv", content: rows501 }),
  (error) => error?.code === "portable_import_row_limit"
);
assert.throws(
  () => parsePortableImport({ kind: "service_rundown_json", filename: "bad.json", content: "{not-json" }),
  (error) => error?.code === "portable_import_malformed"
);

const migration = await readFile(new URL("../db/041_portable_import_batches.sql", import.meta.url), "utf8");
assert.match(migration, /create table if not exists portable_import_batches/i);
assert.match(migration, /create table if not exists portable_import_batch_items/i);
assert.match(migration, /source_fingerprint/i);
assert.match(migration, /organization_id/i);
assert.match(migration, /provenance/i);

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  const schema = await client.query(`select table_name from information_schema.tables where table_schema='public' and table_name in ('portable_import_batches','portable_import_batch_items') order by table_name`);
  assert.deepEqual(schema.rows.map((row) => row.table_name), ["portable_import_batch_items", "portable_import_batches"]);
  const before = await client.query(`select count(*)::int as count from portable_import_batches`);
  parsePortableImport({ kind: "song_text", filename: "dry-run.txt", content: songText });
  const after = await client.query(`select count(*)::int as count from portable_import_batches`);
  assert.equal(after.rows[0].count, before.rows[0].count, "parser/dry-run must not mutate import batch state");
} finally {
  client.release();
  await pool.end();
}

const expectedHash = createHash("sha256").update("song_text\n" + songText.replaceAll("\r\n", "\n").trim()).digest("hex");
assert.equal(songPreview.sourceFingerprint, expectedHash, "source fingerprint contract must remain stable");

console.log(JSON.stringify({
  ok: true,
  kinds: ["song_text", "song_csv", "service_rundown_json", "media_url_manifest"],
  dryRunNonMutating: true,
  deterministicFingerprint: true,
  rowLimit: PORTABLE_IMPORT_LIMITS.maxRows,
  byteLimit: PORTABLE_IMPORT_LIMITS.maxBytes,
  proprietaryFormatsRejected: true
}));
