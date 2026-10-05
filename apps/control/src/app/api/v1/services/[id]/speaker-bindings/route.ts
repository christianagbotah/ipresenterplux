import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { VOICE_ADMIN_ROLES, userHasAnyRole } from "@/lib/rbac";
import { publishServiceEvent } from "@/lib/realtime";
import { enqueueSpeechSynthesisJob } from "@/lib/speech-synthesis-jobs";

export const dynamic = "force-dynamic";

const speakerIdSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/);
const bodySchema = z.object({
  speakerId: speakerIdSchema,
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
    const payload = bodySchema.parse(await request.json());
    const speakerId = payload.speakerId.toLowerCase();
    const client = await db.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [id]);

      const service = await client.query<{ organization_id: string; status: string }>(
        `select organization_id::text,status from services where id=$1`,
        [id]
      );
      const row = service.rows[0];
      if (!row) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "Service not found" }, { status: 404 });
      }
      const allowed = await userHasAnyRole(session.user.id, row.organization_id, VOICE_ADMIN_ROLES);
      if (!allowed) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "Only owners and administrators can bind detected speakers to synthetic voices" }, { status: 403 });
      }
      if (!['ready', 'live'].includes(row.status)) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "Detected speaker bindings can only be changed for a ready or live service" }, { status: 409 });
      }

      const observed = await client.query<{ observed: boolean }>(
        `select exists(
           select 1 from transcript_segments
           where service_id=$1 and speaker_source='asr'
             and speaker_id is not null and lower(speaker_id)=lower($2)
         ) as observed`,
        [id, speakerId]
      );
      if (!observed.rows[0]?.observed) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "This speaker label has not been observed in the current service" }, { status: 409 });
      }

      const previous = await client.query<{ voice_profile_id: string | null }>(
        `select voice_profile_id::text from service_speaker_voice_bindings
         where service_id=$1 and lower(speaker_id)=lower($2)`,
        [id, speakerId]
      );

      let boundProfile: { id: string; display_name: string } | null = null;
      if (payload.voiceProfileId) {
        const voice = await client.query<{ id: string; display_name: string }>(
          `select id::text,display_name
           from voice_profiles
           where id=$1 and organization_id=$2
             and consent_status='consented'
             and consented_at is not null and revoked_at is null
             and provider is not null and provider_voice_id is not null
           limit 1
           for update`,
          [payload.voiceProfileId, row.organization_id]
        );
        boundProfile = voice.rows[0] ?? null;
        if (!boundProfile) {
          await client.query("rollback");
          return NextResponse.json({ ok: false, error: "Select a consented voice profile with an active provider voice" }, { status: 409 });
        }

        await client.query(
          `insert into service_speaker_voice_bindings
            (service_id,organization_id,speaker_id,voice_profile_id,set_by,updated_at)
           values ($1,$2,$3,$4,$5,clock_timestamp())
           on conflict (service_id,speaker_id) do update set
             organization_id=excluded.organization_id,
             voice_profile_id=excluded.voice_profile_id,
             set_by=excluded.set_by,
             updated_at=excluded.updated_at`,
          [id, row.organization_id, speakerId, boundProfile.id, session.user.id]
        );
      } else {
        await client.query(
          `delete from service_speaker_voice_bindings
           where service_id=$1 and lower(speaker_id)=lower($2)`,
          [id, speakerId]
        );
      }

      const translations = await client.query<{ id: string }>(
        `select j.id::text
         from transcript_translation_jobs j
         join transcript_segments ts on ts.id=j.transcript_segment_id
         where ts.service_id=$1
           and ts.speaker_source='asr'
           and ts.speaker_id is not null and lower(ts.speaker_id)=lower($2)
           and j.status='succeeded' and j.channel_mode='translation_audio'`,
        [id, speakerId]
      );
      for (const translation of translations.rows) {
        await enqueueSpeechSynthesisJob(client, translation.id);
      }

      await client.query(
        `insert into audit_events
          (organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
         values ($1,'operator',$2,'speaker.voice_binding.changed','service',$3,$4::jsonb)`,
        [
          row.organization_id,
          session.user.id,
          id,
          JSON.stringify({
            speakerId,
            fromVoiceProfileId: previous.rows[0]?.voice_profile_id ?? null,
            toVoiceProfileId: boundProfile?.id ?? null,
            regeneratedSynthesisJobs: translations.rowCount ?? 0
          })
        ]
      );
      await client.query("commit");

      await publishServiceEvent(id, "speaker.voice_binding.changed", {
        speakerId,
        bound: Boolean(boundProfile)
      });
      return NextResponse.json({
        ok: true,
        binding: boundProfile ? { speakerId, voiceProfileId: boundProfile.id, displayName: boundProfile.display_name } : null,
        regeneratedSynthesisJobs: translations.rowCount ?? 0
      });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Invalid detected speaker binding request", issues: error.issues }, { status: 400 });
    }
    console.error("Detected speaker voice binding failed", error);
    return NextResponse.json({ ok: false, error: "Detected speaker voice binding could not be updated" }, { status: 500 });
  }
}
