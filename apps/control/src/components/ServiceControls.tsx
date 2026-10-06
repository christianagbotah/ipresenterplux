"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleStop, Radio, RotateCcw } from "lucide-react";

type ServiceState = "ready" | "live" | "ended";

type MutationPayload = {
  error?: string;
};

export function ServiceControls({
  serviceId,
  status
}: {
  serviceId: string;
  status: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function changeState(state: ServiceState) {
    setError(null);
    setNotice(null);

    startTransition(async () => {
      try {
        const response = await fetch("/api/v1/services/" + serviceId + "/state", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state })
        });

        const payload = (await response.json().catch(() => null)) as MutationPayload | null;

        if (!response.ok) {
          setError(payload?.error ?? "Could not update service");
          return;
        }

        setNotice(
          state === "live"
            ? "Service is live."
            : state === "ended"
              ? "Service ended. Program controls remain separate."
              : "Service returned to prepared state."
        );
        router.refresh();
      } catch {
        setError("Network error. The service state was not confirmed.");
      }
    });
  }

  const feedback = (
    <div className="min-h-5 text-xs leading-5" aria-live="polite" aria-atomic="true">
      {error ? <span role="alert" className="text-red-300">{error}</span> : null}
      {!error && notice ? <span className="text-white/55">{notice}</span> : null}
      {!error && !notice && isPending ? <span className="text-white/45">Updating service…</span> : null}
    </div>
  );

  if (status === "live") {
    return (
      <div className="flex min-w-0 flex-col items-end gap-1.5" aria-busy={isPending}>
        <button
          type="button"
          disabled={isPending}
          onClick={() => changeState("ended")}
          className="flex min-h-11 items-center gap-2 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-2.5 text-sm font-bold text-red-100 transition hover:bg-red-400/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#090c12] disabled:opacity-40"
        >
          <CircleStop size={16} aria-hidden="true" />
          End service
        </button>
        {feedback}
      </div>
    );
  }

  if (status === "ended") {
    return (
      <div className="flex min-w-0 flex-col items-end gap-1.5" aria-busy={isPending}>
        <button
          type="button"
          disabled={isPending}
          onClick={() => changeState("ready")}
          className="flex min-h-11 items-center gap-2 rounded-xl border border-white/[.1] bg-white/[.04] px-4 py-2.5 text-sm font-semibold text-white/75 transition hover:bg-white/[.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:opacity-40"
        >
          <RotateCcw size={15} aria-hidden="true" />
          Prepare again
        </button>
        {feedback}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col items-end gap-1.5" aria-busy={isPending}>
      <div className="flex items-center gap-2">
        <div className="hidden min-h-11 items-center rounded-xl border border-white/[.08] bg-white/[.035] px-4 py-2.5 text-sm font-semibold text-white/50 md:flex">
          Prepared
        </div>
        <button
          type="button"
          disabled={isPending}
          onClick={() => changeState("live")}
          className="flex min-h-11 items-center gap-2 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-extrabold text-white shadow-[0_10px_35px_rgba(239,68,68,.22)] transition hover:bg-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#090c12] disabled:opacity-40"
        >
          <Radio size={16} aria-hidden="true" />
          Go live
        </button>
      </div>
      {feedback}
    </div>
  );
}
