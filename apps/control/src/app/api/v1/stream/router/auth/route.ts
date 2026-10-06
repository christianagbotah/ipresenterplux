import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { hashContributionToken } from "@/lib/stream-contribution";

export const dynamic = "force-dynamic";

const schema = z.object({
  user: z.string().max(256).default(""),
  password: z.string().max(1024).default(""),
  token: z.string().max(4096).default(""),
  action: z.string().max(50),
  path: z.string().max(500).default(""),
  protocol: z.string().max(50).default(""),
  id: z.string().max(500).optional(),
  ip: z.string().max(200).optional(),
  query: z.string().max(4096).optional(),
  userAgent: z.string().max(1000).optional()
});

function deny(status = 401) {
  return NextResponse.json({ ok: false }, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

export async function POST(request: Request) {
  try {
    const payload = schema.parse(await request.json());
    if (payload.action !== "publish" || payload.protocol !== "srt") return deny();
    if (payload.user !== "edge" || !payload.path || !payload.password) return deny();

    const tokenHash = hashContributionToken(payload.password);
    const accepted = await query<{ id: string }>(
      `update edge_stream_contribution_sessions cs
       set last_seen_at=now(),updated_at=now()
       from edge_devices d,services s,stream_sessions ss
       where cs.edge_device_id=d.id
         and cs.service_id=s.id
         and ss.service_id=cs.service_id
         and ss.publisher_edge_device_id=cs.edge_device_id
         and ss.router_path=cs.stream_path
         and ss.status in ('starting','live')
         and cs.stream_path=$1
         and cs.token_hash=$2
         and cs.protocol='srt'
         and cs.revoked_at is null
         and cs.expires_at > now()
         and d.organization_id=cs.organization_id
         and d.status='active'
         and d.active_service_id=cs.service_id
         and s.organization_id=cs.organization_id
         and s.status in ('ready','live')
       returning cs.id::text`,
      [payload.path, tokenHash]
    );

    if (!accepted.rowCount) return deny();
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return deny();
    console.error("Stream router authentication failed", error instanceof Error ? error.name : "unknown");
    return deny(503);
  }
}
