"use client";

import Link from "next/link";
import { AlertTriangle, BookOpen, Camera, Languages, Music2, RadioTower, UserRound } from "lucide-react";
import type { CockpitRoleProjection } from "@/lib/cockpit/role-projection";
import type { CockpitViewModel } from "@/lib/cockpit/contracts";
import { NextRail } from "./NextRail";
import { ProgramPreviewStage } from "./ProgramPreviewStage";

function ProgramSummary({ model }: { model: CockpitViewModel }) {
  return <section className="rounded-2xl border border-red-400/15 bg-black/35 p-4">
    <div className="text-[10px] font-black uppercase tracking-[.2em] text-red-300">Program</div>
    <div className="mt-3 text-xl font-black text-white/90">{model.program?.title ?? "Program clear"}</div>
    <div className="mt-2 text-xs text-white/35">{model.program?.detail ?? "Audience output"}</div>
  </section>;
}

function AttentionSummary({ model }: { model: CockpitViewModel }) {
  const first = model.attention[0];
  if (!first) return <div className="rounded-xl border border-emerald-400/10 bg-emerald-400/[.04] px-3 py-2 text-xs text-emerald-200/70">Systems healthy · no action needed</div>;
  return <button type="button" onClick={() => window.dispatchEvent(new Event("ipresenterplux:attention-open"))} className="flex min-h-12 w-full items-start gap-2 rounded-xl border border-amber-400/15 bg-amber-400/[.06] px-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300">
    <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-300"/><span><strong className="block text-xs text-amber-100">{first.impact}</strong><span className="mt-1 block text-[11px] leading-4 text-white/40">{first.recommendedAction}</span></span>
  </button>;
}

function QuickLink({ href, icon: Icon, children }: { href: string; icon: typeof BookOpen; children: React.ReactNode }) {
  return <Link href={href} className="flex min-h-12 items-center gap-2 rounded-xl border border-white/[.07] bg-white/[.025] px-3 text-xs font-bold text-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e2b85f]"><Icon size={15}/>{children}</Link>;
}

export function CockpitMobile({ model, projection }: { model: CockpitViewModel; projection: CockpitRoleProjection }) {
  if (projection.kind === "producer") return <div className="space-y-3 md:hidden" data-cockpit-mobile-profile="producer">
    <ProgramPreviewStage model={model}/>
    {projection.showAttention ? <AttentionSummary model={model}/> : null}
    <NextRail model={model}/>
    <div className="grid grid-cols-2 gap-2">
      {projection.actions.canOpenMedia ? <QuickLink href="/media" icon={Music2}>Media</QuickLink> : null}
      {projection.actions.canOpenCameras ? <QuickLink href="/cameras" icon={Camera}>Cameras</QuickLink> : null}
      {projection.actions.canOpenTranslations ? <QuickLink href="/translations" icon={Languages}>Languages</QuickLink> : null}
      {projection.actions.canOpenStreaming ? <QuickLink href="/streaming" icon={RadioTower}>Streaming</QuickLink> : null}
    </div>
  </div>;

  if (projection.kind === "pastor_service_leader") return <div className="space-y-3 md:hidden" data-cockpit-mobile-profile="pastor_service_leader">
    <ProgramPreviewStage model={model}/>
    <NextRail model={model}/>
    <QuickLink href="/scripture" icon={BookOpen}>Scripture & service references</QuickLink>
    {projection.showAttention ? <AttentionSummary model={model}/> : null}
  </div>;

  if (projection.kind === "interpreter") return <div className="space-y-3 md:hidden" data-cockpit-mobile-profile="interpreter">
    <ProgramSummary model={model}/>
    <section className="rounded-2xl border border-white/[.07] bg-white/[.02] p-4">
      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[.18em] text-white/35"><UserRound size={14}/> Live speech</div>
      <div className="mt-3 text-sm leading-6 text-white/75">{model.now.transcriptText ?? "Waiting for live speech…"}</div>
      <div className="mt-3 text-[11px] text-white/35">Source {model.now.sourceLanguage?.toUpperCase() ?? "—"} · {model.systems.languages.listeners} language listeners</div>
    </section>
    <QuickLink href="/translations" icon={Languages}>Open interpretation workspace</QuickLink>
    {projection.showAttention ? <AttentionSummary model={model}/> : null}
  </div>;

  if (projection.kind === "media_lead") return <div className="space-y-3 md:hidden" data-cockpit-mobile-profile="media_lead">
    <ProgramSummary model={model}/>
    <section className="grid grid-cols-2 gap-2">
      <div className="rounded-xl border border-white/[.07] bg-white/[.02] p-3"><div className="text-[10px] uppercase tracking-[.14em] text-white/30">Camera</div><div className="mt-2 text-sm font-black text-white/70">{model.systems.camera.activeName ?? "No active camera"}</div><div className="mt-1 text-[11px] text-white/30">{model.systems.camera.freshness}</div></div>
      <div className="rounded-xl border border-white/[.07] bg-white/[.02] p-3"><div className="text-[10px] uppercase tracking-[.14em] text-white/30">Media</div><div className="mt-2 text-sm font-black text-white/70">{model.next.length} queued</div><div className="mt-1 text-[11px] text-white/30">service-ready items</div></div>
    </section>
    <NextRail model={model}/>
    <div className="grid grid-cols-2 gap-2"><QuickLink href="/media" icon={Music2}>Media</QuickLink><QuickLink href="/cameras" icon={Camera}>Cameras</QuickLink></div>
    {projection.showAttention ? <AttentionSummary model={model}/> : null}
  </div>;

  return <div className="space-y-3 md:hidden" data-cockpit-mobile-profile="restricted">
    <ProgramSummary model={model}/>
    <NextRail model={model}/>
    <AttentionSummary model={model}/>
  </div>;
}
