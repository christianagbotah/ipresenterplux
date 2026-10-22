import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { PresentationThemeError, createPresentationTheme, listPresentationThemes, presentationAppearanceSchema } from "@/lib/presentation-themes";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  templateKey: z.string().trim().min(1).max(80),
  appearance: presentationAppearanceSchema
}).strict();

function failure(error: unknown) {
  if (error instanceof PresentationThemeError) return NextResponse.json({ ok:false,error:error.message,code:error.code }, { status:error.status });
  if (error instanceof z.ZodError) return NextResponse.json({ ok:false,error:"Invalid presentation theme",code:"theme_input_invalid",issues:error.issues }, { status:400 });
  console.error("Theme request failed", error);
  return NextResponse.json({ ok:false,error:"Presentation theme request failed" }, { status:500 });
}

async function userId() {
  const session = await auth();
  if (!session?.user?.id) return { response: NextResponse.json({ ok:false,error:"Authentication required" }, { status:401 }) } as const;
  if (session.user.forcePasswordChange) return { response: NextResponse.json({ ok:false,error:"Password change required" }, { status:403 }) } as const;
  return { id:session.user.id } as const;
}

export async function GET(request: Request) {
  const user = await userId();
  if ("response" in user) return user.response;
  const organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!organizationId || !z.string().uuid().safeParse(organizationId).success) return NextResponse.json({ ok:false,error:"Invalid organization id",code:"organization_id_invalid" }, { status:400 });
  try {
    const themes = await listPresentationThemes(db, user.id, organizationId);
    return NextResponse.json({ ok:true,themes }, { headers:{ "Cache-Control":"no-store" } });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const user = await userId();
  if ("response" in user) return user.response;
  const client = await db.connect();
  try {
    const body = createSchema.parse(await request.json());
    await client.query("begin");
    const theme = await createPresentationTheme(client, user.id, body.organizationId, body);
    await client.query("commit");
    return NextResponse.json({ ok:true,theme }, { status:201,headers:{ "Cache-Control":"no-store" } });
  } catch (error) {
    await client.query("rollback").catch(()=>{});
    return failure(error);
  } finally { client.release(); }
}
