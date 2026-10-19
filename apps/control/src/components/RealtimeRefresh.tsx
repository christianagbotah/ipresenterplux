"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RadioTower, RefreshCw, WifiOff } from "lucide-react";
import { reconnectDelayMs, setRealtimeConnectionState, type RealtimeConnectionState } from "@/lib/realtime-reconnect";

export function RealtimeRefresh({ serviceId }: { serviceId: string }) {
  const router = useRouter();
  const lastRefreshAt = useRef(0);
  const [connection, setConnection] = useState<RealtimeConnectionState>("connecting");

  useEffect(() => {
    let fallbackTimer: number | undefined;
    let reconnectTimer: number | undefined;
    let source: EventSource | undefined;
    let stopped = false;
    let reconnectAttempt = 0;

    const publish = (state: RealtimeConnectionState) => {
      setConnection(state);
      setRealtimeConnectionState(serviceId, state);
    };

    const refresh = () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      const now = Date.now();
      if (now - lastRefreshAt.current < 150) return;
      lastRefreshAt.current = now;
      router.refresh();
    };

    const startFallback = () => {
      if (!fallbackTimer) fallbackTimer = window.setInterval(refresh, 15_000);
    };
    const clearFallback = () => {
      if (!fallbackTimer) return;
      window.clearInterval(fallbackTimer);
      fallbackTimer = undefined;
    };
    const clearReconnect = () => {
      if (!reconnectTimer) return;
      window.clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    };

    const scheduleReconnect = () => {
      if (stopped) return;
      source?.close();
      source = undefined;
      startFallback();
      if (navigator.onLine === false) {
        publish("offline");
        clearReconnect();
        return;
      }
      publish("reconnecting");
      if (reconnectTimer) return;
      const delay = reconnectDelayMs(reconnectAttempt++);
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, delay);
    };

    const connect = () => {
      if (stopped) return;
      if (navigator.onLine === false) {
        publish("offline");
        startFallback();
        return;
      }
      source?.close();
      publish(reconnectAttempt > 0 ? "reconnecting" : "connecting");
      const next = new EventSource("/api/v1/events?serviceId=" + encodeURIComponent(serviceId));
      source = next;
      next.onopen = () => {
        if (stopped || source !== next) return;
        reconnectAttempt = 0;
        clearReconnect();
        clearFallback();
        publish("connected");
      };
      next.addEventListener("update", refresh);
      next.addEventListener("transport", scheduleReconnect);
      next.onerror = scheduleReconnect;
    };

    const onOnline = () => {
      reconnectAttempt = 0;
      clearReconnect();
      connect();
    };
    const onOffline = () => {
      source?.close();
      source = undefined;
      clearReconnect();
      startFallback();
      publish("offline");
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    setRealtimeConnectionState(serviceId, "connecting");
    connect();

    return () => {
      stopped = true;
      source?.close();
      clearFallback();
      clearReconnect();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [router, serviceId]);

  const connected = connection === "connected";
  const offline = connection === "offline";
  const reconnecting = connection === "reconnecting";
  const label = connected ? "Realtime connected" : offline ? "Offline · live state retained" : reconnecting ? "Reconnecting · live state retained" : "Realtime connecting";
  const Icon = connected ? RadioTower : offline || reconnecting ? WifiOff : RefreshCw;

  return <div role="status" aria-live="polite" className={`fixed bottom-20 right-3 z-40 flex items-center gap-2 rounded-full border px-3 py-2 text-[11px] font-bold shadow-lg backdrop-blur-xl md:bottom-3 md:z-50 ${connected ? "border-emerald-400/20 bg-[#08120f]/90 text-emerald-200" : offline || reconnecting ? "border-amber-400/25 bg-[#171106]/92 text-amber-100" : "border-white/10 bg-[#0b0e14]/92 text-white/50"}`}>
    <Icon size={13} className={connection === "connecting" ? "animate-spin" : ""} aria-hidden="true" />{label}
  </div>;
}
