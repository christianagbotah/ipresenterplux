import { z } from "zod";
import { query } from "@/lib/db";
import { readStoredTtsAsset } from "@/lib/tts-audio-storage";

export const dynamic = "force-dynamic";

const uuid = z.string().uuid();
type RouteContext = { params: Promise<{ id: string }> };

type AudioRow = {
  id: string;
  audio_storage_key: string;
  audio_content_type: string;
};

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const serviceId = url.searchParams.get("serviceId");
  const channelId = url.searchParams.get("channelId");

  if (!uuid.safeParse(id).success || !serviceId || !uuid.safeParse(serviceId).success || !channelId || !uuid.safeParse(channelId).success) {
    return new Response("Invalid audio request", { status: 400 });
  }

  const result = await query<AudioRow>(
    `select sj.id::text,sj.audio_storage_key,sj.audio_content_type
     from speech_synthesis_jobs sj
     join transcript_translation_jobs tj on tj.id=sj.translation_job_id
     join transcript_segments ts on ts.id=tj.transcript_segment_id
     join services s on s.id=ts.service_id
     join language_channels lc on lc.id=sj.language_channel_id
     where sj.id=$1
       and s.id=$2
       and s.status='live'
       and sj.language_channel_id=$3
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
     limit 1`,
    [id, serviceId, channelId]
  );

  const row = result.rows[0];
  if (!row) return new Response("Audio not found", { status: 404 });

  const asset = await readStoredTtsAsset(row.audio_storage_key, row.id, row.audio_content_type);
  if (!asset) return new Response("Audio not available", { status: 404 });

  return new Response(new Uint8Array(asset.data), {
    status: 200,
    headers: {
      "Content-Type": asset.contentType,
      "Content-Length": String(asset.size),
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Disposition": "inline"
    }
  });
}
