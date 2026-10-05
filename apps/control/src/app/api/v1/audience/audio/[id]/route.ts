import { z } from "zod";
import { query } from "@/lib/db";
import { readStoredTtsAsset, readStoredTtsAssetRange, verifyStoredTtsAsset } from "@/lib/tts-audio-storage";

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

  const metadata = await verifyStoredTtsAsset(row.audio_storage_key, row.id, row.audio_content_type);
  if (!metadata) return new Response("Audio not available", { status: 404 });

  const baseHeaders = {
    "Content-Type": metadata.contentType,
    "Cache-Control": "private, no-store, max-age=0",
    Pragma: "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Disposition": "inline",
    "Accept-Ranges": "bytes"
  };

  const range = request.headers.get("range")?.trim();
  if (!range) {
    const asset = await readStoredTtsAsset(row.audio_storage_key, row.id, row.audio_content_type);
    if (!asset) return new Response("Audio not available", { status: 404 });
    return new Response(new Uint8Array(asset.data), {
      status: 200,
      headers: { ...baseHeaders, "Content-Length": String(asset.size) }
    });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    return new Response(null, { status: 416, headers: { ...baseHeaders, "Content-Range": `bytes */${metadata.size}` } });
  }

  let start: number;
  let end: number;
  const startText = match[1];
  const endText = match[2];
  if (!startText && !endText) {
    return new Response(null, { status: 416, headers: { ...baseHeaders, "Content-Range": `bytes */${metadata.size}` } });
  }
  if (!startText) {
    const suffix = Number(endText);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) {
      return new Response(null, { status: 416, headers: { ...baseHeaders, "Content-Range": `bytes */${metadata.size}` } });
    }
    start = Math.max(0, metadata.size - suffix);
    end = metadata.size - 1;
  } else {
    start = Number(startText);
    if (!Number.isSafeInteger(start) || start < 0 || start >= metadata.size) {
      return new Response(null, { status: 416, headers: { ...baseHeaders, "Content-Range": `bytes */${metadata.size}` } });
    }
    end = endText ? Number(endText) : metadata.size - 1;
    if (!Number.isSafeInteger(end) || end < start) {
      return new Response(null, { status: 416, headers: { ...baseHeaders, "Content-Range": `bytes */${metadata.size}` } });
    }
    end = Math.min(end, metadata.size - 1);
  }

  const asset = await readStoredTtsAssetRange(row.audio_storage_key, row.id, row.audio_content_type, start, end);
  if (!asset) return new Response("Audio not available", { status: 404 });

  return new Response(new Uint8Array(asset.data), {
    status: 206,
    headers: {
      ...baseHeaders,
      "Content-Length": String(asset.data.length),
      "Content-Range": `bytes ${asset.start}-${asset.end}/${asset.size}`
    }
  });
}
