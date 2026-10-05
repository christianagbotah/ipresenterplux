import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { authenticateEdgeDevice } from "@/lib/edge-auth";

export const dynamic = "force-dynamic";

type AssignmentRow = {
  active_service_id: string | null;
  service_title: string | null;
  service_status: string | null;
  campus_id: string | null;
};

export async function GET(request: Request) {
  const device = await authenticateEdgeDevice(request);
  if (!device) {
    return NextResponse.json({ ok: false, error: "Device authentication required" }, { status: 401 });
  }

  const assignment = await query<AssignmentRow>(
    `select d.active_service_id::text,
            s.title as service_title,
            s.status as service_status,
            s.campus_id::text
     from edge_devices d
     left join services s
       on s.id=d.active_service_id
      and s.organization_id=d.organization_id
      and s.campus_id is not distinct from d.campus_id
      and s.status in ('ready','live')
     where d.id=$1 and d.organization_id=$2
     limit 1`,
    [device.deviceId, device.organizationId]
  );
  const row = assignment.rows[0];
  const active = row?.service_status ? row : null;

  return NextResponse.json(
    {
      ok: true,
      assignment: active
        ? {
            serviceId: active.active_service_id,
            title: active.service_title,
            status: active.service_status,
            campusId: active.campus_id
          }
        : null,
      observedAt: new Date().toISOString()
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
