import { redirect } from "next/navigation";
import { auth } from "@auth";
import { AIDirectorWorkspace } from "@/components/ai-director/AIDirectorWorkspace";
import { db } from "@/lib/db";
import { getCurrentServiceForUser } from "@/lib/current-service";
import { getAIDirectorState } from "@/lib/ai-director";
export const dynamic="force-dynamic";
export default async function AIDirectorPage(){
  const session=await auth(); if(!session?.user) redirect('/login'); if(session.user.forcePasswordChange) redirect('/change-password');
  const client=await db.connect();
  try {
    const context=await getCurrentServiceForUser(session.user.id,{client}); if(!context) redirect('/');
    const state=await getAIDirectorState(client,session.user.id,{organizationId:context.organizationId,serviceId:context.service?.id});
    return <AIDirectorWorkspace organizationName={context.organizationName} state={state}/>;
  } finally { client.release(); }
}
