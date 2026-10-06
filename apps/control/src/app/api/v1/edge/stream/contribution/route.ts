import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateEdgeDevice } from "@/lib/edge-auth";
import { createEdgeContributionGrant } from "@/lib/stream-contribution";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const device = await authenticateEdgeDevice(request);
  if (!device) return NextResponse.json({ ok: false, error: "Device authentication required" }, { status: 401 });

  const routerBaseUrl = process.env.IPRESENTERPLUX_STREAM_ROUTER_SRT_URL;
  if (!routerBaseUrl) {
    return NextResponse.json({ ok: false, error: "Stream router is not configured" }, { status: 503 });
  }

  try {
    const grant = createEdgeContributionGrant(routerBaseUrl);
    const client = await db.connect();
    try {
      await client.query("begin");
      const assigned = await client.query<{ service_id: string; organization_id: string }>(
        `select d.active_service_id::text as service_id,d.organization_id::text
         from edge_devices d
         join services s on s.id=d.active_service_id
         where d.id=$1::uuid
           and d.organization_id=$2::uuid
           and d.status='active'
           and s.organization_id=d.organization_id
           and s.status in ('ready','live')
         for update of d`,
        [device.deviceId, device.organizationId]
      );
      const scope = assigned.rows[0];
      if (!scope?.service_id) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "No active streamable service is assigned to this device" }, { status: 409 });
      }

      await client.query(
        `update edge_stream_contribution_sessions
         set revoked_at=coalesce(revoked_at,now()),updated_at=now()
         where edge_device_id=$1::uuid
           and service_id=$2::uuid
           and revoked_at is null
           and expires_at > now()`,
        [device.deviceId, scope.service_id]
      );

      await client.query(
        `insert into edge_stream_contribution_sessions
          (id,organization_id,edge_device_id,service_id,protocol,stream_path,token_hash,router_authority,expires_at)
         values ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9::timestamptz)`,
        [
          grant.sessionId,
          device.organizationId,
          device.deviceId,
          scope.service_id,
          grant.protocol,
          grant.streamPath,
          grant.tokenHash,
          grant.routerAuthority,
          grant.expiresAt
        ]
      );

      await client.query(
        `insert into audit_events
          (organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
         values ($1::uuid,'edge_device',$2::uuid,'stream.contribution.issued','stream_contribution_session',$3::uuid,$4::jsonb)`,
        [
          device.organizationId,
          device.deviceId,
          grant.sessionId,
          JSON.stringify({ serviceId: scope.service_id, protocol: grant.protocol, streamPath: grant.streamPath, expiresAt: grant.expiresAt, routerAuthority: grant.routerAuthority })
        ]
      );

      await client.query("commit");

      return NextResponse.json({
        ok: true,
        contribution: {
          sessionId: grant.sessionId,
          serviceId: scope.service_id,
          streamPath: grant.streamPath,
          protocol: grant.protocol,
          publishUrl: grant.publishUrl,
          expiresAt: grant.expiresAt
        }
      }, {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "Pragma": "no-cache"
        }
      });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : "stream_contribution_failed";
    if (code.startsWith("stream_router_")) {
      console.error("Stream contribution configuration rejected", code);
      return NextResponse.json({ ok: false, error: "Stream router configuration is invalid" }, { status: 503 });
    }
    console.error("Stream contribution issuance failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ ok: false, error: "Could not issue stream contribution session" }, { status: 500 });
  }
}
