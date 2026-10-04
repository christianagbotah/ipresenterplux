import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateEdgeDevice } from "@/lib/edge-auth";

export async function POST(request: Request) {
  const device = await authenticateEdgeDevice(request);
  if (!device) {
    return NextResponse.json({ ok: false, error: "Device authentication required" }, { status: 401 });
  }

  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query(
      `update edge_device_credentials
       set state='revoked',revoked_at=now()
       where edge_device_id=$1 and state in ('active','rotation_required')`,
      [device.deviceId]
    );
    await client.query(
      `update edge_devices
       set status='pending',updated_at=now()
       where id=$1 and status<>'revoked'`,
      [device.deviceId]
    );
    await client.query(
      "update device_pairing_codes set consumed_at=coalesce(consumed_at,now()) where edge_device_id=$1 and consumed_at is null",
      [device.deviceId]
    );
    await client.query(
      `insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
       values ($1,'edge_device',$2,'edge.credential.self_revoked','edge_device',$2,'{}'::jsonb)`,
      [device.organizationId, device.deviceId]
    );
    await client.query("commit");

    return NextResponse.json({
      ok: true,
      metadata: {
        deviceId: device.deviceId,
        organizationId: device.organizationId,
        campusId: device.campusId,
        deviceName: device.name,
        credentialId: device.credentialId,
        state: "revoked",
        revokedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    await client.query("rollback");
    console.error("Edge credential self-revoke failed", error);
    return NextResponse.json({ ok: false, error: "Credential revocation failed" }, { status: 500 });
  } finally {
    client.release();
  }
}
