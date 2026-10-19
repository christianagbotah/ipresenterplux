"use client";

import { useSyncExternalStore } from "react";
import { AlertTriangle, UserRound, WifiOff } from "lucide-react";
import type { CockpitRoleProjection } from "@/lib/cockpit/role-projection";
import type { CockpitViewModel } from "@/lib/cockpit/contracts";
import { getRealtimeConnectionState, subscribeRealtimeConnection } from "@/lib/realtime-reconnect";
import { NextRail } from "./NextRail";
import { ProgramPreviewStage } from "./ProgramPreviewStage";
import { MobileBottomNav } from "./mobile/MobileBottomNav";
import { MobileFindBar } from "./mobile/MobileFindBar";
import { MobileLiveStrip } from "./mobile/MobileLiveStrip";
import { MobileQuickActions } from "./mobile/MobileQuickActions";

function ProgramSummary({ model }: { model: CockpitViewModel }) {
  return <section className="rounded-2xl border border-red-400/20 bg-black/40 p-4">
    <div className="text-[11px] font-black uppercase tracking-[.2em] text-red-300">Program</div>
    <div className="mt-3 text-xl font-black text-white/95">{model.program?.title ?? "Program clear"}</div>
    <div className="mt-2 text-xs text-white/55">{model.program?.detail ?? "Audience output"}</div>
  </section>;
}

function AttentionSummary({ model }: { model: CockpitViewModel }) {
  const first = model.attention[0];
  if (!first) return <div className="rounded-xl border border-emerald-400/15 bg-emerald-400/[.05] px-3 py-2 text-xs text-emerald-200/85">Systems healthy · no action needed</div>;
  return <button type="button" onClick={() => window.dispatchEvent(new Event("ipresenterplux:attention-open"))} className="ip-focus-gold flex min-h-12 w-full items-start gap-2 rounded-xl border border-amber-400/20 bg-amber-400/[.07] px-3 py-3 text-left">
    <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-300" aria-hidden="true"/><span><strong className="block text-xs text-amber-100">{first.impact}</strong><span className="mt-1 block text-[11px] leading-4 text-white/55">{first.recommendedAction}</span></span>
  </button>;
}

function MobileBody({ model, projection }: { model: CockpitViewModel; projection: CockpitRoleProjection }) {
  if (projection.kind === "producer") return <>
    <ProgramPreviewStage model={model} showControls={projection.actions.canTake || projection.actions.canClear}/>
    {projection.showAttention ? <AttentionSummary model={model}/> : null}
    <NextRail model={model}/>
    <MobileQuickActions model={model} projection={projection}/>
  </>;

  if (projection.kind === "pastor_service_leader") return <>
    <ProgramPreviewStage model={model} showControls={false}/>
    <NextRail model={model}/>
    <MobileQuickActions model={model} projection={projection}/>
    {projection.showAttention ? <AttentionSummary model={model}/> : null}
  </>;

  if (projection.kind === "interpreter") return <>
    <ProgramSummary model={model}/>
    <section className="rounded-2xl border border-white/[.07] bg-white/[.02] p-4">
      <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[.18em] text-white/50"><UserRound size={14} aria-hidden="true"/> Live speech</div>
      <div className="mt-3 text-sm leading-6 text-white/82">{model.now.transcriptText ?? "Waiting for live speech…"}</div>
      <div className="mt-3 text-[11px] text-white/50">Source {model.now.sourceLanguage?.toUpperCase() ?? "—"} · {model.systems.languages.listeners} language listeners</div>
    </section>
    <MobileQuickActions model={model} projection={projection}/>
    {projection.showAttention ? <AttentionSummary model={model}/> : null}
  </>;

  if (projection.kind === "media_lead") return <>
    <ProgramSummary model={model}/>
    <section className="grid grid-cols-2 gap-2">
      <div className="rounded-xl border border-white/[.07] bg-white/[.02] p-3"><div className="text-[11px] uppercase tracking-[.14em] text-white/45">Camera</div><div className="mt-2 text-sm font-black text-white/80">{model.systems.camera.activeName ?? "No active camera"}</div><div className="mt-1 text-[11px] text-white/45">{model.systems.camera.freshness}</div></div>
      <div className="rounded-xl border border-white/[.07] bg-white/[.02] p-3"><div className="text-[11px] uppercase tracking-[.14em] text-white/45">Media</div><div className="mt-2 text-sm font-black text-white/80">{model.next.length} queued</div><div className="mt-1 text-[11px] text-white/45">service-ready items</div></div>
    </section>
    <NextRail model={model}/>
    <MobileQuickActions model={model} projection={projection}/>
    {projection.showAttention ? <AttentionSummary model={model}/> : null}
  </>;

  return <>
    <ProgramSummary model={model}/>
    <NextRail model={model}/>
    <AttentionSummary model={model}/>
  </>;
}

export function CockpitMobile({ model, projection }: { model: CockpitViewModel; projection: CockpitRoleProjection }) {
  const serviceId = model.service?.id ?? null;
  const connection = useSyncExternalStore(
    (listener) => serviceId ? subscribeRealtimeConnection(serviceId, listener) : () => {},
    () => serviceId ? getRealtimeConnectionState(serviceId) : "connected",
    () => serviceId ? "connecting" : "connected"
  );
  const stale = connection === "reconnecting" || connection === "offline";

  return <div className="space-y-3 pb-20 md:hidden" data-cockpit-mobile-profile={projection.kind} data-live-assist-freshness={stale ? "stale" : connection}>
    <MobileLiveStrip model={model} projection={projection}/>
    {stale ? <div role="status" aria-live="polite" className="flex min-h-11 items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-400/[.07] px-3 text-[11px] leading-4 text-amber-100">
      <WifiOff size={14} className="shrink-0" aria-hidden="true"/><span><strong>{connection === "offline" ? "Offline" : "Reconnecting"}</strong> · showing last confirmed live state. No action will be replayed automatically.</span>
    </div> : null}
    <MobileFindBar/>
    <MobileBody model={model} projection={projection}/>
    <MobileBottomNav projection={projection} active="live"/>
  </div>;
}
