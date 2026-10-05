import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateEdgeDevice } from "@/lib/edge-auth";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(25).default(10)
});

export async function GET(request: Request) {
  const device = await authenticateEdgeDevice(request);
  if (!device) return NextResponse.json({ ok: false, error: "Device authentication required" }, { status: 401 });

  try {
    const url = new URL(request.url);
    const { limit } = querySchema.parse({ limit: url.searchParams.get("limit") ?? undefined });
    const client = await db.connect();
    try {
      await client.query("begin");
      await client.query(
        `update edge_control_commands
         set state='expired',completed_at=coalesce(completed_at,now()),updated_at=now()
         where edge_device_id=$1 and state in ('pending','delivered') and expires_at <= now()`,
        [device.deviceId]
      );
      const selected = await client.query<{
        id: string; service_id: string | null; command_type: string; arguments: Record<string, string>; issued_at: string;
      }>(
        `select id::text,service_id::text,command_type,arguments,issued_at::text
         from edge_control_commands
         where edge_device_id=$1
           and state in ('pending','delivered')
           and expires_at > now()
           and (delivered_at is null or delivered_at <= now()-interval '10 seconds')
         order by issued_at,id
         limit $2
         for update skip locked`,
        [device.deviceId, limit]
      );
      const ids = selected.rows.map((row) => row.id);
      if (ids.length) {
        await client.query(
          `update edge_control_commands
           set state='delivered',delivered_at=now(),attempt_count=attempt_count+1,updated_at=now()
           where id=any($1::uuid[])`,
          [ids]
        );
      }
      await client.query("commit");
      return NextResponse.json({
        ok: true,
        deviceId: device.deviceId,
        commands: selected.rows.map((row) => ({
          commandId: row.id,
          serviceId: row.service_id,
          type: row.command_type,
          issuedAt: row.issued_at,
          arguments: row.arguments ?? {}
        }))
      }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: "Invalid command poll" }, { status: 400 });
    console.error("Edge command poll failed", error);
    return NextResponse.json({ ok: false, error: "Command poll failed" }, { status: 500 });
  }
}
