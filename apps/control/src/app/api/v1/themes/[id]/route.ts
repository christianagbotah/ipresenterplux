import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { PresentationThemeError, deletePresentationTheme, getPresentationTheme, presentationThemeUpdateSchema, updatePresentationTheme } from "@/lib/presentation-themes";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id:string }> };

function failure(error: unknown) {
  if (error instanceof PresentationThemeError) return NextResponse.json({ ok:false,error:error.message,code:error.code }, { status:error.status });
  if (error instanceof z.ZodError) return NextResponse.json({ ok:false,error:"Invalid presentation theme",code:"theme_input_invalid",issues:error.issues }, { status:400 });
  console.error("Theme detail request failed", error);
  return NextResponse.json({ ok:false,error:"Presentation theme request failed" }, { status:500 });
}
async function sessionUser() {
  const session = await auth();
  if (!session?.user?.id) return { response:NextResponse.json({ ok:false,error:"Authentication required" }, { status:401 }) } as const;
  if (session.user.forcePasswordChange) return { response:NextResponse.json({ ok:false,error:"Password change required" }, { status:403 }) } as const;
  return { id:session.user.id } as const;
}
async function themeId(context: RouteContext) {
  const { id } = await context.params;
  return z.string().uuid().safeParse(id).success ? id : null;
}

export async function GET(_request: Request, context: RouteContext) {
  const user=await sessionUser(); if ("response" in user) return user.response;
  const id=await themeId(context); if (!id) return NextResponse.json({ ok:false,error:"Invalid theme id",code:"theme_id_invalid" }, { status:400 });
  try { return NextResponse.json({ ok:true,theme:await getPresentationTheme(db,user.id,id) }, { headers:{ "Cache-Control":"no-store" } }); }
  catch(error){ return failure(error); }
}

export async function PATCH(request: Request, context: RouteContext) {
  const user=await sessionUser(); if ("response" in user) return user.response;
  const id=await themeId(context); if (!id) return NextResponse.json({ ok:false,error:"Invalid theme id",code:"theme_id_invalid" }, { status:400 });
  const client=await db.connect();
  try { const body=presentationThemeUpdateSchema.parse(await request.json()); await client.query("begin"); const theme=await updatePresentationTheme(client,user.id,id,body); await client.query("commit"); return NextResponse.json({ ok:true,theme }, { headers:{ "Cache-Control":"no-store" } }); }
  catch(error){ await client.query("rollback").catch(()=>{}); return failure(error); }
  finally { client.release(); }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const user=await sessionUser(); if ("response" in user) return user.response;
  const id=await themeId(context); if (!id) return NextResponse.json({ ok:false,error:"Invalid theme id",code:"theme_id_invalid" }, { status:400 });
  const client=await db.connect();
  try { await client.query("begin"); const deleted=await deletePresentationTheme(client,user.id,id); await client.query("commit"); return NextResponse.json({ ok:true,deleted }, { headers:{ "Cache-Control":"no-store" } }); }
  catch(error){ await client.query("rollback").catch(()=>{}); return failure(error); }
  finally { client.release(); }
}
