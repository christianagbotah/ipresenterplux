import { query } from "@/lib/db";
import { publishServiceEvent } from "@/lib/realtime";
import { detectScriptureReferences } from "@/lib/scripture";

export type ServiceContext = {
  id: string;
  organization_id: string;
  campus_id: string | null;
  active_bible_version: string;
  auto_preview_threshold: string;
};

export type TranscriptInput = {
  text: string;
  bibleVersion?: string;
};

export async function findServiceById(serviceId: string) {
  const found = await query<ServiceContext>(
    `select id,organization_id::text,campus_id::text,active_bible_version,auto_preview_threshold::text
     from services where id=$1 limit 1`,
    [serviceId]
  );
  return found.rows[0];
}

export async function findActiveServiceForDevice(organizationId: string, campusId: string | null) {
  const found = await query<ServiceContext>(
    `select id,organization_id::text,campus_id::text,active_bible_version,auto_preview_threshold::text
     from services
     where organization_id=$1
       and status in ('live','ready')
       and ($2::uuid is null or campus_id=$2::uuid)
     order by case when status='live' then 0 else 1 end, created_at desc
     limit 1`,
    [organizationId, campusId]
  );
  return found.rows[0];
}

export async function ingestTranscriptForService(service: ServiceContext, payload: TranscriptInput) {
  const matches = detectScriptureReferences(payload.text);
  const inserted = [];

  for (const match of matches) {
    const duplicate = await query<{ id: string }>(
      "select id from scripture_detections where service_id=$1 and scripture_reference=$2 and detected_at > now() - interval '5 seconds' limit 1",
      [service.id, match.reference]
    );
    if (duplicate.rowCount) continue;

    const nextState = match.confidence >= Number(service.auto_preview_threshold) ? "preview" : "detected";

    if (nextState === "preview") {
      await query(
        "update scripture_detections set state='detected' where service_id=$1 and state='preview'",
        [service.id]
      );
    }

    const result = await query<{
      id: string;
      scripture_reference: string;
      confidence: string;
      state: string;
      detected_at: string;
    }>(
      `insert into scripture_detections
        (service_id,scripture_reference,book,chapter,verse_start,verse_end,bible_version,source_text,confidence,state)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       returning id,scripture_reference,confidence::text,state,detected_at::text`,
      [
        service.id,
        match.reference,
        match.book,
        match.chapter,
        match.verseStart,
        match.verseEnd ?? null,
        payload.bibleVersion ?? service.active_bible_version,
        payload.text,
        match.confidence,
        nextState
      ]
    );
    inserted.push(result.rows[0]);
  }

  if (inserted.length) {
    await publishServiceEvent(service.id, "scripture.detected", {
      detections: inserted.map((item) => ({
        id: item.id,
        reference: item.scripture_reference,
        confidence: item.confidence,
        state: item.state
      }))
    });
  }

  return {
    ok: true,
    serviceId: service.id,
    transcript: payload.text,
    detected: matches.length,
    inserted
  };
}
