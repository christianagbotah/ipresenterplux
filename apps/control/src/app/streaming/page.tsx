import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  CircleDot,
  Cloud,
  MonitorPlay,
  RadioTower,
  Settings2,
  ShieldAlert,
  Signal,
  WifiOff
} from "lucide-react";
import { auth } from "@auth";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { StreamingDestinationControl } from "@/components/StreamingDestinationControl";
import { query } from "@/lib/db";
import { STREAM_OPERATOR_ROLES, userHasAnyRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";

type ServiceRow = {
  id: string;
  organization_id: string;
  title: string;
  status: string;
};

type OutputRow = {
  id: string;
  name: string;
  destination_type: string;
  enabled: boolean;
  status: string;
  public_config: Record<string, unknown>;
  updated_at: string;
};

type StreamSessionRow = {
  id: string;
  status: "idle" | "starting" | "live" | "stopping" | "ended" | "error";
  video_profile: string;
  started_at: string | null;
  ended_at: string | null;
  metrics: Record<string, unknown>;
  created_at: string;
};

function destinationLabel(type: string) {
  if (type === "youtube") return "YouTube Live";
  if (type === "facebook") return "Facebook Live";
  if (type === "tiktok") return "TikTok LIVE";
  if (type === "web_webrtc") return "Web audience";
  if (type === "ndi") return "NDI local output";
  return type.replaceAll("_", " ");
}

function protocolLabel(config: Record<string, unknown>) {
  const protocol = typeof config.protocol === "string" ? config.protocol : null;
  const format = typeof config.format === "string" ? config.format : null;
  return protocol ?? format ?? "Not specified";
}

function statusClasses(status: string) {
  if (status === "live") return "border-red-400/25 bg-red-400/10 text-red-100";
  if (status === "ready") return "border-emerald-400/25 bg-emerald-400/10 text-emerald-100";
  if (status === "connecting" || status === "starting" || status === "stopping" || status === "warning") return "border-amber-400/25 bg-amber-400/10 text-amber-100";
  if (status === "error") return "border-red-400/25 bg-red-400/10 text-red-100";
  return "border-white/10 bg-white/[.035] text-white/45";
}

async function streamingData(userId: string) {
  const services = await query<ServiceRow>(
    `select s.id::text,s.organization_id::text,s.title,s.status
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
  if (!service) return { service: undefined, outputs: [], streamSession: undefined, canControl: false };

  const [outputs, sessions, canControl] = await Promise.all([
    query<OutputRow>(
      `select id::text,name,destination_type,enabled,status,public_config,updated_at::text
       from output_destinations
       where organization_id=$1::uuid
       order by enabled desc,
                case destination_type when 'youtube' then 0 when 'facebook' then 1 when 'tiktok' then 2 when 'web_webrtc' then 3 when 'ndi' then 4 else 5 end,
                name`,
      [service.organization_id]
    ),
    query<StreamSessionRow>(
      `select id::text,status,video_profile,started_at::text,ended_at::text,metrics,created_at::text
       from stream_sessions
       where service_id=$1::uuid
       order by created_at desc
       limit 1`,
      [service.id]
    ),
    userHasAnyRole(userId, service.organization_id, STREAM_OPERATOR_ROLES)
  ]);

  return { service, outputs: outputs.rows, streamSession: sessions.rows[0], canControl };
}

export default async function StreamingPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.forcePasswordChange) redirect("/change-password");

  const data = await streamingData(session.user.id);
  if (!data.service) redirect("/");

  const master = data.streamSession;
  const masterLive = master?.status === "live";
  const enabledCount = data.outputs.filter((item) => item.enabled).length;
  const liveCount = data.outputs.filter((item) => item.status === "live").length;
  const errorCount = data.outputs.filter((item) => item.status === "error" || item.status === "warning").length;

  return (
    <main className="min-h-screen bg-[#070a0f] text-white">
      <RealtimeRefresh serviceId={data.service.id} />

      <header className="sticky top-0 z-40 border-b border-white/[.07] bg-[#080b10]/92 backdrop-blur-xl">
        <div className="mx-auto flex min-h-16 max-w-[1800px] items-center justify-between gap-3 px-3 sm:px-5 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" aria-label="Back to Control Room" className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[.08] bg-white/[.03] text-white/55 transition hover:bg-white/[.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e5b95e]">
              <ArrowLeft size={18} />
            </Link>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#d7a94a]/25 bg-[#d7a94a]/10 text-[#efc86f]">
              <RadioTower size={19} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-black sm:text-base">Streaming Studio</h1>
              <div className="mt-0.5 truncate text-[11px] text-white/34">{data.service.title} · broadcast routing & destination readiness</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link href="/operator" className="hidden min-h-10 items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.025] px-3 text-xs font-bold text-white/45 transition hover:text-white md:flex">
              <MonitorPlay size={15} /> Operator
            </Link>
            <Link href="/settings" className="hidden min-h-10 items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.025] px-3 text-xs font-bold text-white/45 transition hover:text-white lg:flex">
              <Settings2 size={15} /> Settings
            </Link>
            <LogoutButton />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1800px] space-y-4 p-3 sm:p-4 lg:p-6">
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-white/[.08] bg-[#0a0e15] p-4">
            <div className="flex items-center justify-between"><span className="text-xs font-black uppercase tracking-[.13em] text-white/35">Master stream</span><Signal size={16} className={masterLive ? "text-red-300" : "text-white/25"} /></div>
            <div className="mt-3 text-2xl font-black">{master?.status ?? "idle"}</div>
            <div className="mt-1 text-xs text-white/35">{master?.video_profile ?? "1080p30 target"}</div>
          </div>
          <div className="rounded-2xl border border-white/[.08] bg-[#0a0e15] p-4">
            <div className="flex items-center justify-between"><span className="text-xs font-black uppercase tracking-[.13em] text-white/35">Enabled outputs</span><CheckCircle2 size={16} className="text-emerald-300" /></div>
            <div className="mt-3 text-2xl font-black">{enabledCount}</div>
            <div className="mt-1 text-xs text-white/35">Configured for use</div>
          </div>
          <div className="rounded-2xl border border-white/[.08] bg-[#0a0e15] p-4">
            <div className="flex items-center justify-between"><span className="text-xs font-black uppercase tracking-[.13em] text-white/35">Live outputs</span><RadioTower size={16} className={liveCount ? "text-red-300" : "text-white/25"} /></div>
            <div className="mt-3 text-2xl font-black">{liveCount}</div>
            <div className="mt-1 text-xs text-white/35">Actually reporting live</div>
          </div>
          <div className="rounded-2xl border border-white/[.08] bg-[#0a0e15] p-4">
            <div className="flex items-center justify-between"><span className="text-xs font-black uppercase tracking-[.13em] text-white/35">Warnings</span><ShieldAlert size={16} className={errorCount ? "text-amber-300" : "text-white/25"} /></div>
            <div className="mt-3 text-2xl font-black">{errorCount}</div>
            <div className="mt-1 text-xs text-white/35">Destination health</div>
          </div>
        </section>

        <section className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="overflow-hidden rounded-2xl border border-white/[.08] bg-[#0a0e15]">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[.07] px-4 py-4 sm:px-5">
              <div>
                <h2 className="text-base font-black">Broadcast Destinations</h2>
                <p className="mt-1 text-xs text-white/35">Enabled means ready to participate in a broadcast. It does not mean the destination is currently live.</p>
              </div>
              <span className={`rounded-full border px-3 py-1.5 text-xs font-black uppercase tracking-[.12em] ${masterLive ? "border-red-400/25 bg-red-400/10 text-red-100" : "border-white/10 bg-white/[.035] text-white/45"}`}>
                Master {master?.status ?? "idle"}
              </span>
            </header>

            <div className="divide-y divide-white/[.06]">
              {data.outputs.map((output) => {
                const actuallyLive = output.status === "live";
                return (
                  <div key={output.id} className="grid gap-3 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${actuallyLive ? "border-red-400/20 bg-red-400/10 text-red-200" : output.enabled ? "border-emerald-400/20 bg-emerald-400/[.08] text-emerald-200" : "border-white/[.07] bg-white/[.03] text-white/30"}`}>
                        {actuallyLive ? <RadioTower size={18} /> : output.destination_type === "web_webrtc" ? <Cloud size={18} /> : output.destination_type === "ndi" ? <Signal size={18} /> : <CircleDot size={18} />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-black text-white/80">{output.name}</h3>
                          <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[.12em] ${statusClasses(output.status)}`}>{output.status}</span>
                        </div>
                        <div className="mt-1 text-xs text-white/35">{destinationLabel(output.destination_type)} · {protocolLabel(output.public_config)}</div>
                        <div className="mt-2 text-[11px] leading-5 text-white/27">
                          {actuallyLive
                            ? "Destination reports an active live transport."
                            : output.enabled
                              ? "Destination is enabled and ready, but no live transport is being claimed here."
                              : "Destination is disabled and will not be included in a future broadcast."}
                        </div>
                      </div>
                    </div>
                    <StreamingDestinationControl id={output.id} enabled={output.enabled} canControl={data.canControl} />
                  </div>
                );
              })}
            </div>
          </div>

          <aside className="space-y-4">
            <section className="rounded-2xl border border-[#d7a94a]/20 bg-[#d7a94a]/[.055] p-5">
              <div className="flex items-center gap-2 text-[#efc86f]"><ShieldAlert size={17} /><span className="text-xs font-black uppercase tracking-[.14em]">Encoder gate</span></div>
              <h2 className="mt-3 text-xl font-black">Start Broadcast is intentionally locked</h2>
              <p className="mt-2 text-sm leading-6 text-white/50">The Edge Agent does not yet have a production Program-video encoder/publisher. iPresenterPlux will not pretend a broadcast is live by toggling a database flag.</p>
              <div className="mt-4 rounded-xl border border-white/[.07] bg-black/20 p-3 text-xs leading-5 text-white/38">
                Next media milestone: Program frames → hardware/native encoder → one master contribution stream → stream router → enabled destinations.
              </div>
            </section>

            <section className="rounded-2xl border border-white/[.08] bg-[#0a0e15] p-5">
              <div className="flex items-center gap-2"><WifiOff size={16} className="text-white/35" /><span className="text-sm font-black">Failure isolation</span></div>
              <ul className="mt-3 space-y-2 text-xs leading-5 text-white/38">
                <li>• Local projector and recording must continue if Internet streaming fails.</li>
                <li>• One destination failure must not stop the other destinations.</li>
                <li>• Stream keys remain server-side/secure and must never enter browser bundles or logs.</li>
                <li>• Enabled, connecting and live are distinct operational states.</li>
              </ul>
            </section>

            {!data.canControl ? (
              <section className="rounded-2xl border border-amber-400/20 bg-amber-400/[.07] p-4 text-xs leading-5 text-amber-100">
                Your role can view streaming health but cannot change broadcast destinations.
              </section>
            ) : null}
          </aside>
        </section>
      </div>
    </main>
  );
}
