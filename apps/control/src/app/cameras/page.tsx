import { redirect } from "next/navigation";
import { auth } from "@auth";
import { VisualSourcesWorkspace } from "@/components/cameras/VisualSourcesWorkspace";
import { db } from "@/lib/db";
import { getCurrentServiceForUser } from "@/lib/current-service";
import { listVisualSources } from "@/lib/camera-sources";

export const dynamic = "force-dynamic";

export default async function CamerasPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.forcePasswordChange) redirect("/change-password");

  const client = await db.connect();
  try {
    const context = await getCurrentServiceForUser(session.user.id, { client });
    if (!context) redirect("/");
    const state = await listVisualSources(client, session.user.id, context.organizationId);
    return <VisualSourcesWorkspace
      organizationId={context.organizationId}
      organizationName={context.organizationName}
      initialSources={state.sources}
      edgeDevices={state.edgeDevices}
      hasPairedEdge={state.hasPairedEdge}
      staleAfterSeconds={state.staleAfterSeconds}
      canManage={context.roleCapabilities.canSettings}
      canLiveControl={context.roleCapabilities.canLiveControl}
      serviceId={context.service?.id ?? null}
    />;
  } finally {
    client.release();
  }
}
