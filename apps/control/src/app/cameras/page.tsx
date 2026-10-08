import { redirect } from "next/navigation";
import { auth } from "@auth";
import { CameraWorkspace } from "@/components/cameras/CameraWorkspace";
import { db, query } from "@/lib/db";
import { listCameraSources } from "@/lib/camera-sources";
import { roleCapabilities } from "@/lib/role-capabilities";

export const dynamic = "force-dynamic";

type MembershipRow = { organization_id: string; organization_name: string };

export default async function CamerasPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.forcePasswordChange) redirect("/change-password");

  const membership = await query<MembershipRow>(
    `select o.id::text as organization_id,o.name as organization_name
     from organizations o
     where exists (
       select 1 from user_organization_roles uor
       where uor.user_id=$1 and uor.organization_id=o.id
     )
     order by o.created_at,o.id
     limit 1`,
    [session.user.id]
  );
  const organization = membership.rows[0];
  if (!organization) redirect("/");

  const roles = await query<{ role_id: string }>(
    `select role_id from user_organization_roles
     where user_id=$1 and organization_id=$2
     order by role_id`,
    [session.user.id, organization.organization_id]
  );
  const capabilities = roleCapabilities(roles.rows.map((row) => row.role_id));

  const client = await db.connect();
  try {
    const state = await listCameraSources(client, session.user.id, organization.organization_id);
    return (
      <CameraWorkspace
        organizationId={organization.organization_id}
        organizationName={organization.organization_name}
        initialSources={state.sources}
        edgeDevices={state.edgeDevices}
        hasPairedEdge={state.hasPairedEdge}
        staleAfterSeconds={state.staleAfterSeconds}
        canManage={capabilities.canSettings}
      />
    );
  } finally {
    client.release();
  }
}
