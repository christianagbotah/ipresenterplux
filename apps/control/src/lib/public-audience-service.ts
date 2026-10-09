import type { PoolClient } from "pg";

type QueryClient = Pick<PoolClient, "query">;

export type PublicAudienceServiceIdentity = {
  id: string;
  title: string;
  status: string;
};

export type PublicAudienceLanguage = {
  id: string;
  code: string;
  name: string;
  mode: string;
  listeners: number;
};

export type PublicAudienceScripture = {
  reference: string;
  source_text: string | null;
  passage_text: string | null;
};

export type PublicAudienceTranscript = {
  id: string;
  text: string;
  source_language: string | null;
  translations: Record<string, string>;
  speech_synthesis: Record<string, "pending" | "processing" | "succeeded" | "failed">;
};

export type PublicAudienceIdentityPayload = {
  service: PublicAudienceServiceIdentity;
};

export type PublicAudienceLivePayload = PublicAudienceIdentityPayload & {
  languages: PublicAudienceLanguage[];
  scripture: PublicAudienceScripture | null;
  transcript: PublicAudienceTranscript | null;
};

export async function loadPublicAudienceService(
  client: QueryClient,
  serviceId: string
): Promise<PublicAudienceIdentityPayload | PublicAudienceLivePayload | null> {
  const services = await client.query<{
    id: string;
    organization_id: string;
    title: string;
    status: string;
  }>(
    `select id::text,organization_id::text,title,status
     from services
     where id=$1::uuid
     limit 1`,
    [serviceId]
  );
  const row = services.rows[0];
  if (!row) return null;

  const service = { id: row.id, title: row.title, status: row.status };
  if (row.status !== "live") return { service };

  const languages = await client.query<PublicAudienceLanguage>(
      `select id::text,language_code as code,language_name as name,channel_mode as mode,listener_count as listeners
       from language_channels
       where organization_id=$1::uuid and enabled=true
       order by case channel_mode
         when 'original' then 0
         when 'captions' then 1
         when 'translation_audio' then 2
         else 3
       end,language_name`,
      [row.organization_id]
    );

  const scripture = await client.query<PublicAudienceScripture>(
      `select sd.scripture_reference as reference,sd.source_text,
              (select string_agg(bv.text,' ' order by bv.verse)
               from bible_books bb
               join bible_verses bv on bv.version_id=bb.version_id and bv.book_code=bb.book_code
               where bb.version_id=sd.bible_version
                 and lower(bb.canonical_name)=lower(sd.book)
                 and bv.chapter=sd.chapter
                 and (sd.verse_start is null or bv.verse between sd.verse_start and coalesce(sd.verse_end,sd.verse_start))) as passage_text
       from scripture_detections sd
       where sd.service_id=$1::uuid and sd.state='live'
       order by sd.source_observed_at desc,sd.source_ordinal desc,sd.detected_at desc,sd.id desc
       limit 1`,
      [serviceId]
    );

  const transcript = await client.query<PublicAudienceTranscript>(
      `select ts.id::text,ts.text,ts.source_language,
              coalesce((
                select jsonb_object_agg(j.language_channel_id::text,j.translated_text)
                from transcript_translation_jobs j
                join language_channels lc on lc.id=j.language_channel_id
                where j.transcript_segment_id=ts.id
                  and j.status='succeeded'
                  and j.translated_text is not null
                  and lc.enabled=true
                  and lc.organization_id=$2::uuid
              ),'{}'::jsonb) as translations,
              coalesce((
                select jsonb_object_agg(sj.language_channel_id::text,sj.status)
                from speech_synthesis_jobs sj
                join transcript_translation_jobs j on j.id=sj.translation_job_id
                join language_channels lc on lc.id=sj.language_channel_id
                where j.transcript_segment_id=ts.id
                  and j.channel_mode='translation_audio'
                  and lc.enabled=true
                  and lc.organization_id=$2::uuid
                  and sj.organization_id=$2::uuid
              ),'{}'::jsonb) as speech_synthesis
       from transcript_segments ts
       where ts.service_id=$1::uuid
       order by ts.source_observed_at desc,ts.created_at desc,ts.id desc
       limit 1`,
      [serviceId, row.organization_id]
    );

  return {
    service,
    languages: languages.rows,
    scripture: scripture.rows[0] ?? null,
    transcript: transcript.rows[0] ?? null
  };
}
