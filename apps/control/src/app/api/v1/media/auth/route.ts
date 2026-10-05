import { z } from "zod";
import { hashToken } from "@/lib/security";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  user: z.string().max(256).default(""),
  password: z.string().max(256).default(""),
  token: z.string().max(512).default(""),
  ip: z.string().max(128).default(""),
  action: z.enum(["publish", "read", "playback", "api", "metrics", "pprof"]),
  path: z.string().max(256).default(""),
  protocol: z.string().max(32).default(""),
  id: z.string().max(256).default(""),
  query: z.string().max(2048).default(""),
  userAgent: z.string().max(512).default("")
});

const servicePath = /^service\/([0-9a-f-]{36})\/?$/i;

export async function POST(request: Request) {
  let payload: z.infer<typeof bodySchema>;
  try {
    payload = bodySchema.parse(await request.json());
  } catch {
    return new Response(null, { status: 400 });
  }

  const match = servicePath.exec(payload.path);
  if (!match) return new Response(null, { status: 403 });
  const serviceId = match[1];

  if (payload.action === "read") {
    const live = await query(
      "select 1 from services where id=$1 and status='live' limit 1",
      [serviceId]
    );
    return new Response(null, { status: live.rowCount ? 200 : 403 });
  }

  if (payload.action === "publish") {
    const token = payload.token.trim() || payload.password.trim();
    if (token.length < 32 || token.length > 256) return new Response(null, { status: 403 });

    const tokenHash = hashToken(token);
    const publisher = await query<{
      device_id: string;
      organization_id: string;
      active_service_id: string | null;
      campus_id: string | null;
      service_status: string;
      credential_state: string;
    }>(
      `select d.id::text as device_id,
              d.organization_id::text,
              d.active_service_id::text,
              d.campus_id::text,
              s.status as service_status,
              c.state as credential_state
       from edge_device_credentials c
       join edge_devices d on d.id=c.edge_device_id
       left join services s
         on s.id=$2 and s.organization_id=d.organization_id
        and (s.campus_id is not distinct from d.campus_id)
       where c.credential_hash=$1
         and c.state in ('active','rotation_required')
         and c.expires_at>now()
         and d.status='active'
         and d.active_service_id=$2
       limit 1`,
      [tokenHash, serviceId]
    );

    const row = publisher.rows[0];
    const allowed =
      !!row &&
      row.active_service_id === serviceId &&
      (row.service_status === "ready" || row.service_status === "live") &&
      (row.credential_state === "active" || row.credential_state === "rotation_required");

    return new Response(null, { status: allowed ? 200 : 403 });
  }

  return new Response(null, { status: 403 });
}
