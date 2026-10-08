import type { PoolClient } from "pg";
import { BibleLibraryError, resolveLocalScripture } from "./bible-library.ts";

export class ManualScriptureError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 422) {
    super(message);
    this.name = "ManualScriptureError";
    this.code = code;
    this.status = status;
  }
}

type QueryClient = Pick<PoolClient, "query">;

type ManualSelectionInput = {
  serviceId: string;
  reference: string;
  version: string;
  actorId: string;
};

export type ManualScriptureSelection = {
  id: string;
  reference: string;
  state: "detected";
  passageText: string;
  reused: boolean;
};

async function auditManualSelection(
  client: QueryClient,
  input: {
    organizationId: string;
    actorId: string;
    detectionId: string;
    reference: string;
    version: string;
    reused: boolean;
  }
) {
  await client.query(
    `insert into audit_events
      (organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
     values ($1::uuid,'operator',$2,'scripture.manual.selected','scripture_detection',$3::uuid,$4::jsonb)`,
    [
      input.organizationId,
      input.actorId,
      input.detectionId,
      JSON.stringify({ reference: input.reference, version: input.version, detectionMethod: "manual", reused: input.reused })
    ]
  );
}

export async function createManualScriptureDetection(
  client: QueryClient,
  input: ManualSelectionInput
): Promise<ManualScriptureSelection> {
  const serviceResult = await client.query<{
    id: string;
    organization_id: string;
    status: string;
  }>(
    `select id::text,organization_id::text,status
     from services
     where id=$1::uuid
     for update`,
    [input.serviceId]
  );
  const service = serviceResult.rows[0];
  if (!service) {
    throw new ManualScriptureError("service_not_found", "Service not found", 404);
  }
  if (!(["ready", "live"] as string[]).includes(service.status)) {
    throw new ManualScriptureError("service_not_ready", "Service must be ready or live before Scripture can be staged", 409);
  }

  let resolved;
  try {
    resolved = await resolveLocalScripture(client, { reference: input.reference, version: input.version });
  } catch (error) {
    if (error instanceof BibleLibraryError) {
      throw new ManualScriptureError(error.code, error.message, 422);
    }
    throw error;
  }

  const existing = await client.query<{
    id: string;
    scripture_reference: string;
    state: "detected";
  }>(
    `select id::text,scripture_reference,state
     from scripture_detections
     where service_id=$1::uuid
       and bible_version=$2
       and lower(book)=lower($3)
       and chapter=$4
       and verse_start is not distinct from $5::int
       and verse_end is not distinct from $6::int
       and detection_method='manual'
       and state='detected'
     order by source_observed_at desc,detected_at desc,id desc
     limit 1
     for update`,
    [input.serviceId, resolved.version, resolved.book, resolved.chapter, resolved.verseStart, resolved.verseEnd]
  );

  const reusable = existing.rows[0];
  if (reusable) {
    await auditManualSelection(client, {
      organizationId: service.organization_id,
      actorId: input.actorId,
      detectionId: reusable.id,
      reference: reusable.scripture_reference,
      version: resolved.version,
      reused: true
    });
    return {
      id: reusable.id,
      reference: reusable.scripture_reference,
      state: "detected",
      passageText: resolved.passageText,
      reused: true
    };
  }

  const inserted = await client.query<{
    id: string;
    scripture_reference: string;
    state: "detected";
  }>(
    `insert into scripture_detections
      (service_id,scripture_reference,book,chapter,verse_start,verse_end,bible_version,source_text,confidence,state,detection_method,source_observed_at,source_ordinal)
     values ($1::uuid,$2,$3,$4,$5,$6,$7,null,100,'detected','manual',clock_timestamp(),0)
     returning id::text,scripture_reference,state`,
    [
      input.serviceId,
      resolved.reference,
      resolved.book,
      resolved.chapter,
      resolved.verseStart,
      resolved.verseEnd,
      resolved.version
    ]
  );
  const detection = inserted.rows[0];

  await auditManualSelection(client, {
    organizationId: service.organization_id,
    actorId: input.actorId,
    detectionId: detection.id,
    reference: detection.scripture_reference,
    version: resolved.version,
    reused: false
  });

  return {
    id: detection.id,
    reference: detection.scripture_reference,
    state: "detected",
    passageText: resolved.passageText,
    reused: false
  };
}
