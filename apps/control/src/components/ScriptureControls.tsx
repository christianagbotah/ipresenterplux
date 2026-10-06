"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, Radio, Square, X } from "lucide-react";

type ScriptureState = "detected" | "preview" | "live" | "dismissed";

type MutationPayload = {
  error?: string;
  edgeCommandsQueued?: number;
};

export function ScriptureControls({
  id,
  currentState
}: {
  id: string;
  currentState: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function changeState(state: ScriptureState, label: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/v1/scriptures/" + id + "/state", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state })
        });

        const payload = (await response.json().catch(() => null)) as MutationPayload | null;

        if (!response.ok) {
          setError(payload?.error ?? "Could not update scripture state");
          return;
        }

        const queued = Number(payload?.edgeCommandsQueued ?? 0);
        setNotice(
          queued > 0
            ? `${label}. ${queued} Edge command${queued === 1 ? "" : "s"} queued; awaiting physical output confirmation.`
            : `${label} in the control plane. No active Edge device received a command, so physical output is not confirmed.`
        );
        router.refresh();
      } catch {
        setError("Network error. The output state could not be verified.");
      }
    });
  }

  const live = currentState === "live";

  return (
    <div aria-busy={isPending}>
      <div className={live ? "grid gap-2" : "grid grid-cols-1 gap-2 sm:grid-cols-2"}>
        {live ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => changeState("detected", "Program cleared")}
            className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-red-400/25 bg-red-400/[.08] px-4 py-3 text-sm font-black text-red-100 transition hover:bg-red-400/[.14] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Square size={16} aria-hidden="true" />
            Clear Program
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={isPending || currentState === "preview"}
              onClick={() => changeState("preview", "Preview prepared")}
              className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/[.1] bg-white/[.04] px-4 py-3 text-sm font-bold text-white/80 transition hover:bg-white/[.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Eye size={16} aria-hidden="true" />
              Preview
            </button>
            <button
              type="button"
              disabled={isPending || currentState === "live"}
              onClick={() => changeState("live", "Program updated")}
              className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#d7a94a] px-4 py-3 text-sm font-black text-[#161109] shadow-[0_10px_35px_rgba(215,169,74,.16)] transition hover:bg-[#e7bd63] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f2d38f] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Radio size={16} aria-hidden="true" />
              Take Live
            </button>
          </>
        )}
      </div>
      {!live ? (
        <button
          type="button"
          disabled={isPending || currentState === "dismissed"}
          onClick={() => changeState("dismissed", "Detection dismissed")}
          className="mt-2 flex min-h-10 w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-white/35 transition hover:bg-white/[.03] hover:text-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <X size={14} aria-hidden="true" />
          Dismiss detection
        </button>
      ) : null}
      <div className="mt-2 min-h-5 text-xs leading-5" aria-live="polite" aria-atomic="true">
        {error ? <p role="alert" className="text-red-300">{error}</p> : null}
        {!error && notice ? <p className="text-white/55">{notice}</p> : null}
        {!error && !notice && isPending ? <p className="text-white/45">Updating output…</p> : null}
      </div>
    </div>
  );
}
