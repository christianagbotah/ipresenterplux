import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

export type SpeechSynthesisJobSummary = {
  id: string;
  organization_id: string;
  translation_job_id: string;
  language_channel_id: string;
  target_language_code: string;
  source_text_hash: string;
  status: "pending" | "processing" | "succeeded" | "failed";
};

function textHash(text: string) {
  return createHash("sha256").update(text.trim(), "utf8").digest("hex");
}

export async function enqueueSpeechSynthesisJob(
  client: PoolClient,
  translationJobId: string
) {
  const source = await client.query<{
    organization_id: string;
    language_channel_id: string;
    target_language_code: string;
    translated_text: string;
  }>(
    `select s.organization_id::text,j.language_channel_id::text,j.target_language_code,j.translated_text
     from transcript_translation_jobs j
     join transcript_segments ts on ts.id=j.transcript_segment_id
     join services s on s.id=ts.service_id
     join language_channels lc
       on lc.id=j.language_channel_id
      and lc.organization_id=s.organization_id
     where j.id=$1
       and j.status='succeeded'
       and j.channel_mode='translation_audio'
       and j.translated_text is not null
       and length(btrim(j.translated_text)) > 0
       and lc.enabled=true
       and lc.channel_mode='translation_audio'
       and lower(lc.language_code)=lower(j.target_language_code)`,
    [translationJobId]
  );
  const row = source.rows[0];
  if (!row) return null;

  const hash = textHash(row.translated_text);
  const result = await client.query<SpeechSynthesisJobSummary>(
    `insert into speech_synthesis_jobs
      (organization_id,translation_job_id,language_channel_id,target_language_code,source_text_hash)
     values ($1,$2,$3,$4,$5)
     on conflict (translation_job_id) do update set
       organization_id=excluded.organization_id,
       language_channel_id=excluded.language_channel_id,
       target_language_code=excluded.target_language_code,
       source_text_hash=excluded.source_text_hash,
       status=case when speech_synthesis_jobs.source_text_hash=excluded.source_text_hash then speech_synthesis_jobs.status else 'pending' end,
       provider=case when speech_synthesis_jobs.source_text_hash=excluded.source_text_hash then speech_synthesis_jobs.provider else null end,
       audio_storage_key=case when speech_synthesis_jobs.source_text_hash=excluded.source_text_hash then speech_synthesis_jobs.audio_storage_key else null end,
       audio_content_type=case when speech_synthesis_jobs.source_text_hash=excluded.source_text_hash then speech_synthesis_jobs.audio_content_type else null end,
       duration_ms=case when speech_synthesis_jobs.source_text_hash=excluded.source_text_hash then speech_synthesis_jobs.duration_ms else null end,
       error_code=case when speech_synthesis_jobs.source_text_hash=excluded.source_text_hash then speech_synthesis_jobs.error_code else null end,
       attempts=case when speech_synthesis_jobs.source_text_hash=excluded.source_text_hash then speech_synthesis_jobs.attempts else 0 end,
       claimed_at=case when speech_synthesis_jobs.source_text_hash=excluded.source_text_hash then speech_synthesis_jobs.claimed_at else null end,
       completed_at=case when speech_synthesis_jobs.source_text_hash=excluded.source_text_hash then speech_synthesis_jobs.completed_at else null end,
       updated_at=case when speech_synthesis_jobs.source_text_hash=excluded.source_text_hash then speech_synthesis_jobs.updated_at else clock_timestamp() end
     returning id::text,organization_id::text,translation_job_id::text,
               language_channel_id::text,target_language_code,source_text_hash,status`,
    [row.organization_id, translationJobId, row.language_channel_id, row.target_language_code, hash]
  );
  return result.rows[0] ?? null;
}
