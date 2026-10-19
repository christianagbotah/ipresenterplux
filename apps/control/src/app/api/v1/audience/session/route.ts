import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AudienceSessionError, touchAudienceSession } from "@/lib/audience-session";
import { publishServiceEvent } from "@/lib/realtime";

export const dynamic="force-dynamic";
const inputSchema=z.object({serviceId:z.string().uuid(),sessionId:z.string().uuid(),channelId:z.string().uuid().nullable().optional()}).strict();
const noStore={"Cache-Control":"no-store"};

export async function POST(request:Request) {
  const parsed=inputSchema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success) return NextResponse.json({ok:false,error:"Invalid audience session"},{status:400,headers:noStore});
  const client=await db.connect();
  try {
    await client.query("begin");
    const session=await touchAudienceSession(client,{sessionId:parsed.data.sessionId,serviceId:parsed.data.serviceId,languageChannelId:parsed.data.channelId??null});
    await client.query("commit");
    if(session.changed) await publishServiceEvent(parsed.data.serviceId,"language.channel.changed",{audienceDemandChanged:true});
    return NextResponse.json({ok:true,session},{headers:noStore});
  } catch(error) {
    await client.query("rollback");
    if(error instanceof AudienceSessionError) return NextResponse.json({ok:false,error:error.message,code:error.code},{status:error.status,headers:noStore});
    throw error;
  } finally { client.release(); }
}
