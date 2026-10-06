"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, RadioTower, Square } from "lucide-react";

type BroadcastStatus = "idle" | "starting" | "live" | "stopping" | "ended" | "error";

export function StreamingBroadcastControl({
  serviceId,
  status,
  canControl,
  eligibleOutputCount
}: {
  serviceId: string;
  status: BroadcastStatus;
  canControl: boolean;
  eligibleOutputCount: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const active = status === "starting" || status === "live" || status === "stopping";
  const stopping = status === "stopping";
  const action = active ? "stop" : "start";
  const startDisabled = action === "start" && eligibleOutputCount < 1;
  const disabled = !canControl || isPending || stopping || startDisabled;

  function submit() {
    if (disabled) return;
    setFeedback(null);
    setFailed(false);

    startTransition(async () => {
      try {
        const response = await fetch(`/api/v1/services/${serviceId}/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action })
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          setFailed(true);
          setFeedback(payload?.error ?? `Could not ${action} the broadcast.`);
          return;
        }
        setFeedback(action === "start"
          ? "Start accepted. Waiting for Edge and router transport evidence."
          : "Stop accepted. Waiting for the publisher and router to close cleanly.");
        router.refresh();
      } catch {
        setFailed(true);
        setFeedback("Network error. Broadcast state could not be confirmed.");
      }
    });
  }

  const label = isPending
    ? action === "start" ? "Starting…" : "Stopping…"
    : stopping
      ? "Stopping…"
      : action === "start"
        ? "Start Broadcast"
        : "Stop Broadcast";

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={submit}
        disabled={disabled}
        className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e7bd63] disabled:cursor-not-allowed disabled:opacity-45 ${failed
          ? "border-red-400/30 bg-red-400/10 text-red-100"
          : action === "start"
            ? "border-[#d7a94a]/35 bg-[#d7a94a]/15 text-[#f3ce7b] hover:bg-[#d7a94a]/20"
            : "border-red-400/30 bg-red-400/10 text-red-100 hover:bg-red-400/15"}`}
      >
        {isPending || stopping
          ? <LoaderCircle size={17} className="animate-spin" aria-hidden="true" />
          : action === "start"
            ? <RadioTower size={17} aria-hidden="true" />
            : <Square size={16} aria-hidden="true" />}
        {label}
      </button>

      {!canControl ? (
        <p className="text-xs leading-5 text-white/38">Your role is view-only for broadcast control.</p>
      ) : startDisabled ? (
        <p className="text-xs leading-5 text-amber-100/75">Enable at least one configured WebRTC or social destination before starting.</p>
      ) : (
        <p className="text-xs leading-5 text-white/38">
          {active
            ? "Stop closes the authoritative Edge contribution; destination workers terminate with the master path."
            : "Live is shown only after the Edge contribution reaches MediaMTX. Social destinations report their own transport state independently."}
        </p>
      )}

      {feedback ? (
        <p aria-live="polite" className={`text-xs leading-5 ${failed ? "text-red-300" : "text-white/48"}`}>{feedback}</p>
      ) : null}
    </div>
  );
}
