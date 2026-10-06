import Link from "next/link";
import { ArrowLeft, MonitorPlay, Settings2 } from "lucide-react";
import { redirect } from "next/navigation";
import { auth } from "@auth";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { ScriptureOperatorWorkspace } from "@/components/ScriptureOperatorWorkspace";
import { ServiceControls } from "@/components/ServiceControls";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { query } from "@/lib/db";
import { LIVE_OPERATOR_ROLES, userHasAnyRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";

type ServiceRow = {
  id: string;
  organization_id: string;
  title: string;
  status: string;
  active_bible_version: string;
};

type DetectionRow = {
  id: string;
  scripture_reference: string;
  confidence: string;
  state: string;
  bible_version: string;
  detection_method: string;
  source_text: string | null;
  passage_text: string | null;
  detected_at: string;
};

type EdgeCommandRow = {
  id: string;
  command_type: string;
  state: "pending" | "delivered" | "succeeded" | "failed" | "expired";
  item_id: string | null;
  resulting_state: string | null;
  error_code: string | null;
  issued_at: string;
  completed_at: string | null;
};

async function operatorData(userId: string) {
  const services = await query<ServiceRow>(
    `select s.id::text,s.organization_id::text,s.title,s.status,s.active_bible_version
     from services s
     where exists (
       select 1 from user_organization_roles uor
       where uor.user_id=$1 and uor.organization_id=s.organization_id
     )
     order by case when s.status='live' then 0 when s.status='ready' then 1 else 2 end,s.created_at desc
     limit 1`,
    [userId]
  );

  const service = services.rows[0];
  if (!service) return { service: undefined, detections: [], commands: [], canControl: false };

  const [detections, commands, canControl] = await Promise.all([
    query<DetectionRow>(
      `select sd.id::text,sd.scripture_reference,sd.confidence::text,sd.state,sd.bible_version,
              sd.detection_method,sd.source_text,sd.detected_at::text,
              (
                select string_agg(bv.text, ' ' order by bv.verse)
                from bible_books bb
                join bible_verses bv
                  on bv.version_id=bb.version_id and bv.book_code=bb.book_code
                where bb.version_id=sd.bible_version
                  and lower(bb.canonical_name)=lower(sd.book)
                  and bv.chapter=sd.chapter
                  and bv.verse between sd.verse_start and coalesce(sd.verse_end,sd.verse_start)
              ) as passage_text
       from scripture_detections sd
       where sd.service_id=$1::uuid
         and sd.state <> 'dismissed'
       order by sd.source_observed_at desc,sd.source_ordinal desc,sd.detected_at desc,sd.id desc
       limit 30`,
      [service.id]
    ),
    query<EdgeCommandRow>(
      `select id::text,command_type,state,arguments->>'itemId' as item_id,resulting_state,error_code,
              issued_at::text,completed_at::text
       from edge_control_commands
       where service_id=$1::uuid
         and command_type = any($2::text[])
       order by issued_at desc,id desc
       limit 40`,
      [service.id, ["preview.prepare", "program.show", "program.clear"]]
    ),
    userHasAnyRole(userId, service.organization_id, LIVE_OPERATOR_ROLES)
  ]);

  return { service, detections: detections.rows, commands: commands.rows, canControl };
}

export default async function OperatorPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.forcePasswordChange) redirect("/change-password");

  const data = await operatorData(session.user.id);
  if (!data.service) redirect("/");

  const service = data.service;
  const detections = data.detections.map((item) => ({
    id: item.id,
    scriptureReference: item.scripture_reference,
    confidence: Number(item.confidence),
    state: item.state,
    bibleVersion: item.bible_version,
    detectionMethod: item.detection_method,
    sourceText: item.source_text,
    passageText: item.passage_text,
    detectedAt: item.detected_at
  }));
  const commands = data.commands.map((item) => ({
    id: item.id,
    type: item.command_type,
    state: item.state,
    itemId: item.item_id,
    resultingState: item.resulting_state,
    errorCode: item.error_code,
    issuedAt: item.issued_at,
    completedAt: item.completed_at
  }));

  return (
    <main className="min-h-screen bg-[#070a0f] text-white">
      <RealtimeRefresh serviceId={service.id} />

      <header className="sticky top-0 z-40 border-b border-white/[.07] bg-[#080b10]/92 backdrop-blur-xl">
        <div className="mx-auto flex min-h-16 max-w-[1800px] items-center justify-between gap-3 px-3 sm:px-5 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[.08] bg-white/[.03] text-white/55 transition hover:bg-white/[.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e5b95e]"
              aria-label="Back to Control Room"
            >
              <ArrowLeft size={18} />
            </Link>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#d7a94a]/25 bg-[#d7a94a]/10 text-[#efc86f]">
              <MonitorPlay size={19} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-sm font-black sm:text-base">iPresenterPlux Operator</h1>
                <span className={`hidden rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[.13em] sm:inline-flex ${service.status === "live" ? "border-red-400/25 bg-red-400/10 text-red-200" : "border-emerald-400/20 bg-emerald-400/[.08] text-emerald-200"}`}>{service.status}</span>
              </div>
              <div className="mt-0.5 truncate text-[11px] text-white/34">{service.title} · {service.active_bible_version}</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/settings"
              className="hidden min-h-10 items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.025] px-3 text-xs font-bold text-white/45 transition hover:text-white md:flex"
            >
              <Settings2 size={15} /> Settings
            </Link>
            <LogoutButton />
            {data.canControl ? (
              <ServiceControls serviceId={service.id} status={service.status} showOperatorLink={false} />
            ) : (
              <span className="rounded-xl border border-amber-400/20 bg-amber-400/[.08] px-3 py-2 text-xs font-bold text-amber-100">View only</span>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1800px] p-3 sm:p-4 lg:p-6">
        <ScriptureOperatorWorkspace
          serviceId={service.id}
          serviceTitle={service.title}
          serviceStatus={service.status}
          detections={detections}
          commands={commands}
          canControl={data.canControl}
        />
      </div>
    </main>
  );
}
