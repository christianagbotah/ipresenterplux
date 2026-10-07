import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import process from "node:process";
import pg from "pg";
import { assertWritableSelfTestDatabase } from "./selftest-db-safety.mjs";
import ts from "typescript";

process.loadEnvFile?.(".env.local");
assertWritableSelfTestDatabase(process.env.DATABASE_URL);
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
const translationUrl = await transpiledDataUrl(new URL("../src/lib/translation-jobs.ts", import.meta.url));
const workerUrl = await transpiledDataUrl(new URL("../src/lib/translation-worker.ts", import.meta.url));
const { matchScriptureQuote } = await import(quoteUrl);
const { latestTranscriptObservedAt, recordTranscriptSegment, recentTranscriptQuoteWindow, recentlyDetectedQuote } = await import(windowUrl);
const { buildTranscriptReceiptPayload } = await import(receiptUrl);
const { enqueueTranslationJobs } = await import(translationUrl);
const { claimTranslationJobs, completeTranslationJob, failTranslationJob } = await import(workerUrl);

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
  const service = await client.query("select id::text,organization_id::text from services order by created_at limit 1");
  assert.ok(service.rows[0]?.id, "Expected at least one service");
  const serviceId = service.rows[0].id;
  const organizationId = service.rows[0].organization_id;
  const firstAt = new Date("2099-01-01T10:00:00Z");
  const secondAt = new Date("2099-01-01T10:00:05Z");

  const firstSegmentId = await recordTranscriptSegment(client, serviceId, "For God so loved the world", firstAt, {
    sourceLanguage: "en",
    speakerId: "speaker-1",
    asrConfidence: 0.93
  });
  const secondSegmentId = await recordTranscriptSegment(client, serviceId, "that he gave his only born Son", secondAt, {
    sourceLanguage: "en",
    speakerId: "speaker-1",
    asrConfidence: 0.95
  });
  assert.ok(firstSegmentId);
  assert.ok(secondSegmentId);

  const expectedEnglishTargets = await client.query(
    `select count(*)::int as count
     from language_channels
     where organization_id=$1 and enabled=true
       and channel_mode in ('translation_text','translation_audio')
       and lower(language_code) <> 'en'`,
    [organizationId]
  );
  const queuedEnglish = await enqueueTranslationJobs(client, secondSegmentId, organizationId, "en");
  assert.equal(queuedEnglish.length, expectedEnglishTargets.rows[0].count);
  assert.ok(queuedEnglish.every((job) => ["translation_text", "translation_audio"].includes(job.channel_mode)));
  assert.equal((await enqueueTranslationJobs(client, secondSegmentId, organizationId, "en")).length, 0);

  const frenchSegmentId = await recordTranscriptSegment(
    client,
    serviceId,
    "Bonjour à tous",
    new Date("2099-01-01T09:58:00Z"),
    { sourceLanguage: "fr", asrConfidence: 0.91 }
  );
  assert.ok(frenchSegmentId);
  const queuedFrench = await enqueueTranslationJobs(client, frenchSegmentId, organizationId, "fr");
  assert.ok(queuedFrench.every((job) => job.target_language_code.toLowerCase() !== "fr"));

  if (queuedEnglish[0]) {
    await client.query(
      `update transcript_translation_jobs
       set status='succeeded',translated_text='Translated test caption',provider='selftest',completed_at=now(),updated_at=now()
       where id=$1`,
      [queuedEnglish[0].id]
    );
    const translated = await client.query(
      "select status,translated_text from transcript_translation_jobs where id=$1",
      [queuedEnglish[0].id]
    );
    assert.equal(translated.rows[0]?.status, "succeeded");
    assert.equal(translated.rows[0]?.translated_text, "Translated test caption");
  }

  // Isolate this rollback-only worker test from any real queue rows that may already be claimable.
  await client.query(
    "update transcript_translation_jobs set next_attempt_at='2200-01-01T00:00:00Z' where status in ('pending','failed')"
  );
  await client.query(
    "update transcript_translation_jobs set lease_expires_at='2200-01-01T00:00:00Z' where status='processing'"
  );

  const workerSegmentId = await recordTranscriptSegment(
    client,
    serviceId,
    "Worker lease test transcript",
    new Date("1900-01-01T00:00:00Z"),
    { sourceLanguage: "en", asrConfidence: 0.99 }
  );
  assert.ok(workerSegmentId);
  const workerJobs = await enqueueTranslationJobs(client, workerSegmentId, organizationId, "en");
  assert.ok(workerJobs.length > 0);
  const firstClaim = await claimTranslationJobs(client, "selftest-worker-a", 1, 15);
  assert.equal(firstClaim.length, 1);
  assert.equal(firstClaim[0].transcript_segment_id, workerSegmentId);
  const firstLease = firstClaim[0].lease_token;
  const failed = await failTranslationJob(client, firstClaim[0].id, firstLease, "selftest_retry");
  assert.equal(failed?.retry_scheduled, true);
  assert.equal(await completeTranslationJob(client, firstClaim[0].id, firstLease, "must not save", "selftest"), null);
  await client.query("update transcript_translation_jobs set next_attempt_at=now()-interval '1 second' where id=$1", [firstClaim[0].id]);
  const secondClaim = await claimTranslationJobs(client, "selftest-worker-b", 1, 15);
  assert.equal(secondClaim.length, 1);
  assert.equal(secondClaim[0].id, firstClaim[0].id);
  assert.notEqual(secondClaim[0].lease_token, firstLease);
  const completedWorker = await completeTranslationJob(
    client,
    secondClaim[0].id,
    secondClaim[0].lease_token,
    "Worker translated result",
    "selftest-provider"
  );
  assert.equal(completedWorker?.id, firstClaim[0].id);
  assert.equal(await completeTranslationJob(client, secondClaim[0].id, secondClaim[0].lease_token, "duplicate", "selftest-provider"), null);

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

  console.log("Transcript window self-test passed (receipt compatibility, metadata, translation queue, worker leases/retry, ordered assembly, quote match, blank skip, stale watermark, quote dedupe).");
} finally {
  await client.query("rollback");
  await client.end();
}
