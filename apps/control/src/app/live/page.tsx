import { Radio } from "lucide-react";
import { AutoRefresh } from "@/components/AutoRefresh";
import { LiveAudience } from "@/components/audience/LiveAudience";
import { AudienceRealtimeRefresh } from "@/components/audience/AudienceRealtimeRefresh";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

type ServiceRow = {
  id: string;
  organization_id: string;
  title: string;
};

type ScriptureRow = {
  scripture_reference: string;
  source_text: string | null;
  passage_text: string | null;
};

type LanguageRow = {
  id: string;
  language_code: string;
  language_name: string;
  channel_mode: string;
  listener_count: number;
};

function WaitingCard({ needsLink = false }: { needsLink?: boolean }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#07090d] px-4 text-white">
      <div className="w-full max-w-lg rounded-[24px] border border-white/[.08] bg-[#0d121a] p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[.07] bg-white/[.035] text-white/30">
          <Radio size={22} />
        </div>
        <h1 className="mt-5 text-2xl font-black tracking-tight">
          {needsLink ? "Open your church live link" : "The service is not live yet"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-white/38">
          {needsLink
            ? "Use the QR code or live-service link shared by your church. Each link is scoped to one service."
            : "Keep this page open. iPresenterPlux will connect you when this service goes live."}
        </p>
        {!needsLink && <AutoRefresh intervalMs={5000} />}
      </div>
    </main>
  );
}

export default async function LivePage({
  searchParams
}: {
  searchParams: Promise<{ service?: string }>;
}) {
  const { service: serviceId } = await searchParams;

  if (!serviceId || !/^[0-9a-f-]{36}$/i.test(serviceId)) {
    return <WaitingCard needsLink />;
  }

  const services = await query<ServiceRow>(
    `select id,organization_id::text,title
     from services
     where id=$1 and status='live'
     limit 1`,
    [serviceId]
  );

  const service = services.rows[0];
  if (!service) return <WaitingCard />;

  const [scriptures, languageRows] = await Promise.all([
    query<ScriptureRow>(
      `select sd.scripture_reference,sd.source_text,
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
       where sd.service_id=$1 and sd.state='live'
       order by sd.detected_at desc
       limit 1`,
      [service.id]
    ),
    query<LanguageRow>(
      `select id,language_code,language_name,channel_mode,listener_count
       from language_channels
       where organization_id=$1 and enabled=true
       order by case channel_mode
         when 'original' then 0
         when 'captions' then 1
         when 'translation_audio' then 2
         else 3
       end, language_name`,
      [service.organization_id]
    )
  ]);

  const scripture = scriptures.rows[0];

  return (
    <>
      <AudienceRealtimeRefresh serviceId={service.id} />
      <LiveAudience
        serviceTitle={service.title}
        scriptureReference={scripture?.scripture_reference ?? null}
        scriptureText={scripture?.passage_text ?? null}
        transcript={scripture?.source_text ?? null}
        languages={languageRows.rows.map((row) => ({
          id: row.id,
          code: row.language_code,
          name: row.language_name,
          mode: row.channel_mode,
          listeners: row.listener_count
        }))}
      />
    </>
  );
}
