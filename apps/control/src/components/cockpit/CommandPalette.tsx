"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowRight, Command, Eye, Search, X } from "lucide-react";
import { hasBlockingModal } from "@/lib/cockpit/keyboard-safety";

const OPEN_EVENT = "ipresenterplux:command-open";
const SEARCH_DEBOUNCE_MS = 120;
const GROUP_ORDER = ["Scripture", "Songs", "Media", "Service", "Visual Sources", "Actions"] as const;

type CommandResponse = {
  ok: boolean;
  error?: string;
  resolution?: {
    status: "ready" | "needs_confirmation" | "unknown";
    summary: string;
  };
  result?:
    | { kind: "navigation"; href: string }
    | { kind: "scripture_search"; reference: string; version: string; passageText: string }
    | { kind: "prepared"; message: string; followUp: { type: "scripture_preview"; detectionId: string; reference: string } }
    | { kind: "media_search"; items: Array<{ id: string; title: string; itemType: string }> }
    | { kind: "updated"; message: string }
    | { kind: "status"; message: string; href: string }
    | null;
};

type UniversalSearchItem = {
  id: string;
  group: "scripture" | "songs" | "media" | "service" | "visual_sources" | "actions";
  title: string;
  subtitle: string | null;
  href: string | null;
  commandText: string | null;
};

type UniversalSearchGroup = {
  id: UniversalSearchItem["group"];
  label: string;
  items: UniversalSearchItem[];
};

type UniversalSearchResponse = {
  ok: boolean;
  error?: string;
  search?: { query: string; groups: UniversalSearchGroup[] };
};

export function CommandPalette() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<CommandResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState<UniversalSearchResponse["search"] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [pending, startTransition] = useTransition();

  const visibleGroups = useMemo(() => {
    const groups = search?.groups ?? [];
    const ordered = GROUP_ORDER.flatMap((label) => {
      const group = groups.find((candidate) => candidate.label === label);
      return group && group.items.length > 0 ? [group] : [];
    });
    return ordered.map((group, index) => ({
      ...group,
      startIndex: ordered.slice(0, index).reduce((sum, candidate) => sum + candidate.items.length, 0)
    }));
  }, [search]);
  const flatResults = useMemo(() => visibleGroups.flatMap((group) => group.items), [visibleGroups]);
  const activeItem = activeIndex >= 0 ? flatResults[activeIndex] ?? null : null;

  useEffect(() => {
    function openPalette() {
      if (hasBlockingModal()) return;
      setOpen(true);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        setOpen(false);
        setResponse(null);
        setMessage(null);
        setSearch(null);
        setSearchError(null);
        setSearchLoading(false);
        setActiveIndex(-1);
        return;
      }
      if (!open && hasBlockingModal()) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input,textarea,select,[contenteditable='true'],[role='textbox']")) return;
      event.preventDefault();
      openPalette();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_EVENT, openPalette);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_EVENT, openPalette);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const text = query.trim();
    if (!text) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearchLoading(true);
      setSearchError(null);
      try {
        const result = await fetch(`/api/v1/cockpit/search?q=${encodeURIComponent(text)}&limit=5`, { signal: controller.signal });
        const payload = await result.json().catch(() => null) as UniversalSearchResponse | null;
        if (!result.ok || !payload?.ok || !payload.search) {
          setSearchError(payload?.error ?? "Search is temporarily unavailable");
          return;
        }
        setSearch(payload.search);
        setActiveIndex(-1);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSearchError("Search is temporarily unavailable. Live controls remain available.");
      } finally {
        if (!controller.signal.aborted) setSearchLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);

  function close() {
    setOpen(false);
    setResponse(null);
    setMessage(null);
    setSearch(null);
    setSearchError(null);
    setSearchLoading(false);
    setActiveIndex(-1);
  }

  function runCommand(text: string) {
    const normalized = text.trim();
    if (!normalized) return;
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await fetch("/api/v1/cockpit/command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: normalized })
        });
        const payload = await result.json().catch(() => null) as CommandResponse | null;
        if (!result.ok || !payload?.ok) {
          setMessage(payload?.error ?? "Command failed");
          return;
        }
        setResponse(payload);
        if (payload.result?.kind === "navigation") {
          router.push(payload.result.href);
          close();
        }
      } catch {
        setMessage("Network error. The command could not be verified.");
      }
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    runCommand(query);
  }

  function activateSearchItem(item: UniversalSearchItem) {
    if (item.href) {
      router.push(item.href);
      close();
      return;
    }
    if (item.commandText) {
      setQuery(item.commandText);
      runCommand(item.commandText);
    }
  }

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (flatResults.length) setActiveIndex((current) => Math.min(flatResults.length - 1, current + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (flatResults.length) setActiveIndex((current) => current <= 0 ? flatResults.length - 1 : current - 1);
      return;
    }
    if (event.key === "Enter" && activeItem) {
      event.preventDefault();
      activateSearchItem(activeItem);
    }
  }

  function previewPrepared() {
    const prepared = response?.result?.kind === "prepared" ? response.result : null;
    if (!prepared) return;
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await fetch(`/api/v1/scriptures/${prepared.followUp.detectionId}/state`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "preview" })
        });
        const payload = await result.json().catch(() => null);
        if (!result.ok) {
          setMessage(payload?.error ?? "Preview failed");
          return;
        }
        setMessage(`${prepared.followUp.reference} prepared in Preview. Program is unchanged.`);
        router.refresh();
      } catch {
        setMessage("Network error. Preview could not be verified.");
      }
    });
  }

  return <>
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}
      className="ip-focus-gold fixed bottom-20 right-4 z-40 flex min-h-12 items-center gap-2 rounded-xl border border-white/[.08] bg-[#10151e]/95 px-3 text-xs font-bold text-white/75 shadow-2xl backdrop-blur-xl transition hover:bg-[#151b26] hover:text-white md:hidden"
      aria-label="What do you need next?"
    >
      <Search size={16}/><span>Find</span>
    </button>
    {open ? <div className="fixed inset-0 z-[160] flex items-start justify-center bg-black/65 px-3 pt-[7vh] backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="What do you need next?">
      <section className="w-full max-w-3xl overflow-hidden rounded-2xl border border-white/[.1] bg-[#0a0f17] shadow-[0_30px_120px_rgba(0,0,0,.65)]">
        <form onSubmit={submit} className="border-b border-white/[.07] p-3">
          <div className="flex items-center gap-2 rounded-xl border border-white/[.09] bg-black/25 px-3">
            <Search size={18} className="shrink-0 text-[#e2b85f]"/>
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => { setQuery(event.target.value); setActiveIndex(-1); if (!event.target.value.trim()) { setSearch(null); setSearchError(null); setSearchLoading(false); } }}
              onKeyDown={onInputKeyDown}
              placeholder="What do you need next?"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={visibleGroups.length > 0}
              aria-controls="cockpit-universal-results"
              aria-activedescendant={activeItem ? `cockpit-search-option-${activeIndex}` : undefined}
              className="min-h-14 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/40"
            />
            <button type="button" onClick={close} className="ip-focus-gold flex h-11 w-11 items-center justify-center rounded-lg text-white/40 hover:bg-white/[.05] hover:text-white/75" aria-label="Close universal find"><X size={18}/></button>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 px-1 text-xs text-white/50">
            <span>Find first · explicit action second · Program authority unchanged</span>
            <button type="submit" disabled={pending || !query.trim()} className="ip-focus-gold min-h-11 rounded-lg bg-[#d7a94a] px-4 font-black text-[#171107] disabled:opacity-35">{pending ? "Working…" : "Run command"}</button>
          </div>
        </form>
        <div className="max-h-[62vh] overflow-y-auto p-4">
          {query.trim() ? <div id="cockpit-universal-results" role="listbox" aria-label="Universal search results" className="space-y-4">
            {visibleGroups.map((group) => <section key={group.id} aria-label={group.label}>
              <div className="mb-2 text-xs font-black uppercase tracking-[.16em] text-[#e2b85f]">{group.label}</div>
              <div className="space-y-1.5">
                {group.items.map((item, itemIndex) => {
                  const index = group.startIndex + itemIndex;
                  const selected = index === activeIndex;
                  return <button
                    key={`${group.id}:${item.id}`}
                    id={`cockpit-search-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setActiveIndex(index)}
                    onFocus={() => setActiveIndex(index)}
                    onClick={() => activateSearchItem(item)}
                    className={`ip-focus-gold flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition ${selected ? "border-[#d7a94a]/35 bg-[#d7a94a]/[.08]" : "border-white/[.07] bg-white/[.018] hover:bg-white/[.04]"}`}
                  >
                    <span className="min-w-0"><span className="block truncate text-sm font-bold text-white/80">{item.title}</span>{item.subtitle ? <span className="mt-0.5 block truncate text-xs text-white/45">{item.subtitle}</span> : null}</span>
                    <ArrowRight size={15} className="shrink-0 text-white/35"/>
                  </button>;
                })}
              </div>
            </section>)}
            {searchLoading ? <div role="status" className="text-xs text-white/45">Searching Scripture, songs, media, service and sources…</div> : null}
            {searchError ? <div role="status" aria-live="polite" className="rounded-xl border border-amber-300/15 bg-amber-300/[.05] px-3 py-2 text-xs text-amber-100/75">{searchError}</div> : null}
            {!searchLoading && !searchError && search && visibleGroups.length === 0 ? <div className="text-sm text-white/45">No matching items. You can still run the text as a deterministic command.</div> : null}
          </div> : <div className="text-sm leading-6 text-white/55">Search Scripture, Songs, Media, the current Service, Visual Sources, or safe Actions.</div>}

          {response?.resolution ? <div className="mt-4 rounded-xl border border-white/[.07] bg-white/[.02] p-3"><div className="text-xs font-black uppercase tracking-[.18em] text-[#e2b85f]">Interpreted action</div><div className="mt-1 text-sm font-bold text-white/80">{response.resolution.summary}</div>{response.resolution.status !== "ready" ? <div className="mt-2 text-xs text-amber-200/80">Use the explicit live control for consequential actions that are not registered here.</div> : null}</div> : null}
          {response?.result?.kind === "prepared" ? <div className="mt-3 rounded-xl border border-[#d7a94a]/20 bg-[#d7a94a]/[.06] p-3"><div className="text-sm font-bold text-white/75">{response.result.message}</div><button type="button" disabled={pending} onClick={previewPrepared} className="ip-focus-gold mt-3 flex min-h-11 items-center gap-2 rounded-xl bg-[#d7a94a] px-4 text-xs font-black text-[#171107]"><Eye size={15}/>Preview {response.result.followUp.reference}</button></div> : null}
          {response?.result?.kind === "scripture_search" ? <div className="mt-3 rounded-xl border border-white/[.07] p-3"><div className="text-sm font-black text-white/75">{response.result.reference} · {response.result.version}</div><p className="mt-2 text-sm leading-6 text-white/52">{response.result.passageText}</p></div> : null}
          {response?.result?.kind === "media_search" ? <div className="mt-3 space-y-2">{response.result.items.length ? response.result.items.map((item) => <Link key={item.id} href={`/media?item=${encodeURIComponent(item.id)}`} onClick={close} className="ip-focus-gold flex min-h-11 items-center justify-between rounded-xl border border-white/[.07] px-3 text-sm text-white/65 hover:bg-white/[.04]"><span>{item.title}</span><span className="text-xs uppercase text-white/30">{item.itemType}</span></Link>) : <div className="text-xs text-white/35">No matching media found.</div>}</div> : null}
          {response?.result?.kind === "status" ? <Link href={response.result.href} onClick={close} className="ip-focus-gold mt-3 flex min-h-11 items-center justify-between rounded-xl border border-white/[.07] px-3 text-sm text-white/65 hover:bg-white/[.04]"><span>{response.result.message}</span><span className="text-[#e2b85f]">Open</span></Link> : null}
          {response?.result?.kind === "updated" ? <div role="status" className="mt-3 rounded-xl border border-[#d7a94a]/20 bg-[#d7a94a]/[.05] px-3 py-2 text-xs text-[#efd28b]">{response.result.message}</div> : null}
          {message ? <div role="status" aria-live="polite" className="mt-3 rounded-xl border border-white/[.07] bg-white/[.025] px-3 py-2 text-xs text-white/65">{message}</div> : null}
        </div>
        <footer className="border-t border-white/[.07] bg-[#070a0f]/60 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-white/45">
            <span className="flex items-center gap-1"><kbd className="rounded border border-white/10 bg-white/[.04] px-1.5 py-0.5 font-mono text-white/65">⌘K</kbd> Find / Command</span>
            <span className="flex items-center gap-1"><kbd className="rounded border border-white/10 bg-white/[.04] px-1.5 py-0.5 font-mono text-white/65">↑↓</kbd> Highlight</span>
            <span className="flex items-center gap-1"><kbd className="rounded border border-white/10 bg-white/[.04] px-1.5 py-0.5 font-mono text-white/65">Enter</kbd> Open selected</span>
            <span className="ml-auto flex items-center gap-1 text-white/35"><Command size={12}/> Program remains separately authorized</span>
          </div>
        </footer>
      </section>
    </div> : null}
  </>;
}
