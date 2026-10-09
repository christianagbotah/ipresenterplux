import { Radio } from "lucide-react";
import { AudienceRealtimeRefresh } from "@/components/audience/AudienceRealtimeRefresh";
import { LiveAudience } from "@/components/audience/LiveAudience";
import { db } from "@/lib/db";
import { loadPublicAudienceService } from "@/lib/public-audience-service";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AudienceState = "invalid" | "waiting" | "ended" | "unavailable";

function AudienceStateCard({ state, title }: { state: AudienceState; title?: string }) {
  const content = state === "invalid"
    ? { heading: "This live link is invalid", detail: "Open the QR code or service link shared by your church." }
    : state === "unavailable"
      ? { heading: "This service link is unavailable", detail: "The service may have been removed. Ask your church for a current audience link." }
      : state === "ended"
        ? { heading: "This service has ended", detail: title ? `${title} is no longer broadcasting.` : "This church service is no longer broadcasting." }
        : { heading: `${title ?? "This service"} is not live yet`, detail: "Keep this page open. iPresenterPlux will connect automatically when the service goes live." };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#07090d] px-4 text-white">
      <div className="w-full max-w-lg rounded-[24px] border border-white/[.08] bg-[#0d121a] p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[.07] bg-white/[.035] text-white/30"><Radio size={22} /></div>
        <h1 className="mt-5 text-2xl font-black tracking-tight">{content.heading}</h1>
        <p className="mt-2 text-sm leading-6 text-white/38">{content.detail}</p>
      </div>
    </main>
  );
}

export default async function LivePage({ searchParams }: { searchParams: Promise<{ service?: string }> }) {
  const { service: serviceId } = await searchParams;
  if (!serviceId || !UUID.test(serviceId)) return <AudienceStateCard state="invalid" />;

  const audience = await loadPublicAudienceService(db, serviceId);
  if (!audience) return <AudienceStateCard state="unavailable" />;

  if (audience.service.status === "ended" || audience.service.status === "archived") {
    return <AudienceStateCard state="ended" title={audience.service.title} />;
  }
  if (audience.service.status !== "live" || !("languages" in audience)) {
    return (
      <>
        <AudienceRealtimeRefresh serviceId={audience.service.id} />
        <AudienceStateCard state="waiting" title={audience.service.title} />
      </>
    );
  }

  const scripture = audience.scripture;
  const transcript = audience.transcript;
  return (
    <>
      <AudienceRealtimeRefresh serviceId={audience.service.id} />
      <LiveAudience
        serviceId={audience.service.id}
        serviceTitle={audience.service.title}
        scriptureReference={scripture?.reference ?? null}
        scriptureText={scripture?.passage_text ?? null}
        transcript={transcript?.text ?? null}
        transcriptLanguage={transcript?.source_language ?? null}
        translations={transcript?.translations ?? {}}
        speechSynthesis={transcript?.speech_synthesis ?? {}}
        languages={audience.languages}
      />
    </>
  );
}
