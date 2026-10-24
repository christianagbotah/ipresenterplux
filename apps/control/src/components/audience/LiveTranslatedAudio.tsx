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
  const currentItemRef = useRef<QueueItem | null>(null);
  const playbackRetryRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<"waiting" | "ready" | "playing" | "paused" | "retrying" | "error">("waiting");

  const assetUrl = useCallback((id: string) => {
    const params = new URLSearchParams({ serviceId, channelId });
    return `/api/v1/audience/audio/${encodeURIComponent(id)}?${params.toString()}`;
  }, [channelId, serviceId]);

  const startItem = useCallback(async (item: QueueItem, retry = false) => {
    const audio = audioRef.current;
    if (!audio) return;
    currentItemRef.current = item;
    if (!retry) {
      playbackRetryRef.current = 0;
      cursorRef.current = item.id;
      const observedAt = Date.parse(item.observedAt);
      if (Number.isFinite(observedAt)) lastObservedAtRef.current = observedAt;
    }
    audio.src = assetUrl(item.id);
    audio.load();
    try {
      await audio.play();
      setStatus("playing");
    } catch {
      setStatus(retry ? "retrying" : "ready");
    }
  }, [assetUrl]);

  const playNext = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || (!audio.paused && !audio.ended) || currentItemRef.current) return;
    const next = queueRef.current.shift();
    if (!next) {
      setStatus("waiting");
      return;
    }
    await startItem(next);
  }, [startItem]);

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

  const handlePlaybackError = useCallback(() => {
    const current = currentItemRef.current;
    if (!enabled || !current || retryTimerRef.current) {
      setStatus("error");
      return;
    }
    if (playbackRetryRef.current >= 2) {
      currentItemRef.current = null;
      playbackRetryRef.current = 0;
      const audio = audioRef.current;
      if (audio) {
        audio.removeAttribute("src");
        audio.load();
      }
      setStatus("error");
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        void refreshQueue().then(() => playNext());
      }, 750);
      return;
    }
    playbackRetryRef.current += 1;
    setStatus("retrying");
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      void startItem(current, true);
    }, playbackRetryRef.current * 750);
  }, [enabled, playNext, refreshQueue, startItem]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refreshQueue(), 0);
    const timer = window.setInterval(() => void refreshQueue(), enabled ? 1500 : 4000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [enabled, refreshQueue]);

  useEffect(() => () => {
    if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
  }, []);

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
    if (retryTimerRef.current) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
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
          <div className="mt-1 text-xs leading-4 text-white/55">
            {status === "playing" ? "Playing translated sermon audio"
              : status === "ready" ? "Audio is ready"
                : status === "retrying" ? "Audio segment is retrying"
                  : status === "error" ? "Audio segment failed; continuing with the next segment"
                    : status === "paused" ? "Audio paused on this device"
                      : "Waiting for the next translated audio segment"}
          </div>
        </div>
        <button
          type="button"
          onClick={enabled ? stop : start}
          className="ip-focus-gold min-h-11 flex shrink-0 items-center gap-1.5 rounded-lg border border-[#d7a94a]/25 bg-[#d7a94a]/10 px-3 py-2 text-xs font-bold text-[#efc76e]"
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
          currentItemRef.current = null;
          playbackRetryRef.current = 0;
          setStatus("waiting");
          void refreshQueue().then(() => playNext());
        }}
        onError={handlePlaybackError}
      />
    </div>
  );
}
