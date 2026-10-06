"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, Radio, X } from "lucide-react";

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

  function changeState(state: ScriptureState) {
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
        if (state === "preview") {
          setNotice(
            queued > 0
              ? `Preview requested on ${queued} Edge ${queued === 1 ? "device" : "devices"}.`
              : "Preview state saved. No Edge device command was queued."
          );
        } else if (state === "live") {
          setNotice(
            queued > 0
              ? `Take Live requested on ${queued} Edge ${queued === 1 ? "device" : "devices"}. Awaiting device confirmation.`
              : "Live state saved, but no Edge device command was queued. Physical output is not confirmed."
          );
        } else {
          setNotice("Detection dismissed.");
        }

        router.refresh();
      } catch {
        setError("Network error. The scripture state was not confirmed.");
      }
    });
  }

  return (
    <div aria-busy={isPending}>
      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          disabled={isPending || currentState === "preview"}
          onClick={() => changeState("preview")}
          className="flex min-h-12 items-center justify-center gap-2.5 rounded-xl border border-white/[.1] bg-white/[.05] px-4 py-3 text-sm font-bold text-white/80 transition hover:border-white/[.16] hover:bg-white/[.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7a94a]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0e14] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Eye size={17} aria-hidden="true" />
          {currentState === "preview" ? "In Preview" : "Preview"}
        </button>
        <button
          type="button"
          disabled={isPending || currentState === "live"}
          onClick={() => changeState("live")}
          className="flex min-h-12 items-center justify-center gap-2.5 rounded-xl bg-[#d7a94a] px-4 py-3 text-sm font-black text-[#161109] shadow-[0_12px_35px_rgba(215,169,74,.16)] transition hover:bg-[#e5ba61] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f3cf7a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0e14] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Radio size={17} aria-hidden="true" />
          {currentState === "live" ? "On Program" : "Take Live"}
        </button>
      </div>
      <button
        type="button"
        disabled={isPending || currentState === "dismissed"}
        onClick={() => changeState("dismissed")}
        className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-white/45 transition hover:bg-white/[.04] hover:text-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:cursor-not-allowed disabled:opacity-30"
      >
        <X size={15} aria-hidden="true" />
        Dismiss detection
      </button>

      <div className="mt-2 min-h-5 text-xs leading-5" aria-live="polite" aria-atomic="true">
        {error ? <p role="alert" className="text-red-300">{error}</p> : null}
        {!error && notice ? <p className="text-white/55">{notice}</p> : null}
        {!error && !notice && isPending ? <p className="text-white/45">Sending operator command…</p> : null}
      </div>
    </div>
  );
}
