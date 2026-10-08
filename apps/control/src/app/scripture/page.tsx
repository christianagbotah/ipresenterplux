import { BookOpen, MonitorPlay } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@auth";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { StudioMobileNav } from "@/components/navigation/StudioMobileNav";
import { StudioSidebar } from "@/components/navigation/StudioSidebar";
import { ScriptureWorkspace } from "@/components/scripture/ScriptureWorkspace";
import { listBibleBooks, listLocalBibleVersions } from "@/lib/bible-library";
import { db, query } from "@/lib/db";
import { getCurrentServiceForUser } from "@/lib/current-service";

export const dynamic = "force-dynamic";

type ServiceRow = {
  id: string;
  organization_id: string;
  title: string;
  status: string;
  active_bible_version: string;
};

type DetectionRow = {
  id: string;
  scripture_reference: string;
  confidence: string;
  state: string;
  bible_version: string;
  detection_method: string;
  passage_text: string | null;
  detected_at: string;
};

async function scripturePageData(userId: string) {
  const context = await getCurrentServiceForUser(userId);
  const service: ServiceRow | null = context?.service ? {
    id: context.service.id,
    organization_id: context.service.organizationId,
    title: context.service.title,
    status: context.service.status,
    active_bible_version: context.service.activeBibleVersion
  } : null;
  if (!context) {
    return {
      service: null,
      capabilities: { canLiveControl:false, canStreaming:false, canTranslations:false, canSettings:false, canViewPlanner:false, canPlanServices:false },
      navigationCapabilities: { canMedia:false, canCameras:false, canAIDirector:false, canTranslations:false, canStreaming:false, canArchive:false, canSettings:false },
      versions: [], books: [], detections: [],
      libraryError: "No church organization is assigned to this account."
    };
  }
  const capabilities = context.roleCapabilities;
  const navigationCapabilities = context.navigationCapabilities;

  let versions: Awaited<ReturnType<typeof listLocalBibleVersions>> = [];
  let books: Awaited<ReturnType<typeof listBibleBooks>> = [];
  let libraryError: string | null = null;
  try {
    versions = await listLocalBibleVersions(db);
    const preferredVersion = versions.find((item) => item.id.toUpperCase() === service?.active_bible_version?.toUpperCase())?.id
      ?? versions[0]?.id;
    if (preferredVersion) books = await listBibleBooks(db, preferredVersion);
  } catch {
    libraryError = "The local Bible library could not be loaded. Check the Bible import before service use.";
  }

  const detections = service ? await query<DetectionRow>(
    `select sd.id::text,sd.scripture_reference,sd.confidence::text,sd.state,sd.bible_version,
            sd.detection_method,sd.detected_at::text,
            (
              select string_agg(bv.text, ' ' order by bv.verse)
              from bible_books bb
              join bible_verses bv
                on bv.version_id=bb.version_id and bv.book_code=bb.book_code
              where bb.version_id=sd.bible_version
                and lower(bb.canonical_name)=lower(sd.book)
                and bv.chapter=sd.chapter
                and (sd.verse_start is null or bv.verse between sd.verse_start and coalesce(sd.verse_end,sd.verse_start))
            ) as passage_text
     from scripture_detections sd
     where sd.service_id=$1::uuid
       and sd.state <> 'dismissed'
     order by sd.source_observed_at desc,sd.source_ordinal desc,sd.detected_at desc,sd.id desc
     limit 40`,
    [service.id]
  ) : { rows: [] as DetectionRow[] };

  return {
    service,
    capabilities,
    navigationCapabilities,
    versions,
    books,
    detections: detections.rows,
    libraryError
  };
}

export default async function ScripturePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.forcePasswordChange) redirect("/change-password");

  const data = await scripturePageData(session.user.id);
  const service = data.service;
  const capabilities = data.capabilities;
  const detections = data.detections.map((row) => ({
    id: row.id,
    reference: row.scripture_reference,
    confidence: Number(row.confidence),
    state: row.state,
    bibleVersion: row.bible_version,
    detectionMethod: row.detection_method,
    passageText: row.passage_text,
    detectedAt: row.detected_at
  }));

  return (
    <main className="min-h-screen bg-[#070a0f] text-white">
      {service ? <RealtimeRefresh serviceId={service.id} /> : null}
      <StudioMobileNav capabilities={data.navigationCapabilities} />
      <div className="min-h-screen md:grid md:grid-cols-[86px_1fr] xl:grid-cols-[240px_1fr]">
        <StudioSidebar capabilities={data.navigationCapabilities} />
        <section className="min-w-0 pb-20 md:pb-0">
          <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between gap-3 border-b border-white/[.07] bg-[#080b10]/92 px-4 backdrop-blur-xl lg:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#d7a94a]/25 bg-[#d7a94a]/10 text-[#efc86f]">
                <BookOpen size={19} />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-sm font-black sm:text-base">Scripture</h1>
                <p className="truncate text-[11px] text-white/35">Local Bible · search · browse · Preview → Program</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/operator" className="hidden min-h-10 items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.025] px-3 text-xs font-bold text-white/50 transition hover:text-white sm:flex">
                <MonitorPlay size={15} /> Operator
              </Link>
              <LogoutButton />
            </div>
          </header>

          <ScriptureWorkspace
            service={service ? {
              id: service.id,
              title: service.title,
              status: service.status,
              activeBibleVersion: service.active_bible_version
            } : null}
            canControl={capabilities.canLiveControl}
            versions={data.versions}
            initialBooks={data.books}
            detections={detections}
            libraryError={data.libraryError}
          />
        </section>
      </div>
    </main>
  );
}
