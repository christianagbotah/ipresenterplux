"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, Radio, Square, ShieldAlert } from "lucide-react";
import type { CockpitStageState, CockpitViewModel } from "@/lib/cockpit/contracts";
import { hasBlockingModal } from "@/lib/cockpit/keyboard-safety";

function StageSurface({ item, kind }: { item: CockpitStageState | null; kind: "preview" | "program" }) {
  const program = kind === "program";
  const live = program && item;
  return <section className={`min-w-0 w-full overflow-hidden rounded-2xl border ${program ? live ? "border-red-400/35 bg-black/55 ip-program-live" : "border-red-400/15 bg-black/35" : item ? "border-amber-400/30 bg-black/40" : "border-amber-400/15 bg-black/25"}`}>
    <header className="flex items-center justify-between border-b border-white/[.06] px-4 py-3">
      <span className={`flex items-center gap-2 text-xs font-black uppercase tracking-[.2em] ${program ? live ? "text-red-300" : "text-red-300/60" : item ? "text-amber-300" : "text-amber-300/60"}`}>
        {live ? <span className="ip-live-dot inline-flex size-1.5 rounded-full bg-red-400" /> : null}
        {program ? "Program" : "Preview"}
      </span>
      <span className="text-xs text-white/45">{program ? (live ? "Audience output · ON AIR" : "Audience output · clear") : "Safe staging"}</span>
    </header>
    <div className="ip-grid flex w-full aspect-video items-center justify-center p-5 text-center">
      {item ? <div className="max-w-2xl ip-preview-prep"><div className="text-xs font-bold uppercase tracking-[.18em] text-white/45">{item.contentType.replaceAll("_", " ")}</div><h2 className={`${program ? "text-3xl sm:text-4xl" : "text-2xl sm:text-3xl"} mt-3 font-black tracking-tight text-white/95`}>{item.title}</h2>{item.body ? <div className={`${program ? "text-lg sm:text-xl" : "text-base sm:text-lg"} mt-4 whitespace-pre-wrap leading-relaxed text-white/82`}>{item.body}</div> : null}{item.detail ? <div className="mt-3 text-sm text-white/55">{item.detail}</div> : null}</div> : <div className="max-w-md px-4">
        <div className="text-sm font-bold text-white/70">{program ? "Program is clear" : "Preview is empty"}</div>
        <p className="mt-2 text-sm leading-6 text-white/50">{program ? "The audience sees black. Stage something into Preview, then Take it live." : "Preview is your safe staging area. Prepare content here before taking it to Program — nothing goes live until you Take."}</p>
      </div>}
    </div>
  </section>;
}

export function ProgramPreviewStage({ model }: { model: CockpitViewModel }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const preview = model.preview;
  const program = model.program;
  const canTake = Boolean(model.capabilities.canLiveControl && preview?.source === "scripture_detection");
  const canClear = Boolean(model.capabilities.canLiveControl && program?.source === "scripture_detection");

  const mutateScripture = useCallback((id: string, state: "live" | "detected", label: string) => {
    setFeedback(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/v1/scriptures/${id}/state`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state }) });
        const payload = await response.json().catch(() => null);
        if (!response.ok) { setFeedback(payload?.error ?? "Live output action failed."); return; }
        setFeedback(label);
        router.refresh();
      } catch { setFeedback("Network error. Output change could not be verified."); }
    });
  }, [router]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (hasBlockingModal()) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest("input,textarea,select,[role='textbox']")))) return;
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key === "Enter" && preview && canTake && !pending) { event.preventDefault(); mutateScripture(preview.id, "live", "Program updated"); }
      if (command && (event.key === "Backspace" || event.key === "Delete") && program && canClear && !pending) { event.preventDefault(); mutateScripture(program.id, "detected", "Program cleared"); }
    }
    window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown);
  }, [canClear, canTake, mutateScripture, pending, preview, program]);

  return <div className="space-y-3">
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
      <StageSurface item={preview} kind="preview" />
      <StageSurface item={program} kind="program" />
    </div>
    <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
      <div className="text-xs leading-5 text-white/55">{preview && preview.source !== "scripture_detection" ? "Preview is visible. Use its owning workspace for live control until a safe domain adapter is available." : "Preview is the safety boundary before Program — AI prepares here, you Take."}</div>
      <button type="button" disabled={!canTake || pending} onClick={() => preview && mutateScripture(preview.id, "live", "Program updated")} className="min-h-14 rounded-2xl bg-[#d7a94a] px-8 text-sm font-black tracking-wide text-[#171107] shadow-[0_14px_38px_rgba(215,169,74,.18)] transition hover:bg-[#ebc76d] ip-focus-gold disabled:cursor-not-allowed disabled:opacity-30"><span className="inline-flex items-center gap-2"><Radio size={18}/>TAKE</span></button>
      <button type="button" disabled={!canClear || pending} onClick={() => program && mutateScripture(program.id, "detected", "Program cleared")} className="min-h-12 justify-self-stretch rounded-xl border border-red-400/25 bg-red-400/[.06] px-4 text-sm font-bold text-red-100 transition hover:bg-red-400/[.12] ip-focus-gold disabled:cursor-not-allowed disabled:opacity-30 sm:justify-self-end"><span className="inline-flex items-center gap-2"><Square size={15}/>Clear Program</span></button>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/45"><span className="flex items-center gap-2"><Eye size={13}/> Cloud intent and physical Edge truth remain separate.</span><span>Take: Ctrl/⌘ + Enter · Clear: Ctrl/⌘ + Backspace</span></div>
    {(!model.capabilities.canLiveControl) ? <div className="flex items-center gap-2 rounded-xl border border-amber-400/15 bg-amber-400/[.06] px-3 py-2 text-xs text-amber-100"><ShieldAlert size={14}/> View-only role. Live actions are server-gated.</div> : null}
    {feedback ? <div role="status" aria-live="polite" className="rounded-xl border border-white/[.08] bg-white/[.025] px-3 py-2 text-xs text-white/55">{feedback}</div> : null}
  </div>;
}
