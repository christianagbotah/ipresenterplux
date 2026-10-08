import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { requireEntitlementFeature } from "./licensing/entitlement-access.ts";

export type SpeechSynthesisJobSummary = {
  id: string;
  organization_id: string;
  translation_job_id: string;
  language_channel_id: string;
  target_language_code: string;
  source_text_hash: string;
  voice_profile_id: string | null;
  status: "pending" | "processing" | "succeeded" | "failed";
};

function textHash(text: string) {
  return createHash("sha256").update(text.trim(), "utf8").digest("hex");
}

export async function enqueueSpeechSynthesisJob(
  client: PoolClient,
  translationJobId: string
) {
  const service = await client.query<{ service_id: string }>(
    `select ts.service_id::text
     from transcript_translation_jobs j
     join transcript_segments ts on ts.id=j.transcript_segment_id
     where j.id=$1`,
    [translationJobId]
  );
  const serviceId = service.rows[0]?.service_id;
  if (!serviceId) return null;
  await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [serviceId]);

  const source = await client.query<{
    organization_id: string;
    language_channel_id: string;
    target_language_code: string;
    translated_text: string;
    voice_profile_id: string | null;
  }>(
    `select s.organization_id::text,j.language_channel_id::text,j.target_language_code,j.translated_text,
            matched_voice.id::text as voice_profile_id
     from transcript_translation_jobs j
     join transcript_segments ts on ts.id=j.transcript_segment_id
     join services s on s.id=ts.service_id
     join language_channels lc
       on lc.id=j.language_channel_id
      and lc.organization_id=s.organization_id
     left join lateral (
       select vp.id
       from (
         select b.voice_profile_id,0 as priority
         from service_speaker_voice_bindings b
         where ts.speaker_source='asr'
           and ts.speaker_id is not null
           and b.service_id=ts.service_id
           and b.organization_id=s.organization_id
           and lower(b.speaker_id)=lower(ts.speaker_id)
         union all
         select so.voice_profile_id,1 as priority
         from service_speaker_overrides so
         where ts.speaker_source='operator_override'
           and so.service_id=ts.service_id
           and so.organization_id=s.organization_id
       ) candidate
       join voice_profiles vp
         on vp.id=candidate.voice_profile_id
        and vp.organization_id=s.organization_id
       where vp.consent_status='consented'
         and vp.consented_at is not null
         and vp.revoked_at is null
         and vp.provider is not null
         and vp.provider_voice_id is not null
       order by candidate.priority,vp.consented_at desc,vp.id desc
       limit 1
     ) matched_voice on true
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

  await requireEntitlementFeature(row.organization_id, "translations.audio", { client });

  if (row.voice_profile_id) {
    const activeVoice = await client.query(
      `select id
       from voice_profiles
       where id=$1 and organization_id=$2
         and consent_status='consented'
         and consented_at is not null and revoked_at is null
         and provider is not null and provider_voice_id is not null
       for update`,
      [row.voice_profile_id, row.organization_id]
    );
    if (!activeVoice.rowCount) row.voice_profile_id = null;
  }

  const hash = textHash(row.translated_text);
  const result = await client.query<SpeechSynthesisJobSummary>(
    `insert into speech_synthesis_jobs
      (organization_id,translation_job_id,language_channel_id,target_language_code,source_text_hash,voice_profile_id)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (translation_job_id) do update set
       organization_id=excluded.organization_id,
       language_channel_id=excluded.language_channel_id,
       target_language_code=excluded.target_language_code,
       source_text_hash=excluded.source_text_hash,
       voice_profile_id=excluded.voice_profile_id,
       status=case
         when speech_synthesis_jobs.source_text_hash=excluded.source_text_hash
          and speech_synthesis_jobs.voice_profile_id is not distinct from excluded.voice_profile_id
         then speech_synthesis_jobs.status else 'pending' end,
       provider=case
         when speech_synthesis_jobs.source_text_hash=excluded.source_text_hash
          and speech_synthesis_jobs.voice_profile_id is not distinct from excluded.voice_profile_id
         then speech_synthesis_jobs.provider else null end,
       audio_storage_key=case
         when speech_synthesis_jobs.source_text_hash=excluded.source_text_hash
          and speech_synthesis_jobs.voice_profile_id is not distinct from excluded.voice_profile_id
         then speech_synthesis_jobs.audio_storage_key else null end,
       audio_content_type=case
         when speech_synthesis_jobs.source_text_hash=excluded.source_text_hash
          and speech_synthesis_jobs.voice_profile_id is not distinct from excluded.voice_profile_id
         then speech_synthesis_jobs.audio_content_type else null end,
       duration_ms=case
         when speech_synthesis_jobs.source_text_hash=excluded.source_text_hash
          and speech_synthesis_jobs.voice_profile_id is not distinct from excluded.voice_profile_id
         then speech_synthesis_jobs.duration_ms else null end,
       error_code=case
         when speech_synthesis_jobs.source_text_hash=excluded.source_text_hash
          and speech_synthesis_jobs.voice_profile_id is not distinct from excluded.voice_profile_id
         then speech_synthesis_jobs.error_code else null end,
       attempts=case
         when speech_synthesis_jobs.source_text_hash=excluded.source_text_hash
          and speech_synthesis_jobs.voice_profile_id is not distinct from excluded.voice_profile_id
         then speech_synthesis_jobs.attempts else 0 end,
       worker_id=case
         when speech_synthesis_jobs.source_text_hash=excluded.source_text_hash
          and speech_synthesis_jobs.voice_profile_id is not distinct from excluded.voice_profile_id
         then speech_synthesis_jobs.worker_id else null end,
       lease_token=case
         when speech_synthesis_jobs.source_text_hash=excluded.source_text_hash
          and speech_synthesis_jobs.voice_profile_id is not distinct from excluded.voice_profile_id
         then speech_synthesis_jobs.lease_token else null end,
       lease_expires_at=case
         when speech_synthesis_jobs.source_text_hash=excluded.source_text_hash
          and speech_synthesis_jobs.voice_profile_id is not distinct from excluded.voice_profile_id
         then speech_synthesis_jobs.lease_expires_at else null end,
       next_attempt_at=case
         when speech_synthesis_jobs.source_text_hash=excluded.source_text_hash
          and speech_synthesis_jobs.voice_profile_id is not distinct from excluded.voice_profile_id
         then speech_synthesis_jobs.next_attempt_at else null end,
       claimed_at=case
         when speech_synthesis_jobs.source_text_hash=excluded.source_text_hash
          and speech_synthesis_jobs.voice_profile_id is not distinct from excluded.voice_profile_id
         then speech_synthesis_jobs.claimed_at else null end,
       completed_at=case
         when speech_synthesis_jobs.source_text_hash=excluded.source_text_hash
          and speech_synthesis_jobs.voice_profile_id is not distinct from excluded.voice_profile_id
         then speech_synthesis_jobs.completed_at else null end,
       updated_at=case
         when speech_synthesis_jobs.source_text_hash=excluded.source_text_hash
          and speech_synthesis_jobs.voice_profile_id is not distinct from excluded.voice_profile_id
         then speech_synthesis_jobs.updated_at else clock_timestamp() end
     returning id::text,organization_id::text,translation_job_id::text,
               language_channel_id::text,target_language_code,source_text_hash,voice_profile_id::text,status`,
    [row.organization_id, translationJobId, row.language_channel_id, row.target_language_code, hash, row.voice_profile_id]
  );
  return result.rows[0] ?? null;
}
