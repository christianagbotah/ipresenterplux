import { Languages } from "lucide-react";
import { redirect } from "next/navigation";
import { auth } from "@auth";
import { AutoRefresh } from "@/components/AutoRefresh";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { WorkspaceShell } from "@/components/navigation/WorkspaceShell";
import { TranslationDesk } from "@/components/translations/TranslationDesk";
import { query } from "@/lib/db";
import { getCurrentServiceForUser } from "@/lib/current-service";

export const dynamic = "force-dynamic";

type JobRow = {
  id: string;
  service_title: string;
  source_text: string;
  source_language: string | null;
  target_language_code: string;
  language_name: string;
  channel_mode: string;
  status: "pending" | "processing" | "succeeded" | "failed";
  translated_text: string | null;
  provider: string | null;
  attempts: number;
  source_observed_at: string;
  error_code: string | null;
  synthesis_status: "pending" | "processing" | "succeeded" | "failed" | null;
  synthesis_provider: string | null;
  synthesis_error_code: string | null;
};

const jobStatuses = ["pending", "processing", "succeeded", "failed"] as const;
type JobStatus = (typeof jobStatuses)[number];
const PAGE_SIZE = 50;

export default async function TranslationsPage({
  searchParams
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const { status: rawStatus, page: rawPage } = await searchParams;
  const status: JobStatus = jobStatuses.includes(rawStatus as JobStatus) ? rawStatus as JobStatus : "pending";
  const parsedPage = Number.parseInt(rawPage ?? "1", 10);
  const requestedPage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.forcePasswordChange) redirect("/change-password");

  const context = await getCurrentServiceForUser(session.user.id);
  if (!context || !context.capabilities.canTranslations) redirect("/");
  const organizationId = context.organizationId;
  const service = context.service ? {
    id: context.service.id,
    title: context.service.title,
    status: context.service.status
  } : null;

  const countsResult = await query<{ status: JobStatus; count: number }>(
    `select j.status,count(*)::int as count
     from transcript_translation_jobs j
     join transcript_segments ts on ts.id=j.transcript_segment_id
     join services s on s.id=ts.service_id
     join language_channels lc on lc.id=j.language_channel_id
     where s.organization_id=$1
       and lc.organization_id=s.organization_id
       and ($2::uuid is null or s.id=$2::uuid)
     group by j.status`,
    [organizationId, service?.id ?? null]
  );
  const counts = Object.fromEntries(jobStatuses.map((item) => [item, 0])) as Record<JobStatus, number>;
  for (const row of countsResult.rows) counts[row.status] = row.count;
  const totalPages = Math.max(1, Math.ceil(counts[status] / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * PAGE_SIZE;

  const jobs = await query<JobRow>(
    `select j.id::text,s.title as service_title,ts.text as source_text,ts.source_language,
            j.target_language_code,lc.language_name,j.channel_mode,j.status,
            j.translated_text,j.provider,j.attempts,ts.source_observed_at::text,j.error_code,
            sj.status as synthesis_status,sj.provider as synthesis_provider,sj.error_code as synthesis_error_code
     from transcript_translation_jobs j
     join transcript_segments ts on ts.id=j.transcript_segment_id
     join services s on s.id=ts.service_id
     join language_channels lc on lc.id=j.language_channel_id
     left join speech_synthesis_jobs sj on sj.translation_job_id=j.id
     where s.organization_id=$1
       and lc.organization_id=s.organization_id
       and ($2::uuid is null or s.id=$2::uuid)
       and j.status=$3
     order by ts.source_observed_at desc,j.created_at desc,j.id desc
     limit $4 offset $5`,
    [organizationId, service?.id ?? null, status, PAGE_SIZE, offset]
  );

  return (
    <WorkspaceShell
      capabilities={context.navigationCapabilities}
      icon={Languages}
      title="Translation Desk"
      subtitle={`${service?.title ?? "Recent authorized services"} · human + machine translation queue`}
    >
      {service ? <RealtimeRefresh serviceId={service.id} /> : <AutoRefresh intervalMs={10_000} />}
      <div className="mx-auto max-w-7xl p-4 lg:p-6">
        <TranslationDesk
          jobs={jobs.rows}
          serviceTitle={service?.title ?? null}
          counts={counts}
          status={status}
          page={page}
          totalPages={totalPages}
        />
      </div>
    </WorkspaceShell>
  );
}
