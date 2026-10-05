"use client";

import { useMemo } from "react";

type Props = { serviceId: string };

export function LiveProgramVideo({ serviceId }: Props) {
  const webrtcUrl = useMemo(
    () => `/media/webrtc/service/${encodeURIComponent(serviceId)}`,
    [serviceId]
  );
  const hlsUrl = useMemo(
    () => `/media/hls/service/${encodeURIComponent(serviceId)}?autoplay=true&muted=true&controls=true&playsInline=true`,
    [serviceId]
  );

  return (
    <section className="overflow-hidden rounded-[22px] border border-white/[.08] bg-[#0d121a]">
      <div className="flex items-center justify-between border-b border-white/[.06] px-4 py-3">
        <div>
          <div className="text-xs font-black uppercase tracking-[.12em] text-white/55">Live program</div>
          <div className="mt-0.5 text-[10px] text-white/25">WebRTC low-latency · HLS fallback</div>
        </div>
        <span className="rounded-full border border-red-300/20 bg-red-300/[.07] px-2 py-1 text-[9px] font-bold uppercase tracking-[.12em] text-red-100">Live</span>
      </div>
      <div className="grid gap-3 p-3">
        <div className="overflow-hidden rounded-xl bg-black">
          <iframe
            title="iPresenterPlux live program"
            src={webrtcUrl}
            className="aspect-video w-full border-0"
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
          />
        </div>
        <div className="flex items-center justify-between gap-3 px-1">
          <div className="text-[10px] leading-4 text-white/25">
            If the low-latency connection cannot be established, use the HLS fallback below.
          </div>
          <a
            href={hlsUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded-lg border border-white/[.08] bg-white/[.035] px-3 py-2 text-[10px] font-bold text-white/55"
          >
            Open HLS
          </a>
        </div>
      </div>
    </section>
  );
}
