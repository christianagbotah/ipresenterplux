"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Activity, Archive, Bot, BrainCircuit, Languages, ListChecks, Mic2, Radio, Save, ShieldCheck, Sparkles, Users, Volume2 } from "lucide-react";
import type { AIDirectorHealth, AIDirectorState } from "@/lib/ai-director";

type Props = {
  organizationName: string;
  state: AIDirectorState;
};

function healthTone(state: AIDirectorHealth["state"]) {
  if (state === "healthy") return "border-emerald-400/22 bg-emerald-400/[.07] text-emerald-200";
  if (state === "degraded") return "border-amber-400/22 bg-amber-400/[.07] text-amber-100";
  return "border-white/[.08] bg-white/[.025] text-white/50";
}

function HealthCard({ icon, health }: { icon: React.ReactNode; health: AIDirectorHealth }) {
  return (
    <div className={`rounded-2xl border p-4 ${healthTone(health.state)}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-black/20">{icon}</div>
        <span className="rounded-full border border-current/15 px-2.5 py-1 text-[11px] font-black uppercase tracking-[.14em]">{health.state}</span>
      </div>
      <div className="mt-4 text-sm font-black text-white">{health.label}</div>
      <div className="mt-1 text-xs leading-5 opacity-80">{health.detail}</div>
      <div className="mt-3 text-[10px] uppercase tracking-[.12em] opacity-55">
        {health.observedAt ? `Observed ${new Date(health.observedAt).toLocaleTimeString()}` : "No recent heartbeat"}
      </div>
    </div>
  );
}

export function AIDirectorWorkspace({ organizationName, state }: Props) {
  const service = state.service;
  const [aiEnabled, setAiEnabled] = useState(service?.aiEnabled ?? false);
  const [threshold, setThreshold] = useState(service?.autoPreviewThreshold ?? 90);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const canEdit = Boolean(service && state.canManageSettings && state.entitled);
  const recommendationCount = state.recommendations.length;
  const previewCount = useMemo(() => state.recommendations.filter((item) => item.state === "preview").length, [state.recommendations]);
  const freshTranscript = useMemo(() => state.liveTranscript.filter((item) => item.fresh), [state.liveTranscript]);
  const activeListeners = useMemo(() => state.languageDemand.reduce((sum, item) => sum + item.listeners, 0), [state.languageDemand]);

  async function saveSettings() {
    if (!service || !canEdit || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/ai/director/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: state.organizationId,
          serviceId: service.id,
          aiEnabled,
          autoPreviewThreshold: threshold
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "AI Director settings could not be saved");
      setMessage("AI Director settings saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AI Director settings could not be saved");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#080b10] text-white">
      <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <section className="rounded-3xl border border-white/[.07] bg-[radial-gradient(circle_at_top_right,rgba(215,169,74,.13),transparent_34%),#0c1017] p-5 sm:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[.18em] text-[#d7a94a]"><BrainCircuit size={15} />AI Director</div>
              <h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">{organizationName}</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/60">Advisory only. AI can recommend content and promote sufficiently confident Scripture detections into Preview when enabled. Program authority remains operator-only.</p>
            </div>
            <div className="grid min-w-[280px] grid-cols-2 gap-2">
              <div className="rounded-2xl border border-white/[.07] bg-black/20 p-3">
                <div className="text-[11px] font-bold uppercase tracking-[.14em] text-white/45">Recommendations</div>
                <div className="mt-1 text-2xl font-black">{recommendationCount}</div>
              </div>
              <div className="rounded-2xl border border-white/[.07] bg-black/20 p-3">
                <div className="text-[11px] font-bold uppercase tracking-[.14em] text-white/45">In Preview</div>
                <div className="mt-1 text-2xl font-black">{previewCount}</div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          <HealthCard icon={<Mic2 size={18} />} health={state.health.asr} />
          <HealthCard icon={<Languages size={18} />} health={state.health.translation} />
          <HealthCard icon={<Volume2 size={18} />} health={state.health.tts} />
        </section>

        <section className="grid gap-4 xl:grid-cols-12">
          <div className="rounded-3xl border border-white/[.07] bg-[#0c1017]/90 p-5 xl:col-span-7">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-black"><Radio size={17} className="text-emerald-300" />Live Sermon</div>
                <p className="mt-1 text-xs leading-5 text-white/50">Fresh ASR speech from this service only. Stale speech is never presented as current.</p>
              </div>
              <span className="rounded-full border border-emerald-400/15 bg-emerald-400/[.06] px-3 py-1.5 text-[10px] font-black uppercase tracking-[.12em] text-emerald-200">{freshTranscript.length ? `${freshTranscript.length} fresh` : "Waiting"}</span>
            </div>
            <div className="mt-4 space-y-2">
              {freshTranscript.length ? freshTranscript.slice(0, 6).map((segment, index) => (
                <article key={segment.id} className={`rounded-2xl border p-3 ${index === 0 ? "border-emerald-400/18 bg-emerald-400/[.045]" : "border-white/[.06] bg-black/15"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-[.1em] text-white/45">
                    <span>{segment.speakerId ?? "Speaker"}{segment.sourceLanguage ? ` · ${segment.sourceLanguage.toUpperCase()}` : ""}</span>
                    <span>{segment.asrConfidence === null ? "confidence —" : `${Math.round(segment.asrConfidence * 100)}% confidence`} · {new Date(segment.observedAt).toLocaleTimeString()}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-white/78">{segment.text}</p>
                </article>
              )) : (
                <div className="rounded-2xl border border-dashed border-white/[.09] p-7 text-center">
                  <Mic2 size={22} className="mx-auto text-white/30" />
                  <div className="mt-2 text-sm font-black">Waiting for fresh sermon speech</div>
                  <p className="mt-1 text-xs text-white/45">Presentation remains fully usable while ASR is quiet, stale or offline.</p>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-white/[.07] bg-[#0c1017]/90 p-5 xl:col-span-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-black"><ListChecks size={17} className="text-[#d7a94a]" />Smart Next</div>
                <p className="mt-1 text-xs leading-5 text-white/50">Pinned, predicted and planned cues ranked from current service truth.</p>
              </div>
              <Link href="/cockpit" className="inline-flex min-h-9 items-center rounded-xl border border-white/[.08] px-3 text-[11px] font-bold text-white/65 hover:bg-white/[.04] ip-focus-gold">Open Cockpit</Link>
            </div>
            <div className="mt-4 space-y-2">
              {state.smartNext.length ? state.smartNext.slice(0, 6).map((item, index) => (
                <div key={`${item.source}:${item.id}`} className="rounded-2xl border border-white/[.06] bg-black/15 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[10px] font-black uppercase tracking-[.11em] text-[#d7a94a]">{index + 1}. {item.source}</div>
                      <div className="mt-1 truncate text-sm font-black">{item.title}</div>
                    </div>
                    {item.confidence !== null ? <span className="shrink-0 rounded-lg border border-[#d7a94a]/15 px-2 py-1 text-xs font-black text-[#e7c477]">{Math.round(item.confidence)}%</span> : null}
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs leading-5 text-white/48">{item.reason ?? "Planned service rundown"}</p>
                </div>
              )) : <div className="rounded-2xl border border-dashed border-white/[.09] p-6 text-center text-xs text-white/45">No fresh next-cue prediction yet.</div>}
            </div>
          </div>

          <div className="rounded-3xl border border-white/[.07] bg-[#0c1017]/90 p-5 xl:col-span-7">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-black"><Users size={17} className="text-sky-300" />Language Demand</div>
                <p className="mt-1 text-xs leading-5 text-white/50">Anonymous active audience sessions show which language channels need attention now.</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-sky-400/15 bg-sky-400/[.06] px-3 py-1.5 text-[10px] font-black uppercase tracking-[.12em] text-sky-200">{activeListeners} active</span>
                <Link href="/translations" className="inline-flex min-h-9 items-center rounded-xl border border-white/[.08] px-3 text-[11px] font-bold text-white/65 hover:bg-white/[.04] ip-focus-gold">Translations</Link>
              </div>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {state.languageDemand.length ? state.languageDemand.map((language) => (
                <div key={language.id} className="rounded-2xl border border-white/[.06] bg-black/15 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div><div className="text-sm font-black">{language.languageName}</div><div className="mt-1 text-[10px] font-bold uppercase tracking-[.1em] text-white/40">{language.channelMode.replaceAll("_", " ")}</div></div>
                    <span className="text-lg font-black">{language.listeners}</span>
                  </div>
                  <div className={`mt-3 text-[11px] font-bold ${language.readiness.tone === "healthy" ? "text-emerald-300" : language.readiness.tone === "warning" ? "text-amber-200" : "text-white/50"}`}>{language.readiness.label}</div>
                </div>
              )) : <div className="col-span-full rounded-2xl border border-dashed border-white/[.09] p-6 text-center text-xs text-white/45">No enabled audience language channels.</div>}
            </div>
          </div>

          <div className="rounded-3xl border border-white/[.07] bg-[#0c1017]/90 p-5 xl:col-span-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-black"><Archive size={17} className="text-violet-300" />Service Memory</div>
                <p className="mt-1 text-xs leading-5 text-white/50">Post-service intelligence remembers Scripture, speakers, content, incidents and language usage.</p>
              </div>
              <Link href="/archive" className="inline-flex min-h-9 items-center rounded-xl border border-white/[.08] px-3 text-[11px] font-bold text-white/65 hover:bg-white/[.04] ip-focus-gold">Archive</Link>
            </div>
            <div className="mt-4 rounded-2xl border border-white/[.06] bg-black/15 p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-black uppercase tracking-[.12em] text-white/45">{state.memory.status}</span>
                <span className="text-xs font-bold text-white/55">{state.memory.chapterCount} chapter{state.memory.chapterCount === 1 ? "" : "s"}</span>
              </div>
              <p className="mt-3 text-sm leading-6 text-white/65">{state.memory.summary || (state.memory.status === "unavailable" ? "Memory will be generated after the service ends. Live service is never blocked by memory generation." : state.memory.lastError || "Service memory is being prepared.")}</p>
            </div>
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-[.86fr_1.14fr]">
          <div className="rounded-3xl border border-white/[.07] bg-[#0c1017]/90 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-black"><Bot size={17} className="text-[#d7a94a]" />Service automation</div>
                <p className="mt-1 text-xs leading-5 text-white/50">Controls recommendation automation for the current ready/live service only.</p>
              </div>
              <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[.12em] ${state.entitled ? "border-emerald-400/20 bg-emerald-400/[.07] text-emerald-200" : "border-white/[.08] text-white/45"}`}>
                {state.entitled ? "Entitled" : "Plan locked"}
              </span>
            </div>

            {service ? (
              <div className="mt-5 space-y-4">
                <div className="rounded-2xl border border-white/[.07] bg-black/20 p-4">
                  <div className="text-xs font-black">{service.title}</div>
                  <div className="mt-1 text-[11px] font-bold uppercase tracking-[.14em] text-white/45">{service.status} service</div>
                </div>

                <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-white/[.07] p-4">
                  <span>
                    <span className="block text-sm font-bold">AI recommendation automation</span>
                    <span className="mt-1 block text-xs leading-5 text-white/50">When off, detections remain available for manual review but are not automatically promoted into Preview.</span>
                  </span>
                  <input type="checkbox" checked={aiEnabled} disabled={!canEdit} onChange={(event) => setAiEnabled(event.target.checked)} className="h-5 w-5 cursor-pointer accent-[#d7a94a] disabled:cursor-not-allowed" />
                </label>

                <label className="block rounded-2xl border border-white/[.07] p-4">
                  <span className="flex items-center justify-between gap-3 text-sm font-bold"><span>Auto-preview threshold</span><span>{threshold}%</span></span>
                  <input type="range" min={50} max={100} step={1} value={threshold} disabled={!canEdit} onChange={(event) => setThreshold(Number(event.target.value))} className="mt-4 w-full cursor-pointer disabled:cursor-not-allowed" />
                  <span className="mt-2 block text-xs leading-5 text-white/50">Only fresh Scripture detections at or above this confidence can enter Preview automatically.</span>
                </label>

                {!state.canManageSettings ? <p className="text-xs text-amber-200/85">A live operator role is required to change these settings.</p> : null}
                {state.canManageSettings && !state.entitled ? <p className="text-xs text-amber-200/85">The current subscription does not include AI Director controls.</p> : null}
                {message ? <p className="text-xs text-white/65">{message}</p> : null}
                <button type="button" disabled={!canEdit || saving} onClick={saveSettings} className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#d7a94a] px-4 text-sm font-black text-[#171005] transition hover:brightness-110 ip-focus-gold disabled:cursor-not-allowed disabled:opacity-35">
                  <Save size={15} />{saving ? "Saving…" : "Save AI settings"}
                </button>
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-dashed border-white/[.09] p-6 text-center">
                <Activity size={26} className="mx-auto text-white/35" />
                <div className="mt-3 text-sm font-black">No ready or live service</div>
                <p className="mt-1 text-xs leading-5 text-white/50">AI health remains visible, but service automation needs a ready/live service context.</p>
                <Link href="/planner" className="mt-4 inline-flex min-h-10 cursor-pointer items-center rounded-xl border border-white/[.09] px-4 text-xs font-bold text-white/70 transition hover:bg-white/[.04] ip-focus-gold">Open Service Planner</Link>
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-white/[.07] bg-[#0c1017]/90 p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-black"><Sparkles size={17} className="text-[#d7a94a]" />Recent recommendations</div>
                <p className="mt-1 text-xs text-white/50">Confidence, evidence and current Preview state from Scripture intelligence.</p>
              </div>
              <div className="flex gap-2">
                <Link href="/scripture" className="inline-flex min-h-10 cursor-pointer items-center rounded-xl border border-white/[.09] px-3 text-xs font-bold text-white/70 transition hover:bg-white/[.04] ip-focus-gold">Scripture</Link>
                <Link href="/translations" className="inline-flex min-h-10 cursor-pointer items-center rounded-xl border border-white/[.09] px-3 text-xs font-bold text-white/70 transition hover:bg-white/[.04] ip-focus-gold">Translations</Link>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {state.recommendations.length ? state.recommendations.map((item) => (
                <article key={item.id} className="ip-ai-arrive rounded-2xl border border-white/[.07] bg-black/15 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-black">{item.reference}</div>
                      <div className="mt-1 text-[11px] font-bold uppercase tracking-[.12em] text-white/45">{item.method} · {item.state}</div>
                    </div>
                    <div className="rounded-xl border border-[#d7a94a]/20 bg-[#d7a94a]/[.07] px-3 py-2 text-sm font-black text-[#e7c477]">{item.confidence.toFixed(0)}%</div>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-white/62">{item.evidence || "No transcript evidence retained."}</p>
                  <div className="mt-3 flex items-center gap-2 text-[10px] text-white/45"><ShieldCheck size={12} />Human operator remains final authority · {new Date(item.observedAt).toLocaleTimeString()}</div>
                </article>
              )) : (
                <div className="rounded-2xl border border-dashed border-white/[.09] p-8 text-center text-sm text-white/50">No recent Scripture recommendations for this service.</div>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
