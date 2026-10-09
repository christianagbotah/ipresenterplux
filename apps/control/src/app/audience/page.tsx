import { Users } from "lucide-react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@auth";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { AudienceStudio } from "@/components/audience/AudienceStudio";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { StudioMobileNav } from "@/components/navigation/StudioMobileNav";
import { StudioSidebar } from "@/components/navigation/StudioSidebar";
import { audienceQrSvg, canonicalAudienceUrl } from "@/lib/audience-links";
import { query } from "@/lib/db";
import { getCurrentServiceForUser } from "@/lib/current-service";

export const dynamic = "force-dynamic";

type ServiceRow = { id: string; organization_id: string; title: string; status: string };
type LanguageRow = { language_name: string; channel_mode: string; listener_count: number };
type ScriptureRow = { scripture_reference: string; passage_text: string | null };
type TranscriptRow = { text: string };
type StreamRow = { status: string };

async function audienceOrigin() {
  const incoming = await headers();
  const forwardedHost = incoming.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || incoming.get("host")?.trim();
  const forwardedProto = incoming.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = forwardedProto || (host?.startsWith("localhost") || host?.startsWith("127.0.0.1") ? "http" : "https");
  if (host) return `${proto}://${host}`;
  return process.env.AUTH_URL || "http://localhost:3000";
}

async function audiencePageData(userId: string) {
  const context = await getCurrentServiceForUser(userId);
  if (!context) return { service: null, capabilities: { canLiveControl:false, canStreaming:false, canTranslations:false, canSettings:false, canViewPlanner:false, canPlanServices:false }, navigationCapabilities: { canMedia:false, canCameras:false, canAIDirector:false, canTranslations:false, canStreaming:false, canArchive:false, canSettings:false }, languages: [], scripture: null, caption: null, streamStatus: "idle" };
  const service: ServiceRow | null = context.service ? { id: context.service.id, organization_id: context.service.organizationId, title: context.service.title, status: context.service.status } : null;
  const organizationId = context.organizationId;
  const capabilities = context.roleCapabilities;
  const navigationCapabilities = context.navigationCapabilities;
  if (!service) return { service: null, capabilities, navigationCapabilities, languages: [], scripture: null, caption: null, streamStatus: "idle" };

  const [languages, scriptures, transcripts, streams] = await Promise.all([
    query<LanguageRow>(
      `select language_name,channel_mode,listener_count from language_channels
       where organization_id=$1::uuid and enabled=true
       order by case channel_mode when 'original' then 0 when 'captions' then 1 when 'translation_audio' then 2 else 3 end,language_name`,
      [organizationId]
    ),
    query<ScriptureRow>(
      `select sd.scripture_reference,
              (select string_agg(bv.text,' ' order by bv.verse)
               from bible_books bb join bible_verses bv on bv.version_id=bb.version_id and bv.book_code=bb.book_code
               where bb.version_id=sd.bible_version and lower(bb.canonical_name)=lower(sd.book)
                 and bv.chapter=sd.chapter
                 and (sd.verse_start is null or bv.verse between sd.verse_start and coalesce(sd.verse_end,sd.verse_start))) as passage_text
       from scripture_detections sd where sd.service_id=$1::uuid and sd.state='live'
       order by sd.source_observed_at desc,sd.source_ordinal desc,sd.detected_at desc,sd.id desc limit 1`,
      [service.id]
    ),
    query<TranscriptRow>(
      `select text from transcript_segments where service_id=$1::uuid
       order by source_observed_at desc,created_at desc,id desc limit 1`,
      [service.id]
    ),
    query<StreamRow>(
      `select status from stream_sessions where service_id=$1::uuid order by created_at desc limit 1`,
      [service.id]
    )
  ]);

  return {
    service,
    capabilities,
    navigationCapabilities,
    languages: languages.rows.map((row) => ({ name: row.language_name, mode: row.channel_mode, listeners: row.listener_count })),
    scripture: scriptures.rows[0] ? { reference: scriptures.rows[0].scripture_reference, text: scriptures.rows[0].passage_text } : null,
    caption: transcripts.rows[0]?.text ?? null,
    streamStatus: streams.rows[0]?.status ?? "idle"
  };
}

export default async function AudiencePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.forcePasswordChange) redirect("/change-password");

  const data = await audiencePageData(session.user.id);
  const origin = await audienceOrigin();
  const audienceUrl = data.service ? canonicalAudienceUrl(origin, data.service.id) : null;
  const qrSvg = audienceUrl ? await audienceQrSvg(audienceUrl) : null;

  return (
    <main className="min-h-screen bg-[#070a0f] text-white">
      {data.service ? <RealtimeRefresh serviceId={data.service.id} /> : null}
      <StudioMobileNav capabilities={data.navigationCapabilities} />
      <div className="min-h-screen md:grid md:grid-cols-[86px_1fr] xl:grid-cols-[240px_1fr]">
        <StudioSidebar capabilities={data.navigationCapabilities} />
        <section className="min-w-0 pb-20 md:pb-0">
          <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between border-b border-white/[.07] bg-[#080b10]/92 px-4 backdrop-blur-xl lg:px-6">
            <div className="flex min-w-0 items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#d7a94a]/25 bg-[#d7a94a]/10 text-[#efc86f]"><Users size={19} /></div><div><h1 className="text-sm font-black sm:text-base">Audience Studio</h1><p className="text-[11px] text-white/35">QR · canonical links · public experience readiness</p></div></div>
            <LogoutButton />
          </header>
          <AudienceStudio service={data.service} audienceUrl={audienceUrl} qrSvg={qrSvg} languages={data.languages} scripture={data.scripture} caption={data.caption} streamStatus={data.streamStatus} />
        </section>
      </div>
    </main>
  );
}
