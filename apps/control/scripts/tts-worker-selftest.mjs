import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";
import ts from "typescript";

process.loadEnvFile?.(".env.local");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");

async function transpiledDataUrl(relative) {
  const source = await readFile(new URL(relative, import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
}

const workerUrl = await transpiledDataUrl("../src/lib/tts-worker.ts");
const synthUrl = await transpiledDataUrl("../src/lib/speech-synthesis-jobs.ts");
const storageUrl = await transpiledDataUrl("../src/lib/tts-audio-storage.ts");
const { claimTtsJobs, completeTtsJob, failTtsJob } = await import(workerUrl);
const { enqueueSpeechSynthesisJob } = await import(synthUrl);
const { verifyStoredTtsAsset } = await import(storageUrl);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query("begin");
try {
  const base = await client.query(
    `select o.id::text organization_id,c.id::text campus_id,lc.id::text channel_id,lc.language_code
     from organizations o
     join campuses c on c.organization_id=o.id
     join language_channels lc on lc.organization_id=o.id and lc.enabled=true and lc.channel_mode='translation_audio'
     order by o.created_at,c.created_at,lc.created_at limit 1`
  );
  assert.ok(base.rows[0]?.channel_id, "Expected an enabled translation_audio channel");
  const b = base.rows[0];

  const service = await client.query(
    `insert into services(organization_id,campus_id,title,status,active_bible_version)
     values ($1,$2,'TTS worker self-test','live','WEBP') returning id::text`,
    [b.organization_id, b.campus_id]
  );

  async function createTranslation(text, observedOffset = "0 seconds") {
    const segment = await client.query(
      `insert into transcript_segments(service_id,text,source_observed_at,source_language)
       values ($1,'TTS test transcript',clock_timestamp()+$2::interval,'en') returning id::text`,
      [service.rows[0].id, observedOffset]
    );
    return client.query(
      `insert into transcript_translation_jobs
        (transcript_segment_id,language_channel_id,target_language_code,channel_mode,status,translated_text,provider,completed_at)
       values ($1,$2,$3,'translation_audio','succeeded',$4,'selftest',clock_timestamp())
       returning id::text`,
      [segment.rows[0].id, b.channel_id, b.language_code, text]
    );
  }

  const translation = await createTranslation("Bonjour assemblée");
  const synthesis = await enqueueSpeechSynthesisJob(client, translation.rows[0].id);
  assert.ok(synthesis?.id);

  const first = await claimTtsJobs(client, "tts-selftest-a", 1, 15);
  assert.equal(first.length, 1);
  assert.equal(first[0].id, synthesis.id);
  assert.equal(first[0].source_text, "Bonjour assemblée");
  assert.equal(first[0].voice_profile_id, null);
  assert.equal(first[0].attempts, 1);
  assert.equal(
    await completeTtsJob(client, first[0].id, "00000000-0000-4000-8000-000000000001", "selftest", `tts/${first[0].id}.wav`, "audio/wav", 1000),
    null
  );

  await client.query(
    "update transcript_translation_jobs set translated_text='Bonjour corrigé',updated_at=clock_timestamp() where id=$1",
    [translation.rows[0].id]
  );
  assert.equal(
    await completeTtsJob(client, first[0].id, first[0].lease_token, "selftest", `tts/${first[0].id}.wav`, "audio/wav", 1000),
    null,
    "A lease for an older translation revision must not publish audio"
  );

  const refreshed = await enqueueSpeechSynthesisJob(client, translation.rows[0].id);
  assert.equal(refreshed?.id, first[0].id);
  assert.equal(refreshed?.status, "pending");

  const second = await claimTtsJobs(client, "tts-selftest-b", 1, 15);
  assert.equal(second[0]?.id, first[0].id);
  assert.equal(second[0]?.attempts, 1, "Text correction resets synthesis attempts");
  await client.query("update speech_synthesis_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1", [second[0].id]);
  assert.equal(
    await completeTtsJob(client, second[0].id, second[0].lease_token, "selftest", `tts/${second[0].id}.wav`, "audio/wav", 1000),
    null
  );

  const third = await claimTtsJobs(client, "tts-selftest-c", 1, 15);
  assert.equal(third[0]?.attempts, 2);
  const failed = await failTtsJob(client, third[0].id, third[0].lease_token, "temporary_error");
  assert.equal(failed?.status, "pending");
  assert.equal(failed?.retry_scheduled, true);
  await client.query("update speech_synthesis_jobs set next_attempt_at=clock_timestamp()-interval '1 second' where id=$1", [third[0].id]);

  const fourth = await claimTtsJobs(client, "tts-selftest-d", 1, 15);
  assert.equal(fourth[0]?.attempts, 3);
  const completed = await completeTtsJob(
    client,
    fourth[0].id,
    fourth[0].lease_token,
    "selftest",
    `tts/${fourth[0].id}.wav`,
    "audio/wav",
    1250
  );
  assert.equal(completed?.id, fourth[0].id);
  const finalRow = await client.query(
    "select status,audio_storage_key,audio_content_type,duration_ms,lease_token from speech_synthesis_jobs where id=$1",
    [fourth[0].id]
  );
  assert.equal(finalRow.rows[0]?.status, "succeeded");
  assert.equal(finalRow.rows[0]?.audio_content_type, "audio/wav");
  assert.equal(finalRow.rows[0]?.duration_ms, 1250);
  assert.equal(finalRow.rows[0]?.lease_token, null);

  const staleTranslation = await createTranslation("Original text", "-1 second");
  const staleSynthesis = await enqueueSpeechSynthesisJob(client, staleTranslation.rows[0].id);
  await client.query("update transcript_translation_jobs set translated_text='Changed behind queue' where id=$1", [staleTranslation.rows[0].id]);
  await claimTtsJobs(client, "tts-cleanup", 1, 15);
  const staleRow = await client.query("select status,error_code from speech_synthesis_jobs where id=$1", [staleSynthesis.id]);
  assert.equal(staleRow.rows[0]?.status, "failed");
  assert.equal(staleRow.rows[0]?.error_code, "source_text_changed");

  const terminalTranslation = await createTranslation("Terminal crash audio", "-2 seconds");
  const terminalSynthesis = await enqueueSpeechSynthesisJob(client, terminalTranslation.rows[0].id);
  await client.query(
    `update speech_synthesis_jobs
     set status='processing',attempts=5,worker_id='crashed-worker',lease_token=gen_random_uuid(),
         lease_expires_at=clock_timestamp()-interval '1 second'
     where id=$1`,
    [terminalSynthesis.id]
  );
  await claimTtsJobs(client, "tts-cleanup-2", 1, 15);
  const terminalRow = await client.query("select status,error_code,lease_token from speech_synthesis_jobs where id=$1", [terminalSynthesis.id]);
  assert.equal(terminalRow.rows[0]?.status, "failed");
  assert.equal(terminalRow.rows[0]?.error_code, "lease_expired");
  assert.equal(terminalRow.rows[0]?.lease_token, null);

  console.log("TTS worker DB self-test passed (hash guard, lease expiry/reclaim, retry, completion, stale-source cleanup, terminal crash cleanup).");
} finally {
  await client.query("rollback");
  await client.end();
}

const tempRoot = path.resolve(".tmp-tts-storage-selftest");
const jobId = "00000000-0000-4000-8000-000000000777";
process.env.TTS_AUDIO_STORAGE_DIR = tempRoot;
await mkdir(path.join(tempRoot, "tts"), { recursive: true });
try {
  const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVEfmt "), Buffer.alloc(16)]);
  await writeFile(path.join(tempRoot, "tts", `${jobId}.wav`), wav);
  const valid = await verifyStoredTtsAsset(`tts/${jobId}.wav`, jobId, "audio/wav");
  assert.ok(valid?.size > 0);
  assert.equal(await verifyStoredTtsAsset(`tts/${jobId}.wav`, "00000000-0000-4000-8000-000000000778", "audio/wav"), null);
  assert.equal(await verifyStoredTtsAsset(`tts/${jobId}.wav`, jobId, "audio/mpeg"), null);
  await writeFile(path.join(tempRoot, "tts", `${jobId}.mp3`), Buffer.from("not-an-mp3"));
  assert.equal(await verifyStoredTtsAsset(`tts/${jobId}.mp3`, jobId, "audio/mpeg"), null);
  console.log("TTS storage self-test passed (path binding, content type, magic bytes).");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
