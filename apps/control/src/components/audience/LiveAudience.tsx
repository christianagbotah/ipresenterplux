"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  BookOpen,
  Captions,
  Headphones,
  Languages,
  Maximize2,
  Radio,
  Volume2
} from "lucide-react";

type LanguageChannel = {
  id: string;
  code: string;
  name: string;
  mode: string;
  listeners: number;
};

type Props = {
  serviceTitle: string;
  scriptureReference: string | null;
  scriptureText: string | null;
  transcript: string | null;
  languages: LanguageChannel[];
};

export function LiveAudience({
  serviceTitle,
  scriptureReference,
  scriptureText,
  transcript,
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

  return (
    <main className="min-h-screen bg-[#07090d] text-white">
      <header className="sticky top-0 z-30 border-b border-white/[.07] bg-[#080b10]/92 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-black tracking-tight">iPresenterPlux Live</div>
            <div className="truncate text-[10px] uppercase tracking-[.16em] text-white/30">{serviceTitle}</div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-red-400/20 bg-red-400/[.09] px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[.15em] text-red-200">
            <Radio size={12} />
            Live
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-4 px-4 py-4 sm:py-6">
        <section className="overflow-hidden rounded-[22px] border border-white/[.08] bg-[#0d121a]">
          <div className="relative aspect-video bg-black">
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[radial-gradient(circle_at_center,rgba(215,169,74,.08),transparent_45%)]">
              <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/[.08] bg-white/[.04] text-white/25">
                <Volume2 size={22} />
              </div>
              <div className="mt-4 text-sm font-semibold text-white/55">Live video gateway</div>
              <div className="mt-1 text-xs text-white/25">WebRTC program feed will appear here</div>
            </div>

            <button
              type="button"
              className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-xl border border-white/[.08] bg-black/50 text-white/60"
              aria-label="Full screen"
            >
              <Maximize2 size={15} />
            </button>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-white/[.06] px-4 py-3">
            <div className="min-w-0">
              <div className="truncate text-xs font-bold">
                {selected?.name ?? "Original audio"}
              </div>
              <div className="mt-0.5 text-[10px] uppercase tracking-[.12em] text-white/28">
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
              <div className="text-[11px] text-white/30">Choose a channel for this device</div>
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
                    "flex items-center justify-between rounded-xl border px-3 py-3 text-left transition " +
                    (active
                      ? "border-[#d7a94a]/35 bg-[#d7a94a]/10 text-[#f0c66b]"
                      : "border-white/[.06] bg-white/[.025] text-white/55 hover:bg-white/[.045]")
                  }
                >
                  <div>
                    <div className="text-xs font-bold">{language.name}</div>
                    <div className="mt-1 text-[10px] uppercase tracking-[.11em] opacity-55">
                      {language.mode.replaceAll("_", " ")}
                    </div>
                  </div>
                  <span className="text-[10px] opacity-45">{language.listeners}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-[22px] border border-white/[.08] bg-[#0d121a] p-4">
            <div className="mb-3 flex items-center gap-2">
              <BookOpen size={16} className="text-[#d7a94a]" />
              <div className="text-xs font-bold uppercase tracking-[.12em] text-white/45">Current scripture</div>
            </div>
            {scriptureReference ? (
              <div>
                <div className="text-2xl font-black tracking-tight">{scriptureReference}</div>
                {scriptureText ? (
                  <p className="mt-3 text-sm leading-6 text-white/62">{scriptureText}</p>
                ) : (
                  <p className="mt-3 text-xs text-white/28">Scripture text is loading from the selected Bible version.</p>
                )}
              </div>
            ) : (
              <div className="text-sm text-white/30">No scripture is currently live.</div>
            )}
          </div>

          <div className="rounded-[22px] border border-white/[.08] bg-[#0d121a] p-4">
            <div className="mb-3 flex items-center gap-2">
              <Captions size={16} className="text-[#d7a94a]" />
              <div className="text-xs font-bold uppercase tracking-[.12em] text-white/45">Live captions</div>
            </div>
            <p className="text-sm leading-6 text-white/55">
              {selected?.code === "en"
                ? transcript ?? "Waiting for the next spoken segment…"
                : "Translated captions will appear here when the translation worker is connected."}
            </p>
          </div>
        </section>

        <footer className="pb-5 pt-2 text-center text-[10px] leading-5 text-white/20">
          iPresenterPlux · Church presentation, interpretation and live engagement
        </footer>
      </div>
    </main>
  );
}
