"use client";

import { Radio } from "lucide-react";
import type { CockpitViewModel } from "@/lib/cockpit/contracts";
import type { CockpitRoleProjection } from "@/lib/cockpit/role-projection";

function LiveCell({ label, value, live = false }: { label: "PROGRAM" | "PREVIEW" | "NEXT"; value: string; live?: boolean }) {
  return <div className="min-w-0 rounded-xl border border-white/[.07] bg-black/25 px-2.5 py-2">
    <div className={`text-[11px] font-black tracking-[.14em] ${live ? "text-red-300" : "text-white/40"}`}>{label}</div>
    <div className="mt-1 truncate text-[11px] font-bold text-white/80">{value}</div>
  </div>;
}

export function MobileLiveStrip({ model, projection }: { model: CockpitViewModel; projection: CockpitRoleProjection }) {
  const armed = Boolean(model.service?.scriptureAutomation.armed && model.capabilities.canLiveControl);
  const preview = projection.showPreview ? (model.preview?.title ?? "Empty") : "—";
  const next = projection.showNext ? (model.next[0]?.title ?? "Nothing queued") : "—";

  return <section className="sticky top-[68px] z-30 -mx-1 space-y-2 rounded-2xl border border-white/[.08] bg-[#090d14]/95 p-2 shadow-xl backdrop-blur-xl" aria-label="Live Assist state">
    <div className="grid grid-cols-3 gap-1.5">
      <LiveCell label="PROGRAM" value={model.program?.title ?? "Clear"} live={Boolean(model.program)} />
      <LiveCell label="PREVIEW" value={preview} />
      <LiveCell label="NEXT" value={next} />
    </div>
    {armed ? <div className="flex min-h-11 items-center gap-2 rounded-xl border border-red-400/30 bg-red-400/[.08] px-3 text-[11px] font-black tracking-[.12em] text-red-100">
      <Radio size={13} className="shrink-0 text-red-300" aria-hidden="true" />
      <span>AUTO SCRIPTURE LIVE ARMED</span>
    </div> : null}
  </section>;
}
