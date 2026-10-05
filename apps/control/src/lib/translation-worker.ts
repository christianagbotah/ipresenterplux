import type { PoolClient } from "pg";

export const TRANSLATION_MAX_ATTEMPTS = 5;

export type ClaimedTranslationJob = {
  id: string;
  lease_token: string;
  worker_id: string;
  organization_id: string;
  service_id: string;
  transcript_segment_id: string;
  source_text: string;
  source_language: string | null;
  language_channel_id: string;
  target_language_code: string;
  channel_mode: "translation_text" | "translation_audio";
  attempts: number;
  lease_expires_at: string;
};

type LockedTranslationJob = {
  id: string;
  status: string;
  lease_token: string | null;
  lease_expires_at: string | null;
  worker_id: string | null;
  organization_id: string;
  service_id: string;
  language_channel_id: string;
  target_language_code: string;
  channel_mode: string;
  attempts: number;
};

export async function claimTranslationJobs(
  client: PoolClient,
  workerId: string,
  limit = 4,
  leaseSeconds = 45
) {
  const result = await client.query<ClaimedTranslationJob>(
    `with exhausted_candidates as (
       select id
       from transcript_translation_jobs
       where status='processing' and attempts >= $3
         and lease_expires_at is not null and lease_expires_at <= clock_timestamp()
       order by lease_expires_at asc,id asc
       for update skip locked
       limit 100
     ), exhausted as (
       update transcript_translation_jobs j
       set status='failed',error_code='lease_expired',worker_id=null,lease_token=null,
           lease_expires_at=null,next_attempt_at=null,completed_at=clock_timestamp(),updated_at=clock_timestamp()
       from exhausted_candidates e
       where j.id=e.id
       returning j.id
     ), candidates as (
       select j.id
       from transcript_translation_jobs j
       join transcript_segments ts on ts.id=j.transcript_segment_id
       join services s on s.id=ts.service_id
       join language_channels lc on lc.id=j.language_channel_id
       where lc.organization_id=s.organization_id
         and lc.enabled=true
         and lc.channel_mode=j.channel_mode
         and lower(lc.language_code)=lower(j.target_language_code)
         and j.attempts < $3
         and (
           (j.status in ('pending','failed') and coalesce(j.next_attempt_at,'-infinity'::timestamptz) <= clock_timestamp())
           or (j.status='processing' and j.lease_expires_at is not null and j.lease_expires_at <= clock_timestamp())
         )
       order by case s.status when 'live' then 0 when 'ready' then 1 else 2 end,
                ts.source_observed_at desc,j.created_at desc,j.id desc
       for update of j skip locked
       limit $1
     ), claimed as (
       update transcript_translation_jobs j
       set status='processing',worker_id=$2,lease_token=gen_random_uuid(),
           claimed_at=clock_timestamp(),lease_expires_at=clock_timestamp()+make_interval(secs=>$4),
           next_attempt_at=null,completed_at=null,attempts=j.attempts+1,
           updated_at=clock_timestamp(),error_code=null
       from candidates c
       where j.id=c.id
       returning j.id,j.transcript_segment_id,j.language_channel_id,j.target_language_code,
                 j.channel_mode,j.worker_id,j.lease_token,j.attempts,j.lease_expires_at
     )
     select c.id::text,c.lease_token::text,c.worker_id,
            s.organization_id::text,ts.service_id::text,c.transcript_segment_id::text,
            ts.text as source_text,ts.source_language,c.language_channel_id::text,
            c.target_language_code,c.channel_mode,c.attempts,c.lease_expires_at::text
     from claimed c
     join transcript_segments ts on ts.id=c.transcript_segment_id
     join services s on s.id=ts.service_id
     order by ts.source_observed_at desc,c.id desc`,
    [limit, workerId, TRANSLATION_MAX_ATTEMPTS, leaseSeconds]
  );
  return result.rows;
}

async function lockActiveTranslationLease(
  client: PoolClient,
  jobId: string,
  leaseToken: string
): Promise<LockedTranslationJob | null> {
  const locked = await client.query<LockedTranslationJob>(
    `select j.id::text,j.status,j.lease_token::text,j.lease_expires_at::text,j.worker_id,
            s.organization_id::text,ts.service_id::text,j.language_channel_id::text,
            j.target_language_code,j.channel_mode,j.attempts
     from transcript_translation_jobs j
     join transcript_segments ts on ts.id=j.transcript_segment_id
     join services s on s.id=ts.service_id
     join language_channels lc on lc.id=j.language_channel_id
     where j.id=$1
       and lc.organization_id=s.organization_id
       and lc.enabled=true
       and lc.channel_mode=j.channel_mode
       and lower(lc.language_code)=lower(j.target_language_code)
     for update of j`,
    [jobId]
  );
  const row = locked.rows[0];
  if (!row || row.status !== "processing" || !row.lease_token || !row.lease_expires_at) return null;
  if (row.lease_token.toLowerCase() !== leaseToken.toLowerCase()) return null;
  const expiresAt = Date.parse(row.lease_expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  return row;
}

export async function completeTranslationJob(
  client: PoolClient,
  jobId: string,
  leaseToken: string,
  translatedText: string,
  provider: string
) {
  const row = await lockActiveTranslationLease(client, jobId, leaseToken);
  if (!row) return null;

  await client.query(
    `update transcript_translation_jobs
     set status='succeeded',translated_text=$2,provider=$3,error_code=null,
         completed_at=clock_timestamp(),updated_at=clock_timestamp(),
         lease_token=null,lease_expires_at=null,next_attempt_at=null
     where id=$1`,
    [jobId, translatedText, provider]
  );
  return row;
}

export async function failTranslationJob(
  client: PoolClient,
  jobId: string,
  leaseToken: string,
  errorCode: string
) {
  const row = await lockActiveTranslationLease(client, jobId, leaseToken);
  if (!row) return null;

  const retryScheduled = row.attempts < TRANSLATION_MAX_ATTEMPTS;
  const status = retryScheduled ? "pending" : "failed";
  const backoffSeconds = Math.min(60, 2 ** row.attempts);
  await client.query(
    `update transcript_translation_jobs
     set status=$2,error_code=$3,updated_at=clock_timestamp(),lease_token=null,lease_expires_at=null,
         next_attempt_at=case when $4::boolean then clock_timestamp()+make_interval(secs=>$5) else null end,
         completed_at=case when $4::boolean then null else clock_timestamp() end
     where id=$1`,
    [jobId, status, errorCode, retryScheduled, backoffSeconds]
  );
  return { ...row, status, retry_scheduled: retryScheduled };
}
