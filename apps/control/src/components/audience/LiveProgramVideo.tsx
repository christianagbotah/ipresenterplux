"use client";

import { useMemo } from "react";
import type { PublicAudienceVideoStatus } from "@/lib/public-audience-video-state";

type Props = {
  serviceId: string;
  mode?: "audience" | "operator";
  transportStatus?: string;
  videoStatus?: PublicAudienceVideoStatus;
};

export function LiveProgramVideo({ serviceId, mode = "audience", transportStatus = "idle", videoStatus = "offline" }: Props) {
  const webrtcUrl = useMemo(
    () => `/media/webrtc/service/${encodeURIComponent(serviceId)}`,
    [serviceId]
  );
  const hlsUrl = useMemo(
    () => `/media/hls/service/${encodeURIComponent(serviceId)}?autoplay=true&muted=true&controls=true&playsInline=true`,
    [serviceId]
  );

  const operatorMode = mode === "operator";
  const canRenderPlayer = operatorMode || videoStatus === "live";
  const audienceBadge = videoStatus === "live" ? "Live" : videoStatus === "connecting" ? "Connecting" : "Video off";

  return (
    <section className="overflow-hidden rounded-[22px] border border-white/[.08] bg-[#0d121a]">
      <div className="flex items-center justify-between border-b border-white/[.06] px-4 py-3">
        <div>
          <div className="text-xs font-black uppercase tracking-[.12em] text-white/65">{operatorMode ? "Program preview" : "Live program"}</div>
          <div className="mt-0.5 text-[11px] text-white/55">{operatorMode ? "Authoritative service Program · WebRTC low-latency · HLS fallback" : videoStatus === "live" ? "WebRTC low-latency · HLS fallback" : "Video becomes available when the church starts the Program stream"}</div>
        </div>
        {operatorMode ? (
          <span className="rounded-full border border-white/[.09] bg-white/[.035] px-2 py-1 text-[11px] font-bold uppercase tracking-[.12em] text-white/65">{transportStatus}</span>
        ) : (
          <span className={"rounded-full border px-2 py-1 text-[11px] font-bold uppercase tracking-[.12em] " + (videoStatus === "live" ? "border-red-300/20 bg-red-300/[.07] text-red-100" : "border-white/[.09] bg-white/[.035] text-white/55")}>{audienceBadge}</span>
        )}
      </div>
      <div className="grid gap-3 p-3">
        {canRenderPlayer ? (
          <>
            <div className="overflow-hidden rounded-xl bg-black">
              <iframe
                title={operatorMode ? "iPresenterPlux Program preview" : "iPresenterPlux live program"}
                src={webrtcUrl}
                className="aspect-video w-full border-0"
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen
              />
            </div>
            <div className="flex items-center justify-between gap-3 px-1">
              <div className="text-[11px] leading-4 text-white/55">
                If the low-latency connection cannot be established, use the HLS fallback below.
              </div>
              <a
                href={hlsUrl}
                target="_blank"
                rel="noreferrer"
                className="ip-focus-gold min-h-9 shrink-0 rounded-lg border border-white/[.08] bg-white/[.035] px-3 py-2 text-[11px] font-bold text-white/75"
              >
                Open HLS
              </a>
            </div>
          </>
        ) : (
          <div className="flex aspect-video items-center justify-center rounded-xl border border-white/[.05] bg-black/35 px-8 text-center">
            <div>
              <div className="text-sm font-black text-white/80">{videoStatus === "connecting" ? "Connecting to live video…" : "Video feed not started yet"}</div>
              <p className="mt-2 text-xs leading-5 text-white/45">{videoStatus === "connecting" ? "The church is starting the Program stream. This screen will switch automatically when video is ready." : "Scripture, captions and language channels can remain available while the video feed is off."}</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
