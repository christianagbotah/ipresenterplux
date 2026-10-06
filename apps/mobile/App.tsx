import { StatusBar } from "expo-status-bar";
import { useVideoPlayer, VideoView } from "expo-video";
import * as Linking from "expo-linking";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { TranslatedAudioPlayer } from "./TranslatedAudioPlayer";

const API = process.env.EXPO_PUBLIC_CONTROL_URL ?? "https://ipresenterplux.lightworldtech.com";
const SERVICE_POLL_MS = 2000;

type Language = {
  id: string;
  code: string;
  name: string;
  mode: string;
  listeners: number;
};

type Scripture = {
  reference: string;
  source_text: string | null;
  passage_text?: string | null;
};

type Transcript = {
  text: string;
  source_language: string | null;
  translations: Record<string, string>;
  speech_synthesis: Record<string, string>;
};

type Data = {
  service: { id: string; title: string };
  languages: Language[];
  scripture: Scripture | null;
  transcript: Transcript | null;
};

type ConnectionState = "idle" | "connected" | "reconnecting" | "ended";

class ServiceEndedError extends Error {}

async function fetchService(id: string): Promise<Data> {
  const response = await fetch(`${API}/api/v1/audience/service/${encodeURIComponent(id)}`, {
    headers: { Accept: "application/json", "Cache-Control": "no-cache" }
  });
  const body = await response.json().catch(() => null);
  if (response.status === 404) throw new ServiceEndedError(body?.error ?? "This service has ended.");
  if (!response.ok) throw new Error(body?.error ?? "Could not connect to the service.");
  return body as Data;
}

function serviceIdFromUrl(url: string) {
  const parsed = Linking.parse(url);
  const id = typeof parsed.queryParams?.service === "string" ? parsed.queryParams.service.trim() : "";
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

export default function App() {
  const [serviceId, setServiceId] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [interpretedAudioEnabled, setInterpretedAudioEnabled] = useState(false);
  const [appIsActive, setAppIsActive] = useState(AppState.currentState === "active");
  const activeServiceRef = useRef("");
  const refreshInFlightRef = useRef(false);
  const initialLinkHandledRef = useRef(false);

  const videoPlayer = useVideoPlayer(null, (instance) => {
    instance.loop = false;
  });

  const channel = useMemo(
    () => data?.languages.find((item) => item.id === selected) ?? data?.languages[0],
    [data?.languages, selected]
  );
  const source = data?.transcript;
  const sourceSelected = channel?.mode === "original" || Boolean(channel?.code && channel.code === source?.source_language);
  const caption = sourceSelected
    ? source?.text
    : (source?.translations?.[channel?.id ?? ""] ?? "Translation is being prepared…");
  const synthesisState = channel?.id ? source?.speech_synthesis?.[channel.id] : null;
  const usingInterpretedAudio = interpretedAudioEnabled && channel?.mode === "translation_audio" && !sourceSelected;

  function adoptService(body: Data) {
    setData(body);
    setSelected((current) => body.languages.some((item) => item.id === current)
      ? current
      : (body.languages[0]?.id ?? ""));
  }

  async function join(id = serviceId) {
    const normalized = id.trim();
    if (!/^[0-9a-f-]{36}$/i.test(normalized)) {
      setError("Enter a valid service ID or scan the church QR link.");
      return;
    }

    setBusy(true);
    setError(null);
    setConnection("reconnecting");
    try {
      const body = await fetchService(normalized);
      activeServiceRef.current = normalized;
      setServiceId(normalized);
      adoptService(body);
      setInterpretedAudioEnabled(false);
      setConnection("connected");
    } catch (caught) {
      activeServiceRef.current = "";
      setData(null);
      setConnection(caught instanceof ServiceEndedError ? "ended" : "idle");
      setError(caught instanceof Error ? caught.message : "Could not connect to the service.");
    } finally {
      setBusy(false);
    }
  }

  function leave() {
    activeServiceRef.current = "";
    refreshInFlightRef.current = false;
    setData(null);
    setSelected("");
    setInterpretedAudioEnabled(false);
    setConnection("idle");
    setError(null);
    videoPlayer.pause();
    void videoPlayer.replaceAsync(null);
  }

  function selectLanguage(id: string) {
    if (id === selected) return;
    setInterpretedAudioEnabled(false);
    setSelected(id);
  }

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => setAppIsActive(state === "active"));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (initialLinkHandledRef.current) return;
    initialLinkHandledRef.current = true;
    let active = true;

    const openUrl = (url: string) => {
      const id = serviceIdFromUrl(url);
      if (!active || !id) return;
      setServiceId(id);
      void join(id);
    };

    void Linking.getInitialURL().then((url) => {
      if (url) openUrl(url);
    });
    const subscription = Linking.addEventListener("url", ({ url }) => openUrl(url));
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const joinedServiceId = data?.service.id;
    if (!joinedServiceId || !appIsActive) return;
    activeServiceRef.current = joinedServiceId;

    const refresh = async () => {
      if (refreshInFlightRef.current || activeServiceRef.current !== joinedServiceId) return;
      refreshInFlightRef.current = true;
      try {
        const body = await fetchService(joinedServiceId);
        if (activeServiceRef.current !== joinedServiceId) return;
        adoptService(body);
        setConnection("connected");
      } catch (caught) {
        if (activeServiceRef.current !== joinedServiceId) return;
        if (caught instanceof ServiceEndedError) {
          activeServiceRef.current = "";
          setData(null);
          setSelected("");
          setInterpretedAudioEnabled(false);
          setConnection("ended");
          setError("This live service has ended.");
          videoPlayer.pause();
          void videoPlayer.replaceAsync(null);
        } else {
          setConnection("reconnecting");
        }
      } finally {
        refreshInFlightRef.current = false;
      }
    };

    void refresh();
    const timer = setInterval(() => void refresh(), SERVICE_POLL_MS);
    return () => clearInterval(timer);
  }, [appIsActive, data?.service.id, videoPlayer]);

  useEffect(() => {
    const nextSource = data ? `${API}/media/hls/service/${data.service.id}/index.m3u8` : null;
    let cancelled = false;
    void videoPlayer.replaceAsync(nextSource).then(() => {
      if (!cancelled && nextSource) videoPlayer.play();
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [data?.service.id, videoPlayer]);

  useEffect(() => {
    videoPlayer.muted = usingInterpretedAudio;
  }, [usingInterpretedAudio, videoPlayer]);

  if (!data) return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.entry} keyboardShouldPersistTaps="handled">
        <StatusBar style="light" />
        <Text style={styles.brand}>iPresenterPlux</Text>
        <Text style={styles.title}>Join your live church service</Text>
        <Text style={styles.muted}>Scan the church QR code or open its live link. Valid links join automatically.</Text>
        <TextInput
          value={serviceId}
          onChangeText={setServiceId}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Service ID"
          placeholderTextColor="#667080"
          style={styles.input}
          accessibilityLabel="Live service ID"
        />
        <Pressable
          accessibilityRole="button"
          style={[styles.button, busy && styles.buttonDisabled]}
          onPress={() => void join()}
          disabled={busy}
        >
          {busy ? <ActivityIndicator color="#080b10" /> : <Text style={styles.buttonText}>Join Live Service</Text>}
        </Pressable>
        {connection === "ended" ? <Text style={styles.ended}>Service ended</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.liveHeader}>
          <View style={styles.headerCopy}>
            <Text style={styles.brand}>iPresenterPlux Live</Text>
            <Text style={styles.title}>{data.service.title}</Text>
          </View>
          <View style={[styles.connectionBadge, connection === "reconnecting" && styles.connectionBadgeWarning]}>
            <Text style={[styles.connectionText, connection === "reconnecting" && styles.connectionTextWarning]}>
              {connection === "reconnecting" ? "● RECONNECTING" : "● LIVE"}
            </Text>
          </View>
        </View>

        <View style={styles.videoCard}>
          <VideoView
            player={videoPlayer}
            style={styles.video}
            allowsPictureInPicture
            nativeControls
            contentFit="contain"
          />
          {usingInterpretedAudio ? (
            <View style={styles.videoAudioNotice}>
              <Text style={styles.videoAudioNoticeText}>Original video audio muted · interpreted audio selected</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Listen in your language</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {data.languages.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityState={{ selected: item.id === channel?.id }}
                accessibilityLabel={`${item.name}, ${item.mode.replaceAll("_", " ")}`}
                onPress={() => selectLanguage(item.id)}
                style={[styles.lang, item.id === channel?.id && styles.langActive]}
              >
                <Text style={styles.langText}>{item.name}</Text>
                <Text style={styles.langMode}>{item.mode.replaceAll("_", " ")}</Text>
              </Pressable>
            ))}
          </ScrollView>
          {channel?.mode === "translation_audio" && channel.id && !sourceSelected ? (
            <TranslatedAudioPlayer
              key={`${data.service.id}:${channel.id}`}
              serviceId={data.service.id}
              channelId={channel.id}
              enabled={interpretedAudioEnabled}
              onEnabledChange={setInterpretedAudioEnabled}
            />
          ) : null}
          {channel?.mode === "translation_audio" && synthesisState ? (
            <Text style={styles.audioPipelineState}>Translation audio pipeline · {synthesisState}</Text>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Current Scripture</Text>
          <Text style={styles.scripture}>{data.scripture?.reference ?? "No scripture live"}</Text>
          <Text style={styles.body}>{data.scripture?.passage_text ?? data.scripture?.source_text ?? ""}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Live Captions</Text>
          <Text style={styles.caption}>{caption ?? "Waiting for the next spoken segment…"}</Text>
          {source?.source_language ? <Text style={styles.langMode}>Source · {source.source_language}</Text> : null}
          {connection === "reconnecting" ? (
            <Text style={styles.reconnectingCopy}>Keeping the current service on screen while live updates reconnect.</Text>
          ) : null}
        </View>

        <Pressable accessibilityRole="button" style={styles.secondary} onPress={leave}>
          <Text style={styles.secondaryText}>Leave service</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#07090d" },
  entry: { flexGrow: 1, justifyContent: "center", padding: 28 },
  content: { padding: 20, gap: 16 },
  brand: { color: "#e5b85c", fontSize: 12, fontWeight: "900", letterSpacing: 2 },
  title: { color: "#fff", fontSize: 28, fontWeight: "900", marginTop: 8 },
  muted: { color: "#87909f", fontSize: 14, lineHeight: 22, marginTop: 12 },
  input: { marginTop: 24, borderWidth: 1, borderColor: "#29303c", backgroundColor: "#0d121a", borderRadius: 14, padding: 15, color: "#fff", fontSize: 14 },
  button: { marginTop: 12, minHeight: 50, justifyContent: "center", backgroundColor: "#d7a94a", borderRadius: 14, padding: 15, alignItems: "center" },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#111", fontWeight: "900" },
  error: { color: "#fca5a5", marginTop: 12, fontSize: 13, lineHeight: 19 },
  ended: { color: "#fbbf24", marginTop: 14, fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1.2 },
  liveHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  headerCopy: { flex: 1 },
  connectionBadge: { borderWidth: 1, borderColor: "#7f1d1d", backgroundColor: "#ef444412", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  connectionBadgeWarning: { borderColor: "#713f12", backgroundColor: "#f59e0b12" },
  connectionText: { color: "#f87171", fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  connectionTextWarning: { color: "#fbbf24" },
  videoCard: { backgroundColor: "#000", borderWidth: 1, borderColor: "#1d2530", borderRadius: 20, overflow: "hidden" },
  video: { width: "100%", height: 210 },
  videoAudioNotice: { borderTopWidth: 1, borderTopColor: "#302610", backgroundColor: "#d7a94a10", paddingHorizontal: 12, paddingVertical: 8 },
  videoAudioNoticeText: { color: "#c9a85f", fontSize: 9, fontWeight: "800", textAlign: "center" },
  card: { backgroundColor: "#0d121a", borderWidth: 1, borderColor: "#1d2530", borderRadius: 20, padding: 16 },
  label: { color: "#8d96a5", fontSize: 11, fontWeight: "900", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 12 },
  lang: { borderWidth: 1, borderColor: "#252d38", borderRadius: 12, padding: 12, marginRight: 8, minWidth: 130 },
  langActive: { borderColor: "#d7a94a", backgroundColor: "#d7a94a18" },
  langText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  langMode: { color: "#667080", fontSize: 9, textTransform: "uppercase", marginTop: 5 },
  audioPipelineState: { color: "#667080", fontSize: 9, textTransform: "uppercase", marginTop: 8 },
  scripture: { color: "#fff", fontSize: 23, fontWeight: "900" },
  body: { color: "#b6bfcc", fontSize: 14, lineHeight: 22, marginTop: 8 },
  caption: { color: "#fff", fontSize: 18, lineHeight: 28 },
  reconnectingCopy: { marginTop: 10, color: "#fbbf24", fontSize: 10, lineHeight: 16 },
  secondary: { alignItems: "center", padding: 14 },
  secondaryText: { color: "#87909f", fontWeight: "700" }
});
