"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

// A live, frontend-only session clock. Shows how long the operator's current
// cockpit session has been live (elapsed since this page mounted). This is
// deliberately NOT a claimed service-uptime value — service start time is
// Edge/backend truth and is not surfaced to the browser here. The clock is
// labeled "session" so it never reads as fabricated service telemetry.
// Resets naturally on full page reload (the cockpit auto-refreshes via
// RealtimeRefresh/AutoRefresh, which re-mount and restart the count).

function format(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function SessionClock({ live }: { live: boolean }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!live) return;
    const started = Date.now();
    const tick = () => setElapsed(Date.now() - started);
    tick();
    const id = window.setInterval(tick, 1000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [live]);

  if (!live) return null;

  return (
    <span
      className="hidden items-center gap-1.5 rounded-lg border border-white/[.08] bg-white/[.025] px-2.5 py-1 font-mono text-[11px] tabular-nums text-white/65 sm:inline-flex"
      title="How long this cockpit session has been open. Not a service-uptime claim — service start time is Edge/backend truth."
      aria-label={`Cockpit session open for ${format(elapsed)}`}
    >
      <Clock size={12} className="text-[#d7a94a]" />
      {format(elapsed)}
    </span>
  );
}
