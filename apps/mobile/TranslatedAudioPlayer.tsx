import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

const API = process.env.EXPO_PUBLIC_CONTROL_URL ?? "https://ipresenterplux.lightworldtech.com";

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

type PlaybackState = "waiting" | "ready" | "playing" | "paused" | "retrying" | "error";

export function TranslatedAudioPlayer({
  serviceId,
  channelId,
  enabled,
  onEnabledChange
}: {
  serviceId: string;
  channelId: string;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}) {
  const player = useAudioPlayer(null, { updateInterval: 250, preferredForwardBufferDuration: 5 });
  const playerStatus = useAudioPlayerStatus(player);
  const cursorRef = useRef<string | null>(null);
  const queueRef = useRef<QueueItem[]>([]);
  const seenRef = useRef(new Set<string>());
  const currentItemRef = useRef<QueueItem | null>(null);
  const lastObservedAtRef = useRef<number | null>(null);
  const fetchingRef = useRef(false);
  const handledFinishRef = useRef<string | null>(null);
  const playbackRetryRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<PlaybackState>("waiting");

  const assetUrl = useCallback((id: string) => {
    const params = new URLSearchParams({ serviceId, channelId });
    return `${API}/api/v1/audience/audio/${encodeURIComponent(id)}?${params.toString()}`;
  }, [channelId, serviceId]);

  const startItem = useCallback((item: QueueItem, retry = false) => {
    if (!enabled) return;
    currentItemRef.current = item;
    handledFinishRef.current = null;
    if (!retry) {
      playbackRetryRef.current = 0;
      cursorRef.current = item.id;
      const observedAt = Date.parse(item.observedAt);
      if (Number.isFinite(observedAt)) lastObservedAtRef.current = observedAt;
    }
    try {
      player.replace(assetUrl(item.id));
      player.play();
      setState(retry ? "retrying" : "playing");
    } catch {
      setState("retrying");
    }
  }, [assetUrl, enabled, player]);

  const playNext = useCallback(() => {
    if (!enabled || playerStatus.playing || currentItemRef.current) return;
    const next = queueRef.current.shift();
    if (!next) {
      setState("waiting");
      return;
    }
    startItem(next);
  }, [enabled, playerStatus.playing, startItem]);

  const refreshQueue = useCallback(async () => {
    if (!enabled || fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const params = new URLSearchParams({ serviceId, channelId });
      if (cursorRef.current) params.set("after", cursorRef.current);
      const response = await fetch(`${API}/api/v1/audience/audio/queue?${params.toString()}`, {
        headers: { Accept: "application/json" }
      });
      if (!response.ok) {
        setState((current) => current === "playing" ? current : "retrying");
        return;
      }
      const payload = await response.json() as QueueResponse;
      for (const item of payload.items ?? []) {
        if (seenRef.current.has(item.id)) continue;
        const observedAt = Date.parse(item.observedAt);
        if (!Number.isFinite(observedAt)) continue;
        if (lastObservedAtRef.current !== null && observedAt <= lastObservedAtRef.current) continue;
        seenRef.current.add(item.id);
        queueRef.current.push(item);
      }
      queueRef.current.sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
      if (!currentItemRef.current && queueRef.current.length > 0) setState("ready");
    } catch {
      setState((current) => current === "playing" ? current : "retrying");
    } finally {
      fetchingRef.current = false;
    }
  }, [channelId, enabled, serviceId]);

  useEffect(() => {
    queueRef.current = [];
    seenRef.current = new Set();
    cursorRef.current = null;
    currentItemRef.current = null;
    lastObservedAtRef.current = null;
    handledFinishRef.current = null;
    playbackRetryRef.current = 0;
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
    player.pause();
    player.replace(null);
    setState(enabled ? "waiting" : "paused");
  }, [channelId, serviceId, player]);

  useEffect(() => {
    if (!enabled) {
      player.pause();
      setState("paused");
      return;
    }
    const initial = setTimeout(() => void refreshQueue(), 0);
    const timer = setInterval(() => void refreshQueue(), 1500);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [enabled, player, refreshQueue]);

  useEffect(() => {
    if (!enabled || currentItemRef.current || queueRef.current.length === 0 || playerStatus.playing) return;
    playNext();
  }, [enabled, playNext, playerStatus.playing]);

  useEffect(() => {
    const current = currentItemRef.current;
    if (!current || !playerStatus.didJustFinish || handledFinishRef.current === current.id) return;
    handledFinishRef.current = current.id;
    currentItemRef.current = null;
    playbackRetryRef.current = 0;
    setState("waiting");
    void refreshQueue().then(() => playNext());
  }, [playNext, playerStatus.didJustFinish, refreshQueue]);

  useEffect(() => {
    const current = currentItemRef.current;
    if (!playerStatus.error || !current || !enabled || retryTimerRef.current) return;
    if (playbackRetryRef.current >= 2) {
      currentItemRef.current = null;
      playbackRetryRef.current = 0;
      setState("error");
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        void refreshQueue().then(() => playNext());
      }, 750);
      return;
    }

    playbackRetryRef.current += 1;
    setState("retrying");
    const delay = playbackRetryRef.current * 750;
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      startItem(current, true);
    }, delay);
  }, [enabled, playNext, playerStatus.error, refreshQueue, startItem]);

  useEffect(() => () => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
  }, []);

  const label = state === "playing"
    ? "Playing interpreted audio"
    : state === "ready"
      ? "Interpreted audio ready"
      : state === "retrying"
        ? "Audio connection retrying"
        : state === "error"
          ? "Audio segment failed; continuing with the next segment"
        : state === "paused"
          ? "Interpreted audio paused"
          : "Waiting for the next interpreted segment";

  return (
    <View style={styles.card}>
      <View style={styles.copy}>
        <Text style={styles.title}>Live interpreted audio</Text>
        <Text style={styles.status}>{label}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={enabled ? "Pause interpreted audio" : "Start interpreted audio"}
        style={[styles.button, enabled && styles.buttonActive]}
        onPress={() => onEnabledChange(!enabled)}
      >
        <Text style={styles.buttonText}>{enabled ? "Pause" : "Start audio"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#5f4a25",
    backgroundColor: "#d7a94a10",
    borderRadius: 14,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  copy: { flex: 1 },
  title: { color: "#efc76e", fontSize: 12, fontWeight: "900" },
  status: { color: "#8c94a1", fontSize: 10, lineHeight: 15, marginTop: 4 },
  button: {
    borderWidth: 1,
    borderColor: "#5f4a25",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: "#d7a94a12"
  },
  buttonActive: { backgroundColor: "#d7a94a20" },
  buttonText: { color: "#efc76e", fontSize: 10, fontWeight: "900" }
});
