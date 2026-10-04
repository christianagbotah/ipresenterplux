import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { authenticateEdgeDevice } from "@/lib/edge-auth";

const schema = z.object({
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
  if (!device) {
    return NextResponse.json({ ok: false, error: "Device authentication required" }, { status: 401 });
  }

  try {
    const payload = schema.parse(await request.json());
    if (payload.deviceId !== device.deviceId) {
      return NextResponse.json({ ok: false, error: "Heartbeat device identity mismatch" }, { status: 403 });
    }

    const health = {
      status: payload.status,
      observedAt: payload.observedAt,
      cpuPercent: payload.cpuPercent,
      memoryPercent: payload.memoryPercent,
      uplinkMbps: payload.uplinkMbps ?? null
    };

    await query(
      `update edge_devices
       set status='active',
           software_version=$2,
           capabilities=$3::jsonb,
           metadata=metadata || jsonb_build_object('lastHealth',$4::jsonb),
           updated_at=now()
       where id=$1`,
      [device.deviceId, payload.version, JSON.stringify(payload.capabilities), JSON.stringify(health)]
    );

    return NextResponse.json({ ok: true, deviceId: device.deviceId, receivedAt: new Date().toISOString() });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Invalid heartbeat payload", issues: error.issues }, { status: 400 });
    }
    console.error("Edge heartbeat failed", error);
    return NextResponse.json({ ok: false, error: "Heartbeat failed" }, { status: 500 });
  }
}
