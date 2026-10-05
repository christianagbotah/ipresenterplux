"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock3, Languages, LoaderCircle, RefreshCw, TriangleAlert, Volume2 } from "lucide-react";

type TranslationJob = {
  id: string;
  service_title: string;
  source_text: string;
  source_language: string | null;
  target_language_code: string;
  language_name: string;
  channel_mode: string;
  status: "pending" | "processing" | "succeeded" | "failed";
  translated_text: string | null;
  provider: string | null;
  attempts: number;
  source_observed_at: string;
  error_code: string | null;
};

type JobStatus = TranslationJob["status"];

type Props = {
  jobs: TranslationJob[];
  serviceTitle: string | null;
  counts: Record<JobStatus, number>;
  status: JobStatus;
  page: number;
  totalPages: number;
};

const tabs = ["pending", "processing", "succeeded", "failed"] as const;

function statusIcon(status: TranslationJob["status"]) {
  if (status === "succeeded") return CheckCircle2;
  if (status === "failed") return TriangleAlert;
  if (status === "processing") return LoaderCircle;
  return Clock3;
}

export function TranslationDesk({ jobs, serviceTitle, counts, status, page, totalPages }: Props) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function complete(job: TranslationJob) {
    const translatedText = (drafts[job.id] ?? job.translated_text ?? "").trim();
    if (!translatedText) {
      setError("Enter the translated caption before completing this job.");
      return;
    }
    setSaving(job.id);
    setError(null);
    try {
      const response = await fetch(`/api/v1/translations/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ translatedText, provider: "manual" })
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "Translation could not be saved");
      setDrafts((current) => {
        const next = { ...current };
        delete next[job.id];
        return next;
      });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Translation could not be saved");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {tabs.map((itemStatus) => {
          const Icon = statusIcon(itemStatus);
          const active = itemStatus === status;
          return (
            <button
              key={itemStatus}
              type="button"
              onClick={() => router.push(`/translations?status=${itemStatus}&page=1`)}
              className={"rounded-2xl border p-4 text-left transition " + (active ? "border-[#d7a94a]/30 bg-[#d7a94a]/10" : "border-white/[.07] bg-white/[.025] hover:bg-white/[.04]")}
            >
              <div className="flex items-center justify-between">
                <Icon size={16} className={itemStatus === "failed" ? "text-red-300" : itemStatus === "succeeded" ? "text-emerald-300" : "text-[#e5b85c]"} />
                <span className="text-2xl font-black">{counts[itemStatus] ?? 0}</span>
              </div>
              <div className="mt-3 text-[10px] font-bold uppercase tracking-[.15em] text-white/35">{itemStatus}</div>
            </button>
          );
        })}
      </section>

      {error ? <div className="rounded-xl border border-red-400/20 bg-red-400/[.08] px-4 py-3 text-sm text-red-200">{error}</div> : null}

      <section className="ip-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[.07] px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold"><Languages size={16} /> Translation queue</div>
            <div className="mt-1 text-[11px] text-white/35">{serviceTitle ?? "Authorized organization"} · newest live speech first</div>
          </div>
          <button type="button" onClick={() => router.refresh()} className="flex items-center gap-2 rounded-xl border border-white/[.07] bg-white/[.025] px-3 py-2 text-xs text-white/55 hover:text-white">
            <RefreshCw size={13} /> Refresh
          </button>
        </div>

        <div className="divide-y divide-white/[.055]">
          {jobs.length ? jobs.map((job) => {
            const value = drafts[job.id] ?? job.translated_text ?? "";
            const processing = job.status === "processing";
            return (
              <article key={job.id} className="grid gap-4 p-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-[#d7a94a]/20 bg-[#d7a94a]/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.12em] text-[#efc76e]">{job.language_name}</span>
                    <span className="text-[10px] uppercase tracking-[.12em] text-white/28">{job.target_language_code}</span>
                    {job.channel_mode === "translation_audio" ? <span className="flex items-center gap-1 text-[10px] text-white/30"><Volume2 size={11} /> text first · audio later</span> : null}
                  </div>
                  <p className="mt-4 text-sm leading-6 text-white/72">{job.source_text}</p>
                  <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-white/28">
                    <span>Source {job.source_language ?? "auto"}</span>
                    <span>{new Date(job.source_observed_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                    <span>Attempts {job.attempts}</span>
                    {job.provider ? <span>Provider {job.provider}</span> : null}
                    {job.error_code ? <span className="text-amber-200/70">{job.error_code}</span> : null}
                  </div>
                </div>

                <div>
                  <textarea
                    value={value}
                    onChange={(event) => setDrafts((current) => ({ ...current, [job.id]: event.target.value }))}
                    rows={4}
                    placeholder={`Translate into ${job.language_name}…`}
                    className="w-full resize-y rounded-xl border border-white/[.08] bg-black/25 px-3 py-3 text-sm leading-6 text-white outline-none placeholder:text-white/20 focus:border-[#d7a94a]/35"
                  />
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[10px] text-white/28">
                      {processing ? "Machine lease active · saving here safely takes over this job." : job.status === "succeeded" ? "Edit and save to correct the published translation." : "Completing publishes this caption to the matching audience channel."}
                    </div>
                    <button
                      type="button"
                      disabled={saving === job.id || !value.trim()}
                      onClick={() => void complete(job)}
                      className="rounded-xl bg-[#d7a94a] px-4 py-2 text-xs font-extrabold text-[#171109] disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      {saving === job.id ? "Saving…" : job.status === "succeeded" ? "Save correction" : "Publish translation"}
                    </button>
                  </div>
                </div>
              </article>
            );
          }) : (
            <div className="px-6 py-16 text-center">
              <Languages size={22} className="mx-auto text-white/20" />
              <div className="mt-3 text-sm font-semibold text-white/50">No {status} translation jobs</div>
              <div className="mt-1 text-xs text-white/28">New sermon transcript segments will appear here automatically.</div>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-white/[.07] px-5 py-4">
          <div className="text-[11px] text-white/35">Page {page} of {totalPages} · {counts[status]} {status} jobs</div>
          <div className="flex gap-2">
            <button type="button" disabled={page <= 1} onClick={() => router.push(`/translations?status=${status}&page=${page - 1}`)} className="rounded-lg border border-white/[.07] px-3 py-2 text-xs text-white/55 disabled:opacity-30">Previous</button>
            <button type="button" disabled={page >= totalPages} onClick={() => router.push(`/translations?status=${status}&page=${page + 1}`)} className="rounded-lg border border-white/[.07] px-3 py-2 text-xs text-white/55 disabled:opacity-30">Next</button>
          </div>
        </div>
      </section>
    </div>
  );
}
