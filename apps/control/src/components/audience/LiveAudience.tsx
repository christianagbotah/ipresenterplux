"use client";

import { useMemo, useSyncExternalStore } from "react";
import { LiveTranslatedAudio } from "@/components/audience/LiveTranslatedAudio";
import { LiveProgramVideo } from "@/components/audience/LiveProgramVideo";
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

type SpeechSynthesisState = "pending" | "processing" | "succeeded" | "failed";

type Props = {
  serviceId: string;
  serviceTitle: string;
  scriptureReference: string | null;
  scriptureText: string | null;
  transcript: string | null;
  transcriptLanguage: string | null;
  translations: Record<string, string>;
  speechSynthesis: Record<string, SpeechSynthesisState>;
  languages: LanguageChannel[];
};

export function LiveAudience({
  serviceId,
  serviceTitle,
  scriptureReference,
  scriptureText,
  transcript,
  transcriptLanguage,
  translations,
  speechSynthesis,
  languages
}: Props) {
  const fallbackChannelId = languages[0]?.id ?? "";
  const selectedChannelId = useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener("ipresenterplux-language-change", onStoreChange);
      return () => window.removeEventListener("ipresenterplux-language-change", onStoreChange);
    },
    () => {
      const saved = window.localStorage.getItem("ipresenterplux-language");
      return languages.some((item) => item.id === saved) ? saved ?? fallbackChannelId : fallbackChannelId;
    },
    () => fallbackChannelId
  );

  const selected = useMemo(
    () => languages.find((item) => item.id === selectedChannelId) ?? languages[0],
    [languages, selectedChannelId]
  );

  function selectLanguage(id: string) {
    window.localStorage.setItem("ipresenterplux-language", id);
    window.dispatchEvent(new Event("ipresenterplux-language-change"));
  }

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
            <div className="truncate text-[11px] uppercase tracking-[.16em] text-white/55">{serviceTitle}</div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-red-400/20 bg-red-400/[.09] px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-[.15em] text-red-200">
            <Radio size={12} />
            Live
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-4 px-4 py-4 sm:py-6">
        <section className="overflow-hidden rounded-[22px] border border-white/[.08] bg-[#0d121a]">
          <LiveProgramVideo serviceId={serviceId} />

          <div className="flex items-center justify-between gap-3 border-t border-white/[.06] px-4 py-3">
            <div className="min-w-0">
              <div className="truncate text-xs font-bold">
                {selected?.name ?? "Original audio"}
              </div>
              <div className="mt-0.5 text-[11px] uppercase tracking-[.12em] text-white/55">
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
              <div className="text-[11px] text-white/55">Choose a channel for this device</div>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {languages.map((language) => {
              const active = language.id === selected?.id;
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
                  <div>
                    <div className="text-xs font-bold">{language.name}</div>
                    <div className="mt-1 text-[11px] uppercase tracking-[.11em] opacity-70">
                      {language.mode.replaceAll("_", " ")}
                    </div>
                  </div>
                  <span className="text-[11px] opacity-65">{language.listeners}</span>
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
              <div className="mt-3 rounded-lg border border-white/[.05] bg-white/[.02] px-2.5 py-2 text-[11px] leading-4 text-white/55">
                {audioStatusText}
              </div>
            ) : null}
            {selected?.mode === "translation_audio" && selected.id && !sourceSelected ? (
              <LiveTranslatedAudio key={`${serviceId}:${selected.id}`} serviceId={serviceId} channelId={selected.id} />
            ) : null}
            {transcriptLanguage ? (
              <div className="mt-3 text-[11px] uppercase tracking-[.12em] text-white/50">
                Source language · {transcriptLanguage}
              </div>
            ) : null}
          </div>
        </section>

        <footer className="pb-5 pt-2 text-center text-[11px] leading-5 text-white/55">
          iPresenterPlux · Church presentation, interpretation and live engagement
        </footer>
      </div>
    </main>
  );
}
