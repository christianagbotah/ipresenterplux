"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { Command, Eye, Search, X } from "lucide-react";

const OPEN_EVENT = "ipresenterplux:command-open";

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

export function CommandPalette() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<CommandResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    function openPalette() {
      setOpen(true);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        setOpen(false);
        return;
      }
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

  function close() {
    setOpen(false);
    setResponse(null);
    setMessage(null);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = query.trim();
    if (!text) return;
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await fetch("/api/v1/cockpit/command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text })
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
      className="fixed bottom-20 right-4 z-40 hidden min-h-11 items-center gap-2 rounded-xl border border-white/[.08] bg-[#10151e]/95 px-3 text-xs font-bold text-white/65 shadow-2xl backdrop-blur-xl transition hover:bg-[#151b26] hover:text-white/90 ip-focus-gold md:flex"
      aria-label="Open command palette"
    >
      <Command size={15}/><span>Command</span><kbd className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-white/35">⌘/Ctrl K</kbd>
    </button>
    {open ? <div className="fixed inset-0 z-[160] flex items-start justify-center bg-black/65 px-3 pt-[10vh] backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="iPresenterPlux command palette">
      <section className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/[.1] bg-[#0a0f17] shadow-[0_30px_120px_rgba(0,0,0,.65)]">
        <form onSubmit={submit} className="border-b border-white/[.07] p-3">
          <div className="flex items-center gap-2 rounded-xl border border-white/[.09] bg-black/25 px-3">
            <Search size={18} className="shrink-0 text-[#e2b85f]"/>
            <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Show John 3:16, Find Amazing Grace, Open archive…" className="min-h-14 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/40" />
            <button type="button" onClick={close} className="flex h-11 w-11 items-center justify-center rounded-lg text-white/40 hover:bg-white/[.05] hover:text-white/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40" aria-label="Close command palette"><X size={18}/></button>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 px-1 text-[10px] text-white/50"><span>AI-native typed actions · Program remains human-authorized</span><button type="submit" disabled={pending || !query.trim()} className="min-h-9 rounded-lg bg-[#d7a94a] px-3 font-black text-[#171107] disabled:opacity-35">{pending ? "Working…" : "Run"}</button></div>
        </form>
        <div className="max-h-[55vh] overflow-y-auto p-4">
          {response?.resolution ? <div className="rounded-xl border border-white/[.07] bg-white/[.02] p-3"><div className="text-[10px] font-black uppercase tracking-[.18em] text-[#e2b85f]">Interpreted action</div><div className="mt-1 text-sm font-bold text-white/80">{response.resolution.summary}</div>{response.resolution.status !== "ready" ? <div className="mt-2 text-xs text-amber-200/80">Use the explicit live control for consequential actions that are not registered here.</div> : null}</div> : <div className="text-sm leading-6 text-white/55">Try a Scripture reference, media search, workspace navigation, or a system-status question.</div>}
          {response?.result?.kind === "prepared" ? <div className="mt-3 rounded-xl border border-[#d7a94a]/20 bg-[#d7a94a]/[.06] p-3"><div className="text-sm font-bold text-white/75">{response.result.message}</div><button type="button" disabled={pending} onClick={previewPrepared} className="mt-3 flex min-h-11 items-center gap-2 rounded-xl bg-[#d7a94a] px-4 text-xs font-black text-[#171107] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f0d28d]"><Eye size={15}/>Preview {response.result.followUp.reference}</button></div> : null}
          {response?.result?.kind === "scripture_search" ? <div className="mt-3 rounded-xl border border-white/[.07] p-3"><div className="text-sm font-black text-white/75">{response.result.reference} · {response.result.version}</div><p className="mt-2 text-sm leading-6 text-white/52">{response.result.passageText}</p></div> : null}
          {response?.result?.kind === "media_search" ? <div className="mt-3 space-y-2">{response.result.items.length ? response.result.items.map((item) => <Link key={item.id} href={`/media?item=${encodeURIComponent(item.id)}`} onClick={close} className="flex min-h-11 items-center justify-between rounded-xl border border-white/[.07] px-3 text-sm text-white/65 hover:bg-white/[.04]"><span>{item.title}</span><span className="text-[10px] uppercase text-white/30">{item.itemType}</span></Link>) : <div className="text-xs text-white/35">No matching media found.</div>}</div> : null}
          {response?.result?.kind === "status" ? <Link href={response.result.href} onClick={close} className="mt-3 flex min-h-11 items-center justify-between rounded-xl border border-white/[.07] px-3 text-sm text-white/65 hover:bg-white/[.04]"><span>{response.result.message}</span><span className="text-[#e2b85f]">Open</span></Link> : null}
          {message ? <div role="status" aria-live="polite" className="mt-3 rounded-xl border border-white/[.07] bg-white/[.025] px-3 py-2 text-xs text-white/65">{message}</div> : null}
        </div>
        <footer className="border-t border-white/[.07] bg-[#070a0f]/60 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] text-white/45">
            <span className="flex items-center gap-1"><kbd className="rounded border border-white/10 bg-white/[.04] px-1.5 py-0.5 font-mono text-white/65">⌘K</kbd> Command</span>
            <span className="flex items-center gap-1"><kbd className="rounded border border-white/10 bg-white/[.04] px-1.5 py-0.5 font-mono text-white/65">⌘↵</kbd> Take to Program</span>
            <span className="flex items-center gap-1"><kbd className="rounded border border-white/10 bg-white/[.04] px-1.5 py-0.5 font-mono text-white/65">⌘⌫</kbd> Clear Program</span>
            <span className="flex items-center gap-1"><kbd className="rounded border border-white/10 bg-white/[.04] px-1.5 py-0.5 font-mono text-white/65">F</kbd> Focus</span>
            <span className="flex items-center gap-1"><kbd className="rounded border border-white/10 bg-white/[.04] px-1.5 py-0.5 font-mono text-white/65">D</kbd> Depth</span>
            <span className="flex items-center gap-1"><kbd className="rounded border border-white/10 bg-white/[.04] px-1.5 py-0.5 font-mono text-white/65">?</kbd> Shortcuts</span>
            <span className="ml-auto flex items-center gap-1 text-white/35">Program remains human-authorized</span>
          </div>
        </footer>
      </section>
    </div> : null}
  </>;
}
