import type { PoolClient } from "pg";
import { enqueueSpeechSynthesisJob } from "./speech-synthesis-jobs.ts";
import { requireEntitlementFeature } from "./licensing/entitlement-access.ts";
import { TRANSLATION_OPERATOR_ROLES } from "./role-policy.js";

export class TranslationRecoveryError extends Error {
  readonly httpStatus: number;
  readonly code: string;

  constructor(httpStatus: number, code: string, message: string) {
    super(message);
    this.name = "TranslationRecoveryError";
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

type RecoveryScope = {
  id: string;
  service_id: string;
  organization_id: string;
  status: string;
  channel_mode: string;
  allowed: boolean;
};

async function lockTranslationScope(client: PoolClient, userId: string, jobId: string) {
  const result = await client.query<RecoveryScope>(
    `select j.id::text,ts.service_id::text,s.organization_id::text,j.status,j.channel_mode,
            exists(
              select 1 from user_organization_roles uor
              where uor.user_id=$2 and uor.organization_id=s.organization_id
                and uor.role_id=any($3::text[])
            ) as allowed
       from transcript_translation_jobs j
       join transcript_segments ts on ts.id=j.transcript_segment_id
       join services s on s.id=ts.service_id
       join language_channels lc on lc.id=j.language_channel_id and lc.organization_id=s.organization_id
      where j.id=$1
      for update of j`,
    [jobId, userId, [...TRANSLATION_OPERATOR_ROLES]]
  );
  const row = result.rows[0];
  if (!row) throw new TranslationRecoveryError(404, "translation_job_not_found", "Translation job not found");
  if (!row.allowed) throw new TranslationRecoveryError(403, "translation_retry_forbidden", "You are not allowed to retry this translation job");
  return row;
}

export async function retryTranslationJob(client: PoolClient, userId: string, jobId: string) {
  const row = await lockTranslationScope(client, userId, jobId);
  await requireEntitlementFeature(row.organization_id, "translations.text", { client });
  if (row.status !== "failed") {
    throw new TranslationRecoveryError(409, "translation_retry_not_terminal", "Only a failed translation job can be retried");
  }

  const updated = await client.query<{ id:string; status:string; attempts:number; service_id:string; organization_id:string; language_channel_id:string; target_language_code:string }>(
    `update transcript_translation_jobs j
        set status='pending',translated_text=null,provider=null,error_code=null,attempts=0,
            worker_id=null,lease_token=null,lease_expires_at=null,next_attempt_at=null,
            claimed_at=null,completed_at=null,updated_at=clock_timestamp()
       from transcript_segments ts,services s
      where j.id=$1 and ts.id=j.transcript_segment_id and s.id=ts.service_id
      returning j.id::text,j.status,j.attempts,ts.service_id::text,s.organization_id::text,
                j.language_channel_id::text,j.target_language_code`,
    [jobId]
  );
  const retried = updated.rows[0];
  if (!retried) throw new TranslationRecoveryError(409, "translation_retry_conflict", "Translation job could not be reset for retry");
  await client.query(
    `insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
     values ($1,'operator',$2,'translation.job.retried','transcript_translation_job',$3,$4::jsonb)`,
    [row.organization_id,userId,jobId,JSON.stringify({ from: "failed", to: "pending", attemptsReset: true })]
  );
  return retried;
}

export async function retrySpeechSynthesisForTranslation(client: PoolClient, userId: string, translationJobId: string) {
  const scope = await lockTranslationScope(client, userId, translationJobId);
  if (scope.channel_mode !== "translation_audio" || scope.status !== "succeeded") {
    throw new TranslationRecoveryError(409, "audio_retry_not_ready", "Audio can only be retried after an audio translation succeeds");
  }
  await requireEntitlementFeature(scope.organization_id, "translations.audio", { client });

  const existing = await client.query<{ id:string; status:string; attempts:number }>(
    `select id::text,status,attempts from speech_synthesis_jobs where translation_job_id=$1 for update`,
    [translationJobId]
  );
  if (!existing.rows[0]) throw new TranslationRecoveryError(404, "tts_job_not_found", "Speech synthesis job not found");
  if (existing.rows[0].status !== "failed") {
    throw new TranslationRecoveryError(409, "audio_retry_not_terminal", "Only failed audio synthesis can be retried");
  }

  // Re-evaluate current text/voice binding before resetting a terminal synthesis job.
  const synthesis = await enqueueSpeechSynthesisJob(client, translationJobId);
  if (!synthesis) throw new TranslationRecoveryError(409, "audio_retry_not_ready", "No eligible translated audio is available to synthesize");

  const updated = await client.query<{ id:string; status:string; attempts:number; service_id:string; organization_id:string; language_channel_id:string; target_language_code:string }>(
    `update speech_synthesis_jobs sj
        set status='pending',attempts=0,provider=null,audio_storage_key=null,audio_content_type=null,duration_ms=null,
            error_code=null,worker_id=null,lease_token=null,lease_expires_at=null,next_attempt_at=null,
            claimed_at=null,completed_at=null,updated_at=clock_timestamp()
       from transcript_translation_jobs tj,transcript_segments ts,services s
      where sj.translation_job_id=$1 and tj.id=sj.translation_job_id and ts.id=tj.transcript_segment_id and s.id=ts.service_id
      returning sj.id::text,sj.status,sj.attempts,ts.service_id::text,s.organization_id::text,
                sj.language_channel_id::text,sj.target_language_code`,
    [translationJobId]
  );
  const retried = updated.rows[0];
  if (!retried) throw new TranslationRecoveryError(409, "audio_retry_conflict", "Speech synthesis job could not be reset for retry");
  await client.query(
    `insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
     values ($1,'operator',$2,'tts.job.retried','transcript_translation_job',$3,$4::jsonb)`,
    [scope.organization_id,userId,translationJobId,JSON.stringify({ synthesisJobId: retried.id, to: "pending", attemptsReset: true })]
  );
  return retried;
}
