import type { PoolClient } from "pg";
import { NextResponse } from "next/server";
import { auth } from "@auth";
import { PlannerServiceError } from "./planner-service-queries";

export async function requirePlannerSession() {
  const session = await auth();
  if (!session?.user?.id) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 })
    };
  }
  if (session.user.forcePasswordChange) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: "Password change required" }, { status: 403 })
    };
  }
  return { ok: true as const, userId: session.user.id };
}

export async function loadPlannerServiceScope(client: PoolClient, userId: string, serviceId: string) {
  const result = await client.query<{
    id: string;
    organization_id: string;
    campus_id: string | null;
    status: string;
  }>(
    `select s.id::text,s.organization_id::text,s.campus_id::text,s.status
     from services s
     where s.id=$1
       and exists (
         select 1 from user_organization_roles uor
         where uor.user_id=$2 and uor.organization_id=s.organization_id
       )
     limit 1`,
    [serviceId, userId]
  );
  if (!result.rowCount) {
    throw new PlannerServiceError(404, "service_not_found", "Service not found");
  }
  return {
    id: result.rows[0].id,
    organizationId: result.rows[0].organization_id,
    campusId: result.rows[0].campus_id,
    status: result.rows[0].status
  };
}
