"use client";

import type { FormEvent } from "react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LoaderCircle, Settings2, Trash2, X } from "lucide-react";

export function StreamingDestinationCredentials({
  id,
  name,
  configured,
  canControl,
  locked
}: {
  id: string;
  name: string;
  configured: boolean;
  canControl: boolean;
  locked: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ingestUrl, setIngestUrl] = useState("");
  const [streamKey, setStreamKey] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function openConfiguration() {
    if (!canControl || locked || loading) return;
    setOpen(true);
    setLoading(true);
    setFeedback(null);
    setFailed(false);
    setStreamKey("");

    try {
      const response = await fetch(`/api/v1/outputs/${id}/credentials`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setFailed(true);
        setFeedback(payload?.error ?? "Could not load destination configuration.");
        return;
      }
      setIngestUrl(payload?.credential?.ingestUrl ?? "");
    } catch {
      setFailed(true);
      setFeedback("Network error. Destination configuration could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  function closeConfiguration() {
    if (isPending) return;
    setOpen(false);
    setStreamKey("");
    setFeedback(null);
    setFailed(false);
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!canControl || locked || isPending) return;
    setFeedback(null);
    setFailed(false);

    startTransition(async () => {
      try {
        const response = await fetch(`/api/v1/outputs/${id}/credentials`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ingestUrl, streamKey })
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          setFailed(true);
          setFeedback(payload?.error ?? "Could not save destination credentials.");
          return;
        }
        setStreamKey("");
        setFeedback("RTMPS destination saved. The stream key remains write-only.");
        router.refresh();
      } catch {
        setFailed(true);
        setFeedback("Network error. Destination credentials were not saved.");
      }
    });
  }

  function clearCredentials() {
    if (!canControl || locked || isPending || !configured) return;
    setFeedback(null);
    setFailed(false);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/v1/outputs/${id}/credentials`, { method: "DELETE" });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          setFailed(true);
          setFeedback(payload?.error ?? "Could not clear destination credentials.");
          return;
        }
        setIngestUrl("");
        setStreamKey("");
        setFeedback("Credentials cleared and the destination was disabled.");
        router.refresh();
      } catch {
        setFailed(true);
        setFeedback("Network error. Destination credentials were not cleared.");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={openConfiguration}
        disabled={!canControl || locked || loading}
        className="flex min-h-11 items-center gap-2 rounded-xl border border-white/[.1] bg-white/[.035] px-3.5 py-2.5 text-sm font-black text-white/65 transition hover:bg-white/[.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e7bd63] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {loading ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : configured ? <KeyRound size={15} aria-hidden="true" /> : <Settings2 size={15} aria-hidden="true" />}
        {locked ? "Locked" : configured ? "RTMPS" : "Configure"}
      </button>

      {open ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`Configure ${name}`}>
          <div className="w-full max-w-lg rounded-2xl border border-white/[.1] bg-[#0b1018] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[.16em] text-[#e7bd63]">Secure destination</div>
                <h3 className="mt-1 text-lg font-black">{name}</h3>
                <p className="mt-1 text-xs leading-5 text-white/38">The stream key is encrypted at rest and is never returned to this browser after saving.</p>
              </div>
              <button type="button" onClick={closeConfiguration} disabled={isPending} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[.08] text-white/45 hover:bg-white/[.06] hover:text-white disabled:opacity-40" aria-label="Close configuration">
                <X size={16} />
              </button>
            </div>

            {loading ? (
              <div className="mt-5 flex items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.025] p-4 text-sm text-white/45"><LoaderCircle size={16} className="animate-spin" /> Loading configuration…</div>
            ) : (
              <form className="mt-5 space-y-4" onSubmit={save}>
                <label className="block">
                  <span className="text-xs font-bold text-white/55">RTMPS ingest URL</span>
                  <input
                    type="url"
                    required
                    value={ingestUrl}
                    onChange={(event) => setIngestUrl(event.target.value)}
                    placeholder="rtmps://provider.example/live"
                    autoComplete="off"
                    className="mt-1.5 min-h-11 w-full rounded-xl border border-white/[.1] bg-black/25 px-3 text-sm text-white outline-none placeholder:text-white/20 focus:border-[#d7a94a]/50 focus:ring-2 focus:ring-[#d7a94a]/15"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-bold text-white/55">Stream key {configured ? "· enter a new value to rotate" : ""}</span>
                  <input
                    type="password"
                    required
                    value={streamKey}
                    onChange={(event) => setStreamKey(event.target.value)}
                    placeholder={configured ? "Stored key is hidden — enter replacement" : "Paste provider stream key"}
                    autoComplete="new-password"
                    className="mt-1.5 min-h-11 w-full rounded-xl border border-white/[.1] bg-black/25 px-3 text-sm text-white outline-none placeholder:text-white/20 focus:border-[#d7a94a]/50 focus:ring-2 focus:ring-[#d7a94a]/15"
                  />
                </label>

                {feedback ? <p aria-live="polite" className={`text-xs leading-5 ${failed ? "text-red-300" : "text-emerald-200"}`}>{feedback}</p> : null}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={clearCredentials}
                    disabled={!configured || isPending}
                    className="flex min-h-10 items-center gap-2 rounded-xl border border-red-400/20 bg-red-400/[.06] px-3 text-xs font-black text-red-100 transition hover:bg-red-400/10 disabled:opacity-35"
                  >
                    <Trash2 size={14} /> Clear
                  </button>
                  <button
                    type="submit"
                    disabled={isPending || !ingestUrl.trim() || !streamKey.trim()}
                    className="flex min-h-10 items-center gap-2 rounded-xl border border-[#d7a94a]/30 bg-[#d7a94a]/15 px-4 text-xs font-black text-[#f3ce7b] transition hover:bg-[#d7a94a]/20 disabled:opacity-40"
                  >
                    {isPending ? <LoaderCircle size={14} className="animate-spin" /> : <KeyRound size={14} />}
                    {configured ? "Rotate credentials" : "Save credentials"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
