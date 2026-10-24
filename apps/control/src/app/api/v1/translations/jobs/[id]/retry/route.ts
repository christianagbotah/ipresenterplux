import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { EntitlementAccessError } from "@/lib/licensing/entitlement-access";
import { publishServiceEvent } from "@/lib/realtime";
import { retryTranslationJob, TranslationRecoveryError } from "@/lib/translation-recovery";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok:false,error:"Authentication required" },{status:401});
  if (session.user.forcePasswordChange) return NextResponse.json({ ok:false,error:"Password change required" },{status:403});
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ok:false,error:"Invalid translation job id"},{status:400});

  const client = await db.connect();
  try {
    await client.query("begin");
    const job = await retryTranslationJob(client, session.user.id, id);
    await client.query("commit");
    await publishServiceEvent(job.service_id, "translation.retry.requested", { id, languageChannelId:job.language_channel_id, targetLanguageCode:job.target_language_code });
    return NextResponse.json({ok:true,job});
  } catch (error) {
    await client.query("rollback").catch(()=>{});
    if (error instanceof TranslationRecoveryError || error instanceof EntitlementAccessError) {
      return NextResponse.json({ok:false,error:error.message,code:error.code},{status:error.httpStatus});
    }
    console.error("Translation retry failed",error);
    return NextResponse.json({ok:false,error:"Translation job could not be retried"},{status:500});
  } finally { client.release(); }
}
