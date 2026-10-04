"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleStop, Radio, RotateCcw } from "lucide-react";

type ServiceState = "ready" | "live" | "ended";

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

  function changeState(state: ServiceState) {
    setError(null);
    startTransition(async () => {
      const response = await fetch("/api/v1/services/" + serviceId + "/state", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state })
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(payload?.error ?? "Could not update service");
        return;
      }

      router.refresh();
    });
  }

  if (status === "live") {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => changeState("ended")}
          className="flex items-center gap-2 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-2.5 text-xs font-bold text-red-200 disabled:opacity-40"
        >
          <CircleStop size={15} />
          END SERVICE
        </button>
        {error ? <span className="text-[11px] text-red-300">{error}</span> : null}
      </div>
    );
  }

  if (status === "ended") {
    return (
      <button
        type="button"
        disabled={isPending}
        onClick={() => changeState("ready")}
        className="flex items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.035] px-4 py-2.5 text-xs font-semibold text-white/70 disabled:opacity-40"
      >
        <RotateCcw size={14} />
        Prepare Again
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="hidden rounded-xl border border-white/[.08] bg-white/[.035] px-4 py-2.5 text-xs font-semibold text-white/45 md:block">
        Prepared
      </div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => changeState("live")}
        className="flex items-center gap-2 rounded-xl bg-red-500 px-4 py-2.5 text-xs font-extrabold text-white shadow-[0_10px_35px_rgba(239,68,68,.22)] disabled:opacity-40"
      >
        <Radio size={15} />
        GO LIVE
      </button>
      {error ? <span className="hidden text-[11px] text-red-300 xl:inline">{error}</span> : null}
    </div>
  );
}
