import { redirect } from "next/navigation";
import { auth } from "@auth";
import { MediaWorkspace } from "@/components/media/MediaWorkspace";
import { db } from "@/lib/db";
import { getCurrentServiceForUser } from "@/lib/current-service";
import { listMediaLibrary } from "@/lib/media-library";
import { loadPlannerServiceDetail } from "@/lib/planner-service-queries";

export const dynamic = "force-dynamic";
type MediaSourceRow = { id: string; name: string; source_type: string; status: string; media_kind: string | null };

export default async function MediaPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.forcePasswordChange) redirect("/change-password");
  const client = await db.connect();
  try {
    const context = await getCurrentServiceForUser(session.user.id, { client });
    if (!context || !context.roleCapabilities.canViewPlanner) redirect("/");
    const library = await listMediaLibrary(client, session.user.id, { organizationId: context.organizationId, limit: 100, offset: 0 });
    const sources = await client.query<MediaSourceRow>(
      `select id::text,name,source_type,status,nullif(public_config->>'mediaKind','') as media_kind
       from media_sources where organization_id=$1
       order by case status when 'live' then 0 when 'ready' then 1 else 2 end,name,id`, [context.organizationId]);
    let currentService = null;
    if (context.service) {
      const detail = await loadPlannerServiceDetail(client, session.user.id, context.service.id);
      currentService = { id: detail.service.id, title: detail.service.title, status: detail.service.status, revision: detail.revision, editable: detail.canEdit };
    }
    return <MediaWorkspace organizationId={context.organizationId} organizationName={context.organizationName}
      initialItems={library.items} currentService={currentService}
      mediaSources={sources.rows.map(source=>({id:source.id,name:source.name,type:source.source_type,status:source.status,mediaKind:source.media_kind}))}
      canEdit={context.roleCapabilities.canPlanServices}/>;
  } finally { client.release(); }
}
