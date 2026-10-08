"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, Radio, Square, ShieldAlert } from "lucide-react";
import type { CockpitStageState, CockpitViewModel } from "@/lib/cockpit/contracts";

function StageSurface({ item, kind }: { item: CockpitStageState | null; kind: "preview" | "program" }) {
  const program = kind === "program";
  return <section className={`overflow-hidden rounded-2xl border ${program ? "border-red-400/20 bg-black/45" : "border-amber-400/15 bg-black/25"}`}>
    <header className="flex items-center justify-between border-b border-white/[.06] px-4 py-3">
      <span className={`text-[10px] font-black uppercase tracking-[.22em] ${program ? "text-red-300" : "text-amber-300"}`}>{program ? "Program" : "Preview"}</span>
      <span className="text-[10px] text-white/28">{program ? "Audience output" : "Safe staging"}</span>
    </header>
    <div className={`ip-grid flex aspect-video min-h-60 items-center justify-center p-5 text-center ${program ? "lg:min-h-[360px]" : "lg:min-h-[300px]"}`}>
      {item ? <div className="max-w-2xl"><div className="text-[10px] font-bold uppercase tracking-[.18em] text-white/28">{item.contentType.replaceAll("_", " ")}</div><h2 className={`${program ? "text-3xl sm:text-4xl" : "text-2xl sm:text-3xl"} mt-3 font-black tracking-tight text-white/90`}>{item.title}</h2>{item.detail ? <div className="mt-3 text-sm text-white/40">{item.detail}</div> : null}</div> : <div className="text-sm text-white/22">{program ? "Nothing on Program" : "Nothing in Preview"}</div>}
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
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest("input,textarea,select,[role='textbox']")))) return;
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key === "Enter" && preview && canTake && !pending) { event.preventDefault(); mutateScripture(preview.id, "live", "Program updated"); }
      if (command && (event.key === "Backspace" || event.key === "Delete") && program && canClear && !pending) { event.preventDefault(); mutateScripture(program.id, "detected", "Program cleared"); }
    }
    window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown);
  }, [canClear, canTake, mutateScripture, pending, preview, program]);

  return <div className="space-y-3">
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
      <StageSurface item={preview} kind="preview" />
      <StageSurface item={program} kind="program" />
    </div>
    <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
      <div className="text-xs text-white/32">{preview && preview.source !== "scripture_detection" ? "Preview is visible. Use its owning workspace for live control until a safe domain adapter is available." : "Preview is the safety boundary before Program."}</div>
      <button type="button" disabled={!canTake || pending} onClick={() => preview && mutateScripture(preview.id, "live", "Program updated")} className="min-h-14 rounded-2xl bg-[#d7a94a] px-8 text-sm font-black tracking-wide text-[#171107] shadow-[0_14px_38px_rgba(215,169,74,.18)] transition hover:bg-[#ebc76d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f5d58f] disabled:cursor-not-allowed disabled:opacity-30"><span className="inline-flex items-center gap-2"><Radio size={18}/>TAKE</span></button>
      <button type="button" disabled={!canClear || pending} onClick={() => program && mutateScripture(program.id, "detected", "Program cleared")} className="min-h-12 justify-self-stretch rounded-xl border border-red-400/20 bg-red-400/[.06] px-4 text-sm font-bold text-red-100 transition hover:bg-red-400/[.11] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 disabled:cursor-not-allowed disabled:opacity-30 sm:justify-self-end"><span className="inline-flex items-center gap-2"><Square size={15}/>Clear Program</span></button>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-white/28"><span className="flex items-center gap-2"><Eye size={13}/> Cloud intent and physical Edge truth remain separate.</span><span>Take: Ctrl/⌘ + Enter · Clear: Ctrl/⌘ + Backspace</span></div>
    {(!model.capabilities.canLiveControl) ? <div className="flex items-center gap-2 rounded-xl border border-amber-400/15 bg-amber-400/[.06] px-3 py-2 text-xs text-amber-100"><ShieldAlert size={14}/> View-only role. Live actions are server-gated.</div> : null}
    {feedback ? <div role="status" aria-live="polite" className="rounded-xl border border-white/[.08] bg-white/[.025] px-3 py-2 text-xs text-white/55">{feedback}</div> : null}
  </div>;
}
