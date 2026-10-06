"use client";

import { useState, useTransition } from "react";
import { Link2, LoaderCircle, Unlink2, X } from "lucide-react";
import { useRouter } from "next/navigation";

export function StreamingProviderConnection({
  id,
  name,
  connected,
  available,
  canControl,
  locked
}: {
  id: string;
  name: string;
  connected: boolean;
  available: boolean;
  canControl: boolean;
  locked: boolean;
}) {
  const router = useRouter();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [isPending, startTransition] = useTransition();

  function connect() {
    if (!canControl || !available || locked || connected || isPending) return;
    setFeedback(null);
    setFailed(false);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/v1/outputs/${id}/provider/youtube/connect`, { method: "POST" });
        const payload = await response.json().catch(() => null);
        if (!response.ok || typeof payload?.authorizationUrl !== "string") {
          setFailed(true);
          setFeedback(payload?.error ?? "YouTube account linking could not be started.");
          return;
        }
        window.location.assign(payload.authorizationUrl);
      } catch {
        setFailed(true);
        setFeedback("Network error. YouTube account linking could not be started.");
      }
    });
  }

  function disconnect() {
    if (!canControl || locked || !connected || isPending) return;
    setFeedback(null);
    setFailed(false);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/v1/outputs/${id}/provider/youtube/connection`, { method: "DELETE" });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          setFailed(true);
          setFeedback(payload?.error ?? "YouTube account could not be disconnected.");
          return;
        }
        setConfirmDisconnect(false);
        setFeedback("YouTube account disconnected. RTMPS credentials were left unchanged.");
        router.refresh();
      } catch {
        setFailed(true);
        setFeedback("Network error. YouTube account could not be disconnected.");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={connected ? () => setConfirmDisconnect(true) : connect}
        disabled={!canControl || !available || locked || isPending}
        className={`flex min-h-11 items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e7bd63] disabled:cursor-not-allowed disabled:opacity-40 ${connected ? "border-emerald-400/20 bg-emerald-400/[.07] text-emerald-100 hover:bg-emerald-400/10" : "border-white/[.1] bg-white/[.035] text-white/65 hover:bg-white/[.07]"}`}
      >
        {isPending ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <Link2 size={15} aria-hidden="true" />}
        {locked ? "Provider locked" : !available ? "OAuth setup" : connected ? "YouTube linked" : "Link YouTube"}
      </button>
      {!available ? <span className="max-w-56 text-right text-[10px] leading-4 text-amber-200/70">Google OAuth client credentials are not configured yet.</span> : null}
      {feedback ? <span aria-live="polite" className={`max-w-56 text-right text-[10px] leading-4 ${failed ? "text-red-300" : "text-emerald-200"}`}>{feedback}</span> : null}

      {confirmDisconnect ? (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`Disconnect YouTube from ${name}`}>
          <div className="w-full max-w-md rounded-2xl border border-white/[.1] bg-[#0b1018] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[.16em] text-[#e7bd63]">Provider connection</div>
                <h3 className="mt-1 text-lg font-black">Disconnect YouTube?</h3>
                <p className="mt-2 text-xs leading-5 text-white/42">Provider-confirmed health will become unavailable for {name}. The RTMPS ingest URL and stream key are not deleted.</p>
              </div>
              <button type="button" onClick={() => setConfirmDisconnect(false)} disabled={isPending} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[.08] text-white/45 hover:bg-white/[.06] hover:text-white disabled:opacity-40" aria-label="Cancel disconnect">
                <X size={16} />
              </button>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmDisconnect(false)} disabled={isPending} className="min-h-10 rounded-xl border border-white/[.08] px-4 text-xs font-black text-white/55 hover:bg-white/[.05] disabled:opacity-40">Keep linked</button>
              <button type="button" onClick={disconnect} disabled={isPending} className="flex min-h-10 items-center gap-2 rounded-xl border border-red-400/20 bg-red-400/[.07] px-4 text-xs font-black text-red-100 hover:bg-red-400/10 disabled:opacity-40">
                {isPending ? <LoaderCircle size={14} className="animate-spin" /> : <Unlink2 size={14} />} Disconnect
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
