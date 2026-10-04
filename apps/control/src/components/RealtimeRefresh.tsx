"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export function RealtimeRefresh({ serviceId }: { serviceId: string }) {
  const router = useRouter();
  const lastRefreshAt = useRef(0);

  useEffect(() => {
    let fallbackTimer: number | undefined;
    let source: EventSource | undefined;

    const refresh = () => {
      const now = Date.now();
      if (now - lastRefreshAt.current < 150) return;
      lastRefreshAt.current = now;
      router.refresh();
    };

    try {
      source = new EventSource("/api/v1/events?serviceId=" + encodeURIComponent(serviceId));
      source.addEventListener("update", refresh);
      source.addEventListener("transport", () => {
        if (!fallbackTimer) {
          fallbackTimer = window.setInterval(refresh, 15_000);
        }
      });
      source.onerror = () => {
        if (!fallbackTimer) {
          fallbackTimer = window.setInterval(refresh, 15_000);
        }
      };
    } catch {
      fallbackTimer = window.setInterval(refresh, 15_000);
    }

    return () => {
      source?.close();
      if (fallbackTimer) window.clearInterval(fallbackTimer);
    };
  }, [router, serviceId]);

  return null;
}
