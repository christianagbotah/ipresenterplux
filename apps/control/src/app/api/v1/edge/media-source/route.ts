import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { authenticateEdgeDevice } from "@/lib/edge-auth";
import { publishServiceEvent } from "@/lib/realtime";

const schema = z.object({
  sourceId: z.string().trim().min(1).max(160),
  name: z.string().trim().min(1).max(160),
  sourceType: z.string().trim().min(1).max(80),
  status: z.enum(["offline", "ready", "live", "warning", "error"]),
  observedAt: z.string().datetime(),
  metadata: z.record(z.string(), z.string()).default({})
});

export async function POST(request: Request) {
  const device = await authenticateEdgeDevice(request);
  if (!device) {
    return NextResponse.json({ ok: false, error: "Device authentication required" }, { status: 401 });
  }

  try {
    const payload = schema.parse(await request.json());
    const updated = await query<{ id: string; status: string }>(
      `insert into media_sources
        (organization_id,name,source_type,status,edge_device_id,source_key,last_seen_at,metadata,public_config)
       values ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::jsonb,$9::jsonb)
       on conflict (organization_id,name) do update
       set source_type=excluded.source_type,
           status=excluded.status,
           edge_device_id=excluded.edge_device_id,
           source_key=excluded.source_key,
           last_seen_at=excluded.last_seen_at,
           metadata=excluded.metadata,
           public_config=media_sources.public_config || excluded.public_config
       where media_sources.edge_device_id is null or media_sources.edge_device_id=excluded.edge_device_id
       returning id::text,status`,
      [
        device.organizationId,
        payload.name,
        payload.sourceType,
        payload.status,
        device.deviceId,
        payload.sourceId,
        payload.observedAt,
        JSON.stringify(payload.metadata),
        JSON.stringify({ edgeDeviceId: device.deviceId, sourceId: payload.sourceId })
      ]
    );

    if (!updated.rowCount) {
      return NextResponse.json({ ok: false, error: "Media source name is owned by another Edge device" }, { status: 409 });
    }

    const activeService = await query<{ id: string }>(
      `select id from services
       where organization_id=$1 and status in ('live','ready')
       order by case when status='live' then 0 else 1 end,created_at desc
       limit 1`,
      [device.organizationId]
    );

    if (activeService.rows[0]) {
      await publishServiceEvent(activeService.rows[0].id, "media.source.status", {
        sourceId: payload.sourceId,
        name: payload.name,
        status: payload.status
      });
    }

    return NextResponse.json({ ok: true, mediaSourceId: updated.rows[0].id, status: updated.rows[0].status });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Invalid media source payload", issues: error.issues }, { status: 400 });
    }
    console.error("Edge media source update failed", error);
    return NextResponse.json({ ok: false, error: "Media source update failed" }, { status: 500 });
  }
}
