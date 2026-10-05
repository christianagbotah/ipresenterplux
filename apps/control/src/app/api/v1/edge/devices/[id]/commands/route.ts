import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { EDGE_COMMAND_TYPES, rolesForEdgeCommand } from "@/lib/edge-commands";
import { userHasAnyRole } from "@/lib/rbac";

type RouteContext = { params: Promise<{ id: string }> };

const schema = z.object({
  serviceId: z.string().uuid().nullable().optional(),
  type: z.enum(EDGE_COMMAND_TYPES),
  arguments: z.record(z.string(), z.string().max(500)).default({}),
  ttlSeconds: z.number().int().min(10).max(300).default(60)
});

export async function POST(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  if (session.user.forcePasswordChange) return NextResponse.json({ ok: false, error: "Password change required" }, { status: 403 });

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ ok: false, error: "Invalid Edge device id" }, { status: 400 });

  try {
    const payload = schema.parse(await request.json());
    const client = await db.connect();
    try {
      await client.query("begin");
      const found = await client.query<{ organization_id: string; status: string; active_service_id: string | null; name: string }>(
        "select organization_id::text,status,active_service_id::text,name from edge_devices where id=$1 for update",
        [id]
      );
      const device = found.rows[0];
      if (!device) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "Edge device not found" }, { status: 404 });
      }
      if (device.status !== "active") {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "Edge device is not active" }, { status: 409 });
      }
      const allowed = await userHasAnyRole(session.user.id, device.organization_id, rolesForEdgeCommand(payload.type));
      if (!allowed) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "You are not allowed to issue this Edge command" }, { status: 403 });
      }

      const serviceId = payload.serviceId ?? device.active_service_id;
      if (serviceId) {
        const service = await client.query("select 1 from services where id=$1 and organization_id=$2 limit 1", [serviceId, device.organization_id]);
        if (!service.rowCount) {
          await client.query("rollback");
          return NextResponse.json({ ok: false, error: "Service does not belong to this organization" }, { status: 400 });
        }
      }

      const inserted = await client.query<{ id: string; issued_at: string; expires_at: string }>(
        `insert into edge_control_commands
          (organization_id,edge_device_id,service_id,command_type,arguments,issued_by,expires_at)
         values ($1,$2,$3,$4,$5::jsonb,$6,now()+($7::text || ' seconds')::interval)
         returning id::text,issued_at::text,expires_at::text`,
        [device.organization_id, id, serviceId, payload.type, JSON.stringify(payload.arguments), session.user.id, payload.ttlSeconds]
      );
      const command = inserted.rows[0];
      await client.query(
        `insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
         values ($1,'operator',$2,'edge.command.issued','edge_command',$3,$4::jsonb)`,
        [device.organization_id, session.user.id, command.id, JSON.stringify({ deviceId: id, deviceName: device.name, serviceId, type: payload.type })]
      );
      await client.query("commit");
      return NextResponse.json({ ok: true, commandId: command.id, deviceId: id, serviceId, type: payload.type, issuedAt: command.issued_at, expiresAt: command.expires_at });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: "Invalid Edge command", issues: error.issues }, { status: 400 });
    console.error("Edge command creation failed", error);
    return NextResponse.json({ ok: false, error: "Could not issue Edge command" }, { status: 500 });
  }
}
