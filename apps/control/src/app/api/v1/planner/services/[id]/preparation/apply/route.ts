import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePlannerSession } from "@/lib/planner-auth";
import { PlannerServiceError } from "@/lib/planner-service-queries";
import { applyServicePreparationSuggestion } from "@/lib/service-intelligence/preparation";
import { ServiceIntelligenceError } from "@/lib/service-intelligence/notes";

export const dynamic="force-dynamic";
type RouteContext={params:Promise<{id:string}>};
const bodySchema=z.object({suggestionId:z.string().trim().min(1).max(500)}).strict();
function revisionFrom(request:Request){const value=request.headers.get("if-match"); return value?.trim().replace(/^W\//,"").replace(/^"|"$/g,"")||null;}
function failure(error:unknown){
 if(error instanceof ServiceIntelligenceError || error instanceof PlannerServiceError) return NextResponse.json({ok:false,error:error.message,code:error.code},{status:error.status});
 if(error instanceof z.ZodError) return NextResponse.json({ok:false,error:"Invalid preparation suggestion",code:"service_preparation_invalid"},{status:400});
 console.error("Preparation suggestion apply failed",error); return NextResponse.json({ok:false,error:"Preparation suggestion could not be applied"},{status:500});
}
export async function POST(request:Request,context:RouteContext){
 const session=await requirePlannerSession(); if(!session.ok) return session.response; const {id}=await context.params;
 if(!z.string().uuid().safeParse(id).success) return NextResponse.json({ok:false,error:"Invalid service id"},{status:400});
 const revision=revisionFrom(request); if(!revision) return NextResponse.json({ok:false,error:"Planner revision is required",code:"planner_revision_required"},{status:428});
 const client=await db.connect(); try { const body=bodySchema.parse(await request.json()); await client.query("begin"); const result=await applyServicePreparationSuggestion(client,session.userId,{serviceId:id,suggestionId:body.suggestionId,expectedRevision:revision}); await client.query("commit"); return NextResponse.json({ok:true,...result},{headers:{ETag:`"${result.revision}"`}}); } catch(error){await client.query("rollback").catch(()=>{}); return failure(error);} finally{client.release();}
}
