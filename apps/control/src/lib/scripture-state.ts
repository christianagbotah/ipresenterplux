import type { PoolClient } from "pg";
import { enqueueServiceEdgeCommand } from "./edge-command-dispatch.ts";

export type ScriptureStateTarget = "detected" | "preview" | "live" | "dismissed";
export type ScriptureStateActor =
  | { type: "operator"; userId: string }
  | { type: "automation"; userId: string; reason: "auto_scripture_live" };

export class ScriptureStateError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ScriptureStateError";
    this.status = status;
    this.code = code;
  }
}

type TargetRow = {
  id: string;
  service_id: string;
  scripture_reference: string;
  organization_id: string;
  state: string;
  book: string;
  chapter: number;
  verse_start: number | null;
  verse_end: number | null;
  bible_version: string;
};

export async function transitionScriptureState(
  client: PoolClient,
  input: {
    detectionId: string;
    targetState: ScriptureStateTarget;
    actor: ScriptureStateActor;
    source: string;
    requireEdgeForLive?: boolean;
  }
): Promise<{
  scripture: { id: string; reference: string; state: string; detectedAt: string };
  fromState: string;
  edgeCommandsQueued: number;
}> {
  const scope = await client.query<{ service_id: string }>(
    `select service_id::text
       from scripture_detections
      where id=$1::uuid`,
    [input.detectionId]
  );
  const serviceId = scope.rows[0]?.service_id;
  if (!serviceId) throw new ScriptureStateError(404, "scripture_detection_not_found", "Scripture detection not found");

  await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [serviceId]);

  const target = await client.query<TargetRow>(
    `select sd.id::text,sd.service_id::text,sd.scripture_reference,sd.state,s.organization_id::text,
            sd.book,sd.chapter,sd.verse_start,sd.verse_end,sd.bible_version
       from scripture_detections sd
       join services s on s.id=sd.service_id
      where sd.id=$1::uuid and sd.service_id=$2::uuid
      for update of sd`,
    [input.detectionId, serviceId]
  );
  const row = target.rows[0];
  if (!row) throw new ScriptureStateError(404, "scripture_detection_not_found", "Scripture detection not found");

  if (input.targetState === "live" && input.requireEdgeForLive) {
    const physicalAuthority = await client.query<{ id: string }>(
      `select id::text
         from edge_devices
        where organization_id=$1::uuid
          and active_service_id=$2::uuid
          and status='active'
        order by last_seen_at desc nulls last,id
        for update`,
      [row.organization_id, row.service_id]
    );
    if (!physicalAuthority.rowCount) {
      throw new ScriptureStateError(409, "active_edge_required", "Auto Scripture Live requires an active Edge assigned to this service");
    }
  }

  if (input.targetState === "preview") {
    await client.query(
      "update scripture_detections set state='detected' where service_id=$1::uuid and state='preview' and id<>$2::uuid",
      [row.service_id, input.detectionId]
    );
  }

  if (input.targetState === "live") {
    await client.query(
      "update scripture_detections set state='played' where service_id=$1::uuid and state='live' and id<>$2::uuid",
      [row.service_id, input.detectionId]
    );
    await client.query(
      "update scripture_detections set state='detected' where service_id=$1::uuid and state='preview' and id<>$2::uuid",
      [row.service_id, input.detectionId]
    );
  }

  const hasValidContextRange = Number.isInteger(row.chapter) && row.chapter > 0
    && row.verse_start !== null && Number.isInteger(row.verse_start) && row.verse_start > 0
    && (row.verse_end === null || (Number.isInteger(row.verse_end) && row.verse_end >= row.verse_start));

  if ((input.targetState === "preview" || input.targetState === "live") && hasValidContextRange) {
    await client.query(
      `insert into service_scripture_context
        (service_id,book,chapter,verse_start,verse_end,bible_version,source_observed_at,source_ordinal,updated_at)
       values ($1,$2,$3,$4,$5,$6,clock_timestamp(),0,clock_timestamp())
       on conflict (service_id) do update set
         book=excluded.book,chapter=excluded.chapter,verse_start=excluded.verse_start,verse_end=excluded.verse_end,
         bible_version=excluded.bible_version,source_observed_at=excluded.source_observed_at,
         source_ordinal=0,updated_at=clock_timestamp()`,
      [row.service_id,row.book,row.chapter,row.verse_start,row.verse_end,row.bible_version]
    );
  }

  const updated = await client.query<{
    id: string;
    scripture_reference: string;
    state: string;
    detected_at: string;
  }>(
    `update scripture_detections
        set state=$2
      where id=$1::uuid
      returning id::text,scripture_reference,state,detected_at::text`,
    [input.detectionId,input.targetState]
  );

  const actorType = input.actor.type;
  const issuedBy = input.actor.userId;
  let edgeCommandsQueued = 0;
  if (input.targetState === "preview") {
    edgeCommandsQueued = await enqueueServiceEdgeCommand(client, {
      organizationId: row.organization_id,
      serviceId: row.service_id,
      type: "preview.prepare",
      arguments: { itemId: input.detectionId },
      issuedBy,
      actorType,
      source: input.source
    });
  } else if (input.targetState === "live") {
    edgeCommandsQueued = await enqueueServiceEdgeCommand(client, {
      organizationId: row.organization_id,
      serviceId: row.service_id,
      type: "program.show",
      arguments: { itemId: input.detectionId },
      issuedBy,
      actorType,
      source: input.source
    });
    if (input.requireEdgeForLive && edgeCommandsQueued < 1) {
      throw new ScriptureStateError(409, "active_edge_required", "Auto Scripture Live could not queue Program on the active Edge");
    }
  } else if (row.state === "live") {
    edgeCommandsQueued = await enqueueServiceEdgeCommand(client, {
      organizationId: row.organization_id,
      serviceId: row.service_id,
      type: "program.clear",
      issuedBy,
      actorType,
      source: input.source
    });
  }

  await client.query(
    `insert into audit_events
      (organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
     values ($1,$2,$3,'scripture.state.changed','scripture_detection',$4,$5::jsonb)`,
    [
      row.organization_id,
      actorType,
      issuedBy,
      input.detectionId,
      JSON.stringify({
        reference: row.scripture_reference,
        from: row.state,
        to: input.targetState,
        source: input.source,
        automationReason: input.actor.type === "automation" ? input.actor.reason : null,
        edgeCommandsQueued
      })
    ]
  );

  const result = updated.rows[0];
  return {
    scripture: {
      id: result.id,
      reference: result.scripture_reference,
      state: result.state,
      detectedAt: result.detected_at
    },
    fromState: row.state,
    edgeCommandsQueued
  };
}
