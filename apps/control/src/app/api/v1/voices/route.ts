import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { VOICE_ADMIN_ROLES, userHasAnyRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  organizationId: z.string().uuid(),
  displayName: z.string().trim().min(2).max(120),
  sourceSpeakerId: z.string().trim().min(1).max(120).nullable().optional()
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }
  if (session.user.forcePasswordChange) {
    return NextResponse.json({ ok: false, error: "Password change required" }, { status: 403 });
  }

  try {
    const payload = createSchema.parse(await request.json());
    const allowed = await userHasAnyRole(session.user.id, payload.organizationId, VOICE_ADMIN_ROLES);
    if (!allowed) {
      return NextResponse.json({ ok: false, error: "You are not allowed to manage voice consent" }, { status: 403 });
    }

    const client = await db.connect();
    try {
      await client.query("begin");
      const created = await client.query<{
        id: string;
        display_name: string;
        source_speaker_id: string | null;
        consent_status: string;
        created_at: string;
      }>(
        `insert into voice_profiles
          (organization_id,display_name,source_speaker_id,consent_status,created_by)
         values ($1,$2,$3,'pending',$4)
         returning id::text,display_name,source_speaker_id,consent_status,created_at::text`,
        [payload.organizationId, payload.displayName, payload.sourceSpeakerId ?? null, session.user.id]
      );

      await client.query(
        `insert into audit_events
          (organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
         values ($1,'operator',$2,'voice.profile.created','voice_profile',$3,$4::jsonb)`,
        [
          payload.organizationId,
          session.user.id,
          created.rows[0].id,
          JSON.stringify({ displayName: payload.displayName })
        ]
      );
      await client.query("commit");
      return NextResponse.json({ ok: true, profile: created.rows[0] }, { status: 201 });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Invalid voice profile request", issues: error.issues }, { status: 400 });
    }
    console.error("Voice profile creation failed", error);
    return NextResponse.json({ ok: false, error: "Voice profile could not be created" }, { status: 500 });
  }
}
