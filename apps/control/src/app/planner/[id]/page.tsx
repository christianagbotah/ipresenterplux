import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CalendarClock, MapPin, Radio } from "lucide-react";
import { z } from "zod";
import { auth } from "@auth";
import { ServicePlannerWorkspace } from "@/components/planner/ServicePlannerWorkspace";
import type { PlannerDetailPayload } from "@/components/planner/planner-workspace-types";
import { db } from "@/lib/db";
import { PlannerServiceError, loadPlannerServiceDetail } from "@/lib/planner-service-queries";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };
type BibleVersionRow = { id: string; name: string; abbreviation: string };
type MediaSourceRow = { id: string; name: string; source_type: string; media_kind: string | null };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function statusClass(status: string) {
  if (status === "ready") return "border-emerald-400/25 bg-emerald-400/10 text-emerald-200";
  if (status === "live") return "border-red-400/25 bg-red-400/10 text-red-200";
  if (status === "draft") return "border-amber-400/25 bg-amber-400/10 text-amber-200";
  return "border-white/10 bg-white/[.04] text-white/55";
}

function schedule(value: string | null, timeZone: string) {
  if (!value) return "Schedule not set";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

async function loadPlannerPageData(userId: string, id: string) {
  const client = await db.connect();
  try {
    const detail = await loadPlannerServiceDetail(client, userId, id);
    const bibleResult = await client.query<BibleVersionRow>(
      `select id,name,abbreviation
       from bible_versions
       where local_enabled=true
       order by name,id`
    );
    const mediaResult = await client.query<MediaSourceRow>(
      `select id::text,name,source_type,
              case when jsonb_typeof(public_config)='object' then public_config->>'mediaKind' else null end as media_kind
       from media_sources
       where organization_id=$1
       order by case when source_type='camera' then 1 else 0 end,name,id`,
      [detail.service.organizationId]
    );
    const initialDetail: PlannerDetailPayload = {
      service: detail.service,
      items: detail.items.map((item) => ({ ...item, content: asRecord(item.content) })),
      readiness: detail.readiness,
      revision: detail.revision,
      canEdit: detail.canEdit,
      edgeAssignment: detail.edgeAssignment
    };
    return {
      detail,
      initialDetail,
      bibleVersions: bibleResult.rows,
      mediaSources: mediaResult.rows.map((source) => ({
        id: source.id,
        name: source.name,
        sourceType: source.source_type,
        mediaKind: source.media_kind
      }))
    };
  } catch (error) {
    if (error instanceof PlannerServiceError && error.status === 404) notFound();
    throw error;
  } finally {
    client.release();
  }
}

export default async function PlannerServicePage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.forcePasswordChange) redirect("/change-password");

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const { detail, initialDetail, bibleVersions, mediaSources } = await loadPlannerPageData(session.user.id, id);

  return (
    <main className="min-h-screen bg-[#080b10] text-white">
      <header className="sticky top-0 z-40 border-b border-white/[.07] bg-[#090c12]/92 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1800px] flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/planner" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/[.08] bg-white/[.025] text-white/65 transition hover:bg-white/[.05] hover:text-white ip-focus-gold" aria-label="Back to Service Planner"><ArrowLeft size={18} /></Link>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-black tracking-tight sm:text-2xl">{detail.service.title}</h1>
                <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.12em] ${statusClass(detail.service.status)}`}>{detail.service.status}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/55">
                <span className="inline-flex items-center gap-1.5"><CalendarClock size={13} />{schedule(detail.service.scheduledStart, detail.service.timezone)}</span>
                <span className="inline-flex items-center gap-1.5"><MapPin size={13} />{detail.service.campusName ?? "All campuses"}</span>
                <span className="inline-flex items-center gap-1.5"><Radio size={13} />{detail.edgeAssignment.count} Edge assignment{detail.edgeAssignment.count === 1 ? "" : "s"}</span>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-white/[.07] bg-white/[.025] px-3.5 py-2.5 text-xs text-white/55">
            Revision <span className="ml-1 font-mono text-white/65">{detail.revision.slice(0, 10)}</span>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1800px] px-4 py-4 sm:px-6 lg:px-8 lg:py-6">
        <ServicePlannerWorkspace initialDetail={initialDetail} bibleVersions={bibleVersions} mediaSources={mediaSources} />
      </div>
    </main>
  );
}
