import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { DEVICE_ADMIN_ROLES, userHasAnyRole } from "@/lib/rbac";
import { hashToken } from "@/lib/security";

const schema = z.object({
  organizationId: z.string().uuid(),
  campusId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(2).max(120),
  platform: z.enum(["windows", "macos"]),
  ttlMinutes: z.number().int().min(5).max(30).default(15)
});

function makePairingCode() {
  const raw = crypto.randomBytes(6).toString("hex").toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

function normalizedPairingCode(code: string) {
  return code.replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }
  if (session.user.forcePasswordChange) {
    return NextResponse.json({ ok: false, error: "Password change required" }, { status: 403 });
  }

  try {
    const payload = schema.parse(await request.json());
    const allowed = await userHasAnyRole(session.user.id, payload.organizationId, DEVICE_ADMIN_ROLES);
    if (!allowed) {
      return NextResponse.json({ ok: false, error: "You are not allowed to provision Edge devices" }, { status: 403 });
    }

    const client = await db.connect();
    try {
      await client.query("begin");

      if (payload.campusId) {
        const campus = await client.query(
          "select 1 from campuses where id=$1 and organization_id=$2 limit 1",
          [payload.campusId, payload.organizationId]
        );
        if (!campus.rowCount) {
          await client.query("rollback");
          return NextResponse.json({ ok: false, error: "Campus does not belong to this organization" }, { status: 400 });
        }
      }

      const existing = await client.query<{ id: string; status: string }>(
        "select id::text,status from edge_devices where organization_id=$1 and name=$2 for update",
        [payload.organizationId, payload.name]
      );

      let deviceId: string;
      if (existing.rows[0]) {
        if (existing.rows[0].status === "revoked") {
          await client.query("rollback");
          return NextResponse.json({ ok: false, error: "This Edge device has been revoked" }, { status: 409 });
        }
        deviceId = existing.rows[0].id;
        await client.query(
          `update edge_devices
           set campus_id=$2,platform=$3,status=case when status='active' then 'active' else 'pending' end,updated_at=now()
           where id=$1`,
          [deviceId, payload.campusId ?? null, payload.platform]
        );
      } else {
        const created = await client.query<{ id: string }>(
          `insert into edge_devices(organization_id,campus_id,name,platform,status)
           values ($1,$2,$3,$4,'pending') returning id::text`,
          [payload.organizationId, payload.campusId ?? null, payload.name, payload.platform]
        );
        deviceId = created.rows[0].id;
      }

      await client.query(
        "update device_pairing_codes set consumed_at=coalesce(consumed_at,now()) where edge_device_id=$1 and consumed_at is null",
        [deviceId]
      );

      const pairingCode = makePairingCode();
      const codeHash = hashToken(normalizedPairingCode(pairingCode));
      const pairing = await client.query<{ expires_at: string }>(
        `insert into device_pairing_codes(edge_device_id,code_hash,expires_at,created_by)
         values ($1,$2,now()+($3::text || ' minutes')::interval,$4)
         returning expires_at::text`,
        [deviceId, codeHash, payload.ttlMinutes, session.user.id]
      );

      await client.query(
        `insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
         values ($1,'operator',$2,'edge.pairing.created','edge_device',$3,$4::jsonb)`,
        [payload.organizationId, session.user.id, deviceId, JSON.stringify({ platform: payload.platform, campusId: payload.campusId ?? null })]
      );

      await client.query("commit");
      return NextResponse.json({
        ok: true,
        deviceId,
        pairingCode,
        expiresAt: pairing.rows[0].expires_at
      });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Invalid pairing request", issues: error.issues }, { status: 400 });
    }
    console.error("Edge pairing creation failed", error);
    return NextResponse.json({ ok: false, error: "Could not create Edge pairing code" }, { status: 500 });
  }
}
