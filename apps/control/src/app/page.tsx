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
  Radio,
  Settings2,
  Sparkles,
  Users,
  Video,
  Wifi
} from "lucide-react";
import { AutoRefresh } from "@/components/AutoRefresh";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

type ServiceRow = {
  id: string;
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
  detected_at: string;
};

type IntegrationRow = {
  provider: string;
  status: string;
  integration_type: string;
};

async function dashboardData() {
  const [services, outputs, languages, detections, integrations] = await Promise.all([
    query<ServiceRow>(
      "select id, title, status, active_bible_version, auto_preview_threshold::text from services order by case when status='live' then 0 when status='ready' then 1 else 2 end, created_at desc limit 1"
    ),
    query<OutputRow>(
      "select id, name, destination_type, enabled, status from output_destinations order by enabled desc, name"
    ),
    query<LanguageRow>(
      "select id, language_code, language_name, channel_mode, enabled, listener_count from language_channels order by enabled desc, language_name"
    ),
    query<DetectionRow>(
      "select id, scripture_reference, confidence::text, state, bible_version, source_text, detected_at::text from scripture_detections order by detected_at desc limit 8"
    ),
    query<IntegrationRow>(
      "select provider, status, integration_type from integrations order by provider"
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
  const data = await dashboardData();
  const service = data.service;
  const latest = data.detections[0];
  const activeOutputs = data.outputs.filter((item) => item.enabled).length;
  const activeLanguages = data.languages.filter((item) => item.enabled).length;
  const listeners = data.languages.reduce((total, item) => total + item.listener_count, 0);

  return (
    <main className="min-h-screen">
      <AutoRefresh />

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
            <button className="flex w-full items-center justify-center gap-3 rounded-xl border border-white/[.07] bg-white/[.025] px-3 py-3 text-white/45 hover:text-white xl:justify-start">
              <Settings2 size={18} />
              <span className="hidden text-sm xl:inline">Settings</span>
            </button>
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
              <button className="rounded-xl border border-white/[.08] bg-white/[.035] px-4 py-2.5 text-xs font-semibold text-white/75">
                Prepare
              </button>
              <button className="flex items-center gap-2 rounded-xl bg-red-500 px-4 py-2.5 text-xs font-extrabold text-white shadow-[0_10px_35px_rgba(239,68,68,.22)]">
                <Radio size={15} />
                GO LIVE
              </button>
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
                          <div className="mt-1 truncate text-[11px] text-white/38">{item.bible_version} · AI scripture detection</div>
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
                        {latest ? (
                          <div>
                            <div className="text-[10px] font-semibold uppercase tracking-[.3em] text-[#d7a94a]">Detected Scripture</div>
                            <div className="mt-3 text-2xl font-black tracking-tight">{latest.scripture_reference}</div>
                            <div className="mt-1 text-xs text-white/45">{latest.bible_version} · awaiting operator approval</div>
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
                      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.15em] text-white/30">
                        <span className="h-2 w-2 rounded-full bg-white/20" />
                        Off air
                      </div>
                    </div>
                    <div className="ip-grid aspect-video p-5">
                      <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-white/[.08] bg-black/60">
                        <div className="text-sm text-white/20">Program output</div>
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
                      {latest?.source_text ?? "Waiting for the first transcript chunk from the Windows audio agent…"}
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
                    {latest ? (
                      <>
                        <div className="rounded-2xl border border-[#d7a94a]/20 bg-[#d7a94a]/[.06] p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <div className="text-[10px] font-semibold uppercase tracking-[.2em] text-[#d7a94a]">Detected</div>
                              <div className="mt-2 text-2xl font-black">{latest.scripture_reference}</div>
                              <div className="mt-1 text-xs text-white/40">{latest.bible_version}</div>
                            </div>
                            <div className="rounded-xl bg-emerald-400/10 px-2.5 py-2 text-sm font-extrabold text-emerald-300">
                              {Number(latest.confidence).toFixed(0)}%
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <button className="rounded-xl border border-white/[.08] bg-white/[.04] px-3 py-2.5 text-xs font-bold text-white/75">Preview</button>
                          <button className="rounded-xl bg-[#d7a94a] px-3 py-2.5 text-xs font-black text-[#161109]">Send Live</button>
                        </div>
                        <button className="mt-2 w-full rounded-xl px-3 py-2 text-xs font-medium text-white/35 hover:bg-white/[.03]">Dismiss detection</button>
                      </>
                    ) : (
                      <div className="rounded-xl border border-dashed border-white/[.08] p-5 text-center text-xs leading-5 text-white/35">
                        No scripture detected yet. The transcript API is ready for the desktop audio agent.
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
                iPresenterPlux control plane · PostgreSQL connected · realtime refresh 2.5s
              </div>
              <div>Foundation v0.1.0 · Africa/Accra</div>
            </footer>
          </div>
        </section>
      </div>
    </main>
  );
}
