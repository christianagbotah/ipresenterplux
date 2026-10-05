import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { TRANSLATION_OPERATOR_ROLES } from "@/lib/rbac";
import { publishServiceEvent } from "@/lib/realtime";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  translatedText: z.string().trim().min(1).max(20_000),
  provider: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/).optional()
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

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
    return NextResponse.json({ ok: false, error: "Invalid translation job id" }, { status: 400 });
  }

  try {
    const { translatedText, provider = "manual" } = bodySchema.parse(await request.json());
    const client = await db.connect();
    try {
      await client.query("begin");
      const scope = await client.query<{
        service_id: string;
        organization_id: string;
      }>(
        `select ts.service_id::text,s.organization_id::text
         from transcript_translation_jobs j
         join transcript_segments ts on ts.id=j.transcript_segment_id
         join services s on s.id=ts.service_id
         join language_channels lc on lc.id=j.language_channel_id and lc.organization_id=s.organization_id
         where j.id=$1`,
        [id]
      );
      if (!scope.rowCount) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "Translation job not found" }, { status: 404 });
      }

      const membership = await client.query<{ allowed: boolean }>(
        `select exists(
           select 1 from user_organization_roles
           where user_id=$1 and organization_id=$2 and role_id=any($3::text[])
         ) as allowed`,
        [session.user.id, scope.rows[0].organization_id, [...TRANSLATION_OPERATOR_ROLES]]
      );
      if (!membership.rows[0]?.allowed) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "You are not allowed to complete translation jobs" }, { status: 403 });
      }

      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [scope.rows[0].service_id]);
      const target = await client.query<{
        id: string;
        status: string;
        language_channel_id: string;
        target_language_code: string;
        channel_mode: string;
        provider: string | null;
      }>(
        `select j.id::text,j.status,j.language_channel_id::text,j.target_language_code,j.channel_mode,j.provider
         from transcript_translation_jobs j
         join transcript_segments ts on ts.id=j.transcript_segment_id
         join services s on s.id=ts.service_id
         join language_channels lc on lc.id=j.language_channel_id and lc.organization_id=s.organization_id
         where j.id=$1 and ts.service_id=$2
         for update of j`,
        [id, scope.rows[0].service_id]
      );
      if (!target.rowCount) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "Translation job not found" }, { status: 404 });
      }

      const row = target.rows[0];
      const updated = await client.query<{
        id: string;
        status: string;
        language_channel_id: string;
        target_language_code: string;
        channel_mode: string;
        translated_text: string;
        provider: string;
        completed_at: string;
      }>(
        `update transcript_translation_jobs
         set status='succeeded',translated_text=$2,provider=$3,error_code=null,
             attempts=attempts+1,completed_at=now(),updated_at=now()
         where id=$1
         returning id::text,status,language_channel_id::text,target_language_code,channel_mode,
                   translated_text,provider,completed_at::text`,
        [id, translatedText, provider]
      );

      await client.query(
        `insert into audit_events
          (organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
         values ($1,'operator',$2,'translation.job.completed','transcript_translation_job',$3,$4::jsonb)`,
        [
          scope.rows[0].organization_id,
          session.user.id,
          id,
          JSON.stringify({
            from: row.status,
            targetLanguageCode: row.target_language_code,
            channelMode: row.channel_mode,
            provider
          })
        ]
      );

      await client.query("commit");
      await publishServiceEvent(scope.rows[0].service_id, "translation.completed", {
        id,
        languageChannelId: row.language_channel_id,
        targetLanguageCode: row.target_language_code,
        channelMode: row.channel_mode
      });
      return NextResponse.json({ ok: true, job: updated.rows[0] });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Invalid translation result", issues: error.issues }, { status: 400 });
    }
    console.error("Translation job completion failed", error);
    return NextResponse.json({ ok: false, error: "Translation job could not be completed" }, { status: 500 });
  }
}
