"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  CopyPlus,
  Download,
  FileSearch,
  FileUp,
  RotateCcw,
  ShieldCheck,
  TriangleAlert
} from "lucide-react";

type ImportKind = "song_text" | "song_csv" | "service_rundown_json" | "media_url_manifest";
type DuplicatePolicy = "skip" | "import_copy";
type CandidateStatus = "valid" | "warning" | "error" | "duplicate";

type EditableService = {
  id: string;
  title: string;
  status: string;
  revision: string;
};

type PreviewCandidate = {
  index: number;
  status: CandidateStatus;
  targetType: string;
  title: string;
  candidateFingerprint: string;
  warnings: string[];
  errors: string[];
};

type ImportPreview = {
  kind: ImportKind;
  sourceName: string;
  sourceFingerprint: string;
  previousBatchId: string | null;
  candidates: PreviewCandidate[];
  summary: { total: number; valid: number; warnings: number; errors: number; duplicates: number };
};

type CommitResult = {
  batchId: string;
  created: number;
  skipped: number;
  sourceFingerprint: string;
  duplicatePolicy: DuplicatePolicy;
};

type Props = {
  organizationId: string;
  organizationName: string;
  editableServices: EditableService[];
};

const kinds: Array<{ value: ImportKind; label: string; detail: string; accept: string }> = [
  { value: "song_text", label: "Song text", detail: "One song with [Verse], [Chorus] sections", accept: ".txt,text/plain" },
  { value: "song_csv", label: "Song CSV", detail: "Columns: title, section, text", accept: ".csv,text/csv" },
  { value: "service_rundown_json", label: "Service rundown JSON", detail: "Portable service items for an editable plan", accept: ".json,application/json" },
  { value: "media_url_manifest", label: "Media URL manifest", detail: "HTTPS images, video and audio references", accept: ".json,application/json" }
];

const statusClass: Record<CandidateStatus, string> = {
  valid: "border-emerald-400/20 bg-emerald-400/[.07] text-emerald-200",
  warning: "border-amber-300/20 bg-amber-300/[.07] text-amber-100",
  error: "border-red-300/20 bg-red-300/[.07] text-red-100",
  duplicate: "border-sky-300/20 bg-sky-300/[.07] text-sky-100"
};

function defaultFilename(kind: ImportKind) {
  if (kind === "song_text") return "song.txt";
  if (kind === "song_csv") return "songs.csv";
  if (kind === "service_rundown_json") return "service-rundown.json";
  return "media-manifest.json";
}

export function ImportWizard({ organizationId, organizationName, editableServices }: Props) {
  const [kind, setKind] = useState<ImportKind>("song_text");
  const [filename, setFilename] = useState(defaultFilename("song_text"));
  const [content, setContent] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewAccepted, setPreviewAccepted] = useState(false);
  const [duplicatePolicy, setDuplicatePolicy] = useState<DuplicatePolicy>("skip");
  const [targetServiceId, setTargetServiceId] = useState(editableServices[0]?.id ?? "");
  const [busy, setBusy] = useState<"preview" | "commit" | "undo" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);

  const selectedService = editableServices.find((service) => service.id === targetServiceId) ?? null;
  const needsService = kind === "service_rundown_json";
  const canCommit = Boolean(
    preview
    && previewAccepted
    && preview.summary.errors === 0
    && content.trim()
    && (!needsService || selectedService)
    && !busy
  );

  function invalidatePreview(nextMessage: string | null = null) {
    setPreview(null);
    setPreviewAccepted(false);
    setCommitResult(null);
    setMessage(nextMessage);
  }

  function changeKind(next: ImportKind) {
    setKind(next);
    setFilename(defaultFilename(next));
    setContent("");
    invalidatePreview();
  }

  async function loadFile(file: File | null) {
    if (!file) return;
    setFilename(file.name);
    setContent(await file.text());
    invalidatePreview(`${file.name} loaded. Preview it before anything is imported.`);
  }

  function sourcePayload() {
    return { kind, filename: filename.trim() || defaultFilename(kind), content };
  }

  async function previewImport() {
    if (!content.trim()) {
      setMessage("Paste content or choose a portable file first.");
      return;
    }
    setBusy("preview");
    setMessage(null);
    setPreviewAccepted(false);
    setCommitResult(null);
    try {
      const response = await fetch("/api/v1/imports/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, source: sourcePayload() })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) throw new Error(payload?.error ?? "Import preview failed");
      setPreview(payload.preview as ImportPreview);
      setMessage("Preview ready. Nothing has changed yet.");
    } catch (error) {
      setPreview(null);
      setMessage(error instanceof Error ? error.message : "Import preview failed");
    } finally {
      setBusy(null);
    }
  }

  async function commitImport() {
    if (!canCommit || !preview) return;
    setBusy("commit");
    setMessage(null);
    try {
      const body: Record<string, unknown> = {
        organizationId,
        source: sourcePayload()
      };
      if (preview.previousBatchId) body.duplicatePolicy = duplicatePolicy;
      if (needsService && selectedService) {
        body.targetServiceId = selectedService.id;
        body.expectedRevision = selectedService.revision;
      }
      const response = await fetch("/api/v1/imports/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) throw new Error(payload?.error ?? "Import commit failed");
      const result = payload.result as CommitResult;
      setCommitResult(result);
      setPreviewAccepted(false);
      setMessage(`${result.created} created · ${result.skipped} skipped. Batch ${result.batchId.slice(0, 8)} is available for safe undo.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import commit failed");
    } finally {
      setBusy(null);
    }
  }

  async function undoImport() {
    if (!commitResult?.batchId || busy) return;
    setBusy("undo");
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/imports/${commitResult.batchId}/undo`, { method: "POST" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        const detail = payload?.error ?? "Undo could not be completed";
        throw new Error(response.status === 409 ? `Nothing was removed. ${detail}` : detail);
      }
      setMessage("Import batch undone. Only untouched content from this batch was removed.");
      setCommitResult(null);
      setPreview(null);
      setPreviewAccepted(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Undo could not be completed");
    } finally {
      setBusy(null);
    }
  }

  const selectedKind = useMemo(() => kinds.find((item) => item.value === kind) ?? kinds[0], [kind]);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <section className="rounded-3xl border border-white/[.07] bg-[#0c1017]/88 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[.18em] text-[#d7a94a]">Migration wizard</div>
            <h1 className="mt-1 text-2xl font-black tracking-tight">Bring your existing church content</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-white/45">Preview first. Nothing changes until you review the candidates and explicitly commit them to {organizationName}.</p>
          </div>
          <Link href="/media" className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-white/[.09] px-4 text-sm font-bold text-white/60 transition hover:bg-white/[.05] hover:text-white"><ArrowLeft size={16}/>Songs & Media</Link>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {kinds.map((item) => (
            <button key={item.value} type="button" onClick={() => changeKind(item.value)} className={`min-h-20 cursor-pointer rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7a94a] ${kind === item.value ? "border-[#d7a94a]/35 bg-[#d7a94a]/[.09]" : "border-white/[.07] bg-white/[.02] hover:bg-white/[.04]"}`}>
              <div className="text-sm font-black text-white/80">{item.label}</div>
              <div className="mt-1 text-xs leading-5 text-white/38">{item.detail}</div>
              <div className="mt-2 font-mono text-[10px] text-white/25">{item.value}</div>
            </button>
          ))}
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <label className="rounded-2xl border border-dashed border-white/[.12] bg-black/20 p-5">
            <span className="flex items-center gap-2 text-sm font-black text-white/75"><FileUp size={17} className="text-[#d7a94a]"/>Upload portable file</span>
            <span className="mt-1 block text-xs leading-5 text-white/35">{selectedKind.detail}</span>
            <input type="file" accept={selectedKind.accept} onChange={(event) => void loadFile(event.target.files?.[0] ?? null)} className="mt-4 block w-full cursor-pointer text-xs text-white/45 file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-xl file:border-0 file:bg-white/[.08] file:px-4 file:text-xs file:font-bold file:text-white/70" />
          </label>
          <label className="rounded-2xl border border-white/[.07] bg-black/20 p-5">
            <span className="text-sm font-black text-white/75">Or paste portable content</span>
            <input value={filename} onChange={(event) => { setFilename(event.target.value); invalidatePreview(); }} className="mt-3 min-h-11 w-full rounded-xl border border-white/[.08] bg-white/[.035] px-3 text-sm text-white outline-none focus:border-[#d7a94a]/50" aria-label="Source filename" />
            <textarea value={content} onChange={(event) => { setContent(event.target.value); invalidatePreview(); }} placeholder="Paste text, CSV or JSON here…" className="mt-2 min-h-40 w-full resize-y rounded-xl border border-white/[.08] bg-white/[.035] p-3 font-mono text-xs leading-5 text-white/70 outline-none placeholder:text-white/20 focus:border-[#d7a94a]/50" />
          </label>
        </div>

        {needsService ? (
          <div className="mt-4 rounded-2xl border border-sky-300/15 bg-sky-300/[.04] p-4">
            <label className="text-xs font-bold text-sky-100">Editable target service</label>
            <select value={targetServiceId} onChange={(event) => { setTargetServiceId(event.target.value); invalidatePreview(); }} className="mt-2 min-h-11 w-full cursor-pointer rounded-xl border border-white/[.09] bg-[#101721] px-3 text-sm text-white outline-none focus:border-sky-300/45">
              {editableServices.length === 0 ? <option value="">No draft/ready service available</option> : editableServices.map((service) => <option key={service.id} value={service.id}>{service.title} · {service.status}</option>)}
            </select>
            {editableServices.length === 0 ? <p className="mt-2 text-xs text-white/40">Create or open an editable plan first. Live services stay locked.</p> : null}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" onClick={previewImport} disabled={!content.trim() || Boolean(busy)} className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-xl bg-[#d7a94a] px-5 text-sm font-black text-[#17120a] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"><FileSearch size={17}/>{busy === "preview" ? "Checking…" : "Preview import"}</button>
          <div className="flex items-center gap-2 text-xs text-white/35"><ShieldCheck size={15} className="text-emerald-300"/>Preview is read-only and tenant-scoped.</div>
        </div>

        {message ? <div role="status" aria-live="polite" className="mt-4 rounded-xl border border-white/[.08] bg-white/[.025] px-4 py-3 text-sm text-white/60">{message}</div> : null}

        {preview ? (
          <section className="mt-6 border-t border-white/[.07] pt-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-black uppercase tracking-[.18em] text-[#d7a94a]">Preview results</div>
                <div className="mt-1 text-sm text-white/45">{preview.sourceName} · fingerprint {preview.sourceFingerprint.slice(0, 12)}</div>
              </div>
              <div className="flex flex-wrap gap-2 text-[11px] font-bold">
                {(["valid", "warning", "error", "duplicate"] as CandidateStatus[]).map((status) => {
                  const value = status === "valid" ? preview.summary.valid : status === "warning" ? preview.summary.warnings : status === "error" ? preview.summary.errors : preview.summary.duplicates;
                  return <span key={status} className={`rounded-full border px-2.5 py-1 ${statusClass[status]}`}>{status} · {value}</span>;
                })}
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {preview.candidates.map((candidate) => (
                <article key={`${candidate.index}-${candidate.candidateFingerprint}`} className="rounded-2xl border border-white/[.07] bg-black/20 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0"><div className="truncate text-sm font-black text-white/78">{candidate.title}</div><div className="mt-1 text-xs text-white/35">{candidate.targetType}</div></div>
                    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[.12em] ${statusClass[candidate.status]}`}>{candidate.status}</span>
                  </div>
                  {candidate.errors.length ? <div className="mt-2 text-xs leading-5 text-red-200/80">{candidate.errors.join(" · ")}</div> : null}
                  {candidate.warnings.length ? <div className="mt-2 text-xs leading-5 text-amber-100/70">{candidate.warnings.join(" · ")}</div> : null}
                </article>
              ))}
            </div>

            {preview.previousBatchId ? (
              <div className="mt-4 rounded-2xl border border-sky-300/15 bg-sky-300/[.04] p-4">
                <div className="text-sm font-black text-sky-100">This source was imported before</div>
                <p className="mt-1 text-xs leading-5 text-white/40">Choose deliberately. Skip keeps existing content; Import copy creates another church-owned copy.</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <button type="button" onClick={() => setDuplicatePolicy("skip")} className={`min-h-11 cursor-pointer rounded-xl border px-4 text-sm font-bold ${duplicatePolicy === "skip" ? "border-sky-300/30 bg-sky-300/[.1] text-sky-100" : "border-white/[.08] text-white/45"}`}>skip · Keep existing</button>
                  <button type="button" onClick={() => setDuplicatePolicy("import_copy")} className={`min-h-11 cursor-pointer rounded-xl border px-4 text-sm font-bold ${duplicatePolicy === "import_copy" ? "border-sky-300/30 bg-sky-300/[.1] text-sky-100" : "border-white/[.08] text-white/45"}`}><span className="inline-flex items-center gap-2"><CopyPlus size={14}/>import_copy · Import copy</span></button>
                </div>
              </div>
            ) : null}

            <label className={`mt-4 flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 ${preview.summary.errors ? "border-red-300/15 bg-red-300/[.04] opacity-60" : "border-emerald-300/15 bg-emerald-300/[.04]"}`}>
              <input type="checkbox" checked={previewAccepted} disabled={preview.summary.errors > 0} onChange={(event) => setPreviewAccepted(event.target.checked)} className="h-4 w-4 accent-[#d7a94a]" />
              <span className="text-sm text-white/65">I reviewed this preview and want to commit the valid candidates.</span>
            </label>
            <button type="button" onClick={commitImport} disabled={!canCommit} className="mt-3 inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-xl bg-emerald-300 px-5 text-sm font-black text-emerald-950 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-35"><CheckCircle2 size={17}/>{busy === "commit" ? "Importing…" : "Commit import"}</button>
          </section>
        ) : null}

        {commitResult ? (
          <section className="mt-6 rounded-2xl border border-emerald-300/20 bg-emerald-300/[.05] p-5">
            <div className="text-sm font-black text-emerald-100">Import complete</div>
            <div className="mt-2 text-sm text-white/55">{commitResult.created} created · {commitResult.skipped} skipped</div>
            <div className="mt-1 font-mono text-[11px] text-white/30">batchId · {commitResult.batchId}</div>
            <button type="button" onClick={undoImport} disabled={Boolean(busy)} className="mt-4 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-white/[.1] px-4 text-sm font-bold text-white/65 transition hover:bg-white/[.05] disabled:cursor-not-allowed disabled:opacity-40"><RotateCcw size={15}/>{busy === "undo" ? "Checking safe undo…" : "Undo this import"}</button>
          </section>
        ) : null}
      </section>

      <aside className="space-y-4">
        <section className="rounded-3xl border border-amber-300/15 bg-amber-300/[.04] p-5">
          <div className="flex items-center gap-2 text-sm font-black text-amber-100"><TriangleAlert size={16}/>Truthful switching boundary</div>
          <p className="mt-3 text-xs leading-6 text-white/45">iPresenterPlux does not reverse-engineer proprietary EasyWorship, ProPresenter, vMix or OBS project files. Use a documented portable export from the source application—text, CSV, JSON, or an HTTPS media manifest—then preview it here before committing anything.</p>
        </section>

        <section className="rounded-3xl border border-white/[.07] bg-[#0c1017]/88 p-5">
          <div className="text-[11px] font-black uppercase tracking-[.16em] text-white/35">Keep your content portable</div>
          <h2 className="mt-1 text-lg font-black">Export church-owned data anytime</h2>
          <p className="mt-2 text-xs leading-5 text-white/38">Exports contain presentation/library content only—never activation tokens, credentials, private signing material or provider secrets.</p>
          <div className="mt-4 grid gap-2">
            <a href={`/api/v1/exports/library?organizationId=${encodeURIComponent(organizationId)}&format=json`} className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/[.09] text-sm font-bold text-white/60 hover:bg-white/[.05]"><Download size={15}/>Library JSON</a>
            <a href={`/api/v1/exports/library?organizationId=${encodeURIComponent(organizationId)}&format=csv`} className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/[.09] text-sm font-bold text-white/60 hover:bg-white/[.05]"><Download size={15}/>Songs CSV</a>
            {selectedService ? <>
              <a href={`/api/v1/exports/services/${selectedService.id}?format=json`} className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/[.09] text-sm font-bold text-white/60 hover:bg-white/[.05]"><Download size={15}/>Selected service JSON</a>
              <a href={`/api/v1/exports/services/${selectedService.id}?format=csv`} className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/[.09] text-sm font-bold text-white/60 hover:bg-white/[.05]"><Download size={15}/>Selected service CSV</a>
            </> : null}
          </div>
        </section>
      </aside>
    </div>
  );
}
