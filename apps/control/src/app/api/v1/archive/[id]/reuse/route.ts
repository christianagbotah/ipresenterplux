import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePlannerSession } from "@/lib/planner-auth";
import { ArchiveError, reuseArchivedItemsInServicePlan } from "@/lib/archive";
import { PlannerServiceError } from "@/lib/planner-service-queries";
import { PlannerItemError } from "@/lib/planner-item-schemas";

export const dynamic="force-dynamic";
type RouteContext={params:Promise<{id:string}>};
const bodySchema=z.object({targetServiceId:z.string().uuid(),itemIds:z.array(z.string().uuid()).min(1).max(20)}).strict();
function revision(value:string|null){return value?.trim().replace(/^W\//,"").replace(/^"|"$/g,"")||null;}
function errorResponse(error:unknown){
  if(error instanceof ArchiveError||error instanceof PlannerServiceError||error instanceof PlannerItemError) return NextResponse.json({ok:false,error:error.message,code:error.code},{status:error.status});
  if(error instanceof z.ZodError) return NextResponse.json({ok:false,error:"Invalid archive reuse request",issues:error.issues},{status:400});
  console.error("Archive reuse failed",error); return NextResponse.json({ok:false,error:"Archived items could not be reused"},{status:500});
}
export async function POST(request:Request,context:RouteContext){
  const session=await requirePlannerSession(); if(!session.ok) return session.response;
  const {id}=await context.params; if(!z.string().uuid().safeParse(id).success) return NextResponse.json({ok:false,error:"Invalid archived service id"},{status:400});
  const expectedRevision=revision(request.headers.get("if-match"));
  if(!expectedRevision) return NextResponse.json({ok:false,error:"Planner revision is required",code:"planner_revision_required"},{status:428});
  const client=await db.connect();
  try{
    const body=bodySchema.parse(await request.json()); await client.query("begin");
    const result=await reuseArchivedItemsInServicePlan(client,session.userId,{sourceServiceId:id,targetServiceId:body.targetServiceId,sourceItemIds:body.itemIds,expectedRevision});
    await client.query("commit");
    return NextResponse.json({ok:true,...result},{headers:{ETag:`"${result.revision}"`}});
  }catch(error){await client.query("rollback").catch(()=>{});return errorResponse(error);}finally{client.release();}
}
