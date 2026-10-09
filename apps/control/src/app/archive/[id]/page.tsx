import { notFound, redirect } from "next/navigation";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { ArchiveError, getArchivedService } from "@/lib/archive";
import { ArchiveServiceDetail } from "@/components/archive/ArchiveServiceDetail";
export const dynamic="force-dynamic";
export default async function ArchiveDetailPage({params}:{params:Promise<{id:string}>}) {
  const session=await auth(); if(!session?.user) redirect('/login'); if(session.user.forcePasswordChange) redirect('/change-password');
  const {id}=await params; const client=await db.connect();
  let detail: Awaited<ReturnType<typeof getArchivedService>>;
  try { detail=await getArchivedService(client,session.user.id,id); }
  catch(error){ if(error instanceof ArchiveError && error.status===404) notFound(); throw error; }
  finally { client.release(); }
  return <ArchiveServiceDetail detail={detail}/>;
}
