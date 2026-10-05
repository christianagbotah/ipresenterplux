import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
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

const bodySchema = z.discriminatedUnion("action", [consentSchema, revokeSchema]);
type RouteContext = { params: Promise<{ id: string }> };

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
        consent_status: "pending" | "consented" | "revoked";
      }>(
        `select id::text,display_name,consent_status
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
          [
            payload.organizationId,
            session.user.id,
            id,
            JSON.stringify({ method: payload.method, reference: payload.reference })
          ]
        );
        await client.query("commit");
        return NextResponse.json({ ok: true, state: "consented" });
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
      const invalidated = await client.query(
        `update speech_synthesis_jobs
         set status='failed',error_code='voice_consent_revoked',worker_id=null,lease_token=null,
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
