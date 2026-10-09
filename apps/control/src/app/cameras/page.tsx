import { redirect } from "next/navigation";
import { auth } from "@auth";
import { CameraWorkspace } from "@/components/cameras/CameraWorkspace";
import { db } from "@/lib/db";
import { getCurrentServiceForUser } from "@/lib/current-service";
import { listCameraSources } from "@/lib/camera-sources";
export const dynamic = "force-dynamic";
export default async function CamerasPage() {
  const session=await auth(); if(!session?.user) redirect('/login'); if(session.user.forcePasswordChange) redirect('/change-password');
  const client=await db.connect();
  try {
    const context=await getCurrentServiceForUser(session.user.id,{client}); if(!context) redirect('/');
    const state=await listCameraSources(client,session.user.id,context.organizationId);
    return <CameraWorkspace organizationId={context.organizationId} organizationName={context.organizationName}
      initialSources={state.sources} edgeDevices={state.edgeDevices} hasPairedEdge={state.hasPairedEdge}
      staleAfterSeconds={state.staleAfterSeconds} canManage={context.roleCapabilities.canSettings}/>;
  } finally { client.release(); }
}
