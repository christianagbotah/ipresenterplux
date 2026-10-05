import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import process from "node:process";
import pg from "pg";
import ts from "typescript";

process.loadEnvFile?.(".env.local");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");

async function transpiledDataUrl(path, replacements = []) {
  let source = await readFile(path, "utf8");
  for (const [from, to] of replacements) source = source.replace(from, to);
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
}

const scriptureUrl = await transpiledDataUrl(new URL("../src/lib/scripture.ts", import.meta.url));
const quoteUrl = await transpiledDataUrl(
  new URL("../src/lib/scripture-quote.ts", import.meta.url),
  [["@/lib/scripture", scriptureUrl]]
);
const windowUrl = await transpiledDataUrl(new URL("../src/lib/transcript-window.ts", import.meta.url));
const receiptUrl = await transpiledDataUrl(new URL("../src/lib/transcript-receipt.ts", import.meta.url));
const { matchScriptureQuote } = await import(quoteUrl);
const { latestTranscriptObservedAt, recordTranscriptSegment, recentTranscriptQuoteWindow, recentlyDetectedQuote } = await import(windowUrl);
const { buildTranscriptReceiptPayload } = await import(receiptUrl);

const legacyReceipt = {
  serviceId: null,
  startedAt: "2099-01-01T10:00:00.000Z",
  text: "For God so loved the world",
  bibleVersion: null
};
assert.deepEqual(buildTranscriptReceiptPayload(legacyReceipt), legacyReceipt);
assert.deepEqual(buildTranscriptReceiptPayload({ ...legacyReceipt, language: "en", speakerId: "speaker-1" }), legacyReceipt);
assert.deepEqual(buildTranscriptReceiptPayload({ ...legacyReceipt, wireVersion: 2, language: null, speakerId: null, confidence: null }), { ...legacyReceipt, wireVersion: 2 });
assert.deepEqual(
  buildTranscriptReceiptPayload({ ...legacyReceipt, wireVersion: 2, language: "en", speakerId: "speaker-1", confidence: 0.93 }),
  { ...legacyReceipt, wireVersion: 2, language: "en", speakerId: "speaker-1", confidence: 0.93 }
);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query("begin");
try {
  const service = await client.query("select id::text from services order by created_at limit 1");
  assert.ok(service.rows[0]?.id, "Expected at least one service");
  const serviceId = service.rows[0].id;
  const firstAt = new Date("2099-01-01T10:00:00Z");
  const secondAt = new Date("2099-01-01T10:00:05Z");

  await recordTranscriptSegment(client, serviceId, "For God so loved the world", firstAt, {
    sourceLanguage: "en",
    speakerId: "speaker-1",
    asrConfidence: 0.93
  });
  await recordTranscriptSegment(client, serviceId, "that he gave his only born Son", secondAt, {
    sourceLanguage: "en",
    speakerId: "speaker-1",
    asrConfidence: 0.95
  });

  const metadataRow = await client.query(
    `select source_language,speaker_id,asr_confidence
     from transcript_segments
     where service_id=$1 and source_observed_at=$2`,
    [serviceId, secondAt]
  );
  assert.equal(metadataRow.rows[0]?.source_language, "en");
  assert.equal(metadataRow.rows[0]?.speaker_id, "speaker-1");
  assert.equal(Number(metadataRow.rows[0]?.asr_confidence), 0.95);

  const windowText = await recentTranscriptQuoteWindow(client, serviceId, secondAt);
  assert.equal(windowText, "For God so loved the world that he gave his only born Son");
  const matched = await matchScriptureQuote(client, "WEBP", windowText);
  assert.equal(matched?.reference, "John 3:16");

  const beforeBlank = await client.query(
    "select count(*)::int as count from transcript_segments where service_id=$1 and source_observed_at between $2 and $3",
    [serviceId, firstAt, secondAt]
  );
  await recordTranscriptSegment(client, serviceId, "   ", secondAt);
  const afterBlank = await client.query(
    "select count(*)::int as count from transcript_segments where service_id=$1 and source_observed_at between $2 and $3",
    [serviceId, firstAt, secondAt]
  );
  assert.equal(afterBlank.rows[0].count, beforeBlank.rows[0].count);

  assert.equal(new Date(await latestTranscriptObservedAt(client, serviceId)).getTime(), secondAt.getTime());
  await recordTranscriptSegment(client, serviceId, "stale replay chunk", new Date("2099-01-01T09:59:00Z"));
  assert.equal(new Date(await latestTranscriptObservedAt(client, serviceId)).getTime(), secondAt.getTime());
  const latest = await client.query(
    `select text from transcript_segments
     where service_id=$1
     order by source_observed_at desc,created_at desc,id desc
     limit 1`,
    [serviceId]
  );
  assert.equal(latest.rows[0]?.text, "that he gave his only born Son");

  await client.query(
    `insert into scripture_detections
      (service_id,scripture_reference,book,chapter,verse_start,bible_version,confidence,state,detection_method,source_observed_at,source_ordinal)
     values ($1,'John 3:16','John',3,16,'WEBP',92,'detected','quote',$2,0)`,
    [serviceId, secondAt]
  );
  assert.equal(await recentlyDetectedQuote(client, serviceId, "John 3:16", new Date("2099-01-01T10:00:10Z")), true);

  console.log("Transcript window self-test passed (receipt compatibility, metadata, ordered assembly, quote match, blank skip, stale watermark, quote dedupe).");
} finally {
  await client.query("rollback");
  await client.end();
}
