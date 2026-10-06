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
  ShieldCheck,
  ShieldAlert,
  Signal,
  WifiOff
} from "lucide-react";
import { auth } from "@auth";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { StreamingBroadcastControl } from "@/components/StreamingBroadcastControl";
import { StreamingDestinationControl } from "@/components/StreamingDestinationControl";
import { StreamingDestinationCredentials } from "@/components/StreamingDestinationCredentials";
import { query } from "@/lib/db";
import { isSocialDestinationType } from "@/lib/destination-routing";
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
  config_status: string;
  session_status: string | null;
  last_error_code: string | null;
  attempt_count: number | null;
  last_heartbeat_at: string | null;
  credential_configured: boolean;
  public_config: Record<string, unknown>;
  updated_at: string;
};

type StreamSessionRow = {
  id: string;
  status: "idle" | "starting" | "live" | "stopping" | "ended" | "error";
  video_profile: string;
  router_path: string | null;
  publisher_edge_device_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  error_code: string | null;
  metrics: Record<string, unknown>;
  created_at: string;
};

function destinationLabel(type: string) {
  if (type === "youtube") return "YouTube Live";
  if (type === "facebook") return "Facebook Live";
  if (type === "tiktok" || type === "tiktok_rtmp") return "TikTok LIVE";
  if (type === "custom_rtmp") return "Custom RTMPS";
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
  if (["pending", "connecting", "starting", "stopping", "warning"].includes(status)) return "border-amber-400/25 bg-amber-400/10 text-amber-100";
  if (status === "error") return "border-red-400/25 bg-red-400/10 text-red-100";
  return "border-white/10 bg-white/[.035] text-white/45";
}

function operationalStatus(output: OutputRow) {
  if (output.destination_type === "ndi") return output.config_status;
  return output.session_status ?? (output.enabled ? "ready" : "disconnected");
}

function destinationEligible(output: OutputRow) {
  if (!output.enabled) return false;
  if (output.destination_type === "web_webrtc") return true;
  if (!isSocialDestinationType(output.destination_type)) return false;
  const ingestUrl = typeof output.public_config?.ingestUrl === "string" ? output.public_config.ingestUrl.trim() : "";
  return output.credential_configured && Boolean(ingestUrl);
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

  const [sessions, canControl] = await Promise.all([
    query<StreamSessionRow>(
      `select id::text,status,video_profile,router_path,publisher_edge_device_id::text,
              started_at::text,ended_at::text,error_code,metrics,created_at::text
       from stream_sessions
       where service_id=$1::uuid
       order by created_at desc
       limit 1`,
      [service.id]
    ),
    userHasAnyRole(userId, service.organization_id, STREAM_OPERATOR_ROLES)
  ]);
  const streamSession = sessions.rows[0];

  const outputs = await query<OutputRow>(
    `select od.id::text,od.name,od.destination_type,od.enabled,
            od.status as config_status,od.public_config,od.updated_at::text,
            ssd.status as session_status,ssd.last_error_code,ssd.attempt_count,
            ssd.last_heartbeat_at::text,
            exists(
              select 1 from output_destination_credentials c
              where c.output_destination_id=od.id
            ) as credential_configured
     from output_destinations od
     left join stream_session_destinations ssd
       on ssd.output_destination_id=od.id
      and ssd.stream_session_id=$2::uuid
     where od.organization_id=$1::uuid
     order by od.enabled desc,
              case od.destination_type when 'youtube' then 0 when 'facebook' then 1 when 'tiktok' then 2 when 'tiktok_rtmp' then 2 when 'web_webrtc' then 3 when 'ndi' then 4 else 5 end,
              od.name`,
    [service.organization_id, streamSession?.id ?? null]
  );

  return { service, outputs: outputs.rows, streamSession, canControl };
}

export default async function StreamingPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.forcePasswordChange) redirect("/change-password");

  const data = await streamingData(session.user.id);
  if (!data.service) redirect("/");

  const master = data.streamSession;
  const masterStatus = master?.status ?? "idle";
  const masterLive = masterStatus === "live";
  const broadcastActive = ["starting", "live", "stopping"].includes(masterStatus);
  const enabledCount = data.outputs.filter((item) => item.enabled).length;
  const eligibleOutputCount = data.outputs.filter(destinationEligible).length;
  const liveCount = data.outputs.filter((item) => operationalStatus(item) === "live").length;
  const errorCount = data.outputs.filter((item) => ["error", "warning"].includes(operationalStatus(item))).length;

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
              <div className="mt-0.5 truncate text-[11px] text-white/34">{data.service.title} · authoritative master & destination transport</div>
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
            <div className="mt-3 text-2xl font-black capitalize">{masterStatus}</div>
            <div className="mt-1 text-xs text-white/35">{master?.video_profile ?? "1080p30 target"}</div>
          </div>
          <div className="rounded-2xl border border-white/[.08] bg-[#0a0e15] p-4">
            <div className="flex items-center justify-between"><span className="text-xs font-black uppercase tracking-[.13em] text-white/35">Enabled outputs</span><CheckCircle2 size={16} className="text-emerald-300" /></div>
            <div className="mt-3 text-2xl font-black">{enabledCount}</div>
            <div className="mt-1 text-xs text-white/35">{eligibleOutputCount} eligible for broadcast</div>
          </div>
          <div className="rounded-2xl border border-white/[.08] bg-[#0a0e15] p-4">
            <div className="flex items-center justify-between"><span className="text-xs font-black uppercase tracking-[.13em] text-white/35">Live outputs</span><RadioTower size={16} className={liveCount ? "text-red-300" : "text-white/25"} /></div>
            <div className="mt-3 text-2xl font-black">{liveCount}</div>
            <div className="mt-1 text-xs text-white/35">Session transport evidence only</div>
          </div>
          <div className="rounded-2xl border border-white/[.08] bg-[#0a0e15] p-4">
            <div className="flex items-center justify-between"><span className="text-xs font-black uppercase tracking-[.13em] text-white/35">Warnings</span><ShieldAlert size={16} className={errorCount ? "text-amber-300" : "text-white/25"} /></div>
            <div className="mt-3 text-2xl font-black">{errorCount}</div>
            <div className="mt-1 text-xs text-white/35">Current/last session health</div>
          </div>
        </section>

        <section className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="overflow-hidden rounded-2xl border border-white/[.08] bg-[#0a0e15]">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[.07] px-4 py-4 sm:px-5">
              <div>
                <h2 className="text-base font-black">Broadcast Destinations</h2>
                <p className="mt-1 text-xs text-white/35">Enabled is configuration. Connecting/live/error below comes from the broadcast session, not a global toggle.</p>
              </div>
              <span className={`rounded-full border px-3 py-1.5 text-xs font-black uppercase tracking-[.12em] ${masterLive ? "border-red-400/25 bg-red-400/10 text-red-100" : statusClasses(masterStatus)}`}>
                Master {masterStatus}
              </span>
            </header>

            <div className="divide-y divide-white/[.06]">
              {data.outputs.map((output) => {
                const status = operationalStatus(output);
                const actuallyLive = status === "live";
                const social = isSocialDestinationType(output.destination_type);
                return (
                  <div key={output.id} className="grid gap-3 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${actuallyLive ? "border-red-400/20 bg-red-400/10 text-red-200" : output.enabled ? "border-emerald-400/20 bg-emerald-400/[.08] text-emerald-200" : "border-white/[.07] bg-white/[.03] text-white/30"}`}>
                        {actuallyLive ? <RadioTower size={18} /> : output.destination_type === "web_webrtc" ? <Cloud size={18} /> : output.destination_type === "ndi" ? <Signal size={18} /> : <CircleDot size={18} />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-black text-white/80">{output.name}</h3>
                          <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[.12em] ${statusClasses(status)}`}>{status}</span>
                          {social ? (
                            <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[.12em] ${output.credential_configured ? "border-emerald-400/20 bg-emerald-400/[.07] text-emerald-100" : "border-white/10 bg-white/[.03] text-white/35"}`}>
                              {output.credential_configured ? "credentials set" : "credentials needed"}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-xs text-white/35">{destinationLabel(output.destination_type)} · {protocolLabel(output.public_config)}</div>
                        <div className="mt-2 text-[11px] leading-5 text-white/27">
                          {actuallyLive
                            ? social
                              ? `RTMPS egress is active${output.attempt_count ? ` · attempt ${output.attempt_count}` : ""}. Provider-side audience health is a separate signal.`
                              : "MediaMTX reports this session transport as live."
                            : status === "connecting" || status === "pending"
                              ? "Transport is starting; iPresenterPlux is not claiming this destination live yet."
                              : status === "warning"
                                ? `Transport is retrying independently${output.last_error_code ? ` · ${output.last_error_code}` : ""}.`
                                : status === "error"
                                  ? `Transport failed${output.last_error_code ? ` · ${output.last_error_code}` : ""}; the master and other destinations remain isolated.`
                                  : output.enabled
                                    ? social && !output.credential_configured
                                      ? "Enabled configuration is incomplete; add RTMPS credentials before this destination can join a broadcast."
                                      : "Destination is enabled and ready for a future broadcast."
                                    : "Destination is disabled and will not be included in a future broadcast."}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-start justify-end gap-2">
                      {social ? (
                        <StreamingDestinationCredentials
                          id={output.id}
                          name={output.name}
                          configured={output.credential_configured}
                          canControl={data.canControl}
                          locked={broadcastActive}
                        />
                      ) : null}
                      <StreamingDestinationControl
                        id={output.id}
                        enabled={output.enabled}
                        canControl={data.canControl}
                        locked={broadcastActive}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <aside className="space-y-4">
            <section className="rounded-2xl border border-[#d7a94a]/20 bg-[#d7a94a]/[.055] p-5">
              <div className="flex items-center gap-2 text-[#efc86f]"><ShieldCheck size={17} /><span className="text-xs font-black uppercase tracking-[.14em]">Broadcast authority</span></div>
              <h2 className="mt-3 text-xl font-black">Master transport is authoritative</h2>
              <p className="mt-2 text-sm leading-6 text-white/50">Start selects one assigned Edge publisher. The master becomes live only when MediaMTX sees the service path. Social destinations then establish and report their RTMPS transports independently.</p>
              <div className="mt-4">
                <StreamingBroadcastControl
                  serviceId={data.service.id}
                  status={masterStatus}
                  canControl={data.canControl}
                  eligibleOutputCount={eligibleOutputCount}
                />
              </div>
              {master?.error_code ? (
                <div className="mt-3 rounded-xl border border-red-400/20 bg-red-400/[.07] p-3 text-xs leading-5 text-red-100">Master error: {master.error_code}</div>
              ) : null}
            </section>

            <section className="rounded-2xl border border-white/[.08] bg-[#0a0e15] p-5">
              <div className="flex items-center gap-2"><WifiOff size={16} className="text-white/35" /><span className="text-sm font-black">Failure isolation</span></div>
              <ul className="mt-3 space-y-2 text-xs leading-5 text-white/38">
                <li>• Local projector and recording continue if Internet streaming fails.</li>
                <li>• One destination failure does not stop the master or healthy destinations.</li>
                <li>• Stream keys stay encrypted/server-side and never enter this page.</li>
                <li>• Destination topology and credentials are locked while a broadcast is starting, live or stopping.</li>
                <li>• Transport live does not by itself claim provider viewer health or audience analytics.</li>
              </ul>
            </section>

            {!data.canControl ? (
              <section className="rounded-2xl border border-amber-400/20 bg-amber-400/[.07] p-4 text-xs leading-5 text-amber-100">
                Your role can view streaming health but cannot change destinations or start/stop broadcasts.
              </section>
            ) : null}
          </aside>
        </section>
      </div>
    </main>
  );
}
