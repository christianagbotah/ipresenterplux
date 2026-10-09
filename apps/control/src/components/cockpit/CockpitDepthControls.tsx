"use client";

import { useSyncExternalStore } from "react";
import { Crosshair, Gauge, SlidersHorizontal, Wrench } from "lucide-react";
import type { CockpitViewModel } from "@/lib/cockpit/contracts";
import { FocusMode } from "./FocusMode";
import { NextRail } from "./NextRail";
import { NowRail } from "./NowRail";
import { ProgramPreviewStage } from "./ProgramPreviewStage";

type CockpitDepth = "essential" | "advanced" | "engineering";
const DEPTH_KEY = "ipresenterplux:cockpit-depth";
const FOCUS_KEY = "ipresenterplux:cockpit-focus";
const CHANGE_EVENT = "ipresenterplux:cockpit-view-changed";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(CHANGE_EVENT, callback); };
}
function depthSnapshot(): CockpitDepth {
  const value = window.localStorage.getItem(DEPTH_KEY);
  return value === "advanced" || value === "engineering" ? value : "essential";
}
function focusSnapshot() { return window.localStorage.getItem(FOCUS_KEY) === "1"; }
function serverDepth(): CockpitDepth { return "essential"; }
function serverFocus() { return false; }
function writePreference(key: string, value: string) {
  window.localStorage.setItem(key, value);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function CockpitDepthControls({ model, initialFocusMode = false }: { model: CockpitViewModel; initialFocusMode?: boolean }) {
  const storedDepth = useSyncExternalStore(subscribe, depthSnapshot, serverDepth);
  const storedFocus = useSyncExternalStore(subscribe, focusSnapshot, serverFocus);
  const focus = initialFocusMode || storedFocus;
  const depth = storedDepth;
  const canControl = model.capabilities.canLiveControl;

  if (focus) return <FocusMode model={model} onExit={() => writePreference(FOCUS_KEY, "0")} />;

  return <>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div className="inline-flex min-h-11 items-center rounded-xl border border-white/[.07] bg-white/[.02] p-1" aria-label="Cockpit depth">
        {(["essential","advanced","engineering"] as CockpitDepth[]).map((value) => {
          const Icon = value === "essential" ? Gauge : value === "advanced" ? SlidersHorizontal : Wrench;
          return <button key={value} type="button" aria-pressed={depth === value} onClick={() => writePreference(DEPTH_KEY, value)} className={`flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-bold capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e2b85f] ${depth === value ? "bg-white/[.08] text-white/80" : "text-white/35 hover:text-white/65"}`}><Icon size={13}/>{value}</button>;
        })}
      </div>
      <button type="button" onClick={() => writePreference(FOCUS_KEY, "1")} className="flex min-h-11 items-center gap-2 rounded-xl border border-[#d7a94a]/20 bg-[#d7a94a]/[.07] px-3 text-xs font-black text-[#efc86f] hover:bg-[#d7a94a]/[.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e2b85f]"><Crosshair size={15}/> Enter Focus Mode</button>
    </div>
    <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)_300px]">
      <NowRail model={model} />
      <section className="min-w-0"><ProgramPreviewStage model={model} /></section>
      <NextRail model={model} />
    </div>
    {depth !== "essential" ? <section className="mt-4 rounded-2xl border border-white/[.07] bg-white/[.018] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="text-[10px] font-black uppercase tracking-[.18em] text-white/28">{depth === "engineering" ? "Engineering detail" : "Advanced live systems"}</div><div className="mt-1 text-xs text-white/38">Presentation depth never changes server authority.</div></div><span className={`text-[10px] font-black uppercase tracking-[.12em] ${canControl ? "text-emerald-300" : "text-amber-300"}`}>{canControl ? "Live control authorized" : "View only"}</span></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
        <div className="rounded-xl bg-black/20 p-3"><div className="text-white/30">Outputs</div><div className="mt-1 font-bold text-white/65">{model.systems.outputs.healthy}/{model.systems.outputs.enabled} healthy</div></div>
        <div className="rounded-xl bg-black/20 p-3"><div className="text-white/30">Languages</div><div className="mt-1 font-bold text-white/65">{model.systems.languages.enabled} enabled</div></div>
        <div className="rounded-xl bg-black/20 p-3"><div className="text-white/30">Camera truth</div><div className="mt-1 font-bold text-white/65">{model.systems.camera.freshness}</div>{depth === "engineering" ? <div className="mt-1 text-[10px] text-white/25">{model.systems.camera.lastSeenAt ?? "No heartbeat"}</div> : null}</div>
        <div className="rounded-xl bg-black/20 p-3"><div className="text-white/30">Edge truth</div><div className="mt-1 font-bold text-white/65">{model.systems.edge.freshness}</div>{depth === "engineering" ? <div className="mt-1 text-[10px] text-white/25">{model.systems.edge.lastSeenAt ?? "No heartbeat"}</div> : null}</div>
      </div>
    </section> : null}
  </>;
}
