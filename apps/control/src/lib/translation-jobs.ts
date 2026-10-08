import type { PoolClient } from "pg";
import { requireEntitlementFeature } from "./licensing/entitlement-access.ts";

export type TranslationJobSummary = {
  id: string;
  language_channel_id: string;
  target_language_code: string;
  channel_mode: "translation_text" | "translation_audio";
  status: "pending" | "processing" | "succeeded" | "failed";
};

export async function enqueueTranslationJobs(
  client: PoolClient,
  transcriptSegmentId: string,
  organizationId: string,
  sourceLanguage?: string | null
) {
  await requireEntitlementFeature(organizationId, "translations.text", { client });
  const sourceCode = sourceLanguage?.trim().toLowerCase() || null;
  const created = await client.query<TranslationJobSummary>(
    `insert into transcript_translation_jobs
      (transcript_segment_id,language_channel_id,target_language_code,channel_mode)
     select $1,lc.id,lc.language_code,lc.channel_mode
     from language_channels lc
     where lc.organization_id=$2
       and lc.enabled=true
       and lc.channel_mode in ('translation_text','translation_audio')
       and ($3::text is null or lower(lc.language_code) <> $3)
     on conflict (transcript_segment_id,language_channel_id) do nothing
     returning id::text,language_channel_id::text,target_language_code,channel_mode,status`,
    [transcriptSegmentId, organizationId, sourceCode]
  );
  return created.rows;
}
