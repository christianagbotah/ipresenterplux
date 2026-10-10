"use client";

import { useState } from "react";
import { BookOpen, Captions, Check, Copy, ExternalLink, Languages, RadioTower, Users } from "lucide-react";

type AudienceService = { id: string; title: string; status: string };
type AudienceLanguage = { name: string; mode: string; listeners: number };

type Props = {
  service: AudienceService | null;
  audienceUrl: string | null;
  qrSvg: string | null;
  languages: AudienceLanguage[];
  scripture: { reference: string; text: string | null } | null;
  caption: string | null;
  streamStatus: string;
};

function serviceStatusLabel(service: AudienceService | null) {
  if (!service) return "No service selected";
  if (service.status === "live") return "Live now";
  if (service.status === "ready") return "Ready to share";
  if (service.status === "ended") return "Service ended";
  return "Service preparing";
}

function streamReadiness(status: string) {
  if (status === "live") return "Program transport live";
  if (status === "starting") return "Program transport starting";
  if (status === "stopping") return "Program transport stopping";
  if (status === "error") return "Program transport needs attention";
  return "Program transport idle";
}

export function AudienceStudio({ service, audienceUrl, qrSvg, languages, scripture, caption, streamStatus }: Props) {
  const [copied, setCopied] = useState(false);

  async function copyAudienceLink() {
    if (!audienceUrl) return;
    try {
      await navigator.clipboard.writeText(audienceUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  if (!service || !audienceUrl || !qrSvg) {
    return (
      <div className="mx-auto max-w-5xl p-4 lg:p-8">
        <section className="rounded-3xl border border-white/[.08] bg-[#0b0f16] p-8 text-center">
          <Users className="mx-auto text-white/35" size={34} />
          <h2 className="mt-4 text-2xl font-black">No service selected</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-white/55">Create or prepare a service first. Audience links are scoped to one service so guests never land in another church session by accident.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-4 p-4 lg:p-6">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
        <div className="rounded-3xl border border-white/[.08] bg-[#0b0f16] p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[.16em] text-[#e5b95e]">Audience access</div>
              <h2 className="mt-2 text-2xl font-black tracking-tight">{service.title}</h2>
              <p className="mt-1 text-sm text-white/55">{serviceStatusLabel(service)} · {streamReadiness(streamStatus)}</p>
            </div>
            <span className="rounded-full border border-white/[.09] bg-white/[.035] px-3 py-1.5 text-xs font-black capitalize text-white/60">{service.status}</span>
          </div>

          <div className="mt-5 rounded-2xl border border-white/[.07] bg-black/20 p-4">
            <div className="text-[11px] font-black uppercase tracking-[.14em] text-white/45">Canonical service link</div>
            <div className="mt-2 break-all text-sm text-white/80">{audienceUrl}</div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={copyAudienceLink} className="ip-focus-gold inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-[#d7a94a] px-4 text-sm font-black text-[#17120a] transition hover:bg-[#e7bd63]">
                {copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copied" : "Copy audience link"}
              </button>
              <a href={audienceUrl} target="_blank" rel="noreferrer" className="ip-focus-gold inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-white/[.09] bg-white/[.035] px-4 text-sm font-bold text-white/75 transition hover:bg-white/[.06] hover:text-white">
                <ExternalLink size={15} /> Open audience view
              </a>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-white/[.08] bg-[#0b0f16] p-5 text-center">
          <div className="text-[11px] font-black uppercase tracking-[.14em] text-white/45">Scan to join</div>
          <div className="mx-auto mt-4 w-full max-w-[250px] overflow-hidden rounded-2xl bg-white p-3 [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <p className="mt-3 text-xs leading-5 text-white/55">Guests can scan this on iPhone, iPad, Android or any camera app that opens web links.</p>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-white/[.08] bg-[#0b0f16] p-4"><RadioTower size={17} className="text-[#e5b95e]" /><div className="mt-3 text-[11px] font-black uppercase tracking-[.12em] text-white/45">Stream readiness</div><div className="mt-1 text-sm font-bold text-white/80">{streamReadiness(streamStatus)}</div></div>
        <div className="rounded-2xl border border-white/[.08] bg-[#0b0f16] p-4"><Languages size={17} className="text-[#e5b95e]" /><div className="mt-3 text-[11px] font-black uppercase tracking-[.12em] text-white/45">Languages</div><div className="mt-1 text-sm font-bold text-white/80">{languages.length ? `${languages.length} available` : "Original only"}</div><div className="mt-1 text-[11px] text-white/55">{languages.slice(0, 3).map((item) => item.name).join(" · ") || "No translated channels enabled"}</div></div>
        <div className="rounded-2xl border border-white/[.08] bg-[#0b0f16] p-4"><BookOpen size={17} className="text-[#e5b95e]" /><div className="mt-3 text-[11px] font-black uppercase tracking-[.12em] text-white/45">Scripture</div><div className="mt-1 text-sm font-bold text-white/80">{scripture?.reference ?? "No Scripture on Program"}</div><div className="mt-1 line-clamp-2 text-[11px] leading-5 text-white/55">{scripture?.text ?? "Program Scripture will appear here when live."}</div></div>
        <div className="rounded-2xl border border-white/[.08] bg-[#0b0f16] p-4"><Captions size={17} className="text-[#e5b95e]" /><div className="mt-3 text-[11px] font-black uppercase tracking-[.12em] text-white/45">Caption</div><div className="mt-1 line-clamp-3 text-sm leading-5 text-white/75">{caption ?? "Waiting for live transcript"}</div></div>
      </section>

      <section className="overflow-hidden rounded-3xl border border-white/[.08] bg-[#0b0f16]">
        <div className="border-b border-white/[.06] px-5 py-4"><h2 className="text-sm font-black">Audience preview</h2><p className="mt-1 text-xs text-white/55">This is the same public service URL guests receive.</p></div>
        <iframe title="Audience preview" src={audienceUrl} className="h-[620px] w-full border-0 bg-[#07090d]" />
      </section>
    </div>
  );
}
