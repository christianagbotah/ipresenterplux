import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateEdgeDevice } from "@/lib/edge-auth";
import { decryptEdgeCredentialRecovery, encryptEdgeCredentialForRecovery } from "@/lib/edge-credential-recovery";
import { hashToken } from "@/lib/security";

export async function POST(request: Request) {
  const device = await authenticateEdgeDevice(request);
  if (!device) {
    return NextResponse.json({ ok: false, error: "Device authentication required" }, { status: 401 });
  }

  const client = await db.connect();
  try {
    await client.query("begin");
    const current = await client.query<{ id: string; state: string }>(
      `select id::text,state from edge_device_credentials
       where id=$1 and edge_device_id=$2 and expires_at > now() for update`,
      [device.credentialId, device.deviceId]
    );
    const row = current.rows[0];
    if (!row) {
      await client.query("rollback");
      return NextResponse.json({ ok: false, error: "Credential is not eligible for rotation" }, { status: 409 });
    }

    if (row.state === "rotation_required") {
      const recovery = await client.query<{
        id: string; issued_at: string; expires_at: string; recovery_envelope: string;
      }>(
        `select id::text,issued_at::text,expires_at::text,recovery_envelope
         from edge_device_credentials
         where edge_device_id=$1 and replaces_credential_id=$2 and state='active'
           and recovery_envelope is not null and recovery_expires_at > now()
         order by issued_at desc limit 1 for update`,
        [device.deviceId, device.credentialId]
      );
      const recovered = recovery.rows[0];
      if (!recovered) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "Rotation recovery window expired; re-pair this Edge device" }, { status: 409 });
      }
      const credential = decryptEdgeCredentialRecovery(recovered.recovery_envelope);
      await client.query("commit");
      return NextResponse.json({
        ok: true,
        credential,
        recovered: true,
        metadata: {
          deviceId: device.deviceId, organizationId: device.organizationId, campusId: device.campusId,
          deviceName: device.name, platform: device.platform, credentialId: recovered.id,
          replacesCredentialId: device.credentialId, issuedAt: recovered.issued_at,
          expiresAt: recovered.expires_at, state: "active", previousCredentialGraceMinutes: 10
        }
      });
    }

    if (row.state !== "active") {
      await client.query("rollback");
      return NextResponse.json({ ok: false, error: "Credential is not eligible for rotation" }, { status: 409 });
    }

    const nextCredential = `iplx_${crypto.randomBytes(32).toString("base64url")}`;
    const nextHash = hashToken(nextCredential);
    const nextId = crypto.randomUUID();
    const recoveryEnvelope = encryptEdgeCredentialForRecovery(nextCredential);

    await client.query(
      `update edge_device_credentials set state='rotation_required',
       expires_at=least(expires_at,now()+interval '10 minutes') where id=$1`,
      [device.credentialId]
    );
    const inserted = await client.query<{ issued_at: string; expires_at: string }>(
      `insert into edge_device_credentials
        (id,edge_device_id,credential_hash,state,expires_at,replaces_credential_id,recovery_envelope,recovery_expires_at)
       values ($1,$2,$3,'active',now()+interval '30 days',$4,$5,now()+interval '10 minutes')
       returning issued_at::text,expires_at::text`,
      [nextId, device.deviceId, nextHash, device.credentialId, recoveryEnvelope]
    );
    await client.query(
      `insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
       values ($1,'edge_device',$2,'edge.credential.rotated','edge_device',$2,$3::jsonb)`,
      [device.organizationId, device.deviceId, JSON.stringify({ oldCredentialId: device.credentialId, newCredentialId: nextId })]
    );
    await client.query("commit");
    return NextResponse.json({
      ok: true,
      credential: nextCredential,
      recovered: false,
      metadata: {
        deviceId: device.deviceId, organizationId: device.organizationId, campusId: device.campusId,
        deviceName: device.name, platform: device.platform, credentialId: nextId,
        replacesCredentialId: device.credentialId, issuedAt: inserted.rows[0].issued_at,
        expiresAt: inserted.rows[0].expires_at, state: "active", previousCredentialGraceMinutes: 10
      }
    });
  } catch (error) {
    await client.query("rollback");
    console.error("Edge credential rotation failed", error);
    return NextResponse.json({ ok: false, error: "Credential rotation failed" }, { status: 500 });
  } finally {
    client.release();
  }
}
