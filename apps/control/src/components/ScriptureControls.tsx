"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, Radio, X } from "lucide-react";

type ScriptureState = "detected" | "preview" | "live" | "dismissed";

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

  function changeState(state: ScriptureState) {
    setError(null);
    startTransition(async () => {
      const response = await fetch("/api/v1/scriptures/" + id + "/state", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state })
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(payload?.error ?? "Could not update scripture state");
        return;
      }

      router.refresh();
    });
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={isPending || currentState === "preview"}
          onClick={() => changeState("preview")}
          className="flex items-center justify-center gap-2 rounded-xl border border-white/[.08] bg-white/[.04] px-3 py-2.5 text-xs font-bold text-white/75 transition hover:bg-white/[.07] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Eye size={14} />
          Preview
        </button>
        <button
          type="button"
          disabled={isPending || currentState === "live"}
          onClick={() => changeState("live")}
          className="flex items-center justify-center gap-2 rounded-xl bg-[#d7a94a] px-3 py-2.5 text-xs font-black text-[#161109] transition hover:bg-[#e5ba61] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Radio size={14} />
          Send Live
        </button>
      </div>
      <button
        type="button"
        disabled={isPending || currentState === "dismissed"}
        onClick={() => changeState("dismissed")}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-white/35 transition hover:bg-white/[.03] hover:text-white/55 disabled:cursor-not-allowed disabled:opacity-30"
      >
        <X size={13} />
        Dismiss detection
      </button>
      {error ? <p className="mt-2 text-[11px] text-red-300">{error}</p> : null}
    </div>
  );
}
