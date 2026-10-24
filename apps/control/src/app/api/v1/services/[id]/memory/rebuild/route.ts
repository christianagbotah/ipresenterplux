import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { buildServiceMemory } from "@/lib/service-intelligence/memory";
import { ServiceIntelligenceError } from "@/lib/service-intelligence/notes";

export const dynamic="force-dynamic";
type RouteContext={params:Promise<{id:string}>};

export async function POST(_request:Request,context:RouteContext){
  const session=await auth();
  if(!session?.user?.id) return NextResponse.json({ok:false,error:"Authentication required"},{status:401});
  if(session.user.forcePasswordChange) return NextResponse.json({ok:false,error:"Password change required"},{status:403});
  const {id}=await context.params;
  if(!z.string().uuid().safeParse(id).success) return NextResponse.json({ok:false,error:"Invalid service id"},{status:400});
  const client=await db.connect();
  try{
    await client.query("begin");
    const result=await buildServiceMemory(client,session.user.id,id);
    await client.query("commit");
    return NextResponse.json({ok:true,...result});
  }catch(error){
    await client.query("rollback").catch(()=>{});
    if(error instanceof ServiceIntelligenceError) return NextResponse.json({ok:false,error:error.message,code:error.code},{status:error.status});
    console.error("Service memory rebuild failed",error);
    return NextResponse.json({ok:false,error:"Service memory rebuild failed"},{status:500});
  }finally{client.release();}
}
