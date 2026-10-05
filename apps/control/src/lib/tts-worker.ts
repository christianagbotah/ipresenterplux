import type { PoolClient } from "pg";

export const TTS_MAX_ATTEMPTS = 5;

export type ClaimedTtsJob = {
  id: string;
  lease_token: string;
  worker_id: string;
  organization_id: string;
  service_id: string;
  translation_job_id: string;
  language_channel_id: string;
  target_language_code: string;
  source_text: string;
  source_text_hash: string;
  voice_profile_id: string | null;
  voice_provider: string | null;
  provider_voice_id: string | null;
  attempts: number;
  lease_expires_at: string;
};

type LockedTtsJob = {
  id: string;
  status: string;
  lease_token: string | null;
  lease_expires_at: string | null;
  worker_id: string | null;
  organization_id: string;
  service_id: string;
  language_channel_id: string;
  target_language_code: string;
  attempts: number;
};

export async function claimTtsJobs(
  client: PoolClient,
  workerId: string,
  limit = 1,
  leaseSeconds = 45
) {
  const result = await client.query<ClaimedTtsJob>(
    `with invalid_voice_candidates as (
       select sj.id
       from speech_synthesis_jobs sj
       where sj.voice_profile_id is not null
         and sj.status in ('pending','processing','failed')
         and not exists (
           select 1 from voice_profiles vp
           where vp.id=sj.voice_profile_id
             and vp.organization_id=sj.organization_id
             and vp.consent_status='consented'
             and vp.consented_at is not null
             and vp.revoked_at is null
             and vp.provider_voice_id is not null
         )
       order by sj.updated_at asc,sj.id asc
       for update skip locked
       limit 100
     ), invalid_voice as (
       update speech_synthesis_jobs sj
       set status='failed',error_code='voice_consent_invalid',worker_id=null,lease_token=null,
           lease_expires_at=null,next_attempt_at=null,completed_at=clock_timestamp(),updated_at=clock_timestamp()
       from invalid_voice_candidates c
       where sj.id=c.id
       returning sj.id
     ), stale_source_candidates as (
       select sj.id
       from speech_synthesis_jobs sj
       join transcript_translation_jobs tj on tj.id=sj.translation_job_id
       where sj.status in ('pending','processing','failed')
         and tj.translated_text is not null
         and sj.source_text_hash <> encode(digest(tj.translated_text,'sha256'),'hex')
       order by sj.updated_at asc,sj.id asc
       for update of sj skip locked
       limit 100
     ), stale_source as (
       update speech_synthesis_jobs sj
       set status='failed',error_code='source_text_changed',worker_id=null,lease_token=null,
           lease_expires_at=null,next_attempt_at=null,completed_at=clock_timestamp(),updated_at=clock_timestamp()
       from stale_source_candidates c
       where sj.id=c.id
       returning sj.id
     ), exhausted_candidates as (
       select id
       from speech_synthesis_jobs
       where status='processing' and attempts >= $3
         and lease_expires_at is not null and lease_expires_at <= clock_timestamp()
       order by lease_expires_at asc,id asc
       for update skip locked
       limit 100
     ), exhausted as (
       update speech_synthesis_jobs sj
       set status='failed',error_code='lease_expired',worker_id=null,lease_token=null,
           lease_expires_at=null,next_attempt_at=null,completed_at=clock_timestamp(),updated_at=clock_timestamp()
       from exhausted_candidates e
       where sj.id=e.id
       returning sj.id
     ), candidates as (
       select sj.id
       from speech_synthesis_jobs sj
       join transcript_translation_jobs tj on tj.id=sj.translation_job_id
       join transcript_segments ts on ts.id=tj.transcript_segment_id
       join services s on s.id=ts.service_id
       join language_channels lc on lc.id=sj.language_channel_id
       where lc.organization_id=sj.organization_id
         and s.organization_id=sj.organization_id
         and lc.enabled=true
         and lc.channel_mode='translation_audio'
         and tj.status='succeeded'
         and tj.channel_mode='translation_audio'
         and tj.translated_text is not null
         and length(btrim(tj.translated_text)) > 0
         and lower(lc.language_code)=lower(sj.target_language_code)
         and sj.source_text_hash=encode(digest(tj.translated_text,'sha256'),'hex')
         and sj.attempts < $3
         and (
           sj.voice_profile_id is null
           or exists (
             select 1 from voice_profiles vp
             where vp.id=sj.voice_profile_id
               and vp.organization_id=sj.organization_id
               and vp.consent_status='consented'
               and vp.consented_at is not null
               and vp.revoked_at is null
               and vp.provider_voice_id is not null
           )
         )
         and (
           (sj.status in ('pending','failed') and coalesce(sj.next_attempt_at,'-infinity'::timestamptz) <= clock_timestamp())
           or (sj.status='processing' and sj.lease_expires_at is not null and sj.lease_expires_at <= clock_timestamp())
         )
       order by case when s.status='live' then 0 when s.status='ready' then 1 else 2 end,
                ts.source_observed_at desc,sj.created_at desc,sj.id desc
       for update of sj skip locked
       limit $1
     ), claimed as (
       update speech_synthesis_jobs sj
       set status='processing',worker_id=$2,lease_token=gen_random_uuid(),
           claimed_at=clock_timestamp(),lease_expires_at=clock_timestamp()+make_interval(secs=>$4),
           next_attempt_at=null,attempts=sj.attempts+1,updated_at=clock_timestamp(),error_code=null
       from candidates c
       where sj.id=c.id
       returning sj.*
     )
     select c.id::text,c.lease_token::text,c.worker_id,c.organization_id::text,
            s.id::text as service_id,c.translation_job_id::text,c.language_channel_id::text,
            c.target_language_code,tj.translated_text as source_text,c.source_text_hash,
            c.voice_profile_id::text,vp.provider as voice_provider,vp.provider_voice_id,
            c.attempts,c.lease_expires_at::text
     from claimed c
     join transcript_translation_jobs tj on tj.id=c.translation_job_id
     join transcript_segments ts on ts.id=tj.transcript_segment_id
     join services s on s.id=ts.service_id
     left join voice_profiles vp
       on vp.id=c.voice_profile_id and vp.organization_id=c.organization_id
     order by ts.source_observed_at desc,c.id desc`,
    [limit, workerId, TTS_MAX_ATTEMPTS, leaseSeconds]
  );
  return result.rows;
}

async function lockActiveTtsLease(
  client: PoolClient,
  jobId: string,
  leaseToken: string
): Promise<LockedTtsJob | null> {
  const locked = await client.query<LockedTtsJob>(
    `select sj.id::text,sj.status,sj.lease_token::text,sj.lease_expires_at::text,sj.worker_id,
            sj.organization_id::text,s.id::text as service_id,sj.language_channel_id::text,
            sj.target_language_code,sj.attempts
     from speech_synthesis_jobs sj
     join transcript_translation_jobs tj on tj.id=sj.translation_job_id
     join transcript_segments ts on ts.id=tj.transcript_segment_id
     join services s on s.id=ts.service_id and s.organization_id=sj.organization_id
     join language_channels lc on lc.id=sj.language_channel_id and lc.organization_id=sj.organization_id
     where sj.id=$1
       and tj.status='succeeded'
       and tj.channel_mode='translation_audio'
       and tj.translated_text is not null
       and length(btrim(tj.translated_text)) > 0
       and sj.source_text_hash=encode(digest(tj.translated_text,'sha256'),'hex')
       and lc.enabled=true
       and lc.channel_mode='translation_audio'
       and lower(lc.language_code)=lower(sj.target_language_code)
       and (
         sj.voice_profile_id is null
         or exists (
           select 1 from voice_profiles vp
           where vp.id=sj.voice_profile_id
             and vp.organization_id=sj.organization_id
             and vp.consent_status='consented'
             and vp.consented_at is not null
             and vp.revoked_at is null
             and vp.provider_voice_id is not null
         )
       )
     for update of sj`,
    [jobId]
  );
  const row = locked.rows[0];
  if (!row || row.status !== "processing" || !row.lease_token || !row.lease_expires_at) return null;
  if (row.lease_token.toLowerCase() !== leaseToken.toLowerCase()) return null;
  const expiresAt = Date.parse(row.lease_expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  return row;
}

export async function completeTtsJob(
  client: PoolClient,
  jobId: string,
  leaseToken: string,
  provider: string,
  audioStorageKey: string,
  audioContentType: string,
  durationMs: number
) {
  const row = await lockActiveTtsLease(client, jobId, leaseToken);
  if (!row) return null;
  await client.query(
    `update speech_synthesis_jobs
     set status='succeeded',provider=$2,audio_storage_key=$3,audio_content_type=$4,duration_ms=$5,
         error_code=null,completed_at=clock_timestamp(),updated_at=clock_timestamp(),
         lease_token=null,lease_expires_at=null,next_attempt_at=null
     where id=$1`,
    [jobId, provider, audioStorageKey, audioContentType, durationMs]
  );
  return row;
}

export async function failTtsJob(
  client: PoolClient,
  jobId: string,
  leaseToken: string,
  errorCode: string
) {
  const row = await lockActiveTtsLease(client, jobId, leaseToken);
  if (!row) return null;
  const retryScheduled = row.attempts < TTS_MAX_ATTEMPTS;
  const status = retryScheduled ? "pending" : "failed";
  const backoffSeconds = Math.min(60, 2 ** row.attempts);
  await client.query(
    `update speech_synthesis_jobs
     set status=$2,error_code=$3,updated_at=clock_timestamp(),lease_token=null,lease_expires_at=null,
         next_attempt_at=case when $4::boolean then clock_timestamp()+make_interval(secs=>$5) else null end,
         completed_at=case when $4::boolean then null else clock_timestamp() end
     where id=$1`,
    [jobId, status, errorCode, retryScheduled, backoffSeconds]
  );
  return { ...row, status, retry_scheduled: retryScheduled };
}
