import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { query } from "@/lib/db";
import { INGEST_ROLES, userHasAnyRole } from "@/lib/rbac";
import {
  findServiceById,
  ingestTranscriptForService,
  type ServiceContext
} from "@/lib/transcript-ingest";

export const dynamic = "force-dynamic";

const inputSchema = z.object({
  serviceId: z.string().uuid().optional(),
  text: z.string().trim().min(1).max(10_000),
  bibleVersion: z.string().min(2).max(40).optional(),
  language: z.string().trim().min(2).max(35).regex(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/).nullish(),
  speakerId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/).nullish(),
  confidence: z.number().min(0).max(1).nullish()
});

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
    }
  if (session.user.forcePasswordChange) {
    return NextResponse.json({ ok: false, error: "Password change required" }, { status: 403 });
  }

    const payload = inputSchema.parse(await request.json());
    let service: ServiceContext | undefined;

    if (payload.serviceId) {
      service = await findServiceById(payload.serviceId);
    } else {
      const found = await query<ServiceContext>(
        `select s.id,s.organization_id::text,s.campus_id::text,s.active_bible_version,s.auto_preview_threshold::text
         from services s
         where s.status in ('live','ready')
           and exists (
             select 1 from user_organization_roles uor
             where uor.user_id=$1
               and uor.organization_id=s.organization_id
               and uor.role_id=any($2::text[])
           )
         order by case when s.status='live' then 0 else 1 end,s.created_at desc
         limit 1`,
        [session.user.id, [...INGEST_ROLES]]
      );
      service = found.rows[0];
    }

    if (!service) {
      return NextResponse.json({ ok: false, error: "No active or ready service found" }, { status: 404 });
    }

    const allowed = await userHasAnyRole(session.user.id, service.organization_id, INGEST_ROLES);
    if (!allowed) {
      return NextResponse.json({ ok: false, error: "You are not allowed to ingest live transcript events" }, { status: 403 });
    }

    return NextResponse.json(await ingestTranscriptForService(service, payload));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Invalid transcript payload", issues: error.issues }, { status: 400 });
    }
    console.error("Operator transcript ingestion failed", error);
    return NextResponse.json({ ok: false, error: "Transcript processing failed" }, { status: 500 });
  }
}
