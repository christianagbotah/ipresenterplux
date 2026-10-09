import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { CockpitRecommendationError, setCockpitRecommendationState } from "@/lib/cockpit/recommendations";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };
const schema = z.object({
  state: z.enum(["suggested","prepared","accepted","dismissed","expired"]),
  previewResultType: z.string().trim().max(64).nullable().optional(),
  previewResultId: z.string().trim().max(220).nullable().optional()
}).strict();

export async function PATCH(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ok:false,error:"Authentication required"},{status:401});
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ok:false,error:"Invalid recommendation id"},{status:400});
  const client = await db.connect();
  try {
    const input = schema.parse(await request.json());
    await client.query("begin");
    const recommendation = await setCockpitRecommendationState(client, session.user.id, {recommendationId:id,...input});
    await client.query("commit");
    return NextResponse.json({ok:true,recommendation});
  } catch (error) {
    await client.query("rollback").catch(()=>{});
    if (error instanceof CockpitRecommendationError) return NextResponse.json({ok:false,error:error.message,code:error.code},{status:error.status});
    if (error instanceof z.ZodError) return NextResponse.json({ok:false,error:"Invalid recommendation state"},{status:400});
    console.error("Cockpit recommendation mutation failed",error);
    return NextResponse.json({ok:false,error:"Recommendation update failed"},{status:500});
  } finally { client.release(); }
}
