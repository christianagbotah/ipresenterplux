import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { CockpitRecommendationError, listServicePins, setServicePin } from "@/lib/cockpit/recommendations";

export const dynamic = "force-dynamic";
const mutationSchema=z.object({
  organizationId:z.string().uuid(), serviceId:z.string().uuid(), targetType:z.string().trim().min(1).max(64),
  targetId:z.string().trim().min(1).max(220), title:z.string().trim().min(1).max(200),
  payload:z.record(z.string(),z.unknown()).optional(), pinned:z.boolean()
}).strict();

async function membership(client: PoolClient, userId:string, serviceId:string) {
  const result=await client.query<{organization_id:string}>(`select s.organization_id::text from services s where s.id=$1 and exists(select 1 from user_organization_roles uor where uor.user_id=$2 and uor.organization_id=s.organization_id) limit 1`,[serviceId,userId]);
  return result.rows[0]?.organization_id ?? null;
}

export async function GET(request:Request) {
  const session=await auth(); if(!session?.user?.id) return NextResponse.json({ok:false,error:"Authentication required"},{status:401});
  const serviceId=new URL(request.url).searchParams.get("serviceId") ?? "";
  if(!z.string().uuid().safeParse(serviceId).success) return NextResponse.json({ok:false,error:"Invalid service id"},{status:400});
  const client=await db.connect();
  try { const organizationId=await membership(client,session.user.id,serviceId); if(!organizationId) return NextResponse.json({ok:false,error:"Service not found"},{status:404}); return NextResponse.json({ok:true,pins:await listServicePins(client,{organizationId,serviceId})}); }
  finally { client.release(); }
}

export async function POST(request:Request) {
  const session=await auth(); if(!session?.user?.id) return NextResponse.json({ok:false,error:"Authentication required"},{status:401});
  const client=await db.connect();
  try { const input=mutationSchema.parse(await request.json()); await client.query("begin"); const pin=await setServicePin(client,session.user.id,input); await client.query("commit"); return NextResponse.json({ok:true,pin}); }
  catch(error){ await client.query("rollback").catch(()=>{}); if(error instanceof CockpitRecommendationError) return NextResponse.json({ok:false,error:error.message,code:error.code},{status:error.status}); if(error instanceof z.ZodError) return NextResponse.json({ok:false,error:"Invalid pin request"},{status:400}); console.error("Cockpit pin mutation failed",error); return NextResponse.json({ok:false,error:"Pin update failed"},{status:500}); }
  finally { client.release(); }
}
