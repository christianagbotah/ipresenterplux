"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, LockKeyhole, Power, ShieldAlert } from "lucide-react";

export function StreamingDestinationControl({
  id,
  enabled,
  canControl,
  locked = false
}: {
  id: string;
  enabled: boolean;
  canControl: boolean;
  locked?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  function toggle() {
    if (!canControl || locked) return;
    setFeedback(null);
    setFailed(false);

    startTransition(async () => {
      try {
        const response = await fetch(`/api/v1/outputs/${id}/state`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: !enabled })
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          setFailed(true);
          setFeedback(payload?.error ?? "Could not update this destination.");
          return;
        }
        setFeedback(enabled ? "Destination disabled." : "Destination enabled and ready for a future live stream.");
        router.refresh();
      } catch {
        setFailed(true);
        setFeedback("Network error. Destination state could not be confirmed.");
      }
    });
  }

  const disabled = !canControl || locked || isPending;
  const label = locked ? "Locked" : enabled ? "Enabled" : canControl ? "Enable" : "View only";

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-pressed={enabled}
        className={`ip-focus-gold flex min-h-11 items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-40 ${failed ? "border-red-400/25 bg-red-400/10 text-red-100" : enabled ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-100" : "border-white/[.1] bg-white/[.035] text-white/75 hover:bg-white/[.07]"}`}
      >
        {locked ? <LockKeyhole size={15} aria-hidden="true" /> : enabled ? <CheckCircle2 size={15} aria-hidden="true" /> : canControl ? <Power size={15} aria-hidden="true" /> : <ShieldAlert size={15} aria-hidden="true" />}
        {label}
      </button>
      {feedback ? <span aria-live="polite" className={`max-w-64 text-right text-[11px] leading-4 ${failed ? "text-red-300" : "text-white/55"}`}>{feedback}</span> : null}
    </div>
  );
}
