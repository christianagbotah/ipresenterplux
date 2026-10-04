import crypto from "node:crypto";
import type { PoolClient } from "pg";

type EdgeEventKind = "transcript" | "health" | "media";

type ReceiptInput = {
  deviceId: string;
  organizationId: string;
  eventId: string;
  eventKind: EdgeEventKind;
  serviceId?: string | null;
  occurredAt: string;
  payload: unknown;
};

export type EdgeEventReceiptResult =
  | { state: "new"; payloadHash: string }
  | { state: "duplicate"; payloadHash: string }
  | { state: "conflict"; payloadHash: string };

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
}

export function edgeEventPayloadHash(payload: unknown) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(payload)))
    .digest("hex");
}

export async function inspectExistingEdgeEvent(
  client: PoolClient,
  input: Pick<ReceiptInput, "deviceId" | "eventId" | "eventKind" | "payload">
): Promise<"missing" | "duplicate" | "conflict"> {
  const hash = edgeEventPayloadHash(input.payload);
  const existing = await client.query<{ event_kind: string; payload_hash: string }>(
    `select event_kind,payload_hash
     from edge_event_receipts
     where edge_device_id=$1 and event_id=$2
     for update`,
    [input.deviceId, input.eventId]
  );
  const row = existing.rows[0];
  if (!row) return "missing";
  return row.event_kind === input.eventKind && row.payload_hash === hash ? "duplicate" : "conflict";
}

export async function registerEdgeEvent(
  client: PoolClient,
  input: ReceiptInput
): Promise<EdgeEventReceiptResult> {
  const hash = edgeEventPayloadHash(input.payload);
  const inserted = await client.query(
    `insert into edge_event_receipts
      (edge_device_id,event_id,organization_id,event_kind,service_id,occurred_at,payload_hash)
     values ($1,$2,$3,$4,$5,$6::timestamptz,$7)
     on conflict (edge_device_id,event_id) do nothing
     returning event_id`,
    [
      input.deviceId,
      input.eventId,
      input.organizationId,
      input.eventKind,
      input.serviceId ?? null,
      input.occurredAt,
      hash
    ]
  );

  if (inserted.rowCount) return { state: "new", payloadHash: hash };

  const existing = await client.query<{ event_kind: string; payload_hash: string }>(
    `select event_kind,payload_hash
     from edge_event_receipts
     where edge_device_id=$1 and event_id=$2
     for update`,
    [input.deviceId, input.eventId]
  );
  const row = existing.rows[0];
  if (!row || row.event_kind !== input.eventKind || row.payload_hash !== hash) {
    return { state: "conflict", payloadHash: hash };
  }
  return { state: "duplicate", payloadHash: hash };
}
