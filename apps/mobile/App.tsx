import { StatusBar } from "expo-status-bar";
import { useVideoPlayer, VideoView } from "expo-video";
import * as Linking from "expo-linking";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

const API = process.env.EXPO_PUBLIC_CONTROL_URL ?? "https://ipresenterplux.lightworldtech.com";
type Language = { id: string; code: string; name: string; mode: string; listeners: number };
type Data = { service: { id: string; title: string }; languages: Language[]; scripture: { reference: string; source_text: string | null } | null; transcript: { text: string; source_language: string | null; translations: Record<string,string>; speech_synthesis: Record<string,string> } | null };

export default function App() {
  const [serviceId, setServiceId] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const player = useVideoPlayer(
    data ? API + "/media/hls/service/" + data.service.id + "/index.m3u8" : null,
    (instance) => { instance.loop = false; if (data) instance.play(); }
  );

  useEffect(() => {
    Linking.getInitialURL().then((url) => {
      if (!url) return;
      const parsed = Linking.parse(url);
      const id = typeof parsed.queryParams?.service === "string" ? parsed.queryParams.service : "";
      if (id) setServiceId(id);
    });
  }, []);

  async function join(id = serviceId) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) { setError("Enter a valid service ID or scan the church QR link."); return; }
    setBusy(true); setError(null);
    try {
      const response = await fetch(API + "/api/v1/audience/service/" + id);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "This service is not live.");
      setData(body); setServiceId(id); setSelected(body.languages[0]?.id ?? "");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not connect to the service."); setData(null); }
    finally { setBusy(false); }
  }

  const channel = data?.languages.find((item) => item.id === selected) ?? data?.languages[0];
  const source = data?.transcript;
  const caption = channel?.mode === "original" || channel?.code === source?.source_language
    ? source?.text
    : (source?.translations?.[channel?.id ?? ""] ?? "Translation is being prepared…");

  if (!data) return (
    <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.entry}><StatusBar style="light" />
      <Text style={styles.brand}>iPresenterPlux</Text><Text style={styles.title}>Join your live church service</Text>
      <Text style={styles.muted}>Scan the church QR code or enter the service ID from the shared live link.</Text>
      <TextInput value={serviceId} onChangeText={setServiceId} autoCapitalize="none" placeholder="Service ID" placeholderTextColor="#667080" style={styles.input}/>
      <Pressable style={styles.button} onPress={() => join()} disabled={busy}>{busy ? <ActivityIndicator color="#080b10"/> : <Text style={styles.buttonText}>Join Live Service</Text>}</Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </ScrollView></SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.safe}><StatusBar style="light" /><ScrollView contentContainerStyle={styles.content}>
      <View><Text style={styles.brand}>LIVE</Text><Text style={styles.title}>{data.service.title}</Text><Text style={styles.live}>● LIVE</Text></View>
      <View style={styles.videoCard}><VideoView player={player} style={styles.video} allowsPictureInPicture nativeControls contentFit="contain" /></View>
      <View style={styles.card}><Text style={styles.label}>Listen in your language</Text><ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {data.languages.map((item) => <Pressable key={item.id} onPress={() => setSelected(item.id)} style={[styles.lang, item.id === channel?.id && styles.langActive]}>
          <Text style={styles.langText}>{item.name}</Text><Text style={styles.langMode}>{item.mode.replaceAll("_", " ")}</Text>
        </Pressable>)}
      </ScrollView></View>
      <View style={styles.card}><Text style={styles.label}>Current Scripture</Text><Text style={styles.scripture}>{data.scripture?.reference ?? "No scripture live"}</Text><Text style={styles.body}>{data.scripture?.source_text ?? ""}</Text></View>
      <View style={styles.card}><Text style={styles.label}>Live Captions</Text><Text style={styles.caption}>{caption ?? "Waiting for the next spoken segment…"}</Text>
        {source?.source_language ? <Text style={styles.langMode}>Source · {source.source_language}</Text> : null}
      </View>
      <Pressable style={styles.secondary} onPress={() => { setData(null); setError(null); }}><Text style={styles.secondaryText}>Leave service</Text></Pressable>
    </ScrollView></SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:"#07090d"}, entry:{flexGrow:1,justifyContent:"center",padding:28}, content:{padding:20,gap:16},
  brand:{color:"#e5b85c",fontSize:12,fontWeight:"900",letterSpacing:2}, title:{color:"#fff",fontSize:28,fontWeight:"900",marginTop:8},
  muted:{color:"#87909f",fontSize:14,lineHeight:22,marginTop:12}, input:{marginTop:24,borderWidth:1,borderColor:"#29303c",backgroundColor:"#0d121a",borderRadius:14,padding:15,color:"#fff",fontSize:14},
  button:{marginTop:12,backgroundColor:"#d7a94a",borderRadius:14,padding:15,alignItems:"center"}, buttonText:{color:"#111",fontWeight:"900"}, error:{color:"#fca5a5",marginTop:12,fontSize:13},
  live:{color:"#f87171",fontSize:11,fontWeight:"900",marginTop:8}, videoCard:{backgroundColor:"#000",borderWidth:1,borderColor:"#1d2530",borderRadius:20,overflow:"hidden"}, video:{width:"100%",height:210}, card:{backgroundColor:"#0d121a",borderWidth:1,borderColor:"#1d2530",borderRadius:20,padding:16},
  label:{color:"#8d96a5",fontSize:11,fontWeight:"900",letterSpacing:1.2,textTransform:"uppercase",marginBottom:12}, lang:{borderWidth:1,borderColor:"#252d38",borderRadius:12,padding:12,marginRight:8,minWidth:130},
  langActive:{borderColor:"#d7a94a",backgroundColor:"#d7a94a18"}, langText:{color:"#fff",fontWeight:"800",fontSize:12}, langMode:{color:"#667080",fontSize:9,textTransform:"uppercase",marginTop:5},
  scripture:{color:"#fff",fontSize:23,fontWeight:"900"}, body:{color:"#b6bfcc",fontSize:14,lineHeight:22,marginTop:8}, caption:{color:"#fff",fontSize:18,lineHeight:28},
  secondary:{alignItems:"center",padding:14}, secondaryText:{color:"#87909f",fontWeight:"700"}
});
