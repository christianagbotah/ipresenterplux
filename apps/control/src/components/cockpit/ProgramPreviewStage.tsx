"use client";

import { useCallback, useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, MonitorPlay, Radio, Square, ShieldAlert } from "lucide-react";
import type { CockpitStageState, CockpitViewModel } from "@/lib/cockpit/contracts";
import { hasBlockingModal } from "@/lib/cockpit/keyboard-safety";

function StageSurface({ item, kind }: { item: CockpitStageState | null; kind: "preview" | "program" }) {
  const program = kind === "program";
  const live = Boolean(program && item);
  const Icon = program ? MonitorPlay : Eye;
  return <section aria-label={program ? "Program monitor" : "Preview monitor"} className={`min-w-0 w-full overflow-hidden rounded-2xl border ${program ? live ? "border-red-400/35 bg-[#101016] ip-program-live" : "border-white/10 bg-[#0e131c]" : item ? "border-[#d7a94a]/35 bg-[#12151b]" : "border-white/10 bg-[#0e131c]"}`}>
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[.07] px-4 py-3">
      <span className={`flex items-center gap-2 text-sm font-bold ${program ? live ? "text-red-200" : "text-white/75" : "text-[#efc86f]"}`}>
        <Icon size={16} aria-hidden="true" />{program ? "Program" : "Preview"}
      </span>
      <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-bold ${live ? "bg-red-400/12 text-red-200" : item ? "bg-[#d7a94a]/10 text-[#efc86f]" : "bg-white/[.05] text-white/50"}`}>
        {live ? <span className="ip-live-dot size-1.5 rounded-full bg-red-400" aria-hidden="true" /> : null}
        {program ? (live ? "ON AIR" : "Clear") : item ? "Ready to take" : "Not on air"}
      </span>
    </header>
    <div className="ip-stage-canvas ip-grid flex w-full aspect-video items-center justify-center text-center">
      {item ? <div className="ip-stage-copy ip-preview-prep ip-scrollbar-thin max-h-full w-full overflow-y-auto p-5" tabIndex={0} aria-label={`${program ? "Program" : "Preview"} content`}>
        <div className="text-xs font-semibold uppercase tracking-[.16em] text-white/45">{item.contentType.replaceAll("_", " ")}</div>
        <h2 className="ip-stage-title mt-2 font-bold tracking-tight text-white/95">{item.title}</h2>
        {item.body ? <div className="ip-stage-body mt-3 whitespace-pre-wrap leading-relaxed text-white/85">{item.body}</div> : null}
        {item.detail ? <div className="mt-3 text-xs text-white/50">{item.detail}</div> : null}
      </div> : <div className="px-4">
        <span className={`mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl border ${program ? "border-white/10 bg-white/[.025] text-white/30" : "border-[#d7a94a]/15 bg-[#d7a94a]/[.04] text-[#efc86f]/60"}`}><Icon size={23} aria-hidden="true" /></span>
        <div className="text-sm font-semibold text-white/65">{program ? "Program clear" : "Preview empty"}</div>
      </div>}
    </div>
    <footer className="flex items-center justify-between gap-2 border-t border-white/[.06] bg-black/15 px-4 py-2.5 text-xs text-white/50">
      <span>{program ? "Audience output" : "Only you can see this"}</span><span className="tabular-nums text-white/35">16:9</span>
    </footer>
  </section>;
}

export function ProgramPreviewStage({ model }: { model: CockpitViewModel }) {
  const router = useRouter();
  const guidanceId = useId();
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

  const takeHint = !model.capabilities.canLiveControl ? "Your role can view this service. Ask an operator to change Program."
    : preview && !canTake ? "Open this item's workspace to control its output."
    : !preview ? "Choose an item from Next or Scripture to prepare Preview."
    : "Preview is safe. Nothing reaches the audience until you take it live.";

  return <div className="min-w-0 space-y-4" aria-busy={pending}>
    <div className="grid gap-4 md:grid-cols-2">
      <StageSurface item={preview} kind="preview" />
      <StageSurface item={program} kind="program" />
    </div>
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/[.08] bg-[#101620] p-3 sm:p-4">
      <div className="min-w-0 flex-1 basis-48">
        <div className="flex items-center gap-2 text-sm font-semibold text-white/90"><ArrowRight size={15} className="shrink-0 text-[#efc86f]" aria-hidden="true" /><span className="truncate">{preview ? preview.title : "Prepare your next moment"}</span></div>
        <p id={guidanceId} className="mt-1 text-xs leading-5 text-white/60">{pending ? "Updating Program…" : takeHint}</p>
      </div>
      <button type="button" disabled={!canTake || pending} aria-describedby={guidanceId} onClick={() => preview && mutateScripture(preview.id, "live", "Program updated")} className="min-h-14 flex-1 rounded-xl bg-[#d7a94a] px-6 py-2 text-[#171107] shadow-[0_6px_24px_rgba(215,169,74,.14)] transition hover:bg-[#ebc76d] ip-focus-gold disabled:cursor-not-allowed disabled:opacity-35 sm:flex-none"><span className="flex items-center justify-center gap-2 text-sm font-black tracking-wide"><Radio size={17} aria-hidden="true"/>TAKE PREVIEW LIVE</span></button>
      <button type="button" disabled={!canClear || pending} onClick={() => program && mutateScripture(program.id, "detected", "Program cleared")} className="min-h-12 flex-1 rounded-xl border border-white/10 bg-white/[.025] px-4 text-sm font-semibold text-white/75 transition hover:border-red-400/30 hover:bg-red-400/[.08] hover:text-red-100 ip-focus-gold disabled:cursor-not-allowed disabled:opacity-35 sm:flex-none"><span className="inline-flex items-center gap-2"><Square size={14} aria-hidden="true"/>CLEAR LIVE</span></button>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs leading-5 text-white/45"><span className="flex items-center gap-1.5"><Eye size={13} aria-hidden="true"/> Preview first. You decide what goes live.</span><span>Take: Ctrl/⌘ + Enter · Clear: Ctrl/⌘ + Backspace</span></div>
    {(!model.capabilities.canLiveControl) ? <div className="flex items-center gap-2 rounded-xl border border-amber-400/15 bg-amber-400/[.06] px-3 py-2 text-xs text-amber-100"><ShieldAlert size={14}/> View only · live controls are available to your service operators.</div> : null}
    {feedback ? <div role="status" aria-live="polite" className="rounded-xl border border-white/[.08] bg-white/[.025] px-3 py-2 text-xs text-white/55">{feedback}</div> : null}
  </div>;
}
