import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { query } from "@/lib/db";
import { TRANSLATION_OPERATOR_ROLES } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const statusSchema = z.enum(["pending", "processing", "succeeded", "failed"]);

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }
  if (session.user.forcePasswordChange) {
    return NextResponse.json({ ok: false, error: "Password change required" }, { status: 403 });
  }

  try {
    const url = new URL(request.url);
    const rawServiceId = url.searchParams.get("serviceId");
    const serviceId = rawServiceId && z.string().uuid().safeParse(rawServiceId).success
      ? rawServiceId
      : null;
    if (rawServiceId && !serviceId) {
      return NextResponse.json({ ok: false, error: "Invalid serviceId" }, { status: 400 });
    }

    const status = statusSchema.parse(url.searchParams.get("status") ?? "pending");
    const requestedLimit = Number(url.searchParams.get("limit") ?? 50);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(100, Math.max(1, Math.trunc(requestedLimit)))
      : 50;

    const result = await query<{
      id: string;
      organization_id: string;
      service_id: string;
      service_title: string;
      transcript_segment_id: string;
      source_text: string;
      source_language: string | null;
      language_channel_id: string;
      target_language_code: string;
      language_name: string;
      channel_mode: string;
      status: string;
      translated_text: string | null;
      provider: string | null;
      attempts: number;
      source_observed_at: string;
      created_at: string;
    }>(
      `select j.id::text,s.organization_id::text,j.transcript_segment_id::text,
              s.id::text as service_id,s.title as service_title,
              ts.text as source_text,ts.source_language,
              j.language_channel_id::text,j.target_language_code,lc.language_name,j.channel_mode,
              j.status,j.translated_text,j.provider,j.attempts,
              ts.source_observed_at::text,j.created_at::text
       from transcript_translation_jobs j
       join transcript_segments ts on ts.id=j.transcript_segment_id
       join services s on s.id=ts.service_id
       join language_channels lc on lc.id=j.language_channel_id
       where j.status=$2
         and lc.organization_id=s.organization_id
         and ($3::uuid is null or s.id=$3::uuid)
         and exists (
           select 1 from user_organization_roles uor
           where uor.user_id=$1
             and uor.organization_id=s.organization_id
             and uor.role_id=any($4::text[])
         )
       order by ts.source_observed_at asc,j.created_at asc,j.id asc
       limit $5`,
      [session.user.id, status, serviceId, [...TRANSLATION_OPERATOR_ROLES], limit]
    );

    return NextResponse.json({ ok: true, jobs: result.rows });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Invalid translation job filter", issues: error.issues }, { status: 400 });
    }
    console.error("Translation job listing failed", error);
    return NextResponse.json({ ok: false, error: "Translation jobs could not be loaded" }, { status: 500 });
  }
}
