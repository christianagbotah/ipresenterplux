import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "Invalid service" }, { status: 400 });
  const services = await query<{ id: string; organization_id: string; title: string }>(
    `select id, organization_id::text, title from services where id=$1 and status='live' limit 1`, [id]
  );
  const service = services.rows[0];
  if (!service) return NextResponse.json({ ok: false, error: "Service is not live" }, { status: 404 });
  const [languages, scripture, transcript] = await Promise.all([
    query(`select id,language_code as code,language_name as name,channel_mode as mode,listener_count as listeners from language_channels where organization_id=$1 and enabled=true order by language_name`, [service.organization_id]),
    query(`select sd.scripture_reference as reference,sd.source_text,
                  (select string_agg(bv.text,' ' order by bv.verse)
                   from bible_books bb
                   join bible_verses bv on bv.version_id=bb.version_id and bv.book_code=bb.book_code
                   where bb.version_id=sd.bible_version
                     and lower(bb.canonical_name)=lower(sd.book)
                     and bv.chapter=sd.chapter
                     and (sd.verse_start is null or bv.verse between sd.verse_start and coalesce(sd.verse_end,sd.verse_start))) as passage_text
           from scripture_detections sd
           where sd.service_id=$1 and sd.state='live'
           order by sd.source_observed_at desc,sd.source_ordinal desc,sd.detected_at desc,sd.id desc
           limit 1`, [id]),
    query(`select ts.id::text,ts.text,ts.source_language,coalesce((select jsonb_object_agg(j.language_channel_id::text,j.translated_text) from transcript_translation_jobs j join language_channels lc on lc.id=j.language_channel_id where j.transcript_segment_id=ts.id and j.status='succeeded' and j.translated_text is not null and lc.enabled=true and lc.organization_id=$2),'{}'::jsonb) translations,coalesce((select jsonb_object_agg(sj.language_channel_id::text,sj.status) from speech_synthesis_jobs sj join transcript_translation_jobs j on j.id=sj.translation_job_id join language_channels lc on lc.id=sj.language_channel_id where j.transcript_segment_id=ts.id and j.channel_mode='translation_audio' and lc.enabled=true and lc.organization_id=$2),'{}'::jsonb) speech_synthesis from transcript_segments ts where ts.service_id=$1 order by ts.source_observed_at desc,ts.created_at desc,ts.id desc limit 1`, [id, service.organization_id])
  ]);
  return NextResponse.json(
    { ok: true, service: { id: service.id, title: service.title }, languages: languages.rows, scripture: scripture.rows[0] ?? null, transcript: transcript.rows[0] ?? null },
    { headers: { "Cache-Control": "no-store" } }
  );
}
