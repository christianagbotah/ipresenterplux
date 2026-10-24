import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePlannerSession } from "@/lib/planner-auth";
import { PlannerServiceError, loadPlannerServiceDetail } from "@/lib/planner-service-queries";
import { buildServicePreparationContext } from "@/lib/service-intelligence/preparation";
import { ServiceIntelligenceError, upsertServicePreparationNote } from "@/lib/service-intelligence/notes";

export const dynamic = "force-dynamic";
type RouteContext={params:Promise<{id:string}>};
const noteSchema=z.object({noteId:z.string().uuid().optional(),noteType:z.enum(["sermon_notes","service_notes","operator_notes"]),title:z.string().min(1).max(160),content:z.string().min(1).max(100001),sourceLabel:z.string().max(240).nullable().optional()}).strict();
function failure(error:unknown){
  if(error instanceof ServiceIntelligenceError || error instanceof PlannerServiceError) return NextResponse.json({ok:false,error:error.message,code:error.code},{status:error.status});
  if(error instanceof z.ZodError) return NextResponse.json({ok:false,error:"Invalid preparation request",code:"service_preparation_invalid",issues:error.issues},{status:400});
  console.error("Service preparation request failed",error); return NextResponse.json({ok:false,error:"Service preparation request failed"},{status:500});
}
export async function GET(_request:Request,context:RouteContext){
  const session=await requirePlannerSession(); if(!session.ok) return session.response; const {id}=await context.params;
  if(!z.string().uuid().safeParse(id).success) return NextResponse.json({ok:false,error:"Invalid service id"},{status:400});
  const client=await db.connect(); try { const [preparation,detail]=await Promise.all([buildServicePreparationContext(client,session.userId,id),loadPlannerServiceDetail(client,session.userId,id)]); return NextResponse.json({ok:true,preparation,revision:detail.revision}); } catch(error){return failure(error);} finally{client.release();}
}
export async function POST(request:Request,context:RouteContext){
  const session=await requirePlannerSession(); if(!session.ok) return session.response; const {id}=await context.params;
  if(!z.string().uuid().safeParse(id).success) return NextResponse.json({ok:false,error:"Invalid service id"},{status:400});
  const client=await db.connect(); try { const body=noteSchema.parse(await request.json()); await client.query("begin"); const note=await upsertServicePreparationNote(client,session.userId,{serviceId:id,...body}); await client.query("commit"); return NextResponse.json({ok:true,note}); } catch(error){await client.query("rollback").catch(()=>{}); return failure(error);} finally{client.release();}
}
