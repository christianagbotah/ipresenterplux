"use client";

import { useEffect, useSyncExternalStore } from "react";
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

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input,textarea,select,[contenteditable='true'],[role='textbox']"));
}

export function CockpitDepthControls({ model, initialFocusMode = false }: { model: CockpitViewModel; initialFocusMode?: boolean }) {
  const storedDepth = useSyncExternalStore(subscribe, depthSnapshot, serverDepth);
  const storedFocus = useSyncExternalStore(subscribe, focusSnapshot, serverFocus);
  const focus = initialFocusMode || storedFocus;
  const depth = storedDepth;
  const canControl = model.capabilities.canLiveControl;

  // Keyboard shortcuts for the cockpit view.
  //  'F' — toggle Focus Mode (registered unconditionally so 'F' can both
  //        enter AND exit Focus Mode; parallels the operator 'P' preview
  //        shortcut).
  //  'D' — cycle cockpit depth essential→advanced→engineering→essential.
  //        Only fires when NOT in Focus Mode (Focus hides the depth control);
  //        parallels 'F' and the operator 'P' shortcut.
  //  'A' — open the Attention layer. Works in both normal and Focus Mode
  //        (Focus Mode has its own Attention button); dispatches the shared
  //        'ipresenterplux:attention-open' event that AttentionLayer listens
  //        for. Parallels F/D and the operator 'P' shortcut.
  // All are bare-key, guarded to ignore input/textarea/select/contenteditable
  // focus so they never hijack typing, and to ignore modifier keys (so ⌘F
  // browser-find, ⌘D bookmark, ⌘A select-all, etc. still work).
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        writePreference(FOCUS_KEY, focus ? "0" : "1");
        return;
      }
      if (event.key === "a" || event.key === "A") {
        event.preventDefault();
        window.dispatchEvent(new Event("ipresenterplux:attention-open"));
        return;
      }
      if ((event.key === "d" || event.key === "D") && !focus) {
        event.preventDefault();
        const order: CockpitDepth[] = ["essential", "advanced", "engineering"];
        const current = order.indexOf(depth);
        const next = order[(current + 1) % order.length];
        writePreference(DEPTH_KEY, next);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus, depth]);

  if (focus) return <FocusMode model={model} onExit={() => writePreference(FOCUS_KEY, "0")} />;

  const depthHint: Record<CockpitDepth, string> = {
    essential: "Essential — normal live operator view. The quietest depth; healthy systems stay out of the way.",
    advanced: "Advanced — adds output, language, camera and system controls. Reveals more information, never more authority.",
    engineering: "Engineering — adds diagnostics, timestamps and deeper health detail. Read-only; no extra permissions granted."
  };

  return <>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-white/[.07] bg-white/[.02] p-1" aria-label="Cockpit depth (press D to cycle)" role="group" aria-describedby="ip-cockpit-depth-hint">
        {(["essential","advanced","engineering"] as CockpitDepth[]).map((value) => {
          const Icon = value === "essential" ? Gauge : value === "advanced" ? SlidersHorizontal : Wrench;
          return <button key={value} type="button" aria-pressed={depth === value} aria-label={value} title={depthHint[value]} onClick={() => writePreference(DEPTH_KEY, value)} className={`flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-bold capitalize transition ip-focus-gold ${depth === value ? "bg-white/[.08] text-white/85" : "text-white/55 hover:text-white/80"}`}><Icon size={13}/>{value}</button>;
        })}
        <kbd className="ml-1 hidden rounded border border-white/10 bg-black/20 px-1.5 py-0.5 font-mono text-[10px] text-white/45 sm:inline-block" title="Press D to cycle depth">D</kbd>
      </div>
      <button type="button" onClick={() => writePreference(FOCUS_KEY, "1")} title="Enter Focus Mode (F)" className="flex min-h-11 items-center gap-2 rounded-xl border border-[#d7a94a]/20 bg-[#d7a94a]/[.07] px-3 text-xs font-black text-[#efc86f] transition hover:bg-[#d7a94a]/[.12] ip-focus-gold"><Crosshair size={15}/> Enter Focus Mode <kbd className="rounded border border-[#d7a94a]/25 bg-black/20 px-1.5 py-0.5 font-mono text-[10px] text-[#efc86f]/80">F</kbd></button>
    </div>
    <p id="ip-cockpit-depth-hint" className="mb-3 -mt-1 px-1 text-[11px] leading-5 text-white/45">
      <span className="sr-only">Cockpit depth: </span>{depthHint[depth]}
    </p>
    <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)_300px]">
      <NowRail model={model} />
      <section className="min-w-0"><ProgramPreviewStage model={model} /></section>
      <NextRail model={model} />
    </div>
    {depth !== "essential" ? <section className="ip-focus-in mt-4 rounded-2xl border border-white/[.07] bg-white/[.018] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="text-[11px] font-black uppercase tracking-[.18em] text-white/45">{depth === "engineering" ? "Engineering detail" : "Advanced live systems"}</div><div className="mt-1 text-xs text-white/55">Presentation depth never changes server authority.</div></div><span className={`text-[11px] font-black uppercase tracking-[.12em] ${canControl ? "text-emerald-300" : "text-amber-300"}`}>{canControl ? "Live control authorized" : "View only"}</span></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
        <div className="rounded-xl bg-black/20 p-3"><div className="text-white/45">Outputs</div><div className="mt-1 font-bold text-white/80">{model.systems.outputs.healthy}/{model.systems.outputs.enabled} healthy</div></div>
        <div className="rounded-xl bg-black/20 p-3"><div className="text-white/45">Languages</div><div className="mt-1 font-bold text-white/80">{model.systems.languages.enabled} enabled</div></div>
        <div className="rounded-xl bg-black/20 p-3"><div className="text-white/45">Camera truth</div><div className="mt-1 font-bold text-white/80">{model.systems.camera.freshness}</div>{depth === "engineering" ? <div className="mt-1 text-[10px] text-white/45">{model.systems.camera.lastSeenAt ?? "No heartbeat"}</div> : null}</div>
        <div className="rounded-xl bg-black/20 p-3"><div className="text-white/45">Edge truth</div><div className="mt-1 font-bold text-white/80">{model.systems.edge.freshness}</div>{depth === "engineering" ? <div className="mt-1 text-[10px] text-white/45">{model.systems.edge.lastSeenAt ?? "No heartbeat"}</div> : null}</div>
      </div>
    </section> : null}
  </>;
}
