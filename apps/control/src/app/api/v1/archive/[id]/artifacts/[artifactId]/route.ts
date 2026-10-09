import { NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { ArchiveError, resolveArchiveArtifactAccess } from "@/lib/archive";
export const dynamic="force-dynamic";
export async function GET(_request:Request,{params}:{params:Promise<{id:string;artifactId:string}>}) {
  const session=await auth();
  if(!session?.user?.id) return NextResponse.json({ok:false,error:"Authentication required"},{status:401,headers:{"Cache-Control":"no-store"}});
  if(session.user.forcePasswordChange) return NextResponse.json({ok:false,error:"Password change required"},{status:403,headers:{"Cache-Control":"no-store"}});
  const {id,artifactId}=await params; const client=await db.connect();
  try {
    const result=await resolveArchiveArtifactAccess(client,session.user.id,id,artifactId);
    if(result.kind==='redirect') return NextResponse.redirect(result.url,307);
    return NextResponse.json({ok:false,status:result.status,artifact:result.artifact},{status:410,headers:{"Cache-Control":"no-store"}});
  } catch(error) {
    if(error instanceof ArchiveError) return NextResponse.json({ok:false,error:error.message,code:error.code},{status:error.status,headers:{"Cache-Control":"no-store"}});
    console.error('Archive artifact access failed',error);
    return NextResponse.json({ok:false,error:'Archive artifact unavailable'},{status:500,headers:{"Cache-Control":"no-store"}});
  } finally { client.release(); }
}
