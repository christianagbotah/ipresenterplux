import {
  Activity,
  AudioLines,
  BookOpen,
  Bot,
  RadioTower,
  Camera,
  Captions,
  ChevronRight,
  CircleDot,
  Cloud,
  Languages,
  LayoutDashboard,
  MonitorPlay,
  Music2,
  Settings2,
  Sparkles,
  Users,
  Video,
  Wifi
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@auth";
import { AutoRefresh } from "@/components/AutoRefresh";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { ScriptureControls } from "@/components/ScriptureControls";
import { ServiceControls } from "@/components/ServiceControls";
import { OutputControls } from "@/components/OutputControls";
import { AudienceAccessCard } from "@/components/audience/AudienceAccessCard";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

type ServiceRow = {
  id: string;
  organization_id: string;
  title: string;
  status: string;
  active_bible_version: string;
  auto_preview_threshold: string;
};

type OutputRow = {
  id: string;
  name: string;
  destination_type: string;
  enabled: boolean;
  status: string;
};

type LanguageRow = {
  id: string;
  language_code: string;
  language_name: string;
  channel_mode: string;
  enabled: boolean;
  listener_count: number;
};

type DetectionRow = {
  id: string;
  scripture_reference: string;
  confidence: string;
  state: string;
  bible_version: string;
  source_text: string | null;
  passage_text: string | null;
  detected_at: string;
};

type IntegrationRow = {
  provider: string;
  status: string;
  integration_type: string;
};

async function dashboardData(userId: string) {
  const services = await query<ServiceRow>(
    `select s.id,s.organization_id::text,s.title,s.status,s.active_bible_version,s.auto_preview_threshold::text
     from services s
     where exists (
       select 1 from user_organization_roles uor
       where uor.user_id=$1 and uor.organization_id=s.organization_id
     )
     order by case when s.status='live' then 0 when s.status='ready' then 1 else 2 end,s.created_at desc
     limit 1`,
    [userId]
  );

  let organizationId = services.rows[0]?.organization_id;
  if (!organizationId) {
    const membership = await query<{ organization_id: string }>(
      "select organization_id::text from user_organization_roles where user_id=$1 order by created_at limit 1",
      [userId]
    );
    organizationId = membership.rows[0]?.organization_id;
  }

  if (!organizationId) {
    return { service: undefined, outputs: [], languages: [], detections: [], integrations: [] };
  }

  const [outputs, languages, detections, integrations] = await Promise.all([
    query<OutputRow>(
      "select id,name,destination_type,enabled,status from output_destinations where organization_id=$1 order by enabled desc,name",
      [organizationId]
    ),
    query<LanguageRow>(
      "select id,language_code,language_name,channel_mode,enabled,listener_count from language_channels where organization_id=$1 order by enabled desc,language_name",
      [organizationId]
    ),
    query<DetectionRow>(
      `select sd.id,sd.scripture_reference,sd.confidence::text,sd.state,sd.bible_version,sd.source_text,sd.detected_at::text,
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
       join services s on s.id=sd.service_id
       where s.organization_id=$1
       order by sd.detected_at desc limit 8`,
      [organizationId]
    ),
    query<IntegrationRow>(
      "select provider,status,integration_type from integrations where organization_id=$1 order by provider",
      [organizationId]
    )
  ]);

  return {
    service: services.rows[0],
    outputs: outputs.rows,
    languages: languages.rows,
    detections: detections.rows,
    integrations: integrations.rows
  };
}

function stateClass(status: string) {
  if (["ready", "live", "connected", "configured"].includes(status)) {
    return "border-emerald-400/20 bg-emerald-400/10 text-emerald-300";
  }
  if (["warning", "connecting"].includes(status)) {
    return "border-amber-400/20 bg-amber-400/10 text-amber-300";
  }
  if (["error"].includes(status)) {
    return "border-red-400/20 bg-red-400/10 text-red-300";
  }
  return "border-white/10 bg-white/[.04] text-white/55";
}

function Pill({ status }: { status: string }) {
  return (
    <span className={"inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[.14em] " + stateClass(status)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

const nav = [
  ["Control Room", LayoutDashboard],
  ["Scripture", BookOpen],
  ["Songs & Media", Music2],
  ["Cameras", Camera],
  ["AI Director", Bot],
  ["Translations", Languages],
  ["Streaming", RadioTower],
  ["Audience", Users],
  ["Archive", Video]
] as const;

export default async function Home() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.forcePasswordChange) redirect("/change-password");

  const data = await dashboardData(session.user.id);
  const service = data.service;
  const latest = data.detections[0];
  const previewDetection = data.detections.find((item) => item.state === "preview");
  const liveDetection = data.detections.find((item) => item.state === "live");
  const actionableDetection = previewDetection ?? data.detections.find((item) => item.state === "detected");
  const transcriptContext = actionableDetection ?? liveDetection ?? latest;
  const activeOutputs = data.outputs.filter((item) => item.enabled).length;
  const activeLanguages = data.languages.filter((item) => item.enabled).length;
  const listeners = data.languages.reduce((total, item) => total + item.listener_count, 0);

  return (
    <main className="min-h-screen">
      {service ? <RealtimeRefresh serviceId={service.id} /> : <AutoRefresh intervalMs={15_000} />}

      <div className="grid min-h-screen grid-cols-[86px_1fr] xl:grid-cols-[240px_1fr]">
        <aside className="sticky top-0 h-screen border-r border-white/[.07] bg-[#080b10]/95 px-3 py-4 backdrop-blur-xl xl:px-4">
          <div className="mb-7 flex items-center gap-3 px-1 xl:px-2">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[#d7a94a]/30 bg-[#d7a94a]/10 text-[#f2c765] shadow-[0_0_35px_rgba(215,169,74,.08)]">
              <MonitorPlay size={22} />
            </div>
            <div className="hidden min-w-0 xl:block">
              <div className="truncate text-sm font-extrabold tracking-tight">iPresenterPlux</div>
              <div className="truncate text-[10px] uppercase tracking-[.22em] text-white/35">AI Church Studio</div>
            </div>
          </div>

          <nav className="space-y-1">
            {nav.map(([label, Icon], index) => (
              <button
                key={label}
                className={
                  "group flex w-full items-center justify-center gap-3 rounded-xl px-3 py-3 text-left transition xl:justify-start " +
                  (index === 0
                    ? "border border-[#d7a94a]/20 bg-[#d7a94a]/10 text-[#f2c765]"
                    : "text-white/45 hover:bg-white/[.04] hover:text-white/80")
                }
              >
                <Icon size={18} />
                <span className="hidden text-sm font-medium xl:inline">{label}</span>
              </button>
            ))}
          </nav>

          <div className="absolute bottom-4 left-3 right-3 xl:left-4 xl:right-4">
            <Link href="/settings/devices" className="flex w-full items-center justify-center gap-3 rounded-xl border border-white/[.07] bg-white/[.025] px-3 py-3 text-white/45 hover:text-white xl:justify-start">
              <Settings2 size={18} />
              <span className="hidden text-sm xl:inline">Settings</span>
            </Link>
          </div>
        </aside>

        <section className="min-w-0">
          <header className="sticky top-0 z-30 flex min-h-[72px] items-center justify-between border-b border-white/[.07] bg-[#090c12]/88 px-5 backdrop-blur-xl lg:px-7">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <h1 className="truncate text-base font-bold lg:text-lg">{service?.title ?? "No service selected"}</h1>
                {service ? <Pill status={service.status} /> : null}
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-white/40">
                <span>Main Auditorium</span>
                <span>·</span>
                <span>{service?.active_bible_version ?? "Bible not set"}</span>
                <span>·</span>
                <span>Auto-preview ≥ {service?.auto_preview_threshold ?? "90"}%</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="hidden items-center gap-2 rounded-xl border border-white/[.07] bg-white/[.025] px-3 py-2 text-xs text-white/50 md:flex">
                <Wifi size={14} className="text-emerald-400" />
                VPS online
              </div>
              <div className="hidden text-right xl:block">
                <div className="max-w-36 truncate text-xs font-semibold text-white/65">{session.user.name ?? session.user.email}</div>
                <div className="text-[10px] uppercase tracking-[.12em] text-white/25">Authorized operator</div>
              </div>
              <LogoutButton />
              {service ? <ServiceControls serviceId={service.id} status={service.status} /> : null}
            </div>
          </header>

          <div className="space-y-5 p-4 lg:p-6">
            <section className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
              {[
                ["Presentation Engine", "Ready", "Preview + Program", MonitorPlay, "ready"],
                ["Scripture Intelligence", data.detections.length ? "Listening" : "Armed", String(data.detections.length) + " recent detections", Sparkles, "ready"],
                ["Broadcast Router", activeOutputs + " outputs", "RTMP · WebRTC · NDI", RadioTower, activeOutputs ? "ready" : "disconnected"],
                ["Language Engine", activeLanguages + " channels", listeners + " connected listeners", Languages, "ready"]
              ].map(([label, value, note, Icon, status]) => (
                <div key={String(label)} className="ip-card p-4">
                  <div className="mb-4 flex items-start justify-between">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[.045] text-white/70">
                      <Icon size={17} />
                    </div>
                    <Pill status={String(status)} />
                  </div>
                  <div className="text-xs uppercase tracking-[.15em] text-white/35">{String(label)}</div>
                  <div className="mt-1.5 text-xl font-bold tracking-tight">{String(value)}</div>
                  <div className="mt-1 text-xs text-white/40">{String(note)}</div>
                </div>
              ))}
            </section>

            <section className="grid gap-4 2xl:grid-cols-[310px_minmax(0,1fr)_360px]">
              <div className="ip-card flex min-h-[510px] flex-col overflow-hidden">
                <div className="flex items-center justify-between border-b border-white/[.07] px-4 py-4">
                  <div>
                    <div className="text-sm font-bold">Service Queue</div>
                    <div className="text-[11px] text-white/35">Detected & prepared content</div>
                  </div>
                  <button className="rounded-lg border border-white/[.07] px-2.5 py-1.5 text-xs text-white/50">+ Add</button>
                </div>
                <div className="ip-scrollbar flex-1 space-y-2 overflow-y-auto p-3">
                  {data.detections.length ? data.detections.map((item, index) => (
                    <div key={item.id} className={"rounded-xl border p-3 " + (index === 0 ? "border-[#d7a94a]/25 bg-[#d7a94a]/[.07]" : "border-white/[.06] bg-white/[.02]")}>
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-white/[.045] text-[#e4ba63]">
                          <BookOpen size={15} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="truncate text-sm font-semibold">{item.scripture_reference}</div>
                            <span className="text-[10px] font-bold text-emerald-300">{Number(item.confidence).toFixed(0)}%</span>
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-white/38"><span>{item.bible_version} · AI scripture detection</span><span className="uppercase tracking-[.12em] text-white/25">{item.state}</span></div>
                        </div>
                      </div>
                    </div>
                  )) : (
                    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
                      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[.04] text-white/35">
                        <AudioLines size={21} />
                      </div>
                      <div className="text-sm font-semibold text-white/65">Listening for scripture</div>
                      <div className="mt-2 text-xs leading-5 text-white/35">Transcript ingestion is ready. Detected references will enter this queue automatically.</div>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="ip-card overflow-hidden">
                    <div className="flex items-center justify-between border-b border-white/[.07] px-4 py-3">
                      <div className="text-xs font-bold uppercase tracking-[.13em] text-white/45">Preview</div>
                      <span className="h-2 w-2 rounded-full bg-amber-400" />
                    </div>
                    <div className="ip-grid aspect-video p-5">
                      <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-white/[.08] bg-black/35 text-center">
                        {previewDetection ? (
                          <div>
                            <div className="text-[10px] font-semibold uppercase tracking-[.3em] text-[#d7a94a]">Preview Scripture</div>
                            <div className="mt-3 text-2xl font-black tracking-tight">{previewDetection.scripture_reference}</div>
                            {previewDetection.passage_text ? (
                              <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-white/70">{previewDetection.passage_text}</p>
                            ) : null}
                            <div className="mt-2 text-xs text-white/45">{previewDetection.bible_version} · awaiting operator approval</div>
                          </div>
                        ) : (
                          <div className="text-sm text-white/25">Nothing queued for preview</div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="ip-card overflow-hidden">
                    <div className="flex items-center justify-between border-b border-white/[.07] px-4 py-3">
                      <div className="text-xs font-bold uppercase tracking-[.13em] text-white/45">Program</div>
                      <div className={"flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.15em] " + (liveDetection ? "text-red-300" : "text-white/30")}>
                        <span className={"h-2 w-2 rounded-full " + (liveDetection ? "bg-red-400" : "bg-white/20")} />
                        {liveDetection ? "Live" : "No scripture live"}
                      </div>
                    </div>
                    <div className="ip-grid aspect-video p-5">
                      <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-white/[.08] bg-black/60 text-center">
                        {liveDetection ? (
                          <div>
                            <div className="text-[10px] font-semibold uppercase tracking-[.3em] text-red-300">Program Scripture</div>
                            <div className="mt-3 text-2xl font-black tracking-tight">{liveDetection.scripture_reference}</div>
                            {liveDetection.passage_text ? (
                              <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-white/75">{liveDetection.passage_text}</p>
                            ) : null}
                            <div className="mt-2 text-xs text-white/45">{liveDetection.bible_version} · live output state</div>
                          </div>
                        ) : (
                          <div className="text-sm text-white/20">Program output</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="ip-card p-4">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold">Live Transcript & AI Context</div>
                      <div className="text-[11px] text-white/35">Mixer audio → ASR → scripture / translation / captions</div>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-emerald-300">
                      <Activity size={14} />
                      Pipeline armed
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/[.06] bg-black/20 p-4">
                    <p className="min-h-16 text-sm leading-6 text-white/55">
                      {transcriptContext?.source_text ?? "Waiting for the first transcript chunk from the Windows audio agent…"}
                    </p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {["Scripture AI", "Captions", "Speaker context", "Translation router", "Sermon archive"].map((item) => (
                      <span key={item} className="rounded-lg border border-white/[.06] bg-white/[.025] px-2.5 py-1.5 text-[11px] text-white/45">{item}</span>
                    ))}
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="ip-card p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-bold"><Camera size={16} /> Media Sources</div>
                    <div className="grid grid-cols-3 gap-2">
                      {["Camera 1", "Mixer", "Screen"].map((source, index) => (
                        <div key={source} className="rounded-xl border border-white/[.06] bg-white/[.025] p-3">
                          <div className="mb-5 h-16 rounded-lg bg-black/35" />
                          <div className="text-xs font-semibold">{source}</div>
                          <div className="mt-1 text-[10px] text-white/30">{index === 1 ? "Audio agent pending" : "Source pending"}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="ip-card p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-bold"><Bot size={16} /> AI Director</div>
                    <div className="rounded-xl border border-white/[.06] bg-white/[.025] p-4">
                      <div className="text-xs font-semibold text-white/70">Director is in advisory mode</div>
                      <div className="mt-2 text-xs leading-5 text-white/38">Camera switching, subject tracking, intelligent graphics and scene recommendations will attach to this decision layer.</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="ip-card overflow-hidden">
                  <div className="flex items-center justify-between border-b border-white/[.07] px-4 py-4">
                    <div>
                      <div className="text-sm font-bold">Scripture Intelligence</div>
                      <div className="text-[11px] text-white/35">Human approval by default</div>
                    </div>
                    <Sparkles size={17} className="text-[#e5b85c]" />
                  </div>
                  <div className="p-4">
                    {actionableDetection ? (
                      <>
                        <div className="rounded-2xl border border-[#d7a94a]/20 bg-[#d7a94a]/[.06] p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <div className="text-[10px] font-semibold uppercase tracking-[.2em] text-[#d7a94a]">
                                {actionableDetection.state === "preview" ? "In Preview" : "Detected"}
                              </div>
                              <div className="mt-2 text-2xl font-black">{actionableDetection.scripture_reference}</div>
                              <div className="mt-1 text-xs text-white/40">{actionableDetection.bible_version}</div>
                              {actionableDetection.passage_text ? (
                                <p className="mt-3 text-xs leading-5 text-white/55">{actionableDetection.passage_text}</p>
                              ) : null}
                            </div>
                            <div className="rounded-xl bg-emerald-400/10 px-2.5 py-2 text-sm font-extrabold text-emerald-300">
                              {Number(actionableDetection.confidence).toFixed(0)}%
                            </div>
                          </div>
                        </div>
                        <div className="mt-3">
                          <ScriptureControls id={actionableDetection.id} currentState={actionableDetection.state} />
                        </div>
                      </>
                    ) : liveDetection ? (
                      <div className="rounded-xl border border-red-400/15 bg-red-400/[.05] p-5 text-center">
                        <div className="text-[10px] font-semibold uppercase tracking-[.2em] text-red-300">Currently live</div>
                        <div className="mt-2 text-xl font-black">{liveDetection.scripture_reference}</div>
                        <div className="mt-1 text-xs text-white/35">{liveDetection.bible_version}</div>
                        {liveDetection.passage_text ? (
                          <p className="mt-3 text-xs leading-5 text-white/50">{liveDetection.passage_text}</p>
                        ) : null}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-white/[.08] p-5 text-center text-xs leading-5 text-white/35">
                        No actionable scripture detected yet. The transcript API is ready for the desktop audio agent.
                      </div>
                    )}
                  </div>
                </div>

                <div className="ip-card overflow-hidden">
                  <div className="flex items-center justify-between border-b border-white/[.07] px-4 py-4">
                    <div>
                      <div className="text-sm font-bold">Broadcast Destinations</div>
                      <div className="text-[11px] text-white/35">One program · many outputs</div>
                    </div>
                    <Cloud size={16} className="text-white/35" />
                  </div>
                  <div className="divide-y divide-white/[.055]">
                    {data.outputs.map((output) => (
                      <div key={output.id} className="flex items-center gap-3 px-4 py-3">
                        <span className={"h-2 w-2 rounded-full " + (output.enabled ? "bg-emerald-400" : "bg-white/15")} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-semibold">{output.name}</div>
                          <div className="mt-0.5 text-[10px] uppercase tracking-[.12em] text-white/28">{output.destination_type}</div>
                        </div>
                        <Pill status={output.status} />
                        <OutputControls id={output.id} enabled={output.enabled} />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="ip-card overflow-hidden">
                  <div className="flex items-center justify-between border-b border-white/[.07] px-4 py-4">
                    <div>
                      <div className="text-sm font-bold">Language Channels</div>
                      <div className="text-[11px] text-white/35">Audience interpretation</div>
                    </div>
                    <Captions size={16} className="text-white/35" />
                  </div>
                  <div className="max-h-72 divide-y divide-white/[.055] overflow-y-auto ip-scrollbar">
                    {data.languages.map((channel) => (
                      <div key={channel.id} className="flex items-center gap-3 px-4 py-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[.04] text-[10px] font-extrabold uppercase text-white/55">{channel.language_code}</div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-semibold">{channel.language_name}</div>
                          <div className="mt-0.5 truncate text-[10px] text-white/30">{channel.channel_mode.replaceAll("_", " ")}</div>
                        </div>
                        <div className="text-xs font-semibold text-white/35">{channel.listener_count}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {service ? <AudienceAccessCard serviceId={service.id} /> : null}

            <section className="ip-card overflow-hidden">
              <div className="flex items-center justify-between border-b border-white/[.07] px-4 py-4">
                <div>
                  <div className="text-sm font-bold">Integration Fabric</div>
                  <div className="text-[11px] text-white/35">iPresenterPlux remains the source of truth; external software receives feeds and control events.</div>
                </div>
                <ChevronRight size={17} className="text-white/25" />
              </div>
              <div className="grid md:grid-cols-2 xl:grid-cols-4">
                {data.integrations.map((item) => (
                  <div key={item.provider} className="border-b border-white/[.055] p-4 md:border-r xl:border-b-0 last:border-r-0">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-bold">{item.provider}</div>
                      <Pill status={item.status} />
                    </div>
                    <div className="mt-2 text-xs capitalize text-white/35">{item.integration_type.replaceAll("_", " ")}</div>
                  </div>
                ))}
              </div>
            </section>

            <footer className="flex flex-wrap items-center justify-between gap-3 px-1 pb-2 text-[11px] text-white/25">
              <div className="flex items-center gap-2">
                <CircleDot size={12} className="text-emerald-400" />
                iPresenterPlux control plane · PostgreSQL + Redis connected · realtime event stream
              </div>
              <div>Foundation v0.1.0 · Africa/Accra</div>
            </footer>
          </div>
        </section>
      </div>
    </main>
  );
}
