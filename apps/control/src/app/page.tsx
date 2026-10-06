import {
  Activity,
  AudioLines,
  BookOpen,
  Bot,
  RadioTower,
  Camera,
  Captions,
  ChevronRight,
  CircleDot,
  Cloud,
  Languages,
  LayoutDashboard,
  MonitorPlay,
  Music2,
  Settings2,
  Sparkles,
  Users,
  Video,
  Wifi
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@auth";
import { AutoRefresh } from "@/components/AutoRefresh";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { ScriptureControls } from "@/components/ScriptureControls";
import { ServiceControls } from "@/components/ServiceControls";
import { ActiveSpeakerControl } from "@/components/ActiveSpeakerControl";
import { SpeakerVoiceBindings } from "@/components/SpeakerVoiceBindings";
import { OutputControls } from "@/components/OutputControls";
import { AudienceAccessCard } from "@/components/audience/AudienceAccessCard";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { query } from "@/lib/db";
import { roleCapabilities } from "@/lib/role-capabilities";

export const dynamic = "force-dynamic";

type ServiceRow = {
  id: string;
  organization_id: string;
  title: string;
  status: string;
  active_bible_version: string;
  auto_preview_threshold: string;
};

type OutputRow = {
  id: string;
  name: string;
  destination_type: string;
  enabled: boolean;
  status: string;
};

type LanguageRow = {
  id: string;
  language_code: string;
  language_name: string;
  channel_mode: string;
  enabled: boolean;
  listener_count: number;
};

type DetectionRow = {
  id: string;
  scripture_reference: string;
  confidence: string;
  state: string;
  bible_version: string;
  detection_method: string;
  source_text: string | null;
  passage_text: string | null;
  detected_at: string;
};


type MediaSourceRow = {
  id: string;
  name: string;
  source_type: string;
  status: string;
  last_seen_at: string | null;
  level_db: string | null;
  sample_rate: string | null;
  channels: string | null;
  bits_per_sample: string | null;
  encoding: string | null;
  dropped_frames: string | null;
  recognized_chunks: string | null;
  silent_chunks: string | null;
  failed_chunks: string | null;
  published_chunks: string | null;
  publish_failures: string | null;
  worker_status: string | null;
  worker_version: string | null;
  worker_model_loaded: string | null;
  worker_engine: string | null;
  worker_device: string | null;
  worker_diarization: string | null;
  worker_diarization_ready: string | null;
  asr_status: string | null;
  publish_status: string | null;
  last_success_at: string | null;
};

type IntegrationRow = {
  provider: string;
  status: string;
  integration_type: string;
};

type TranscriptSegmentRow = {
  text: string;
  source_observed_at: string;
  source_language: string | null;
  speaker_id: string | null;
  speaker_source: "unknown" | "asr" | "operator_override";
  asr_confidence: number | null;
};

type SpeakerProfileRow = {
  id: string;
  display_name: string;
  source_speaker_id: string;
  active: boolean;
};

type DetectedSpeakerRow = {
  speaker_id: string;
  last_seen_at: string;
  voice_profile_id: string | null;
  voice_name: string | null;
};

type SyntheticVoiceRow = {
  id: string;
  display_name: string;
  provider: string;
};

type TranslationWorkerRow = {
  worker_id: string;
  provider: string;
  state: string;
  software_version: string | null;
  claimed_count: number;
  completed_count: number;
  failed_count: number;
  error_code: string | null;
  observed_at: string;
};

type TtsWorkerRow = TranslationWorkerRow;

async function dashboardData(userId: string) {
  const services = await query<ServiceRow>(
    `select s.id,s.organization_id::text,s.title,s.status,s.active_bible_version,s.auto_preview_threshold::text
     from services s
     where exists (
       select 1 from user_organization_roles uor
       where uor.user_id=$1 and uor.organization_id=s.organization_id
     )
     order by case when s.status='live' then 0 when s.status='ready' then 1 else 2 end,s.created_at desc
     limit 1`,
    [userId]
  );

  let organizationId = services.rows[0]?.organization_id;
  if (!organizationId) {
    const membership = await query<{ organization_id: string }>(
      "select organization_id::text from user_organization_roles where user_id=$1 order by created_at limit 1",
      [userId]
    );
    organizationId = membership.rows[0]?.organization_id;
  }

  if (!organizationId) {
    return { service: undefined, outputs: [], languages: [], detections: [], integrations: [], mediaSources: [], transcript: undefined, translationWorker: undefined, ttsWorker: undefined, speakerProfiles: [], detectedSpeakers: [], syntheticVoices: [], voiceAdmin: false, capabilities: roleCapabilities([]) };
  }

  const roleRows = await query<{ role_id: string }>(
    `select role_id from user_organization_roles
     where user_id=$1 and organization_id=$2
     order by role_id`,
    [userId, organizationId]
  );
  const capabilities = roleCapabilities(roleRows.rows.map((row) => row.role_id));

  const voiceAdminResult = await query<{ allowed: boolean }>(
    `select exists(
       select 1 from user_organization_roles
       where user_id=$1 and organization_id=$2 and role_id = any($3::text[])
     ) as allowed`,
    [userId, organizationId, ["owner", "admin"]]
  );
  const voiceAdmin = Boolean(voiceAdminResult.rows[0]?.allowed);

  const [outputs, languages, detections, integrations, mediaSources, transcripts, translationWorkers, ttsWorkers, speakerProfiles] = await Promise.all([
    query<OutputRow>(
      "select id,name,destination_type,enabled,status from output_destinations where organization_id=$1 order by enabled desc,name",
      [organizationId]
    ),
    query<LanguageRow>(
      "select id,language_code,language_name,channel_mode,enabled,listener_count from language_channels where organization_id=$1 order by enabled desc,language_name",
      [organizationId]
    ),
    query<DetectionRow>(
      `select sd.id,sd.scripture_reference,sd.confidence::text,sd.state,sd.bible_version,sd.detection_method,sd.source_text,sd.detected_at::text,
              (
                select string_agg(bv.text, ' ' order by bv.verse)
                from bible_books bb
                join bible_verses bv
                  on bv.version_id=bb.version_id and bv.book_code=bb.book_code
                where bb.version_id=sd.bible_version
                  and lower(bb.canonical_name)=lower(sd.book)
                  and bv.chapter=sd.chapter
                  and bv.verse between sd.verse_start and coalesce(sd.verse_end,sd.verse_start)
              ) as passage_text
       from scripture_detections sd
       join services s on s.id=sd.service_id
       where s.organization_id=$1
         and ($2::uuid is null or sd.service_id=$2::uuid)
       order by sd.source_observed_at desc,sd.source_ordinal desc,sd.detected_at desc,sd.id desc limit 8`,
      [organizationId, services.rows[0]?.id ?? null]
    ),
    query<IntegrationRow>(
      "select provider,status,integration_type from integrations where organization_id=$1 order by provider",
      [organizationId]
    ),
    query<MediaSourceRow>(
      `select id::text,name,source_type,
              case when last_seen_at is not null and last_seen_at < now()-interval '45 seconds' then 'offline' else status end as status,
              last_seen_at::text,metadata->>'levelDb' as level_db,metadata->>'sampleRate' as sample_rate,
              metadata->>'channels' as channels,metadata->>'bitsPerSample' as bits_per_sample,
              metadata->>'encoding' as encoding,metadata->>'transcriptionDroppedFrames' as dropped_frames,
              metadata->>'transcriptionRecognizedChunks' as recognized_chunks,metadata->>'transcriptionSilentChunks' as silent_chunks,
              metadata->>'transcriptionFailedChunks' as failed_chunks,metadata->>'transcriptPublishedChunks' as published_chunks,
              metadata->>'transcriptPublishFailures' as publish_failures,
              metadata->>'asrWorkerStatus' as worker_status,metadata->>'asrWorkerVersion' as worker_version,
              metadata->>'asrWorkerModelLoaded' as worker_model_loaded,metadata->>'asrWorkerEngine' as worker_engine,
              metadata->>'asrWorkerDevice' as worker_device,metadata->>'asrWorkerDiarization' as worker_diarization,
              metadata->>'asrWorkerDiarizationReady' as worker_diarization_ready,metadata->>'asrStatus' as asr_status,
              metadata->>'transcriptPublishStatus' as publish_status,
              metadata->>'transcriptionLastSuccessAt' as last_success_at
       from media_sources where organization_id=$1
       order by case when source_type='audio_input' then 0 else 1 end,last_seen_at desc nulls last,name
       limit 6`,
      [organizationId]
    ),
    query<TranscriptSegmentRow>(
      `select ts.text,ts.source_observed_at::text,ts.source_language,ts.speaker_id,ts.speaker_source,ts.asr_confidence
       from transcript_segments ts
       join services s on s.id=ts.service_id
       where s.organization_id=$1
         and ($2::uuid is null or ts.service_id=$2::uuid)
       order by ts.source_observed_at desc,ts.created_at desc,ts.id desc
       limit 1`,
      [organizationId, services.rows[0]?.id ?? null]
    ),
    query<TranslationWorkerRow>(
      `select worker_id,provider,
              case when observed_at < clock_timestamp()-interval '20 seconds' then 'offline' else state end as state,
              software_version,claimed_count,completed_count,failed_count,error_code,observed_at::text
       from translation_worker_status
       order by observed_at desc,worker_id
       limit 1`
    ),
    query<TtsWorkerRow>(
      `select worker_id,provider,
              case when observed_at < clock_timestamp()-interval '20 seconds' then 'offline' else state end as state,
              software_version,claimed_count,completed_count,failed_count,error_code,observed_at::text
       from tts_worker_status
       order by observed_at desc,worker_id
       limit 1`
    ),
    query<SpeakerProfileRow>(
      `select vp.id::text,vp.display_name,vp.source_speaker_id,
              (so.voice_profile_id is not null) as active
       from voice_profiles vp
       left join service_speaker_overrides so
         on so.voice_profile_id=vp.id and so.organization_id=vp.organization_id
        and so.service_id=$2::uuid
       where vp.organization_id=$1
         and vp.consent_status='consented'
         and vp.consented_at is not null and vp.revoked_at is null
         and vp.source_speaker_id is not null and length(btrim(vp.source_speaker_id)) > 0
       order by active desc,vp.display_name,vp.id`,
      [organizationId, services.rows[0]?.id ?? null]
    )
  ]);

  const serviceId = services.rows[0]?.id ?? null;
  const detectedSpeakers = serviceId ? await query<DetectedSpeakerRow>(
    `select recent.speaker_id,recent.last_seen_at::text,b.voice_profile_id::text,vp.display_name as voice_name
     from (
       select distinct on (lower(ts.speaker_id))
              lower(ts.speaker_id) as speaker_id,ts.source_observed_at as last_seen_at
       from transcript_segments ts
       where ts.service_id=$1 and ts.speaker_source='asr' and ts.speaker_id is not null
       order by lower(ts.speaker_id),ts.source_observed_at desc,ts.created_at desc,ts.id desc
     ) recent
     left join service_speaker_voice_bindings b
       on b.service_id=$1 and lower(b.speaker_id)=recent.speaker_id
     left join voice_profiles vp
       on vp.id=b.voice_profile_id and vp.organization_id=b.organization_id
     order by recent.last_seen_at desc,recent.speaker_id
     limit 12`,
    [serviceId]
  ) : { rows: [] as DetectedSpeakerRow[] };
  const syntheticVoices = voiceAdmin ? await query<SyntheticVoiceRow>(
    `select id::text,display_name,provider
     from voice_profiles
     where organization_id=$1
       and consent_status='consented' and consented_at is not null and revoked_at is null
       and provider is not null and provider_voice_id is not null
     order by display_name,id`,
    [organizationId]
  ) : { rows: [] as SyntheticVoiceRow[] };

  return {
    service: services.rows[0],
    outputs: outputs.rows,
    languages: languages.rows,
    detections: detections.rows,
    integrations: integrations.rows,
    mediaSources: mediaSources.rows,
    transcript: transcripts.rows[0],
    translationWorker: translationWorkers.rows[0],
    ttsWorker: ttsWorkers.rows[0],
    speakerProfiles: speakerProfiles.rows,
    detectedSpeakers: voiceAdmin ? detectedSpeakers.rows : [],
    syntheticVoices: syntheticVoices.rows,
    voiceAdmin,
    capabilities
  };
}

function stateClass(status: string) {
  if (["ready", "live", "connected", "configured"].includes(status)) {
    return "border-emerald-400/20 bg-emerald-400/10 text-emerald-300";
  }
  if (["warning", "connecting", "degraded"].includes(status)) {
    return "border-amber-400/20 bg-amber-400/10 text-amber-300";
  }
  if (["error", "offline"].includes(status)) {
    return "border-red-400/20 bg-red-400/10 text-red-300";
  }
  return "border-white/10 bg-white/[.04] text-white/55";
}

function Pill({ status }: { status: string }) {
  return (
    <span className={"inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[.14em] " + stateClass(status)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

const nav = [
  ["Control Room", LayoutDashboard, null],
  ["Scripture", BookOpen, null],
  ["Songs & Media", Music2, null],
  ["Cameras", Camera, null],
  ["AI Director", Bot, null],
  ["Translations", Languages, "/translations"],
  ["Streaming", RadioTower, "/streaming"],
  ["Audience", Users, null],
  ["Archive", Video, null]
] as const;

export default async function Home() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.forcePasswordChange) redirect("/change-password");

  const data = await dashboardData(session.user.id);
  const service = data.service;
  const capabilities = data.capabilities;
  const latest = data.detections[0];
  const previewDetection = data.detections.find((item) => item.state === "preview");
  const liveDetection = data.detections.find((item) => item.state === "live");
  const actionableDetection = previewDetection ?? data.detections.find((item) => item.state === "detected");
  const transcriptContext = actionableDetection ?? liveDetection ?? latest;
  const activeOutputs = data.outputs.filter((item) => item.enabled).length;
  const activeLanguages = data.languages.filter((item) => item.enabled).length;
  const listeners = data.languages.reduce((total, item) => total + item.listener_count, 0);
  const translationWorkerState = data.translationWorker?.state ?? "offline";
  const ttsWorkerState = data.ttsWorker?.state ?? "offline";
  const hasAudioTranslation = data.languages.some((item) => item.enabled && item.channel_mode === "translation_audio");
  const languageEngineState = translationWorkerState === "offline" || translationWorkerState === "degraded"
    ? translationWorkerState
    : hasAudioTranslation && ["offline", "degraded", "disabled"].includes(ttsWorkerState)
      ? "warning"
      : translationWorkerState;
  const languageEngineNote = `Text ${translationWorkerState} · Audio ${ttsWorkerState} · ${listeners} connected listeners`;

  return (
    <main className="min-h-screen">
      {service ? <RealtimeRefresh serviceId={service.id} /> : <AutoRefresh intervalMs={15_000} />}

      <div className="grid min-h-screen grid-cols-[86px_1fr] xl:grid-cols-[240px_1fr]">
        <aside className="sticky top-0 h-screen border-r border-white/[.07] bg-[#080b10]/95 px-3 py-4 backdrop-blur-xl xl:px-4">
          <div className="mb-7 flex items-center gap-3 px-1 xl:px-2">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[#d7a94a]/30 bg-[#d7a94a]/10 text-[#f2c765] shadow-[0_0_35px_rgba(215,169,74,.08)]">
              <MonitorPlay size={22} />
            </div>
            <div className="hidden min-w-0 xl:block">
              <div className="truncate text-sm font-extrabold tracking-tight">iPresenterPlux</div>
              <div className="truncate text-[10px] uppercase tracking-[.22em] text-white/35">AI Church Studio</div>
            </div>
          </div>

          <nav className="space-y-1">
            {nav.map(([label, Icon, href], index) => {
              if (label === "Translations" && !capabilities.canTranslations) return null;
              if (label === "Streaming" && !capabilities.canStreaming) return null;
              const className =
                "group flex w-full items-center justify-center gap-3 rounded-xl px-3 py-3 text-left transition xl:justify-start " +
                (index === 0
                  ? "border border-[#d7a94a]/20 bg-[#d7a94a]/10 text-[#f2c765]"
                  : "text-white/45 hover:bg-white/[.04] hover:text-white/80");
              const content = <><Icon size={18} /><span className="hidden text-sm font-medium xl:inline">{label}</span></>;
              return href ? <Link key={label} href={href} className={className}>{content}</Link> : <button key={label} className={className}>{content}</button>;
            })}
          </nav>

          {capabilities.canSettings ? (
            <div className="absolute bottom-4 left-3 right-3 xl:left-4 xl:right-4">
              <Link href="/settings" className="flex w-full items-center justify-center gap-3 rounded-xl border border-white/[.07] bg-white/[.025] px-3 py-3 text-white/45 hover:text-white xl:justify-start">
                <Settings2 size={18} />
                <span className="hidden text-sm xl:inline">Settings</span>
              </Link>
            </div>
          ) : null}
        </aside>

        <section className="min-w-0">
          <header className="sticky top-0 z-30 flex min-h-[72px] items-center justify-between border-b border-white/[.07] bg-[#090c12]/88 px-5 backdrop-blur-xl lg:px-7">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <h1 className="truncate text-base font-bold lg:text-lg">{service?.title ?? "No service selected"}</h1>
                {service ? <Pill status={service.status} /> : null}
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-white/40">
                <span>Main Auditorium</span>
                <span>·</span>
                <span>{service?.active_bible_version ?? "Bible not set"}</span>
                <span>·</span>
                <span>Auto-preview ≥ {service?.auto_preview_threshold ?? "90"}%</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="hidden items-center gap-2 rounded-xl border border-white/[.07] bg-white/[.025] px-3 py-2 text-xs text-white/50 md:flex">
                <Wifi size={14} className="text-emerald-400" />
                VPS online
              </div>
              <div className="hidden text-right xl:block">
                <div className="max-w-36 truncate text-xs font-semibold text-white/65">{session.user.name ?? session.user.email}</div>
                <div className="text-[10px] uppercase tracking-[.12em] text-white/25">Authorized operator</div>
              </div>
              <LogoutButton />
              {service && capabilities.canLiveControl ? <ServiceControls serviceId={service.id} status={service.status} /> : null}
            </div>
          </header>

          <div className="space-y-5 p-4 lg:p-6">
            <section className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
              {[
                ["Presentation Engine", "Ready", "Preview + Program", MonitorPlay, "ready"],
                ["Scripture Intelligence", data.detections.length ? "Listening" : "Armed", String(data.detections.length) + " recent detections", Sparkles, "ready"],
                ["Broadcast Router", activeOutputs + " outputs", "RTMP · WebRTC · NDI", RadioTower, activeOutputs ? "ready" : "disconnected"],
                ["Language Engine", activeLanguages + " channels", languageEngineNote, Languages, languageEngineState]
              ].map(([label, value, note, Icon, status]) => (
                <div key={String(label)} className="ip-card p-4">
                  <div className="mb-4 flex items-start justify-between">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[.045] text-white/70">
                      <Icon size={17} />
                    </div>
                    <Pill status={String(status)} />
                  </div>
                  <div className="text-xs uppercase tracking-[.15em] text-white/35">{String(label)}</div>
                  <div className="mt-1.5 text-xl font-bold tracking-tight">{String(value)}</div>
                  <div className="mt-1 text-xs text-white/40">{String(note)}</div>
                </div>
              ))}
            </section>

            <section className="grid gap-4 2xl:grid-cols-[310px_minmax(0,1fr)_360px]">
              <div className="ip-card flex min-h-[510px] flex-col overflow-hidden">
                <div className="flex items-center justify-between border-b border-white/[.07] px-4 py-4">
                  <div>
                    <div className="text-sm font-bold">Service Queue</div>
                    <div className="text-[11px] text-white/35">Detected & prepared content</div>
                  </div>
                  <button className="rounded-lg border border-white/[.07] px-2.5 py-1.5 text-xs text-white/50">+ Add</button>
                </div>
                <div className="ip-scrollbar flex-1 space-y-2 overflow-y-auto p-3">
                  {data.detections.length ? data.detections.map((item, index) => (
                    <div key={item.id} className={"rounded-xl border p-3 " + (index === 0 ? "border-[#d7a94a]/25 bg-[#d7a94a]/[.07]" : "border-white/[.06] bg-white/[.02]")}>
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-white/[.045] text-[#e4ba63]">
                          <BookOpen size={15} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="truncate text-sm font-semibold">{item.scripture_reference}</div>
                            <span className="text-[10px] font-bold text-emerald-300">{Number(item.confidence).toFixed(0)}%</span>
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-white/38"><span>{item.bible_version} · {item.detection_method === "quote" ? "Quote match" : item.detection_method === "context" ? "Context navigation" : item.detection_method === "reference" ? "Reference detection" : "Historical detection"}</span><span className="uppercase tracking-[.12em] text-white/25">{item.state}</span></div>
                        </div>
                      </div>
                    </div>
                  )) : (
                    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
                      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[.04] text-white/35">
                        <AudioLines size={21} />
                      </div>
                      <div className="text-sm font-semibold text-white/65">Listening for scripture</div>
                      <div className="mt-2 text-xs leading-5 text-white/35">Transcript ingestion is ready. Detected references will enter this queue automatically.</div>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="ip-card overflow-hidden">
                    <div className="flex items-center justify-between border-b border-white/[.07] px-4 py-3">
                      <div className="text-xs font-bold uppercase tracking-[.13em] text-white/45">Preview</div>
                      <span className="h-2 w-2 rounded-full bg-amber-400" />
                    </div>
                    <div className="ip-grid aspect-video p-5">
                      <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-white/[.08] bg-black/35 text-center">
                        {previewDetection ? (
                          <div>
                            <div className="text-[10px] font-semibold uppercase tracking-[.3em] text-[#d7a94a]">Preview Scripture</div>
                            <div className="mt-3 text-2xl font-black tracking-tight">{previewDetection.scripture_reference}</div>
                            {previewDetection.passage_text ? (
                              <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-white/70">{previewDetection.passage_text}</p>
                            ) : null}
                            <div className="mt-2 text-xs text-white/45">{previewDetection.bible_version} · awaiting operator approval</div>
                          </div>
                        ) : (
                          <div className="text-sm text-white/25">Nothing queued for preview</div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="ip-card overflow-hidden">
                    <div className="flex items-center justify-between border-b border-white/[.07] px-4 py-3">
                      <div className="text-xs font-bold uppercase tracking-[.13em] text-white/45">Program</div>
                      <div className={"flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.15em] " + (liveDetection ? "text-red-300" : "text-white/30")}>
                        <span className={"h-2 w-2 rounded-full " + (liveDetection ? "bg-red-400" : "bg-white/20")} />
                        {liveDetection ? "Live" : "No scripture live"}
                      </div>
                    </div>
                    <div className="ip-grid aspect-video p-5">
                      <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-white/[.08] bg-black/60 text-center">
                        {liveDetection ? (
                          <div>
                            <div className="text-[10px] font-semibold uppercase tracking-[.3em] text-red-300">Program Scripture</div>
                            <div className="mt-3 text-2xl font-black tracking-tight">{liveDetection.scripture_reference}</div>
                            {liveDetection.passage_text ? (
                              <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-white/75">{liveDetection.passage_text}</p>
                            ) : null}
                            <div className="mt-2 text-xs text-white/45">{liveDetection.bible_version} · live output state</div>
                          </div>
                        ) : (
                          <div className="text-sm text-white/20">Program output</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="ip-card p-4">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold">Live Transcript & AI Context</div>
                      <div className="text-[11px] text-white/35">Mixer audio → ASR → scripture / translation / captions</div>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-emerald-300">
                      <Activity size={14} />
                      Pipeline armed
                    </div>
                  </div>
                  {data.service && capabilities.canLiveControl ? (
                    <div className="mb-3 space-y-2">
                      <ActiveSpeakerControl
                        serviceId={data.service.id}
                        serviceStatus={data.service.status}
                        profiles={data.speakerProfiles.map((profile) => ({
                          id: profile.id,
                          name: profile.display_name,
                          speakerId: profile.source_speaker_id,
                          active: profile.active
                        }))}
                      />
                      {data.voiceAdmin ? (
                        <SpeakerVoiceBindings
                          serviceId={data.service.id}
                          serviceStatus={data.service.status}
                          speakers={data.detectedSpeakers.map((speaker) => ({
                            speakerId: speaker.speaker_id,
                            lastSeenAt: speaker.last_seen_at,
                            voiceProfileId: speaker.voice_profile_id,
                            voiceName: speaker.voice_name
                          }))}
                          profiles={data.syntheticVoices.map((profile) => ({
                            id: profile.id,
                            name: profile.display_name,
                            provider: profile.provider
                          }))}
                        />
                      ) : null}
                    </div>
                  ) : null}
                  <div className="rounded-xl border border-white/[.06] bg-black/20 p-4">
                    <p className="min-h-16 text-sm leading-6 text-white/55">
                      {data.transcript?.text ?? transcriptContext?.source_text ?? "Waiting for the first transcript chunk from the Windows audio agent…"}
                    </p>
                    {data.transcript ? (
                      <div className="mt-3 flex flex-wrap gap-2 text-[10px] uppercase tracking-[.12em] text-white/30">
                        {data.transcript.source_language ? <span>Language {data.transcript.source_language}</span> : null}
                        {data.transcript.speaker_id ? <span>Speaker {data.transcript.speaker_id}</span> : <span>Speaker unknown</span>}
                        {data.transcript.speaker_source !== "unknown" ? <span>{data.transcript.speaker_source === "asr" ? "ASR speaker" : "Operator speaker"}</span> : null}
                        {data.transcript.asr_confidence !== null ? <span>ASR {Math.round(data.transcript.asr_confidence * 100)}%</span> : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {["Scripture AI", "Captions", "Speaker context", "Translation router", "Sermon archive"].map((item) => (
                      <span key={item} className="rounded-lg border border-white/[.06] bg-white/[.025] px-2.5 py-1.5 text-[11px] text-white/45">{item}</span>
                    ))}
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="ip-card p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm font-bold"><Camera size={16} /> Media Sources</div>
                      <span className="text-[10px] uppercase tracking-[.12em] text-white/25">Edge telemetry</span>
                    </div>
                    {data.mediaSources.length ? (
                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {data.mediaSources.map((source) => {
                          const level = source.level_db === null ? null : Number(source.level_db);
                          const levelWidth = level === null || !Number.isFinite(level) ? 0 : Math.max(0, Math.min(100, ((level + 60) / 60) * 100));
                          const SourceIcon = source.source_type === "audio_input" ? AudioLines : Camera;
                          return (
                            <div key={source.id} className="rounded-xl border border-white/[.06] bg-white/[.025] p-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/25 text-white/45"><SourceIcon size={15} /></div>
                                <Pill status={source.status} />
                              </div>
                              <div className="mt-3 truncate text-xs font-semibold">{source.name}</div>
                              <div className="mt-1 truncate text-[10px] uppercase tracking-[.1em] text-white/28">{source.source_type.replaceAll("_", " ")}</div>
                              {source.source_type === "audio_input" ? (
                                <>
                                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[.06]">
                                    <div className="h-full rounded-full bg-emerald-400/70 transition-[width]" style={{ width: `${levelWidth}%` }} />
                                  </div>
                                  <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-white/32">
                                    <span>{level === null || !Number.isFinite(level) ? "No level" : `${level.toFixed(1)} dB`}</span>
                                    <span>{source.sample_rate ? `${source.sample_rate} Hz` : "—"}{source.channels ? ` · ${source.channels} ch` : ""}</span>
                                  </div>
                                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-white/32">
                                    <span>Worker <span className={source.worker_status === "offline" || source.worker_status === "error" ? "text-red-200/80" : source.worker_status === "ready" ? "text-emerald-200/80" : "text-white/45"}>{source.worker_status ?? "unknown"}</span></span>
                                    <span>ASR <span className={source.asr_status === "degraded" ? "text-amber-200/80" : source.asr_status === "ready" ? "text-emerald-200/80" : "text-white/45"}>{source.asr_status ?? "disabled"}</span></span>
                                    <span>Delivery <span className={source.publish_status === "degraded" ? "text-amber-200/80" : source.publish_status === "ready" ? "text-emerald-200/80" : "text-white/45"}>{source.publish_status ?? "disabled"}</span></span>
                                    <span>Diarization <span className={source.worker_diarization_ready === "true" ? "text-emerald-200/80" : source.worker_diarization === "disabled" ? "text-white/35" : "text-amber-200/80"}>{source.worker_diarization ?? "unknown"}</span></span>
                                    <span>Speech {source.recognized_chunks ?? "0"}</span>
                                    <span>Delivered {source.published_chunks ?? "0"}</span>
                                    <span>Silent {source.silent_chunks ?? "0"}</span>
                                    {Number(source.dropped_frames ?? "0") > 0 ? <span className="text-amber-200/75">Dropped {source.dropped_frames}</span> : null}
                                  </div>
                                  {source.worker_status === "ready" ? (
                                    <div className="mt-1 text-[10px] text-white/25">{[source.worker_engine, source.worker_device, source.worker_version ? `v${source.worker_version}` : null, source.worker_model_loaded === "true" ? "model loaded" : "model idle"].filter(Boolean).join(" · ")}</div>
                                  ) : null}
                                  {Number(source.failed_chunks ?? "0") > 0 ? (
                                    <div className="mt-1 text-[10px] text-amber-200/70">ASR failures: {source.failed_chunks}</div>
                                  ) : null}
                                  {Number(source.publish_failures ?? "0") > 0 ? (
                                    <div className="mt-1 text-[10px] text-amber-200/70">Transcript delivery failures: {source.publish_failures}</div>
                                  ) : null}
                                  {source.last_success_at ? (
                                    <div className="mt-1 text-[10px] text-white/25">Last ASR success {new Date(source.last_success_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
                                  ) : null}
                                </>
                              ) : (
                                <div className="mt-3 text-[10px] text-white/30">Last telemetry {source.last_seen_at ? new Date(source.last_seen_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "not received"}</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-white/[.08] px-4 py-8 text-center">
                        <AudioLines size={20} className="mx-auto text-white/20" />
                        <div className="mt-3 text-xs font-semibold text-white/50">No Edge media telemetry yet</div>
                        <div className="mt-1 text-[10px] leading-5 text-white/28">Pair a church computer and start its mixer/audio capture to populate this panel.</div>
                      </div>
                    )}
                  </div>

                  <div className="ip-card p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-bold"><Bot size={16} /> AI Director</div>
                    <div className="rounded-xl border border-white/[.06] bg-white/[.025] p-4">
                      <div className="text-xs font-semibold text-white/70">Director is in advisory mode</div>
                      <div className="mt-2 text-xs leading-5 text-white/38">Camera switching, subject tracking, intelligent graphics and scene recommendations will attach to this decision layer.</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="ip-card overflow-hidden">
                  <div className="flex items-center justify-between border-b border-white/[.07] px-4 py-4">
                    <div>
                      <div className="text-sm font-bold">Scripture Intelligence</div>
                      <div className="text-[11px] text-white/35">Human approval by default</div>
                    </div>
                    <Sparkles size={17} className="text-[#e5b85c]" />
                  </div>
                  <div className="p-4">
                    {actionableDetection ? (
                      <>
                        <div className="rounded-2xl border border-[#d7a94a]/20 bg-[#d7a94a]/[.06] p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <div className="text-[10px] font-semibold uppercase tracking-[.2em] text-[#d7a94a]">
                                {actionableDetection.state === "preview" ? "In Preview" : "Detected"}
                              </div>
                              <div className="mt-2 text-2xl font-black">{actionableDetection.scripture_reference}</div>
                              <div className="mt-1 text-xs text-white/40">{actionableDetection.bible_version}</div>
                              {actionableDetection.passage_text ? (
                                <p className="mt-3 text-xs leading-5 text-white/55">{actionableDetection.passage_text}</p>
                              ) : null}
                            </div>
                            <div className="rounded-xl bg-emerald-400/10 px-2.5 py-2 text-sm font-extrabold text-emerald-300">
                              {Number(actionableDetection.confidence).toFixed(0)}%
                            </div>
                          </div>
                        </div>
                        {capabilities.canLiveControl ? (
                          <div className="mt-3">
                            <ScriptureControls id={actionableDetection.id} currentState={actionableDetection.state} />
                          </div>
                        ) : null}
                      </>
                    ) : liveDetection ? (
                      <div className="rounded-xl border border-red-400/15 bg-red-400/[.05] p-5 text-center">
                        <div className="text-[10px] font-semibold uppercase tracking-[.2em] text-red-300">Currently live</div>
                        <div className="mt-2 text-xl font-black">{liveDetection.scripture_reference}</div>
                        <div className="mt-1 text-xs text-white/35">{liveDetection.bible_version}</div>
                        {liveDetection.passage_text ? (
                          <p className="mt-3 text-xs leading-5 text-white/50">{liveDetection.passage_text}</p>
                        ) : null}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-white/[.08] p-5 text-center text-xs leading-5 text-white/35">
                        No actionable scripture detected yet. The transcript API is ready for the desktop audio agent.
                      </div>
                    )}
                  </div>
                </div>

                <div className="ip-card overflow-hidden">
                  <div className="flex items-center justify-between border-b border-white/[.07] px-4 py-4">
                    <div>
                      <div className="text-sm font-bold">Broadcast Destinations</div>
                      <div className="text-[11px] text-white/35">One program · many outputs</div>
                    </div>
                    <Cloud size={16} className="text-white/35" />
                  </div>
                  <div className="divide-y divide-white/[.055]">
                    {data.outputs.map((output) => (
                      <div key={output.id} className="flex items-center gap-3 px-4 py-3">
                        <span className={"h-2 w-2 rounded-full " + (output.enabled ? "bg-emerald-400" : "bg-white/15")} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-semibold">{output.name}</div>
                          <div className="mt-0.5 text-[10px] uppercase tracking-[.12em] text-white/28">{output.destination_type}</div>
                        </div>
                        <Pill status={output.status} />
                        {capabilities.canStreaming ? <OutputControls id={output.id} enabled={output.enabled} /> : null}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="ip-card overflow-hidden">
                  <div className="flex items-center justify-between border-b border-white/[.07] px-4 py-4">
                    <div>
                      <div className="text-sm font-bold">Language Channels</div>
                      <div className="text-[11px] text-white/35">Audience interpretation</div>
                    </div>
                    <Captions size={16} className="text-white/35" />
                  </div>
                  <div className="max-h-72 divide-y divide-white/[.055] overflow-y-auto ip-scrollbar">
                    {data.languages.map((channel) => (
                      <div key={channel.id} className="flex items-center gap-3 px-4 py-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[.04] text-[10px] font-extrabold uppercase text-white/55">{channel.language_code}</div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-semibold">{channel.language_name}</div>
                          <div className="mt-0.5 truncate text-[10px] text-white/30">{channel.channel_mode.replaceAll("_", " ")}</div>
                        </div>
                        <div className="text-xs font-semibold text-white/35">{channel.listener_count}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {service ? <AudienceAccessCard serviceId={service.id} /> : null}

            <section className="ip-card overflow-hidden">
              <div className="flex items-center justify-between border-b border-white/[.07] px-4 py-4">
                <div>
                  <div className="text-sm font-bold">Integration Fabric</div>
                  <div className="text-[11px] text-white/35">iPresenterPlux remains the source of truth; external software receives feeds and control events.</div>
                </div>
                <ChevronRight size={17} className="text-white/25" />
              </div>
              <div className="grid md:grid-cols-2 xl:grid-cols-4">
                {data.integrations.map((item) => (
                  <div key={item.provider} className="border-b border-white/[.055] p-4 md:border-r xl:border-b-0 last:border-r-0">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-bold">{item.provider}</div>
                      <Pill status={item.status} />
                    </div>
                    <div className="mt-2 text-xs capitalize text-white/35">{item.integration_type.replaceAll("_", " ")}</div>
                  </div>
                ))}
              </div>
            </section>

            <footer className="flex flex-wrap items-center justify-between gap-3 px-1 pb-2 text-[11px] text-white/25">
              <div className="flex items-center gap-2">
                <CircleDot size={12} className="text-emerald-400" />
                iPresenterPlux control plane · PostgreSQL + Redis connected · realtime event stream
              </div>
              <div>Foundation v0.1.0 · Africa/Accra</div>
            </footer>
          </div>
        </section>
      </div>
    </main>
  );
}
