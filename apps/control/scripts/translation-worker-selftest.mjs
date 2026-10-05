import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import process from "node:process";
import pg from "pg";
import ts from "typescript";

process.loadEnvFile?.(".env.local");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");

const source = await readFile(new URL("../src/lib/translation-worker.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const workerUrl = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
const { claimTranslationJobs, completeTranslationJob, failTranslationJob } = await import(workerUrl);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query("begin");
try {
  const tenant = await client.query(
    `select o.id::text as organization_id,c.id::text as campus_id
     from organizations o left join campuses c on c.organization_id=o.id
     order by o.created_at,c.created_at nulls last limit 1`
  );
  assert.ok(tenant.rows[0]?.organization_id, "Expected at least one organization");
  const { organization_id: organizationId, campus_id: campusId } = tenant.rows[0];

  const channel = await client.query(
    `select id::text,language_code,channel_mode
     from language_channels
     where organization_id=$1 and enabled=true
       and channel_mode in ('translation_text','translation_audio')
     order by case channel_mode when 'translation_audio' then 0 else 1 end,language_code
     limit 1`,
    [organizationId]
  );
  assert.ok(channel.rows[0]?.id, "Expected at least one translation channel");

  const service = await client.query(
    `insert into services(organization_id,campus_id,title,status,active_bible_version)
     values ($1,$2,'Translation worker self-test','live','WEBP')
     returning id::text`,
    [organizationId, campusId]
  );
  const serviceId = service.rows[0].id;

  const segment = await client.query(
    `insert into transcript_segments(service_id,text,source_observed_at,source_language,asr_confidence)
     values ($1,'Please translate this live caption',$2,'en',0.97)
     returning id::text`,
    [serviceId, new Date("2099-12-31T23:59:59Z")]
  );
  const segmentId = segment.rows[0].id;

  const insertedJob = await client.query(
    `insert into transcript_translation_jobs
      (transcript_segment_id,language_channel_id,target_language_code,channel_mode)
     values ($1,$2,$3,$4)
     returning id::text`,
    [segmentId, channel.rows[0].id, channel.rows[0].language_code, channel.rows[0].channel_mode]
  );
  const jobId = insertedJob.rows[0].id;

  const firstClaim = await claimTranslationJobs(client, "selftest-worker", 1, 15);
  assert.equal(firstClaim.length, 1);
  assert.equal(firstClaim[0].id, jobId);
  assert.equal(firstClaim[0].attempts, 1);
  assert.ok(firstClaim[0].lease_token);

  assert.equal(
    await completeTranslationJob(client, jobId, "00000000-0000-4000-8000-000000000001", "wrong lease", "selftest"),
    null
  );

  await client.query(
    "update transcript_translation_jobs set lease_expires_at=now()-interval '1 second' where id=$1",
    [jobId]
  );
  assert.equal(
    await completeTranslationJob(client, jobId, firstClaim[0].lease_token, "expired lease", "selftest"),
    null
  );

  const secondClaim = await claimTranslationJobs(client, "selftest-worker-2", 1, 15);
  assert.equal(secondClaim.length, 1);
  assert.equal(secondClaim[0].id, jobId);
  assert.equal(secondClaim[0].attempts, 2);
  assert.notEqual(secondClaim[0].lease_token, firstClaim[0].lease_token);

  const failed = await failTranslationJob(client, jobId, secondClaim[0].lease_token, "temporary_error");
  assert.equal(failed?.status, "pending");
  assert.equal(failed?.retry_scheduled, true);

  await client.query("update transcript_translation_jobs set next_attempt_at=now()-interval '1 second' where id=$1", [jobId]);
  const thirdClaim = await claimTranslationJobs(client, "selftest-worker-3", 1, 15);
  assert.equal(thirdClaim.length, 1);
  assert.equal(thirdClaim[0].attempts, 3);

  const completed = await completeTranslationJob(
    client,
    jobId,
    thirdClaim[0].lease_token,
    "Translated self-test caption",
    "selftest"
  );
  assert.equal(completed?.id, jobId);

  const finalRow = await client.query(
    "select status,translated_text,attempts,lease_token,lease_expires_at from transcript_translation_jobs where id=$1",
    [jobId]
  );
  assert.equal(finalRow.rows[0]?.status, "succeeded");
  assert.equal(finalRow.rows[0]?.translated_text, "Translated self-test caption");
  assert.equal(finalRow.rows[0]?.attempts, 3);
  assert.equal(finalRow.rows[0]?.lease_token, null);
  assert.equal(finalRow.rows[0]?.lease_expires_at, null);

  const terminalSegment = await client.query(
    `insert into transcript_segments(service_id,text,source_observed_at,source_language)
     values ($1,'Final-attempt crash test',$2,'en')
     returning id::text`,
    [serviceId, new Date("2099-12-31T23:59:58Z")]
  );
  const terminalJob = await client.query(
    `insert into transcript_translation_jobs
      (transcript_segment_id,language_channel_id,target_language_code,channel_mode,status,attempts,worker_id,lease_token,lease_expires_at)
     values ($1,$2,$3,$4,'processing',5,'crashed-worker',gen_random_uuid(),now()-interval '1 second')
     returning id::text`,
    [terminalSegment.rows[0].id, channel.rows[0].id, channel.rows[0].language_code, channel.rows[0].channel_mode]
  );
  await claimTranslationJobs(client, "cleanup-worker", 1, 15);
  const terminalRow = await client.query(
    "select status,error_code,lease_token,lease_expires_at from transcript_translation_jobs where id=$1",
    [terminalJob.rows[0].id]
  );
  assert.equal(terminalRow.rows[0]?.status, "failed");
  assert.equal(terminalRow.rows[0]?.error_code, "lease_expired");
  assert.equal(terminalRow.rows[0]?.lease_token, null);
  assert.equal(terminalRow.rows[0]?.lease_expires_at, null);

  console.log("Translation worker self-test passed (claim, expiry, reclaim, retry backoff, final-attempt crash cleanup, completion).");
} finally {
  await client.query("rollback");
  await client.end();
}
