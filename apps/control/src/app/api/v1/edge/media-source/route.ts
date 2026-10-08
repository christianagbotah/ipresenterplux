import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateEdgeDevice } from "@/lib/edge-auth";
import { registerEdgeEvent } from "@/lib/edge-events";
import { publishServiceEvent } from "@/lib/realtime";
import { upsertCockpitRecommendation } from "@/lib/cockpit/recommendations";

const schema = z.object({
  eventId: z.string().uuid(),
  serviceId: z.string().uuid().nullable().default(null),
  sourceId: z.string().trim().min(1).max(160),
  name: z.string().trim().min(1).max(160),
  sourceType: z.string().trim().min(1).max(80),
  status: z.enum(["offline", "ready", "live", "warning", "error"]),
  observedAt: z.string().datetime(),
  metadata: z.record(z.string(), z.string()).default({})
});

export async function POST(request: Request) {
  const device = await authenticateEdgeDevice(request);
  if (!device) return NextResponse.json({ ok: false, error: "Device authentication required" }, { status: 401 });
  try {
    const payload = schema.parse(await request.json());
    const client = await db.connect();
    let activeServiceId: string | undefined;
    try {
      await client.query("begin");
      const receipt = await registerEdgeEvent(client, {
        deviceId: device.deviceId, organizationId: device.organizationId, eventId: payload.eventId,
        eventKind: "media", occurredAt: payload.observedAt, payload
      });
      if (receipt.state === "conflict") {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "Event ID already exists with different content" }, { status: 409 });
      }
      if (receipt.state === "duplicate") {
        await client.query("commit");
        return NextResponse.json({ ok: true, duplicate: true, eventId: payload.eventId });
      }
      const updated = await client.query<{ id: string; status: string }>(
        `insert into media_sources
          (organization_id,name,source_type,status,edge_device_id,source_key,last_seen_at,metadata,public_config)
         values ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::jsonb,$9::jsonb)
         on conflict (organization_id,name) do update
         set source_type=case when media_sources.last_seen_at is null or excluded.last_seen_at >= media_sources.last_seen_at then excluded.source_type else media_sources.source_type end,
           status=case when media_sources.last_seen_at is null or excluded.last_seen_at >= media_sources.last_seen_at then excluded.status else media_sources.status end,
           edge_device_id=excluded.edge_device_id,source_key=excluded.source_key,
           last_seen_at=greatest(coalesce(media_sources.last_seen_at,'epoch'::timestamptz),excluded.last_seen_at),
           metadata=case when media_sources.last_seen_at is null or excluded.last_seen_at >= media_sources.last_seen_at then excluded.metadata else media_sources.metadata end,
           public_config=media_sources.public_config || excluded.public_config
         where media_sources.edge_device_id is null or media_sources.edge_device_id=excluded.edge_device_id
         returning id::text,status`,
        [device.organizationId,payload.name,payload.sourceType,payload.status,device.deviceId,payload.sourceId,payload.observedAt,
         JSON.stringify(payload.metadata),JSON.stringify({ edgeDeviceId: device.deviceId, sourceId: payload.sourceId })]
      );
      if (!updated.rowCount) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "Media source name is owned by another Edge device" }, { status: 409 });
      }
      const active = await client.query<{ id: string; ai_enabled: boolean }>(
        `select d.active_service_id::text as id,s.ai_enabled
           from edge_devices d
           join services s on s.id=d.active_service_id
          where d.id=$1
            and s.organization_id=d.organization_id
            and (s.campus_id is not distinct from d.campus_id)
            and s.status in ('live','ready')
            and ($2::uuid is null or d.active_service_id=$2::uuid)
          limit 1`,
        [device.deviceId, payload.serviceId]
      );
      if (payload.serviceId && !active.rows[0]) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "Media source service is not assigned to this Edge device" }, { status: 409 });
      }
      activeServiceId = active.rows[0]?.id;
      const activeService = active.rows[0];
      if (activeService?.ai_enabled && ["camera","video_input","video_capture"].includes(payload.sourceType) && ["ready","live"].includes(payload.status)) {
        const observedAt = new Date(payload.observedAt);
        await upsertCockpitRecommendation(client, {
          organizationId: device.organizationId, serviceId: activeService.id, sourceKey: `camera:${updated.rows[0].id}`,
          recommendationType: "camera.available", targetType: "camera_source", targetId: updated.rows[0].id,
          payload: { status: payload.status, sourceType: payload.sourceType }, confidence: 70,
          reason: `${payload.name} is available from the active Edge`, evidence: "Fresh Edge camera telemetry",
          sourceObservedAt: observedAt, expiresAt: new Date(observedAt.getTime()+120_000), state: "suggested", now: observedAt
        });
      }
      await client.query("commit");
      if (activeServiceId) await publishServiceEvent(activeServiceId, "media.source.status", { sourceId: payload.sourceId, name: payload.name, status: payload.status });
      return NextResponse.json({ ok: true, duplicate: false, eventId: payload.eventId, mediaSourceId: updated.rows[0].id, status: updated.rows[0].status });
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: "Invalid media source payload", issues: error.issues }, { status: 400 });
    console.error("Edge media source update failed", error);
    return NextResponse.json({ ok: false, error: "Media source update failed" }, { status: 500 });
  }
}
