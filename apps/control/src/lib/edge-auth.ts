import { isIP } from "node:net";
import { query } from "@/lib/db";
import { hashToken } from "@/lib/security";

export type EdgeDevicePrincipal = {
  deviceId: string;
  organizationId: string;
  campusId: string | null;
  name: string;
  platform: string;
  credentialId: string;
};

function requestIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const candidate = forwarded || request.headers.get("x-real-ip")?.trim() || "";
  return isIP(candidate) ? candidate : null;
}

export async function authenticateEdgeDevice(request: Request): Promise<EdgeDevicePrincipal | null> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return null;

  const token = authorization.slice(7).trim();
  if (token.length < 32 || token.length > 256) return null;

  const tokenHash = hashToken(token);
  const found = await query<{
    credential_id: string;
    replaces_credential_id: string | null;
    device_id: string;
    organization_id: string;
    campus_id: string | null;
    name: string;
    platform: string;
  }>(
    `select c.id::text as credential_id,
            c.replaces_credential_id::text,
            d.id::text as device_id,
            d.organization_id::text,
            d.campus_id::text,
            d.name,
            d.platform
     from edge_device_credentials c
     join edge_devices d on d.id=c.edge_device_id
     where c.credential_hash=$1
       and c.state in ('active','rotation_required')
       and c.expires_at > now()
       and d.status='active'
     limit 1`,
    [tokenHash]
  );

  const row = found.rows[0];
  if (!row) return null;

  const ip = requestIp(request);
  const updates: Promise<unknown>[] = [
    query("update edge_device_credentials set last_used_at=now(), recovery_envelope=null, recovery_expires_at=null where id=$1 and state='active'", [row.credential_id]),
    query(
      "update edge_devices set last_seen_at=now(), last_ip=$2::inet, updated_at=now() where id=$1",
      [row.device_id, ip]
    )
  ];
  if (row.replaces_credential_id) {
    updates.push(
      query(
        "update edge_device_credentials set state='revoked', revoked_at=coalesce(revoked_at,now()) where id=$1 and state='rotation_required'",
        [row.replaces_credential_id]
      )
    );
  }
  await Promise.all(updates);

  return {
    credentialId: row.credential_id,
    deviceId: row.device_id,
    organizationId: row.organization_id,
    campusId: row.campus_id,
    name: row.name,
    platform: row.platform
  };
}
