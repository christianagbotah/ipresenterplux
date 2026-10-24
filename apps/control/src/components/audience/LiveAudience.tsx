"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { LiveTranslatedAudio } from "@/components/audience/LiveTranslatedAudio";
import { resolveAudienceChannelReadiness, type AudienceJobStatus } from "@/lib/audience-readiness";
import { LiveProgramVideo } from "@/components/audience/LiveProgramVideo";
import type { PublicAudienceVideoStatus } from "@/lib/public-audience-video-state";
import {
  BookOpen,
  Captions,
  Headphones,
  Languages,
  Radio,
} from "lucide-react";

type LanguageChannel = {
  id: string;
  code: string;
  name: string;
  mode: string;
  listeners: number;
};

type SpeechSynthesisState = AudienceJobStatus;

type Props = {
  serviceId: string;
  videoStatus: PublicAudienceVideoStatus;
  serviceTitle: string;
  scriptureReference: string | null;
  scriptureText: string | null;
  transcript: string | null;
  transcriptLanguage: string | null;
  translations: Record<string, string>;
  translationStatus: Record<string, AudienceJobStatus>;
  speechSynthesis: Record<string, SpeechSynthesisState>;
  languages: LanguageChannel[];
};

export function LiveAudience({
  serviceId,
  videoStatus,
  serviceTitle,
  scriptureReference,
  scriptureText,
  transcript,
  transcriptLanguage,
  translations,
  translationStatus,
  speechSynthesis,
  languages
}: Props) {
  const fallbackChannelId = languages[0]?.id ?? "";
  const languageStorageKey=`ipresenterplux-language:${serviceId}`;
  const audienceSessionStorageKey=`ipresenterplux-audience-session:${serviceId}`;
  const selectedChannelId = useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener("ipresenterplux-language-change", onStoreChange);
      return () => window.removeEventListener("ipresenterplux-language-change", onStoreChange);
    },
    () => {
      const saved = window.localStorage.getItem(languageStorageKey);
      return languages.some((item) => item.id === saved) ? saved ?? fallbackChannelId : fallbackChannelId;
    },
    () => fallbackChannelId
  );

  const audienceSessionId=useSyncExternalStore(
    () => () => {},
    () => {
      const saved=window.localStorage.getItem(audienceSessionStorageKey);
      if(saved && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved)) return saved;
      const created=crypto.randomUUID();
      window.localStorage.setItem(audienceSessionStorageKey,created);
      return created;
    },
    () => ""
  );

  const selected = useMemo(
    () => languages.find((item) => item.id === selectedChannelId) ?? languages[0],
    [languages, selectedChannelId]
  );

  function selectLanguage(id: string) {
    window.localStorage.setItem(languageStorageKey, id);
    window.dispatchEvent(new Event("ipresenterplux-language-change"));
  }

  useEffect(() => {
    if(!audienceSessionId) return;
    let stopped=false;
    const heartbeat=async () => {
      if(stopped || navigator.onLine===false) return;
      try {
        await fetch("/api/v1/audience/session",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({serviceId,sessionId:audienceSessionId,channelId:selectedChannelId||null}),cache:"no-store",keepalive:true});
      } catch { /* Public audience remains usable even if presence telemetry is unavailable. */ }
    };
    void heartbeat();
    const timer=window.setInterval(()=>void heartbeat(),20_000);
    const onVisible=()=>{ if(document.visibilityState==="visible") void heartbeat(); };
    document.addEventListener("visibilitychange",onVisible);
    return ()=>{ stopped=true; window.clearInterval(timer); document.removeEventListener("visibilitychange",onVisible); };
  },[audienceSessionId,selectedChannelId,serviceId]);

  const sourceSelected = selected?.mode === "original"
    || Boolean(transcriptLanguage && selected?.code === transcriptLanguage);
  const selectedTranslation = selected ? translations[selected.id] ?? null : null;
  const synthesisState = selected ? speechSynthesis[selected.id] ?? null : null;
  const captionText = sourceSelected ? transcript : selectedTranslation;
  const audioStatusText = selected?.mode !== "translation_audio"
    ? null
    : !selectedTranslation
      ? "Translation text is still being prepared."
      : synthesisState === "processing"
        ? "Translated audio is being synthesized."
        : synthesisState === "succeeded"
          ? "Translated audio is ready for playback."
          : synthesisState === "failed"
            ? "Translated audio generation needs operator attention."
            : "Translated audio is queued for synthesis.";

  return (
    <main className="min-h-screen bg-[#07090d] text-white">
      <header className="sticky top-0 z-30 border-b border-white/[.07] bg-[#080b10]/92 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-black tracking-tight">iPresenterPlux Live</div>
            <div className="truncate text-xs uppercase tracking-[.16em] text-white/55">{serviceTitle}</div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-red-400/20 bg-red-400/[.09] px-3 py-1.5 text-xs font-extrabold uppercase tracking-[.15em] text-red-200">
            <Radio size={12} />
            Live
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-4 px-4 py-4 sm:py-6">
        <section className="overflow-hidden rounded-[22px] border border-white/[.08] bg-[#0d121a]">
          <LiveProgramVideo serviceId={serviceId} videoStatus={videoStatus} />

          <div className="flex items-center justify-between gap-3 border-t border-white/[.06] px-4 py-3">
            <div className="min-w-0">
              <div className="truncate text-xs font-bold">
                {selected?.name ?? "Original audio"}
              </div>
              <div className="mt-0.5 text-xs uppercase tracking-[.12em] text-white/55">
                {selected?.mode.replaceAll("_", " ") ?? "original"}
              </div>
            </div>
            <Headphones size={18} className="text-[#d7a94a]" />
          </div>
        </section>

        <section className="rounded-[22px] border border-white/[.08] bg-[#0d121a] p-4">
          <div className="mb-3 flex items-center gap-2">
            <Languages size={16} className="text-[#d7a94a]" />
            <div>
              <div className="text-sm font-bold">Listen in your language</div>
              <div className="text-xs text-white/55">Choose a channel for this device</div>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {languages.map((language) => {
              const active = language.id === selected?.id;
              const readiness = resolveAudienceChannelReadiness({
                serviceLive: true,
                channelMode: language.mode,
                transcriptAvailable: Boolean(transcript),
                translationStatus: translationStatus[language.id] ?? null,
                synthesisStatus: speechSynthesis[language.id] ?? null
              });
              return (
                <button
                  key={language.id}
                  type="button"
                  onClick={() => selectLanguage(language.id)}
                  className={
                    "ip-focus-gold min-h-11 flex items-center justify-between rounded-xl border px-3 py-3 text-left transition " +
                    (active
                      ? "border-[#d7a94a]/35 bg-[#d7a94a]/10 text-[#f0c66b]"
                      : "border-white/[.06] bg-white/[.025] text-white/70 hover:bg-white/[.045]")
                  }
                >
                  <div className="min-w-0">
                    <div className="text-xs font-bold">{language.name}</div>
                    <div className="mt-1 text-xs uppercase tracking-[.11em] opacity-65">
                      {language.mode.replaceAll("_", " ")}
                    </div>
                    <div className={`mt-1 text-xs ${readiness.tone === "healthy" ? "text-emerald-300" : readiness.tone === "warning" ? "text-amber-200" : readiness.tone === "working" ? "text-[#efc86f]" : "text-white/50"}`}>
                      {readiness.label}
                    </div>
                    {readiness.text ? <div className="mt-1 text-xs text-white/60">Text · {readiness.text.label}</div> : null}
                    {readiness.voice ? <div className="mt-1 text-xs text-white/60">Voice · {readiness.voice.label}</div> : null}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-[22px] border border-white/[.08] bg-[#0d121a] p-4">
            <div className="mb-3 flex items-center gap-2">
              <BookOpen size={16} className="text-[#d7a94a]" />
              <div className="text-xs font-bold uppercase tracking-[.12em] text-white/65">Current scripture</div>
            </div>
            {scriptureReference ? (
              <div>
                <div className="text-2xl font-black tracking-tight">{scriptureReference}</div>
                {scriptureText ? (
                  <p className="mt-3 text-sm leading-6 text-white/75">{scriptureText}</p>
                ) : (
                  <p className="mt-3 text-xs text-white/55">Scripture text is loading from the selected Bible version.</p>
                )}
              </div>
            ) : (
              <div className="text-sm text-white/55">No scripture is currently live.</div>
            )}
          </div>

          <div className="rounded-[22px] border border-white/[.08] bg-[#0d121a] p-4">
            <div className="mb-3 flex items-center gap-2">
              <Captions size={16} className="text-[#d7a94a]" />
              <div className="text-xs font-bold uppercase tracking-[.12em] text-white/65">Live captions</div>
            </div>
            <p className="text-sm leading-6 text-white/75">
              {captionText
                ?? (sourceSelected
                  ? "Waiting for the next spoken segment…"
                  : "Translation is being prepared for this language…")}
            </p>
            {audioStatusText ? (
              <div className="mt-3 rounded-lg border border-white/[.05] bg-white/[.02] px-2.5 py-2 text-xs leading-4 text-white/55">
                {audioStatusText}
              </div>
            ) : null}
            {selected?.mode === "translation_audio" && selected.id && !sourceSelected ? (
              <LiveTranslatedAudio key={`${serviceId}:${selected.id}`} serviceId={serviceId} channelId={selected.id} />
            ) : null}
            {transcriptLanguage ? (
              <div className="mt-3 text-xs uppercase tracking-[.12em] text-white/50">
                Source language · {transcriptLanguage}
              </div>
            ) : null}
          </div>
        </section>

        <footer className="pb-5 pt-2 text-center text-xs leading-5 text-white/55">
          iPresenterPlux · Church presentation, interpretation and live engagement
        </footer>
      </div>
    </main>
  );
}
