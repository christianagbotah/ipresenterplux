"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { reconnectDelayMs } from "@/lib/realtime-reconnect";

export function AudienceRealtimeRefresh({ serviceId }: { serviceId: string }) {
  const router = useRouter();

  useEffect(() => {
    let source: EventSource | undefined;
    let reconnectTimer: number | undefined;
    let stopped = false;
    let reconnectAttempt = 0;
    const refresh = () => {
      if (navigator.onLine !== false) router.refresh();
    };
    const fallback = window.setInterval(refresh, 5_000);

    const clearReconnect = () => {
      if (!reconnectTimer) return;
      window.clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    };
    const scheduleReconnect = () => {
      if (stopped) return;
      source?.close();
      source = undefined;
      if (navigator.onLine === false || reconnectTimer) return;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, reconnectDelayMs(reconnectAttempt++));
    };
    const connect = () => {
      if (stopped || navigator.onLine === false) return;
      source?.close();
      const next = new EventSource(`/api/v1/audience/events?serviceId=${encodeURIComponent(serviceId)}`);
      source = next;
      next.onopen = () => {
        if (stopped || source !== next) return;
        reconnectAttempt = 0;
        clearReconnect();
      };
      next.addEventListener("refresh", refresh);
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
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    connect();

    return () => {
      stopped = true;
      window.clearInterval(fallback);
      clearReconnect();
      source?.close();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [router, serviceId]);

  return null;
}
