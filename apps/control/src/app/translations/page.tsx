import Link from "next/link";
import { ArrowLeft, Languages, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { auth } from "@auth";
import { AutoRefresh } from "@/components/AutoRefresh";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { TranslationDesk } from "@/components/translations/TranslationDesk";
import { query } from "@/lib/db";
import { TRANSLATION_OPERATOR_ROLES } from "@/lib/rbac";

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

  const membership = await query<{ organization_id: string }>(
    `select organization_id::text
     from user_organization_roles
     where user_id=$1 and role_id=any($2::text[])
     order by created_at
     limit 1`,
    [session.user.id, [...TRANSLATION_OPERATOR_ROLES]]
  );
  const organizationId = membership.rows[0]?.organization_id;
  if (!organizationId) redirect("/");

  const services = await query<{ id: string; title: string; status: string }>(
    `select id::text,title,status
     from services
     where organization_id=$1 and status in ('live','ready')
     order by case status when 'live' then 0 else 1 end,created_at desc
     limit 1`,
    [organizationId]
  );
  const service = services.rows[0];

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
            j.translated_text,j.provider,j.attempts,ts.source_observed_at::text,j.error_code
     from transcript_translation_jobs j
     join transcript_segments ts on ts.id=j.transcript_segment_id
     join services s on s.id=ts.service_id
     join language_channels lc on lc.id=j.language_channel_id
     where s.organization_id=$1
       and lc.organization_id=s.organization_id
       and ($2::uuid is null or s.id=$2::uuid)
       and j.status=$3
     order by ts.source_observed_at desc,j.created_at desc,j.id desc
     limit $4 offset $5`,
    [organizationId, service?.id ?? null, status, PAGE_SIZE, offset]
  );

  return (
    <main className="min-h-screen bg-[#07090d] text-white">
      {service ? <RealtimeRefresh serviceId={service.id} /> : <AutoRefresh intervalMs={10_000} />}
      <header className="sticky top-0 z-30 border-b border-white/[.07] bg-[#080b10]/92 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[.07] bg-white/[.025] text-white/45 hover:text-white" aria-label="Back to Control Room">
              <ArrowLeft size={17} />
            </Link>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#d7a94a]/25 bg-[#d7a94a]/10 text-[#efc76e]">
              <Languages size={18} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-black tracking-tight">Translation Desk</h1>
              <p className="truncate text-xs text-white/35">{service?.title ?? "Recent authorized services"} · human + machine translation queue</p>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-xl border border-emerald-400/15 bg-emerald-400/[.06] px-3 py-2 text-[11px] text-emerald-200/75 sm:flex">
            <ShieldCheck size={14} /> Authorized translator workspace
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl p-4 lg:p-6">
        <div className="mb-5 rounded-2xl border border-white/[.07] bg-white/[.025] px-4 py-3 text-xs leading-5 text-white/38">
          Manual translations use the same queue as the machine worker. Publishing here safely takes over any active machine lease and immediately refreshes the matching audience channel. Translation-audio channels still require the separate TTS stage before audio playback.
        </div>
        <TranslationDesk
          jobs={jobs.rows}
          serviceTitle={service?.title ?? null}
          counts={counts}
          status={status}
          page={page}
          totalPages={totalPages}
        />
      </div>
    </main>
  );
}
