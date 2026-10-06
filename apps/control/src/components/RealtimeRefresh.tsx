"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RadioTower, RefreshCw, WifiOff } from "lucide-react";

type ConnectionState = "connecting" | "connected" | "degraded";

export function RealtimeRefresh({ serviceId }: { serviceId: string }) {
  const router = useRouter();
  const lastRefreshAt = useRef(0);
  const [connection, setConnection] = useState<ConnectionState>("connecting");

  useEffect(() => {
    let fallbackTimer: number | undefined;
    let source: EventSource | undefined;

    const refresh = () => {
      const now = Date.now();
      if (now - lastRefreshAt.current < 150) return;
      lastRefreshAt.current = now;
      router.refresh();
    };

    const startFallback = () => {
      setConnection("degraded");
      if (!fallbackTimer) fallbackTimer = window.setInterval(refresh, 15_000);
    };

    try {
      source = new EventSource("/api/v1/events?serviceId=" + encodeURIComponent(serviceId));
      source.onopen = () => {
        setConnection("connected");
        if (fallbackTimer) {
          window.clearInterval(fallbackTimer);
          fallbackTimer = undefined;
        }
      };
      source.addEventListener("update", refresh);
      source.addEventListener("transport", startFallback);
      source.onerror = startFallback;
    } catch {
      startFallback();
    }

    return () => {
      source?.close();
      if (fallbackTimer) window.clearInterval(fallbackTimer);
    };
  }, [router, serviceId]);

  const connected = connection === "connected";
  const degraded = connection === "degraded";
  const label = connected ? "Realtime connected" : degraded ? "Realtime degraded · 15s fallback" : "Realtime connecting";
  const Icon = connected ? RadioTower : degraded ? WifiOff : RefreshCw;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-3 right-3 z-50 flex items-center gap-2 rounded-full border px-3 py-2 text-[11px] font-bold shadow-lg backdrop-blur-xl ${connected ? "border-emerald-400/20 bg-[#08120f]/90 text-emerald-200" : degraded ? "border-amber-400/25 bg-[#171106]/92 text-amber-100" : "border-white/10 bg-[#0b0e14]/92 text-white/50"}`}
    >
      <Icon size={13} className={connection === "connecting" ? "animate-spin" : ""} aria-hidden="true" />
      {label}
    </div>
  );
}
