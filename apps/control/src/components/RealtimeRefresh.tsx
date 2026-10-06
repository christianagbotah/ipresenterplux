"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RadioTower, WifiOff } from "lucide-react";

type RealtimeState = "connecting" | "connected" | "degraded";

export function RealtimeRefresh({ serviceId }: { serviceId: string }) {
  const router = useRouter();
  const lastRefreshAt = useRef(0);
  const [state, setState] = useState<RealtimeState>("connecting");

  useEffect(() => {
    let fallbackTimer: number | undefined;
    let source: EventSource | undefined;
    let disposed = false;

    const refresh = () => {
      const now = Date.now();
      if (now - lastRefreshAt.current < 150) return;
      lastRefreshAt.current = now;
      router.refresh();
    };

    const startFallback = () => {
      if (disposed) return;
      setState("degraded");
      if (!fallbackTimer) {
        fallbackTimer = window.setInterval(refresh, 15_000);
      }
    };

    const stopFallback = () => {
      if (fallbackTimer) {
        window.clearInterval(fallbackTimer);
        fallbackTimer = undefined;
      }
    };

    try {
      source = new EventSource("/api/v1/events?serviceId=" + encodeURIComponent(serviceId));
      source.onopen = () => {
        if (disposed) return;
        stopFallback();
        setState("connected");
      };
      source.addEventListener("update", refresh);
      source.addEventListener("transport", startFallback);
      source.onerror = startFallback;
    } catch {
      startFallback();
    }

    return () => {
      disposed = true;
      source?.close();
      stopFallback();
    };
  }, [router, serviceId]);

  const degraded = state === "degraded";

  return (
    <div
      className={
        "fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold shadow-2xl backdrop-blur-xl transition " +
        (degraded
          ? "border-amber-300/25 bg-[#17130a]/95 text-amber-100"
          : state === "connected"
            ? "border-emerald-300/15 bg-[#08110d]/88 text-emerald-100/75"
            : "border-white/[.1] bg-[#0b0e14]/92 text-white/60")
      }
      role={degraded ? "status" : undefined}
      aria-live="polite"
      aria-label={degraded ? "Realtime connection degraded" : "Realtime connection status"}
    >
      {degraded ? <WifiOff size={14} aria-hidden="true" /> : <RadioTower size={14} aria-hidden="true" />}
      <span>
        {degraded
          ? "Realtime degraded · refreshing every 15s"
          : state === "connected"
            ? "Realtime connected"
            : "Connecting realtime…"}
      </span>
    </div>
  );
}
