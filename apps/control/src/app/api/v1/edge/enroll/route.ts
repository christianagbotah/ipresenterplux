import crypto from "node:crypto";
import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/security";

const schema = z.object({
  pairingCode: z.string().min(8).max(32),
  deviceName: z.string().trim().min(2).max(120),
  softwareVersion: z.string().trim().min(1).max(80)
});

function normalizePairingCode(code: string) {
  return code.replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

function requestIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const candidate = forwarded || request.headers.get("x-real-ip")?.trim() || "";
  return isIP(candidate) ? candidate : null;
}

export async function POST(request: Request) {
  try {
    const payload = schema.parse(await request.json());
    const codeHash = hashToken(normalizePairingCode(payload.pairingCode));
    const credential = `iplx_${crypto.randomBytes(32).toString("base64url")}`;
    const credentialHash = hashToken(credential);
    const credentialId = crypto.randomUUID();
    const ip = requestIp(request);
    const client = await db.connect();

    try {
      await client.query("begin");
      const pairing = await client.query<{
        pairing_id: string;
        device_id: string;
        organization_id: string;
        campus_id: string | null;
        name: string;
        platform: string;
        status: string;
      }>(
        `select p.id::text as pairing_id,
                d.id::text as device_id,
                d.organization_id::text,
                d.campus_id::text,
                d.name,d.platform,d.status
         from device_pairing_codes p
         join edge_devices d on d.id=p.edge_device_id
         where p.code_hash=$1
           and p.consumed_at is null
           and p.expires_at > now()
         for update of p,d`,
        [codeHash]
      );

      const row = pairing.rows[0];
      if (!row || row.status === "revoked") {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "Pairing code is invalid or expired" }, { status: 401 });
      }

      await client.query(
        `update edge_device_credentials
         set state='revoked',revoked_at=now()
         where edge_device_id=$1 and state in ('active','rotation_required')`,
        [row.device_id]
      );

      const inserted = await client.query<{ issued_at: string; expires_at: string }>(
        `insert into edge_device_credentials(id,edge_device_id,credential_hash,state,expires_at)
         values ($1,$2,$3,'active',now()+interval '30 days')
         returning issued_at::text,expires_at::text`,
        [credentialId, row.device_id, credentialHash]
      );

      await client.query("update device_pairing_codes set consumed_at=now() where id=$1", [row.pairing_id]);
      await client.query(
        `update edge_devices
         set status='active',software_version=$2,last_seen_at=now(),last_ip=$3::inet,updated_at=now()
         where id=$1`,
        [row.device_id, payload.softwareVersion, ip]
      );
      await client.query(
        `insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
         values ($1,'edge_device',$2,'edge.device.enrolled','edge_device',$2,$3::jsonb)`,
        [row.organization_id, row.device_id, JSON.stringify({ platform: row.platform, requestedName: payload.deviceName, softwareVersion: payload.softwareVersion })]
      );
      await client.query("commit");

      return NextResponse.json({
        ok: true,
        credential,
        metadata: {
          deviceId: row.device_id,
          organizationId: row.organization_id,
          campusId: row.campus_id,
          deviceName: row.name,
          platform: row.platform,
          credentialId,
          issuedAt: inserted.rows[0].issued_at,
          expiresAt: inserted.rows[0].expires_at,
          state: "active"
        }
      });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Invalid enrollment request", issues: error.issues }, { status: 400 });
    }
    console.error("Edge enrollment failed", error);
    return NextResponse.json({ ok: false, error: "Edge enrollment failed" }, { status: 500 });
  }
}
