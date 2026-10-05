import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

const uuid = z.string().uuid();

type QueueRow = {
  id: string;
  source_observed_at: string;
  duration_ms: number;
};

const baseReadySql = `
  from speech_synthesis_jobs sj
  join transcript_translation_jobs tj on tj.id=sj.translation_job_id
  join transcript_segments ts on ts.id=tj.transcript_segment_id
  join services s on s.id=ts.service_id
  join language_channels lc on lc.id=sj.language_channel_id
  where s.id=$1
    and s.status='live'
    and sj.language_channel_id=$2
    and sj.organization_id=s.organization_id
    and lc.organization_id=s.organization_id
    and lc.enabled=true
    and lc.channel_mode='translation_audio'
    and tj.language_channel_id=lc.id
    and tj.status='succeeded'
    and tj.channel_mode='translation_audio'
    and lower(tj.target_language_code)=lower(lc.language_code)
    and tj.translated_text is not null
    and length(btrim(tj.translated_text)) > 0
    and sj.source_text_hash=encode(digest(tj.translated_text,'sha256'),'hex')
    and sj.status='succeeded'
    and sj.audio_storage_key is not null
    and sj.audio_content_type in ('audio/mpeg','audio/wav','audio/ogg')
    and sj.duration_ms is not null
    and sj.completed_at is not null
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
`;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const serviceId = url.searchParams.get("serviceId");
  const channelId = url.searchParams.get("channelId");
  const after = url.searchParams.get("after");

  if (!serviceId || !uuid.safeParse(serviceId).success || !channelId || !uuid.safeParse(channelId).success) {
    return NextResponse.json({ ok: false, error: "Invalid service or language channel" }, { status: 400 });
  }
  if (after && !uuid.safeParse(after).success) {
    return NextResponse.json({ ok: false, error: "Invalid audio cursor" }, { status: 400 });
  }

  const channel = await query<{ id: string }>(
    `select lc.id::text
     from services s
     join language_channels lc on lc.organization_id=s.organization_id
     where s.id=$1 and s.status='live'
       and lc.id=$2 and lc.enabled=true and lc.channel_mode='translation_audio'
     limit 1`,
    [serviceId, channelId]
  );
  if (!channel.rowCount) {
    return NextResponse.json({ ok: false, error: "Live audio channel not found" }, { status: 404 });
  }

  let rows: QueueRow[] = [];
  if (!after) {
    const latest = await query<QueueRow>(
      `select sj.id::text,ts.source_observed_at::text,sj.duration_ms
       ${baseReadySql}
       order by ts.source_observed_at desc,ts.created_at desc,sj.id desc
       limit 1`,
      [serviceId, channelId]
    );
    rows = latest.rows.reverse();
  } else {
    const cursor = await query<{ completed_at: string; id: string }>(
      `select sj.completed_at::text,sj.id::text
       ${baseReadySql}
         and sj.id=$3
       limit 1`,
      [serviceId, channelId, after]
    );
    if (!cursor.rowCount) {
      return NextResponse.json({ ok: false, error: "Audio cursor not found" }, { status: 404 });
    }
    const next = await query<QueueRow>(
      `select sj.id::text,ts.source_observed_at::text,sj.duration_ms
       ${baseReadySql}
         and (sj.completed_at,sj.id) > ($3::timestamptz,$4::uuid)
       order by sj.completed_at asc,sj.id asc
       limit 20`,
      [serviceId, channelId, cursor.rows[0].completed_at, cursor.rows[0].id]
    );
    rows = next.rows;
  }

  return NextResponse.json(
    {
      ok: true,
      items: rows.map((row) => ({
        id: row.id,
        observedAt: row.source_observed_at,
        durationMs: row.duration_ms
      })),
      cursor: rows.at(-1)?.id ?? after ?? null
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
