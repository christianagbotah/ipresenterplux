import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { LIVE_OPERATOR_ROLES, userHasAnyRole } from "@/lib/rbac";
import { publishServiceEvent } from "@/lib/realtime";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  voiceProfileId: z.string().uuid().nullable()
});

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
    return NextResponse.json({ ok: false, error: "Invalid service id" }, { status: 400 });
  }

  try {
    const { voiceProfileId } = bodySchema.parse(await request.json());
    const client = await db.connect();
    try {
      await client.query("begin");
      const service = await client.query<{
        id: string;
        organization_id: string;
        title: string;
        status: string;
      }>(
        `select id::text,organization_id::text,title,status
         from services where id=$1`,
        [id]
      );
      const row = service.rows[0];
      if (!row) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "Service not found" }, { status: 404 });
      }

      const allowed = await userHasAnyRole(session.user.id, row.organization_id, LIVE_OPERATOR_ROLES);
      if (!allowed) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "You are not allowed to set the active speaker" }, { status: 403 });
      }
      if (!['ready', 'live'].includes(row.status)) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "Active speaker can only be set for a ready or live service" }, { status: 409 });
      }

      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [id]);
      const previous = await client.query<{
        voice_profile_id: string;
        display_name: string;
        source_speaker_id: string;
      }>(
        `select so.voice_profile_id::text,vp.display_name,vp.source_speaker_id
         from service_speaker_overrides so
         join voice_profiles vp on vp.id=so.voice_profile_id and vp.organization_id=so.organization_id
         where so.service_id=$1`,
        [id]
      );

      let next: { id: string; displayName: string; speakerId: string } | null = null;
      if (voiceProfileId) {
        const voice = await client.query<{
          id: string;
          display_name: string;
          source_speaker_id: string;
        }>(
          `select id::text,display_name,source_speaker_id
           from voice_profiles
           where id=$1 and organization_id=$2
             and consent_status='consented'
             and consented_at is not null and revoked_at is null
             and source_speaker_id is not null and length(btrim(source_speaker_id)) > 0
           limit 1`,
          [voiceProfileId, row.organization_id]
        );
        const profile = voice.rows[0];
        if (!profile) {
          await client.query("rollback");
          return NextResponse.json({ ok: false, error: "Select a consented speaker profile with a speaker ID" }, { status: 409 });
        }

        await client.query(
          `insert into service_speaker_overrides
            (service_id,organization_id,voice_profile_id,set_by,updated_at)
           values ($1,$2,$3,$4,clock_timestamp())
           on conflict (service_id) do update set
             organization_id=excluded.organization_id,
             voice_profile_id=excluded.voice_profile_id,
             set_by=excluded.set_by,
             updated_at=excluded.updated_at`,
          [id, row.organization_id, profile.id, session.user.id]
        );
        next = { id: profile.id, displayName: profile.display_name, speakerId: profile.source_speaker_id };
      } else {
        await client.query("delete from service_speaker_overrides where service_id=$1", [id]);
      }

      await client.query(
        `insert into audit_events
          (organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
         values ($1,'operator',$2,'speaker.override.changed','service',$3,$4::jsonb)`,
        [
          row.organization_id,
          session.user.id,
          id,
          JSON.stringify({
            fromVoiceProfileId: previous.rows[0]?.voice_profile_id ?? null,
            fromSpeakerId: previous.rows[0]?.source_speaker_id ?? null,
            toVoiceProfileId: next?.id ?? null,
            toSpeakerId: next?.speakerId ?? null
          })
        ]
      );
      await client.query("commit");

      await publishServiceEvent(id, "speaker.override.changed", {
        active: Boolean(next),
        voiceProfileId: next?.id ?? null,
        speakerId: next?.speakerId ?? null
      });
      return NextResponse.json({ ok: true, activeSpeaker: next });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Invalid active speaker request", issues: error.issues }, { status: 400 });
    }
    console.error("Active speaker update failed", error);
    return NextResponse.json({ ok: false, error: "Active speaker could not be updated" }, { status: 500 });
  }
}
