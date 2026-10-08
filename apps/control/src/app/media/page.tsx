import { redirect } from "next/navigation";
import { auth } from "@auth";
import { MediaWorkspace } from "@/components/media/MediaWorkspace";
import { db, query } from "@/lib/db";
import { listMediaLibrary } from "@/lib/media-library";
import { loadPlannerServiceDetail } from "@/lib/planner-service-queries";
import { roleCapabilities } from "@/lib/role-capabilities";

export const dynamic = "force-dynamic";

type MembershipRow = { organization_id: string; organization_name: string };
type MediaSourceRow = { id: string; name: string; source_type: string; status: string; media_kind: string | null };

export default async function MediaPage() {
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
  if (!capabilities.canViewPlanner) redirect("/");

  const client = await db.connect();
  try {
    const library = await listMediaLibrary(client, session.user.id, {
      organizationId: organization.organization_id,
      limit: 100,
      offset: 0
    });
    const sources = await client.query<MediaSourceRow>(
      `select id::text,name,source_type,status,
              nullif(public_config->>'mediaKind','') as media_kind
       from media_sources
       where organization_id=$1
       order by case status when 'live' then 0 when 'ready' then 1 else 2 end,name,id`,
      [organization.organization_id]
    );
    const current = await client.query<{ id: string }>(
      `select id::text
       from services
       where organization_id=$1 and status in ('live','ready')
       order by case status when 'live' then 0 else 1 end,updated_at desc,id desc
       limit 1`,
      [organization.organization_id]
    );

    let currentService = null;
    if (current.rows[0]) {
      const detail = await loadPlannerServiceDetail(client, session.user.id, current.rows[0].id);
      currentService = {
        id: detail.service.id,
        title: detail.service.title,
        status: detail.service.status,
        revision: detail.revision,
        editable: detail.canEdit
      };
    }

    return (
      <MediaWorkspace
        organizationId={organization.organization_id}
        organizationName={organization.organization_name}
        initialItems={library.items}
        currentService={currentService}
        mediaSources={sources.rows.map((source) => ({
          id: source.id,
          name: source.name,
          type: source.source_type,
          status: source.status,
          mediaKind: source.media_kind
        }))}
        canEdit={capabilities.canPlanServices}
      />
    );
  } finally {
    client.release();
  }
}
