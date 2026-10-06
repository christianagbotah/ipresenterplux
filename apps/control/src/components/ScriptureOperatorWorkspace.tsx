"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  CheckCircle2,
  Eye,
  MonitorPlay,
  Radio,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Square,
  WifiOff,
  X
} from "lucide-react";

type Detection = {
  id: string;
  scriptureReference: string;
  confidence: number;
  state: string;
  bibleVersion: string;
  detectionMethod: string;
  sourceText: string | null;
  passageText: string | null;
  detectedAt: string;
};

type EdgeCommand = {
  id: string;
  type: string;
  state: "pending" | "delivered" | "succeeded" | "failed" | "expired";
  itemId: string | null;
  resultingState: string | null;
  errorCode: string | null;
  issuedAt: string;
  completedAt: string | null;
};

type MutationState = "preview" | "live" | "detected" | "dismissed";

type Feedback = {
  tone: "success" | "warning" | "error";
  message: string;
} | null;

function commandLabel(command: EdgeCommand | undefined) {
  if (!command) return { label: "No Edge confirmation", tone: "neutral" as const };
  if (command.state === "succeeded") return { label: "Edge confirmed", tone: "success" as const };
  if (command.state === "failed") return { label: "Edge failed", tone: "error" as const };
  if (command.state === "expired") return { label: "Command expired", tone: "error" as const };
  if (command.state === "delivered") return { label: "Sent to Edge", tone: "warning" as const };
  return { label: "Queued for Edge", tone: "warning" as const };
}

function StatusBadge({ command }: { command?: EdgeCommand }) {
  const status = commandLabel(command);
  const className = status.tone === "success"
    ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
    : status.tone === "error"
      ? "border-red-400/25 bg-red-400/10 text-red-200"
      : status.tone === "warning"
        ? "border-amber-400/25 bg-amber-400/10 text-amber-200"
        : "border-white/10 bg-white/[.035] text-white/45";

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${className}`}>
      {status.tone === "success" ? <CheckCircle2 size={12} /> : status.tone === "error" ? <ShieldAlert size={12} /> : <RefreshCw size={12} />}
      {status.label}
    </span>
  );
}

function methodLabel(method: string) {
  if (method === "quote") return "Quote match";
  if (method === "context") return "Context navigation";
  if (method === "reference") return "Reference detection";
  return method.replaceAll("_", " ");
}

function MonitorCard({
  title,
  mode,
  detection,
  command
}: {
  title: string;
  mode: "preview" | "program";
  detection?: Detection;
  command?: EdgeCommand;
}) {
  const isProgram = mode === "program";

  return (
    <section className={`overflow-hidden rounded-2xl border bg-[#080b10] ${isProgram && detection ? "border-red-400/25 shadow-[0_0_55px_rgba(239,68,68,.07)]" : "border-white/[.08]"}`}>
      <header className="flex min-h-14 items-center justify-between gap-3 border-b border-white/[.07] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className={`h-2.5 w-2.5 rounded-full ${isProgram ? detection ? "bg-red-400 shadow-[0_0_14px_rgba(248,113,113,.8)]" : "bg-white/15" : "bg-amber-400"}`} />
          <div>
            <div className="text-xs font-black uppercase tracking-[.16em] text-white/70">{title}</div>
            <div className="mt-0.5 text-[11px] text-white/35">{isProgram ? "Audience / projector output" : "Operator staging"}</div>
          </div>
        </div>
        <StatusBadge command={command} />
      </header>

      <div className="ip-grid aspect-video min-h-52 p-4 sm:p-5">
        <div className={`flex h-full items-center justify-center rounded-xl border p-5 text-center ${isProgram ? "border-red-400/10 bg-black/65" : "border-amber-400/10 bg-black/40"}`}>
          {detection ? (
            <div className="mx-auto max-w-2xl">
              <div className={`text-[10px] font-bold uppercase tracking-[.28em] ${isProgram ? "text-red-300" : "text-amber-300"}`}>
                {isProgram ? "Program" : "Preview"}
              </div>
              <h3 className="mt-3 text-2xl font-black tracking-tight sm:text-3xl">{detection.scriptureReference}</h3>
              {detection.passageText ? (
                <p className="mt-4 line-clamp-5 text-sm leading-6 text-white/72 sm:text-base sm:leading-7">{detection.passageText}</p>
              ) : (
                <p className="mt-4 text-sm text-white/35">Passage text is not available for this detection.</p>
              )}
              <div className="mt-4 text-xs font-semibold text-white/38">{detection.bibleVersion}</div>
            </div>
          ) : (
            <div className="flex flex-col items-center text-white/25">
              {isProgram ? <MonitorPlay size={30} /> : <Eye size={30} />}
              <div className="mt-3 text-sm font-semibold">{isProgram ? "Nothing on Program" : "Nothing in Preview"}</div>
              <div className="mt-1 max-w-xs text-xs leading-5">Select scripture from the queue and use the operator actions below.</div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function ScriptureOperatorWorkspace({
  serviceId,
  serviceTitle,
  serviceStatus,
  detections,
  commands,
  canControl
}: {
  serviceId: string;
  serviceTitle: string;
  serviceStatus: string;
  detections: Detection[];
  commands: EdgeCommand[];
  canControl: boolean;
}) {
  const router = useRouter();
  const fallbackSelection = detections.find((item) => item.state === "preview")
    ?? detections.find((item) => item.state === "detected")
    ?? detections.find((item) => item.state === "live")
    ?? detections[0];
  const [selectedId, setSelectedId] = useState<string | null>(fallbackSelection?.id ?? null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [isPending, startTransition] = useTransition();
  const storageKey = `ipresenterplux:operator-selection:${serviceId}`;

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    if (saved && detections.some((item) => item.id === saved)) {
      setSelectedId(saved);
      return;
    }
    if (selectedId && !detections.some((item) => item.id === selectedId)) {
      setSelectedId(fallbackSelection?.id ?? null);
    }
  }, [detections, fallbackSelection?.id, selectedId, storageKey]);

  useEffect(() => {
    if (!selectedId) return;
    window.localStorage.setItem(storageKey, selectedId);
  }, [selectedId, storageKey]);

  const selected = detections.find((item) => item.id === selectedId) ?? fallbackSelection;
  const preview = detections.find((item) => item.state === "preview");
  const program = detections.find((item) => item.state === "live");

  const commandFor = (type: string, itemId?: string) => commands.find((command) => {
    if (command.type !== type) return false;
    return itemId ? command.itemId === itemId : true;
  });
  const previewCommand = preview ? commandFor("preview.prepare", preview.id) : undefined;
  const programCommand = program ? commandFor("program.show", program.id) : commandFor("program.clear");

  function select(id: string) {
    setSelectedId(id);
    setFeedback(null);
  }

  function changeState(id: string, state: MutationState, successLabel: string) {
    if (!canControl) {
      setFeedback({ tone: "error", message: "Your role can view this workspace but cannot control live output." });
      return;
    }

    setFeedback(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/v1/scriptures/${id}/state`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state })
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          setFeedback({ tone: "error", message: payload?.error ?? "The scripture output action failed." });
          return;
        }

        const queued = Number(payload?.edgeCommandsQueued ?? 0);
        setFeedback(queued > 0
          ? { tone: "success", message: `${successLabel}. ${queued} Edge command${queued === 1 ? "" : "s"} queued; physical output confirmation will follow.` }
          : { tone: "warning", message: `${successLabel} in the cloud, but no active Edge device received a command. Physical output is not confirmed.` });
        router.refresh();
      } catch {
        setFeedback({ tone: "error", message: "Network error. The requested output change could not be verified." });
      }
    });
  }

  const feedbackClass = feedback?.tone === "success"
    ? "border-emerald-400/20 bg-emerald-400/[.08] text-emerald-100"
    : feedback?.tone === "warning"
      ? "border-amber-400/20 bg-amber-400/[.08] text-amber-100"
      : "border-red-400/20 bg-red-400/[.08] text-red-100";

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-2xl border border-white/[.08] bg-[#0a0e15] shadow-[0_24px_90px_rgba(0,0,0,.22)]">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[.07] px-4 py-4 sm:px-5">
          <div>
            <div className="flex items-center gap-2.5">
              <Sparkles size={17} className="text-[#e8bd62]" />
              <h2 className="text-base font-black tracking-tight sm:text-lg">Scripture Operator</h2>
              <span className="rounded-full border border-white/10 bg-white/[.04] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.12em] text-white/45">{serviceStatus}</span>
            </div>
            <p className="mt-1.5 text-xs text-white/38">{serviceTitle} · Human-approved Preview → Program workflow</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-white/35">
            {canControl ? <><CheckCircle2 size={14} className="text-emerald-300" /> Live controls enabled</> : <><ShieldAlert size={14} className="text-amber-300" /> View-only role</>}
          </div>
        </header>

        <div className="grid min-h-[600px] xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="border-b border-white/[.07] xl:border-b-0 xl:border-r">
            <div className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="text-xs font-black uppercase tracking-[.14em] text-white/55">Service Queue</div>
                <div className="mt-1 text-[11px] text-white/30">Selection stays fixed while new detections arrive</div>
              </div>
              <span className="rounded-lg bg-white/[.045] px-2 py-1 text-xs font-bold text-white/45">{detections.length}</span>
            </div>

            <div className="ip-scrollbar max-h-[420px] space-y-2 overflow-y-auto px-3 pb-3 xl:max-h-[720px]">
              {detections.length ? detections.map((item) => {
                const active = item.id === selected?.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => select(item.id)}
                    className={`w-full rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e6b85b] ${active ? "border-[#d7a94a]/35 bg-[#d7a94a]/[.09] shadow-[inset_3px_0_0_#d7a94a]" : "border-white/[.06] bg-white/[.018] hover:border-white/15 hover:bg-white/[.04]"}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${active ? "bg-[#d7a94a]/15 text-[#efc86f]" : "bg-white/[.04] text-white/40"}`}>
                        <BookOpen size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <span className="truncate text-sm font-bold text-white/80">{item.scriptureReference}</span>
                          <span className="text-[11px] font-black text-emerald-300">{Math.round(item.confidence)}%</span>
                        </div>
                        <div className="mt-1 truncate text-[11px] text-white/34">{item.bibleVersion} · {methodLabel(item.detectionMethod)}</div>
                        <div className="mt-2 flex items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[.12em] ${item.state === "live" ? "bg-red-400/10 text-red-200" : item.state === "preview" ? "bg-amber-400/10 text-amber-200" : "bg-white/[.05] text-white/35"}`}>{item.state}</span>
                          {active ? <span className="text-[10px] font-bold text-[#e8bd62]">Selected</span> : null}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              }) : (
                <div className="rounded-xl border border-dashed border-white/[.08] p-8 text-center">
                  <WifiOff size={24} className="mx-auto text-white/20" />
                  <div className="mt-3 text-sm font-bold text-white/50">Waiting for scripture</div>
                  <p className="mt-1 text-xs leading-5 text-white/30">Detected references and quote matches will appear here.</p>
                </div>
              )}
            </div>
          </aside>

          <div className="min-w-0 p-3 sm:p-4 lg:p-5">
            <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="space-y-4">
                <div className="grid gap-4 lg:grid-cols-2">
                  <MonitorCard title="Preview" mode="preview" detection={preview} command={previewCommand} />
                  <MonitorCard title="Program" mode="program" detection={program} command={programCommand} />
                </div>

                <section className="rounded-2xl border border-white/[.08] bg-white/[.018] p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-[10px] font-black uppercase tracking-[.2em] text-[#d7a94a]">Selected item</div>
                      <h3 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">{selected?.scriptureReference ?? "Select scripture"}</h3>
                      {selected ? <div className="mt-1 text-xs text-white/38">{selected.bibleVersion} · {methodLabel(selected.detectionMethod)} · {Math.round(selected.confidence)}% confidence</div> : null}
                    </div>
                    {selected ? <span className="rounded-xl border border-white/10 bg-white/[.035] px-3 py-2 text-xs font-bold uppercase tracking-[.12em] text-white/45">{selected.state}</span> : null}
                  </div>

                  {selected?.passageText ? <p className="mt-4 max-w-4xl text-sm leading-6 text-white/62 sm:text-base sm:leading-7">{selected.passageText}</p> : null}
                  {selected?.sourceText ? <p className="mt-3 text-xs leading-5 text-white/32">Heard: “{selected.sourceText}”</p> : null}

                  <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <button
                      type="button"
                      disabled={!selected || !canControl || isPending || selected.state === "preview"}
                      onClick={() => selected && changeState(selected.id, "preview", "Preview prepared")}
                      className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[.04] px-4 py-3 text-sm font-black text-white/80 transition hover:bg-white/[.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <Eye size={17} /> Preview
                    </button>
                    <button
                      type="button"
                      disabled={!selected || !canControl || isPending || selected.state === "live"}
                      onClick={() => selected && changeState(selected.id, "live", "Program updated")}
                      className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#d7a94a] px-4 py-3 text-sm font-black text-[#171107] shadow-[0_12px_34px_rgba(215,169,74,.18)] transition hover:bg-[#e9c469] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f5d58f] disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <Radio size={17} /> Take Live
                    </button>
                    <button
                      type="button"
                      disabled={!program || !canControl || isPending}
                      onClick={() => program && changeState(program.id, "detected", "Program cleared")}
                      className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-red-400/20 bg-red-400/[.07] px-4 py-3 text-sm font-black text-red-100 transition hover:bg-red-400/[.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <Square size={16} /> Clear Program
                    </button>
                    <button
                      type="button"
                      disabled={!selected || !canControl || isPending || selected.state === "live"}
                      onClick={() => selected && changeState(selected.id, "dismissed", "Detection dismissed")}
                      className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/[.07] px-4 py-3 text-sm font-bold text-white/45 transition hover:bg-white/[.035] hover:text-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <X size={16} /> Dismiss
                    </button>
                  </div>

                  {feedback ? <div aria-live="polite" role="status" className={`mt-4 rounded-xl border px-4 py-3 text-xs font-semibold leading-5 ${feedbackClass}`}>{feedback.message}</div> : null}
                </section>
              </div>

              <aside className="space-y-3">
                <section className="rounded-2xl border border-white/[.08] bg-white/[.018] p-4">
                  <div className="text-xs font-black uppercase tracking-[.14em] text-white/55">Output truth</div>
                  <div className="mt-4 space-y-3">
                    <div className="rounded-xl border border-white/[.06] bg-black/20 p-3">
                      <div className="flex items-center justify-between gap-3"><span className="text-xs font-bold text-white/65">Cloud Program</span><span className={program ? "text-xs font-black text-red-200" : "text-xs text-white/35"}>{program ? "LIVE STATE" : "CLEAR"}</span></div>
                      <div className="mt-1 text-[11px] text-white/30">Database state is not the same as physical projector confirmation.</div>
                    </div>
                    <div className="rounded-xl border border-white/[.06] bg-black/20 p-3">
                      <div className="flex items-center justify-between gap-3"><span className="text-xs font-bold text-white/65">Edge Program</span><StatusBadge command={programCommand} /></div>
                      {programCommand?.errorCode ? <div className="mt-2 text-[11px] text-red-200/75">{programCommand.errorCode}</div> : null}
                    </div>
                    <div className="rounded-xl border border-white/[.06] bg-black/20 p-3">
                      <div className="flex items-center justify-between gap-3"><span className="text-xs font-bold text-white/65">Edge Preview</span><StatusBadge command={previewCommand} /></div>
                    </div>
                  </div>
                </section>

                <section className="rounded-2xl border border-white/[.08] bg-white/[.018] p-4">
                  <div className="text-xs font-black uppercase tracking-[.14em] text-white/55">Operator safeguards</div>
                  <ul className="mt-3 space-y-2 text-xs leading-5 text-white/38">
                    <li>• New AI detections never replace your current selection.</li>
                    <li>• Preview does not take content live.</li>
                    <li>• Program changes require an explicit operator action.</li>
                    <li>• Edge confirmation is shown separately from cloud intent.</li>
                  </ul>
                </section>
              </aside>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
