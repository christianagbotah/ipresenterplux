import type { PoolClient } from "pg";

export type TranscriptSegmentMetadata = {
  sourceLanguage?: string | null;
  speakerId?: string | null;
  asrConfidence?: number | null;
};

export async function latestTranscriptObservedAt(
  client: PoolClient,
  serviceId: string
) {
  const found = await client.query<{ source_observed_at: string }>(
    `select source_observed_at::text
     from transcript_segments
     where service_id=$1
     order by source_observed_at desc,created_at desc,id desc
     limit 1`,
    [serviceId]
  );
  return found.rows[0]?.source_observed_at ?? null;
}

export async function recordTranscriptSegment(
  client: PoolClient,
  serviceId: string,
  text: string,
  observedAt: Date,
  metadata: TranscriptSegmentMetadata = {}
) {
  const cleanText = text.trim();
  if (!cleanText) return;
  await client.query(
    `insert into transcript_segments
      (service_id,text,source_observed_at,source_language,speaker_id,asr_confidence)
     values ($1,$2,$3,$4,$5,$6)`,
    [
      serviceId,
      cleanText,
      observedAt,
      metadata.sourceLanguage ?? null,
      metadata.speakerId ?? null,
      metadata.asrConfidence ?? null
    ]
  );
}

export async function recentTranscriptQuoteWindow(
  client: PoolClient,
  serviceId: string,
  observedAt: Date
) {
  const rows = await client.query<{ text: string }>(
    `select text from (
       select id,text,source_observed_at,created_at
       from transcript_segments
       where service_id=$1
         and source_observed_at <= $2
         and source_observed_at >= $2::timestamptz - interval '15 seconds'
       order by source_observed_at desc,created_at desc,id desc
       limit 3
     ) recent
     order by source_observed_at asc,created_at asc,id asc`,
    [serviceId, observedAt]
  );
  return rows.rows.map((row) => row.text.trim()).filter(Boolean).join(" ").trim();
}

export async function recentlyDetectedQuote(
  client: PoolClient,
  serviceId: string,
  reference: string,
  observedAt: Date
) {
  const found = await client.query(
    `select 1
     from scripture_detections
     where service_id=$1
       and scripture_reference=$2
       and detection_method='quote'
       and source_observed_at between $3::timestamptz - interval '15 seconds' and $3
     limit 1`,
    [serviceId, reference, observedAt]
  );
  return Boolean(found.rowCount);
}
