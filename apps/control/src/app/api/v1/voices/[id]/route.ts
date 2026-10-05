import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import type { PoolClient } from "pg";
import { publishServiceEvent } from "@/lib/realtime";
import { VOICE_ADMIN_ROLES, userHasAnyRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const consentSchema = z.object({
  action: z.literal("record_consent"),
  organizationId: z.string().uuid(),
  method: z.enum(["written", "recorded_verbal"]),
  reference: z.string().trim().min(3).max(240)
});

const revokeSchema = z.object({
  action: z.literal("revoke"),
  organizationId: z.string().uuid(),
  reason: z.string().trim().min(3).max(240)
});

const bindProviderSchema = z.object({
  action: z.literal("bind_provider"),
  organizationId: z.string().uuid(),
  provider: z.literal("google"),
  providerVoiceId: z.string().trim().min(3).max(128).regex(/^[A-Za-z0-9._:-]+$/)
});

const unbindProviderSchema = z.object({
  action: z.literal("unbind_provider"),
  organizationId: z.string().uuid()
});

const bodySchema = z.discriminatedUnion("action", [
  consentSchema,
  revokeSchema,
  bindProviderSchema,
  unbindProviderSchema
]);
type RouteContext = { params: Promise<{ id: string }> };

async function resetSynthesisJobsForVoice(
  client: PoolClient,
  organizationId: string,
  profileId: string,
  sourceSpeakerId: string,
  useProfile: boolean
) {
  return client.query(
    `update speech_synthesis_jobs sj
     set voice_profile_id=case when $4::boolean then $2::uuid else null end,
         status='pending',provider=null,audio_storage_key=null,audio_content_type=null,duration_ms=null,
         error_code=null,attempts=0,worker_id=null,lease_token=null,lease_expires_at=null,
         next_attempt_at=null,claimed_at=null,completed_at=null,updated_at=clock_timestamp()
     from transcript_translation_jobs tj
     join transcript_segments ts on ts.id=tj.transcript_segment_id
     join services s on s.id=ts.service_id and s.organization_id=sj.organization_id
     where sj.translation_job_id=tj.id
       and sj.organization_id=$1
       and s.status in ('live','ready')
       and ts.speaker_id is not null
       and lower(ts.speaker_id)=lower($3)
       and tj.status='succeeded' and tj.channel_mode='translation_audio'
     returning s.id::text as service_id`,
    [organizationId, profileId, sourceSpeakerId, useProfile]
  );
}

async function publishTtsRefreshes(rows: Array<{ service_id?: string }>, reason: string) {
  const serviceIds = [...new Set(rows.map((row) => row.service_id).filter((value): value is string => Boolean(value)))];
  await Promise.allSettled(
    serviceIds.map((serviceId) => publishServiceEvent(serviceId, "tts.failed", { reason }))
  );
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }
  if (session.user.forcePasswordChange) {
    return NextResponse.json({ ok: false, error: "Password change required" }, { status: 403 });
  }

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, error: "Invalid voice profile id" }, { status: 400 });
  }

  try {
    const payload = bodySchema.parse(await request.json());
    const allowed = await userHasAnyRole(session.user.id, payload.organizationId, VOICE_ADMIN_ROLES);
    if (!allowed) {
      return NextResponse.json({ ok: false, error: "You are not allowed to manage voice consent" }, { status: 403 });
    }

    const client = await db.connect();
    try {
      await client.query("begin");
      const locked = await client.query<{
        id: string;
        display_name: string;
        source_speaker_id: string | null;
        consent_status: "pending" | "consented" | "revoked";
        provider: string | null;
        provider_voice_id: string | null;
      }>(
        `select id::text,display_name,source_speaker_id,consent_status,provider,provider_voice_id
         from voice_profiles
         where id=$1 and organization_id=$2
         for update`,
        [id, payload.organizationId]
      );
      const profile = locked.rows[0];
      if (!profile) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "Voice profile not found" }, { status: 404 });
      }

      if (payload.action === "record_consent") {
        if (profile.consent_status !== "pending") {
          await client.query("rollback");
          return NextResponse.json({ ok: false, error: "Only pending profiles can record consent" }, { status: 409 });
        }
        await client.query(
          `update voice_profiles
           set consent_status='consented',consented_at=clock_timestamp(),revoked_at=null,
               consent_method=$3,consent_reference=$4,consent_recorded_by=$5,
               revoked_by=null,revocation_reason=null,updated_at=clock_timestamp()
           where id=$1 and organization_id=$2`,
          [id, payload.organizationId, payload.method, payload.reference, session.user.id]
        );
        await client.query(
          `insert into audit_events
            (organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
           values ($1,'operator',$2,'voice.consent.recorded','voice_profile',$3,$4::jsonb)`,
          [payload.organizationId, session.user.id, id, JSON.stringify({ method: payload.method, reference: payload.reference })]
        );
        await client.query("commit");
        return NextResponse.json({ ok: true, state: "consented" });
      }

      if (payload.action === "bind_provider") {
        if (profile.consent_status !== "consented") {
          await client.query("rollback");
          return NextResponse.json({ ok: false, error: "Provider voices require active speaker consent" }, { status: 409 });
        }
        if (!profile.source_speaker_id) {
          await client.query("rollback");
          return NextResponse.json({ ok: false, error: "A speaker ID is required before binding a personalized voice" }, { status: 409 });
        }
        await client.query(
          `update voice_profiles
           set provider=$3,provider_voice_id=$4,updated_at=clock_timestamp()
           where id=$1 and organization_id=$2`,
          [id, payload.organizationId, payload.provider, payload.providerVoiceId]
        );
        const reset = await resetSynthesisJobsForVoice(
          client,
          payload.organizationId,
          id,
          profile.source_speaker_id,
          true
        );
        await client.query(
          `insert into audit_events
            (organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
           values ($1,'operator',$2,'voice.provider.bound','voice_profile',$3,$4::jsonb)`,
          [
            payload.organizationId,
            session.user.id,
            id,
            JSON.stringify({ provider: payload.provider, regeneratedSynthesisJobs: reset.rowCount ?? 0 })
          ]
        );
        await client.query("commit");
        await publishTtsRefreshes(reset.rows, "voice_provider_changed");
        return NextResponse.json({ ok: true, state: "bound", regeneratedSynthesisJobs: reset.rowCount ?? 0 });
      }

      if (payload.action === "unbind_provider") {
        if (profile.consent_status !== "consented" || !profile.provider_voice_id || !profile.source_speaker_id) {
          await client.query("rollback");
          return NextResponse.json({ ok: false, error: "No active personalized provider voice is bound" }, { status: 409 });
        }
        await client.query(
          `update voice_profiles
           set provider=null,provider_voice_id=null,updated_at=clock_timestamp()
           where id=$1 and organization_id=$2`,
          [id, payload.organizationId]
        );
        const reset = await resetSynthesisJobsForVoice(
          client,
          payload.organizationId,
          id,
          profile.source_speaker_id,
          false
        );
        await client.query(
          `insert into audit_events
            (organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
           values ($1,'operator',$2,'voice.provider.unbound','voice_profile',$3,$4::jsonb)`,
          [payload.organizationId, session.user.id, id, JSON.stringify({ regeneratedSynthesisJobs: reset.rowCount ?? 0 })]
        );
        await client.query("commit");
        await publishTtsRefreshes(reset.rows, "voice_provider_changed");
        return NextResponse.json({ ok: true, state: "unbound", regeneratedSynthesisJobs: reset.rowCount ?? 0 });
      }

      if (profile.consent_status !== "consented") {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "Only consented profiles can be revoked" }, { status: 409 });
      }

      await client.query(
        `update voice_profiles
         set consent_status='revoked',revoked_at=clock_timestamp(),revoked_by=$3,
             revocation_reason=$4,provider=null,provider_voice_id=null,updated_at=clock_timestamp()
         where id=$1 and organization_id=$2`,
        [id, payload.organizationId, session.user.id, payload.reason]
      );
      const overriddenServices = await client.query<{ service_id: string }>(
        `delete from service_speaker_overrides
         where organization_id=$1 and voice_profile_id=$2
         returning service_id::text`,
        [payload.organizationId, id]
      );
      const affectedServices = await client.query<{ service_id: string }>(
        `select distinct ts.service_id::text
         from speech_synthesis_jobs sj
         join transcript_translation_jobs tj on tj.id=sj.translation_job_id
         join transcript_segments ts on ts.id=tj.transcript_segment_id
         where sj.organization_id=$1 and sj.voice_profile_id=$2
           and sj.status in ('pending','processing','failed','succeeded')`,
        [payload.organizationId, id]
      );
      const invalidated = await client.query(
        `update speech_synthesis_jobs
         set status='failed',provider=null,audio_storage_key=null,audio_content_type=null,duration_ms=null,
             error_code='voice_consent_revoked',worker_id=null,lease_token=null,
             lease_expires_at=null,next_attempt_at=null,completed_at=clock_timestamp(),updated_at=clock_timestamp()
         where organization_id=$1 and voice_profile_id=$2 and status in ('pending','processing','failed','succeeded')`,
        [payload.organizationId, id]
      );
      await client.query(
        `insert into audit_events
          (organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
         values ($1,'operator',$2,'voice.consent.revoked','voice_profile',$3,$4::jsonb)`,
        [
          payload.organizationId,
          session.user.id,
          id,
          JSON.stringify({ reason: payload.reason, invalidatedSynthesisJobs: invalidated.rowCount ?? 0 })
        ]
      );
      await client.query("commit");
      await publishTtsRefreshes([...affectedServices.rows, ...overriddenServices.rows], "voice_consent_revoked");
      return NextResponse.json({ ok: true, state: "revoked", invalidatedSynthesisJobs: invalidated.rowCount ?? 0 });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Invalid voice consent request", issues: error.issues }, { status: 400 });
    }
    console.error("Voice consent update failed", error);
    return NextResponse.json({ ok: false, error: "Voice consent could not be updated" }, { status: 500 });
  }
}
