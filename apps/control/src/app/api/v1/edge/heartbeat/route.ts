import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateEdgeDevice } from "@/lib/edge-auth";
import { registerEdgeEvent } from "@/lib/edge-events";

const schema = z.object({
  eventId: z.string().uuid(),
  deviceId: z.string().uuid(),
  deviceName: z.string().trim().min(1).max(120),
  version: z.string().trim().min(1).max(80),
  status: z.string().trim().min(1).max(40),
  observedAt: z.string().datetime(),
  cpuPercent: z.number().min(0).max(100),
  memoryPercent: z.number().min(0).max(100),
  uplinkMbps: z.number().min(0).nullable().optional(),
  capabilities: z.record(z.string(), z.string()).default({})
});

export async function POST(request: Request) {
  const device = await authenticateEdgeDevice(request);
  if (!device) return NextResponse.json({ ok: false, error: "Device authentication required" }, { status: 401 });
  try {
    const payload = schema.parse(await request.json());
    if (payload.deviceId !== device.deviceId) return NextResponse.json({ ok: false, error: "Heartbeat device identity mismatch" }, { status: 403 });
    const client = await db.connect();
    try {
      await client.query("begin");
      const receipt = await registerEdgeEvent(client, {
        deviceId: device.deviceId,
        organizationId: device.organizationId,
        eventId: payload.eventId,
        eventKind: "health",
        occurredAt: payload.observedAt,
        payload
      });
      if (receipt.state === "conflict") {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "Event ID already exists with different content" }, { status: 409 });
      }
      if (receipt.state === "duplicate") {
        await client.query("commit");
        return NextResponse.json({ ok: true, duplicate: true, eventId: payload.eventId });
      }
      const health = { status: payload.status, observedAt: payload.observedAt, cpuPercent: payload.cpuPercent,
        memoryPercent: payload.memoryPercent, uplinkMbps: payload.uplinkMbps ?? null };
      await client.query(
        `update edge_devices
         set status='active',
             software_version=case when last_seen_at is null or $5::timestamptz >= last_seen_at then $2 else software_version end,
             capabilities=case when last_seen_at is null or $5::timestamptz >= last_seen_at then $3::jsonb else capabilities end,
             metadata=case when last_seen_at is null or $5::timestamptz >= last_seen_at
               then metadata || jsonb_build_object('lastHealth',$4::jsonb) else metadata end,
             last_seen_at=greatest(coalesce(last_seen_at,'epoch'::timestamptz),$5::timestamptz),
             updated_at=now()
         where id=$1`,
        [device.deviceId,payload.version,JSON.stringify(payload.capabilities),JSON.stringify(health),payload.observedAt]
      );
      await client.query("commit");
      return NextResponse.json({ ok: true, duplicate: false, eventId: payload.eventId, deviceId: device.deviceId, receivedAt: new Date().toISOString() });
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: "Invalid heartbeat payload", issues: error.issues }, { status: 400 });
    console.error("Edge heartbeat failed", error);
    return NextResponse.json({ ok: false, error: "Heartbeat failed" }, { status: 500 });
  }
}
