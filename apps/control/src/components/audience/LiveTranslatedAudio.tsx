"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Headphones, Pause, Play } from "lucide-react";

type QueueItem = {
  id: string;
  observedAt: string;
  durationMs: number;
};

type QueueResponse = {
  ok: boolean;
  items?: QueueItem[];
  cursor?: string | null;
};

type Props = {
  serviceId: string;
  channelId: string;
};

export function LiveTranslatedAudio({ serviceId, channelId }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cursorRef = useRef<string | null>(null);
  const queueRef = useRef<QueueItem[]>([]);
  const seenRef = useRef(new Set<string>());
  const lastObservedAtRef = useRef<number | null>(null);
  const fetchingRef = useRef(false);
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<"waiting" | "ready" | "playing" | "paused" | "error">("waiting");

  const assetUrl = useCallback((id: string) => {
    const params = new URLSearchParams({ serviceId, channelId });
    return `/api/v1/audience/audio/${encodeURIComponent(id)}?${params.toString()}`;
  }, [channelId, serviceId]);

  const playNext = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !audio.paused && !audio.ended) return;
    const next = queueRef.current.shift();
    if (!next) {
      setStatus("waiting");
      return;
    }
    cursorRef.current = next.id;
    const observedAt = Date.parse(next.observedAt);
    if (Number.isFinite(observedAt)) lastObservedAtRef.current = observedAt;
    audio.src = assetUrl(next.id);
    audio.load();
    try {
      await audio.play();
      setStatus("playing");
    } catch {
      setStatus("ready");
    }
  }, [assetUrl]);

  const refreshQueue = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const params = new URLSearchParams({ serviceId, channelId });
      if (cursorRef.current) params.set("after", cursorRef.current);
      const response = await fetch(`/api/v1/audience/audio/queue?${params.toString()}`, {
        cache: "no-store"
      });
      if (!response.ok) return;
      const payload = await response.json() as QueueResponse;
      const incoming = payload.items ?? [];
      if (!enabled && !cursorRef.current) {
        queueRef.current = [];
        seenRef.current = new Set();
        lastObservedAtRef.current = null;
      }
      for (const item of incoming) {
        if (seenRef.current.has(item.id)) continue;
        seenRef.current.add(item.id);
        const observedAt = Date.parse(item.observedAt);
        if (!Number.isFinite(observedAt)) continue;
        if (lastObservedAtRef.current !== null && observedAt <= lastObservedAtRef.current) continue;
        queueRef.current.push(item);
      }
      queueRef.current.sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
      if (queueRef.current.length > 0 && status === "waiting") setStatus("ready");
      if (enabled && audioRef.current?.paused) void playNext();
    } catch {
      setStatus((current) => current === "playing" ? current : "error");
    } finally {
      fetchingRef.current = false;
    }
  }, [channelId, enabled, playNext, serviceId, status]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refreshQueue(), 0);
    const timer = window.setInterval(() => void refreshQueue(), enabled ? 1500 : 4000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [enabled, refreshQueue]);

  function start() {
    setEnabled(true);
    const audio = audioRef.current;
    if (audio?.src && audio.paused) {
      void audio.play().then(() => setStatus("playing")).catch(() => setStatus("ready"));
      return;
    }
    void playNext();
  }

  function stop() {
    setEnabled(false);
    audioRef.current?.pause();
    setStatus("paused");
  }

  return (
    <div className="mt-3 rounded-xl border border-[#d7a94a]/15 bg-[#d7a94a]/[.05] p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-bold text-[#efc76e]">
            <Headphones size={14} /> Live interpreted audio
          </div>
          <div className="mt-1 text-[10px] leading-4 text-white/32">
            {status === "playing" ? "Playing translated sermon audio"
              : status === "ready" ? "Audio is ready"
                : status === "error" ? "Audio connection is retrying"
                  : status === "paused" ? "Audio paused on this device"
                    : "Waiting for the next translated audio segment"}
          </div>
        </div>
        <button
          type="button"
          onClick={enabled ? stop : start}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[#d7a94a]/25 bg-[#d7a94a]/10 px-3 py-2 text-[10px] font-bold text-[#efc76e]"
        >
          {enabled ? <Pause size={12} /> : <Play size={12} />}
          {enabled ? "Pause" : "Start audio"}
        </button>
      </div>
      <audio
        ref={audioRef}
        className="mt-3 w-full"
        controls
        preload="none"
        onPlay={() => setStatus("playing")}
        onPause={() => setStatus((current) => current === "waiting" ? current : "paused")}
        onEnded={() => {
          setStatus("waiting");
          void refreshQueue();
        }}
        onError={() => setStatus("error")}
      />
    </div>
  );
}
