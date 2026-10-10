"use client";

import { Command, HeartPulse, Minimize2 } from "lucide-react";
import type { CockpitViewModel } from "@/lib/cockpit/contracts";
import { NextRail } from "./NextRail";
import { ProgramPreviewStage } from "./ProgramPreviewStage";

export function FocusMode({ model, onExit }: { model: CockpitViewModel; onExit: () => void }) {
  return (
    <div className="ip-focus-in fixed inset-0 z-[100] overflow-y-auto bg-[#05070b] text-white">
      <header className="sticky top-0 z-20 flex min-h-16 items-center justify-between gap-3 border-b border-white/[.07] bg-[#05070b]/95 px-4 backdrop-blur-xl">
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-[.22em] text-[#e2b85f]">Focus Mode</div>
          <div className="mt-1 truncate text-sm font-black text-white/90">{model.service?.title ?? "Service Cockpit"}</div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => window.dispatchEvent(new Event("ipresenterplux:attention-open"))} className="flex min-h-12 items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.025] px-3 text-xs font-bold text-white/70 transition hover:bg-white/[.05] ip-focus-gold"><HeartPulse size={15}/> Attention{model.attention.length ? ` · ${model.attention.length}` : ""}</button>
          <button type="button" onClick={() => window.dispatchEvent(new Event("ipresenterplux:command-open"))} className="flex min-h-12 items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.025] px-3 text-xs font-bold text-white/70 transition hover:bg-white/[.05] ip-focus-gold"><Command size={15}/> Command</button>
          <button type="button" onClick={onExit} className="flex min-h-12 items-center gap-2 rounded-xl border border-[#d7a94a]/25 bg-[#d7a94a]/[.08] px-3 text-xs font-black text-[#efc86f] transition hover:bg-[#d7a94a]/[.14] ip-focus-gold"><Minimize2 size={15}/> Exit Focus</button>
        </div>
      </header>
      <main className="mx-auto max-w-[1900px] p-3 sm:p-4 lg:p-5">
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-white/[.06] bg-white/[.018] px-3 py-2 text-xs text-white/55">
          <span><strong className="text-white/80">Now:</strong> {model.now.currentContent?.title ?? "Program clear"}</span>
          <span><strong className="text-white/80">Speaker:</strong> {model.now.speakerId ?? "Unknown"}</span>
          <span><strong className="text-white/80">Audience:</strong> {model.systems.audience.listeners}</span>
          <span className={model.systems.edge.freshness === "current" ? "text-emerald-300" : "text-amber-300"}>Edge {model.systems.edge.freshness}</span>
        </div>
        <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_310px]">
          <ProgramPreviewStage model={model} />
          <NextRail model={model} />
        </div>
      </main>
    </div>
  );
}
