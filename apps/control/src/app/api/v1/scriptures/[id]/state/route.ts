import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { LIVE_OPERATOR_ROLES, userHasAnyRole } from "@/lib/rbac";
import { publishServiceEvent } from "@/lib/realtime";
import { ScriptureStateError, transitionScriptureState } from "@/lib/scripture-state";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  state: z.enum(["detected", "preview", "live", "dismissed"])
});

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok:false,error:"Authentication required" },{status:401});
  if (session.user.forcePasswordChange) return NextResponse.json({ ok:false,error:"Password change required" },{status:403});

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ ok:false,error:"Invalid scripture detection id" },{status:400});

  try {
    const { state } = bodySchema.parse(await request.json());
    const client = await db.connect();
    try {
      await client.query("begin");
      const scope = await client.query<{ service_id:string; organization_id:string }>(
        `select sd.service_id::text,s.organization_id::text
           from scripture_detections sd
           join services s on s.id=sd.service_id
          where sd.id=$1::uuid`,
        [id]
      );
      const scoped = scope.rows[0];
      if (!scoped) {
        await client.query("rollback");
        return NextResponse.json({ok:false,error:"Scripture detection not found"},{status:404});
      }
      const allowed = await userHasAnyRole(session.user.id, scoped.organization_id, LIVE_OPERATOR_ROLES);
      if (!allowed) {
        await client.query("rollback");
        return NextResponse.json({ok:false,error:"You are not allowed to control live scripture output"},{status:403});
      }

      const result = await transitionScriptureState(client, {
        detectionId:id,
        targetState:state,
        actor:{type:"operator",userId:session.user.id},
        source:`scripture.state.${state}`
      });
      await client.query("commit");
      await publishServiceEvent(scoped.service_id,"scripture.state.changed",{
        id:result.scripture.id,
        reference:result.scripture.reference,
        from:result.fromState,
        to:result.scripture.state,
        edgeCommandsQueued:result.edgeCommandsQueued
      });
      return NextResponse.json({ok:true,scripture:{
        id:result.scripture.id,
        scripture_reference:result.scripture.reference,
        state:result.scripture.state,
        detected_at:result.scripture.detectedAt
      },edgeCommandsQueued:result.edgeCommandsQueued});
    } catch(error) {
      await client.query("rollback").catch(()=>{});
      throw error;
    } finally {
      client.release();
    }
  } catch(error) {
    if (error instanceof z.ZodError) return NextResponse.json({ok:false,error:"Invalid state",issues:error.issues},{status:400});
    if (error instanceof ScriptureStateError) return NextResponse.json({ok:false,error:error.message,code:error.code},{status:error.status});
    console.error("Scripture state transition failed",error);
    return NextResponse.json({ok:false,error:"State transition failed"},{status:500});
  }
}
