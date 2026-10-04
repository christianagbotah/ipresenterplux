import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { DEVICE_ADMIN_ROLES, userHasAnyRole } from "@/lib/rbac";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }
  if (session.user.forcePasswordChange) {
    return NextResponse.json({ ok: false, error: "Password change required" }, { status: 403 });
  }

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, error: "Invalid Edge device id" }, { status: 400 });
  }

  const client = await db.connect();
  try {
    await client.query("begin");
    const found = await client.query<{
      organization_id: string;
      name: string;
      status: string;
    }>(
      "select organization_id::text,name,status from edge_devices where id=$1 for update",
      [id]
    );

    const device = found.rows[0];
    if (!device) {
      await client.query("rollback");
      return NextResponse.json({ ok: false, error: "Edge device not found" }, { status: 404 });
    }

    const allowed = await userHasAnyRole(session.user.id, device.organization_id, DEVICE_ADMIN_ROLES);
    if (!allowed) {
      await client.query("rollback");
      return NextResponse.json({ ok: false, error: "You are not allowed to revoke Edge devices" }, { status: 403 });
    }

    await client.query("update edge_devices set status='revoked',updated_at=now() where id=$1", [id]);
    await client.query(
      `update edge_device_credentials
       set state='revoked',revoked_at=coalesce(revoked_at,now())
       where edge_device_id=$1 and state in ('active','rotation_required')`,
      [id]
    );
    await client.query(
      "update device_pairing_codes set consumed_at=coalesce(consumed_at,now()) where edge_device_id=$1 and consumed_at is null",
      [id]
    );
    await client.query(
      `insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
       values ($1,'operator',$2,'edge.device.revoked','edge_device',$3,$4::jsonb)`,
      [device.organization_id, session.user.id, id, JSON.stringify({ name: device.name, previousStatus: device.status })]
    );
    await client.query("commit");

    return NextResponse.json({ ok: true, deviceId: id, state: "revoked" });
  } catch (error) {
    await client.query("rollback");
    console.error("Edge device revoke failed", error);
    return NextResponse.json({ ok: false, error: "Edge device revocation failed" }, { status: 500 });
  } finally {
    client.release();
  }
}
