"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function AudienceRealtimeRefresh({ serviceId }: { serviceId: string }) {
  const router = useRouter();

  useEffect(() => {
    const source = new EventSource(`/api/v1/audience/events?serviceId=${encodeURIComponent(serviceId)}`);
    const refresh = () => router.refresh();

    source.addEventListener("refresh", refresh);
    const fallback = window.setInterval(refresh, 5_000);

    return () => {
      window.clearInterval(fallback);
      source.removeEventListener("refresh", refresh);
      source.close();
    };
  }, [router, serviceId]);

  return null;
}
