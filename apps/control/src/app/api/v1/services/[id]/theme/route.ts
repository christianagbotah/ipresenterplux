import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { PresentationThemeError, assignServicePresentationTheme } from "@/lib/presentation-themes";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id:string }> };
const bodySchema = z.object({ themeId:z.string().uuid().nullable() }).strict();

function failure(error: unknown) {
  if (error instanceof PresentationThemeError) return NextResponse.json({ ok:false,error:error.message,code:error.code }, { status:error.status });
  if (error instanceof z.ZodError) return NextResponse.json({ ok:false,error:"Invalid theme assignment",code:"theme_assignment_invalid",issues:error.issues }, { status:400 });
  console.error("Service theme assignment failed", error);
  return NextResponse.json({ ok:false,error:"Service theme assignment failed" }, { status:500 });
}

export async function PATCH(request: Request, context: RouteContext) {
  const session=await auth();
  if (!session?.user?.id) return NextResponse.json({ ok:false,error:"Authentication required" }, { status:401 });
  if (session.user.forcePasswordChange) return NextResponse.json({ ok:false,error:"Password change required" }, { status:403 });
  const { id }=await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ ok:false,error:"Invalid service id",code:"service_id_invalid" }, { status:400 });
  const client=await db.connect();
  try { const body=bodySchema.parse(await request.json()); await client.query("begin"); const assignment=await assignServicePresentationTheme(client,session.user.id,id,body.themeId); await client.query("commit"); return NextResponse.json({ ok:true,assignment }, { headers:{ "Cache-Control":"no-store" } }); }
  catch(error){ await client.query("rollback").catch(()=>{}); return failure(error); }
  finally { client.release(); }
}
