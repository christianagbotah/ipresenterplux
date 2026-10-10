"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  BookOpen,
  CheckCircle2,
  Eye,
  Loader2,
  Radio,
  Search,
  Sparkles,
  Square,
  WifiOff
} from "lucide-react";

type Service = {
  id: string;
  title: string;
  status: string;
  activeBibleVersion: string;
};

type BibleVersion = { id: string; name: string; abbreviation: string; languageCode: string };
type BibleBook = { bookCode: string; canonicalName: string; bookOrder: number; testament: "OT" | "NT"; chapterCount: number };
type BibleVerse = { verse: number; text: string };
type Detection = {
  id: string;
  reference: string;
  confidence: number;
  state: string;
  bibleVersion: string;
  detectionMethod: string;
  passageText: string | null;
  detectedAt: string;
};
type SelectedPassage = {
  reference: string;
  version: string;
  passageText: string;
  detectionId: string | null;
  state: string | null;
};

type LibraryPayload = {
  ok?: boolean;
  error?: string;
  versions?: BibleVersion[];
  books?: BibleBook[];
  verses?: BibleVerse[];
  passage?: {
    reference: string;
    version: string;
    passageText: string;
  };
};

type MutationPayload = {
  ok?: boolean;
  error?: string;
  edgeCommandsQueued?: number;
  scripture?: {
    id: string;
    reference?: string;
    scripture_reference?: string;
    state: string;
    passageText?: string;
    reused?: boolean;
  };
};

function stateTone(state: string) {
  if (state === "live") return "border-red-400/25 bg-red-400/10 text-red-100";
  if (state === "preview") return "border-amber-400/25 bg-amber-400/10 text-amber-100";
  if (state === "detected") return "border-emerald-400/20 bg-emerald-400/[.08] text-emerald-100";
  return "border-white/[.08] bg-white/[.03] text-white/60";
}

function methodLabel(method: string) {
  if (method === "manual") return "Manual";
  if (method === "quote") return "AI quote match";
  if (method === "context") return "AI context";
  if (method === "reference") return "AI reference";
  return "Detection";
}

export function ScriptureWorkspace({
  service,
  canControl,
  versions,
  initialBooks,
  detections,
  libraryError
}: {
  service: Service | null;
  canControl: boolean;
  versions: BibleVersion[];
  initialBooks: BibleBook[];
  detections: Detection[];
  libraryError: string | null;
}) {
  const router = useRouter();
  const initialVersion = versions.find((item) => item.id.toUpperCase() === service?.activeBibleVersion?.toUpperCase())?.id
    ?? versions[0]?.id
    ?? "";
  const [version, setVersion] = useState(initialVersion);
  const [books, setBooks] = useState(initialBooks);
  const [bookCode, setBookCode] = useState(initialBooks[0]?.bookCode ?? "");
  const [chapter, setChapter] = useState(1);
  const [verses, setVerses] = useState<BibleVerse[]>([]);
  const [fromVerse, setFromVerse] = useState<number | "">("");
  const [toVerse, setToVerse] = useState<number | "">("");
  const [reference, setReference] = useState("John 3:16");
  const [selected, setSelected] = useState<SelectedPassage | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const preview = detections.find((item) => item.state === "preview") ?? null;
  const program = detections.find((item) => item.state === "live") ?? null;
  const canOperate = Boolean(service && ["ready", "live"].includes(service.status) && canControl);
  const selectedBook = books.find((item) => item.bookCode === bookCode) ?? null;

  const rangeText = useMemo(() => {
    if (!fromVerse || !toVerse) return "";
    return verses.filter((item) => item.verse >= fromVerse && item.verse <= toVerse).map((item) => item.text).join(" ");
  }, [fromVerse, toVerse, verses]);

  async function loadJson(url: string): Promise<LibraryPayload> {
    const response = await fetch(url, { cache: "no-store" });
    const payload = await response.json().catch(() => null) as LibraryPayload | null;
    if (!response.ok) throw new Error(payload?.error ?? "Local Bible request failed");
    return payload ?? {};
  }

  async function onVersionChange(nextVersion: string) {
    setVersion(nextVersion);
    setVerses([]);
    setFromVerse("");
    setToVerse("");
    setError(null);
    setBusy("books");
    try {
      const payload = await loadJson(`/api/v1/scriptures/library?version=${encodeURIComponent(nextVersion)}`);
      const nextBooks = payload.books ?? [];
      setBooks(nextBooks);
      setBookCode(nextBooks[0]?.bookCode ?? "");
      setChapter(1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Bible books could not be loaded");
    } finally {
      setBusy(null);
    }
  }

  async function findReference() {
    if (!version || reference.trim().length < 3) return;
    setBusy("reference");
    setError(null);
    setNotice(null);
    try {
      const payload = await loadJson(`/api/v1/scriptures/library?version=${encodeURIComponent(version)}&reference=${encodeURIComponent(reference.trim())}`);
      if (!payload.passage) throw new Error("Passage was not returned by the local Bible library");
      setSelected({
        reference: payload.passage.reference,
        version: payload.passage.version,
        passageText: payload.passage.passageText,
        detectionId: null,
        state: null
      });
      setNotice("Passage loaded from the local Bible. Add it to the service when you are ready to stage it.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Scripture reference could not be loaded");
    } finally {
      setBusy(null);
    }
  }

  async function loadChapter() {
    if (!version || !bookCode || !Number.isInteger(chapter) || chapter < 1) return;
    setBusy("chapter");
    setError(null);
    setNotice(null);
    try {
      const payload = await loadJson(`/api/v1/scriptures/library?version=${encodeURIComponent(version)}&book=${encodeURIComponent(bookCode)}&chapter=${chapter}`);
      const nextVerses = payload.verses ?? [];
      setVerses(nextVerses);
      const first = nextVerses[0]?.verse ?? "";
      setFromVerse(first);
      setToVerse(first);
      if (!nextVerses.length) setNotice("No verses were found for this chapter in the local Bible library.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Bible chapter could not be loaded");
    } finally {
      setBusy(null);
    }
  }

  function useBrowseRange() {
    if (!selectedBook || !fromVerse || !toVerse || fromVerse > toVerse || !rangeText) {
      setError("Choose a valid contiguous verse range first.");
      return;
    }
    const displayBook = selectedBook.canonicalName;
    const range = fromVerse === toVerse ? `${fromVerse}` : `${fromVerse}-${toVerse}`;
    setSelected({
      reference: `${displayBook} ${chapter}:${range}`,
      version,
      passageText: rangeText,
      detectionId: null,
      state: null
    });
    setError(null);
    setNotice("Range selected locally. Add it to the service to make Preview available.");
  }

  async function addToService() {
    if (!selected || !service || !canOperate) return;
    setBusy("manual");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/v1/scriptures/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId: service.id, reference: selected.reference, version: selected.version })
      });
      const payload = await response.json().catch(() => null) as MutationPayload | null;
      if (!response.ok || !payload?.scripture) throw new Error(payload?.error ?? "Passage could not be added to this service");
      setSelected((current) => current ? {
        ...current,
        reference: payload.scripture?.reference ?? payload.scripture?.scripture_reference ?? current.reference,
        passageText: payload.scripture?.passageText ?? current.passageText,
        detectionId: payload.scripture?.id ?? current.detectionId,
        state: payload.scripture?.state ?? "detected"
      } : current);
      setNotice(payload.scripture.reused ? "Existing detected selection reused. Preview remains explicit." : "Added to this service as Detected. Preview remains explicit.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Passage could not be added to this service");
    } finally {
      setBusy(null);
    }
  }

  async function changeState(id: string, state: "detected" | "preview" | "live", label: string) {
    if (!canOperate) return;
    if (state === "live" && selected?.state !== "preview") {
      setError("Preview the selected passage before taking it live.");
      return;
    }
    setBusy(state);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/v1/scriptures/${id}/state`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state })
      });
      const payload = await response.json().catch(() => null) as MutationPayload | null;
      if (!response.ok) throw new Error(payload?.error ?? "Scripture output state could not be updated");
      if (selected?.detectionId === id) setSelected((current) => current ? { ...current, state } : current);
      const queued = Number(payload?.edgeCommandsQueued ?? 0);
      setNotice(queued > 0
        ? `${label}. ${queued} Edge command${queued === 1 ? "" : "s"} queued; physical output confirmation remains separate.`
        : `${label} in the control plane. No active Edge device confirmed physical output.`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Scripture output state could not be updated");
    } finally {
      setBusy(null);
    }
  }

  function inspectDetection(item: Detection) {
    setSelected({
      reference: item.reference,
      version: item.bibleVersion,
      passageText: item.passageText ?? "Passage text is not available for this historical detection.",
      detectionId: item.id,
      state: item.state
    });
    setError(null);
    setNotice(`${item.reference} selected. No output state changed.`);
  }

  if (libraryError || !versions.length) {
    return (
      <div className="p-4 lg:p-6">
        <section className="mx-auto max-w-3xl rounded-3xl border border-amber-400/20 bg-amber-400/[.06] p-8 text-center">
          <WifiOff className="mx-auto text-amber-200" size={26} />
          <h2 className="mt-4 text-xl font-black">Bible library unavailable</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-white/60">{libraryError ?? "No locally enabled Bible version is installed. Import a licensed/local Bible before live service use."}</p>
          <Link href="/settings" className="mt-5 inline-flex min-h-10 items-center rounded-xl border border-white/[.09] px-4 text-sm font-bold text-white/70 transition hover:bg-white/[.05] ip-focus-gold">Open Settings</Link>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1800px] space-y-4 p-3 sm:p-4 lg:p-6">
      {!service ? (
        <section className="rounded-2xl border border-amber-400/20 bg-amber-400/[.06] p-4 text-sm leading-6 text-amber-100">
          <strong>No service is available.</strong> Bible browsing remains available, but Add to Service, Preview, Take Live and Clear Program are disabled. <Link href="/planner" className="font-bold underline underline-offset-4">Open the Service Planner</Link> to create or prepare a service.
        </section>
      ) : service.status === "ended" ? (
        <section className="rounded-2xl border border-amber-400/20 bg-amber-400/[.06] p-4 text-sm leading-6 text-amber-100">
          <strong>{service.title} has ended.</strong> Bible browsing remains available; open or prepare a ready service before controlling Preview or Program.
        </section>
      ) : !canControl ? (
        <section className="rounded-2xl border border-white/[.08] bg-white/[.03] p-4 text-sm leading-6 text-white/55">
          You can browse and inspect Scripture, but your role is view-only for live output controls.
        </section>
      ) : null}

      <section className="grid gap-4 2xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,.65fr)]">
        <div className="space-y-4">
          <section className="rounded-2xl border border-white/[.08] bg-[#0b0f16] p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-[#e5b95e]"><Search size={16} /><span className="text-[10px] font-black uppercase tracking-[.15em]">Fast lookup</span></div>
                <h2 className="mt-2 text-xl font-black">Find a Scripture reference</h2>
                <p className="mt-1 text-xs text-white/50">Searches the local Bible library only. Finding a passage never changes Preview or Program.</p>
              </div>
              <span className="rounded-full border border-white/[.08] bg-white/[.03] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.12em] text-white/50">{versions.length} local version{versions.length === 1 ? "" : "s"}</span>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-[170px_minmax(0,1fr)_auto]">
              <select value={version} onChange={(event) => void onVersionChange(event.target.value)} className="min-h-11 rounded-xl border border-white/[.09] bg-[#080b10] px-3 text-sm text-white outline-none focus:border-[#d7a94a]/60">
                {versions.map((item) => <option key={item.id} value={item.id}>{item.abbreviation} · {item.name}</option>)}
              </select>
              <input value={reference} onChange={(event) => setReference(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void findReference(); }} placeholder="John 3:16" className="min-h-11 rounded-xl border border-white/[.09] bg-black/20 px-3 text-sm text-white outline-none placeholder:text-white/40 focus:border-[#d7a94a]/60" />
              <button type="button" onClick={() => void findReference()} disabled={busy !== null} className="min-h-11 rounded-xl bg-[#d7a94a] px-4 text-sm font-black text-[#17120a] transition hover:brightness-110 ip-focus-gold disabled:opacity-40">{busy === "reference" ? "Finding…" : "Find Passage"}</button>
            </div>
          </section>

          <section className="rounded-2xl border border-white/[.08] bg-[#0b0f16] p-4 sm:p-5">
            <div className="flex items-center gap-2 text-white/60"><BookOpen size={16} /><h2 className="text-sm font-black">Browse Bible</h2></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <label className="space-y-1.5"><span className="text-[10px] font-bold uppercase tracking-[.12em] text-white/50">Version</span><select value={version} onChange={(event) => void onVersionChange(event.target.value)} className="min-h-10 w-full rounded-xl border border-white/[.08] bg-black/20 px-3 text-xs text-white">{versions.map((item) => <option key={item.id} value={item.id}>{item.abbreviation}</option>)}</select></label>
              <label className="space-y-1.5"><span className="text-[10px] font-bold uppercase tracking-[.12em] text-white/50">Book</span><select value={bookCode} onChange={(event) => { setBookCode(event.target.value); setVerses([]); setFromVerse(""); setToVerse(""); }} className="min-h-10 w-full rounded-xl border border-white/[.08] bg-black/20 px-3 text-xs text-white">{books.map((item) => <option key={item.bookCode} value={item.bookCode}>{item.canonicalName}</option>)}</select></label>
              <label className="space-y-1.5"><span className="text-[10px] font-bold uppercase tracking-[.12em] text-white/50">Chapter</span><input type="number" min={1} max={selectedBook?.chapterCount || 200} value={chapter} onChange={(event) => setChapter(Math.max(1, Number(event.target.value) || 1))} className="min-h-10 w-full rounded-xl border border-white/[.08] bg-black/20 px-3 text-xs text-white" /></label>
              <label className="space-y-1.5"><span className="text-[10px] font-bold uppercase tracking-[.12em] text-white/50">From verse</span><select value={fromVerse} onChange={(event) => { const value = Number(event.target.value); setFromVerse(value); if (toVerse && value > toVerse) setToVerse(value); }} disabled={!verses.length} className="min-h-10 w-full rounded-xl border border-white/[.08] bg-black/20 px-3 text-xs text-white disabled:opacity-35"><option value="">—</option>{verses.map((item) => <option key={item.verse} value={item.verse}>{item.verse}</option>)}</select></label>
              <label className="space-y-1.5"><span className="text-[10px] font-bold uppercase tracking-[.12em] text-white/50">To verse</span><select value={toVerse} onChange={(event) => setToVerse(Number(event.target.value))} disabled={!verses.length} className="min-h-10 w-full rounded-xl border border-white/[.08] bg-black/20 px-3 text-xs text-white disabled:opacity-35"><option value="">—</option>{verses.filter((item) => !fromVerse || item.verse >= fromVerse).map((item) => <option key={item.verse} value={item.verse}>{item.verse}</option>)}</select></label>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => void loadChapter()} disabled={!bookCode || busy !== null} className="min-h-10 rounded-xl border border-white/[.09] bg-white/[.035] px-4 text-xs font-bold text-white/65 transition hover:bg-white/[.06] ip-focus-gold disabled:opacity-35">{busy === "chapter" ? "Loading…" : "Load Chapter"}</button>
              <button type="button" onClick={useBrowseRange} disabled={!rangeText || busy !== null} className="min-h-10 rounded-xl border border-[#d7a94a]/25 bg-[#d7a94a]/[.07] px-4 text-xs font-bold text-[#efc86f] transition hover:bg-[#d7a94a]/[.12] ip-focus-gold disabled:opacity-35">Use Range</button>
            </div>
            {verses.length ? <div className="mt-4 max-h-64 space-y-2 overflow-y-auto rounded-xl border border-white/[.06] bg-black/20 p-3 ip-scrollbar-thin">{verses.map((item) => <p key={item.verse} className="text-xs leading-5 text-white/60"><strong className="mr-2 text-[#d7a94a]">{item.verse}</strong>{item.text}</p>)}</div> : null}
          </section>

          <section className="rounded-2xl border border-white/[.08] bg-[#0b0f16] p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div><div className="text-[10px] font-black uppercase tracking-[.14em] text-white/50">Selected passage</div><h2 className="mt-2 text-xl font-black">{selected?.reference ?? "Nothing selected"}</h2></div>
              {selected?.state ? <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[.12em] ${stateTone(selected.state)}`}>{selected.state}</span> : null}
            </div>
            <p className="mt-4 min-h-20 whitespace-pre-wrap text-sm leading-7 text-white/65">{selected?.passageText ?? "Find a reference or choose a chapter range. Your selection stays local until you explicitly add it to the service."}</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <button type="button" onClick={() => void addToService()} disabled={!selected || !canOperate || Boolean(selected.detectionId) || busy !== null} className="min-h-11 rounded-xl border border-emerald-400/20 bg-emerald-400/[.08] px-3 text-xs font-black text-emerald-100 transition hover:bg-emerald-400/[.13] ip-focus-gold disabled:opacity-35">{busy === "manual" ? "Adding…" : selected?.detectionId ? "Added to Service" : "Add to Service"}</button>
              <button type="button" onClick={() => selected?.detectionId && void changeState(selected.detectionId, "preview", "Preview prepared")} disabled={!selected?.detectionId || !canOperate || selected.state === "preview" || selected.state === "live" || busy !== null} className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/[.1] bg-white/[.04] px-3 text-xs font-black text-white/70 transition hover:bg-white/[.07] ip-focus-gold disabled:opacity-35"><Eye size={15} /> Preview</button>
              <button type="button" onClick={() => selected?.detectionId && void changeState(selected.detectionId, "live", "Program updated")} disabled={!selected?.detectionId || !canOperate || selected.state !== "preview" || busy !== null} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#d7a94a] px-3 text-xs font-black text-[#17120a] transition hover:brightness-110 ip-focus-gold disabled:opacity-35"><Radio size={15} /> Take Live</button>
            </div>
            <div className="mt-3 min-h-5 text-xs leading-5" aria-live="polite">{error ? <p role="alert" className="text-red-300">{error}</p> : notice ? <p className="text-white/60">{notice}</p> : busy ? <p className="flex items-center gap-2 text-white/50"><Loader2 size={13} className="animate-spin" /> Working…</p> : null}</div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="overflow-hidden rounded-2xl border border-amber-400/15 bg-[#0b0f16]">
              <div className="flex items-center justify-between border-b border-white/[.06] px-4 py-3"><span className="text-xs font-black uppercase tracking-[.13em] text-amber-200">Preview</span><Eye size={15} className="text-amber-200" /></div>
              <div className="min-h-40 p-4">{preview ? <><h3 className="text-lg font-black">{preview.reference}</h3><p className="mt-3 text-sm leading-6 text-white/55">{preview.passageText ?? "Passage text unavailable"}</p><p className="mt-3 text-[10px] uppercase tracking-[.12em] text-white/45">{preview.bibleVersion} · staged only</p></> : <p className="py-12 text-center text-sm text-white/40">Preview is clear</p>}</div>
            </div>
            <div className="overflow-hidden rounded-2xl border border-red-400/15 bg-[#0b0f16]">
              <div className="flex items-center justify-between border-b border-white/[.06] px-4 py-3"><span className="text-xs font-black uppercase tracking-[.13em] text-red-200">Program</span><Radio size={15} className={program ? "text-red-300" : "text-white/35"} /></div>
              <div className="min-h-40 p-4">{program ? <><h3 className="text-lg font-black">{program.reference}</h3><p className="mt-3 text-sm leading-6 text-white/60">{program.passageText ?? "Passage text unavailable"}</p><button type="button" onClick={() => void changeState(program.id, "detected", "Program cleared")} disabled={!canOperate || busy !== null} className="mt-4 flex min-h-10 items-center gap-2 rounded-xl border border-red-400/25 bg-red-400/[.07] px-3 text-xs font-black text-red-100 transition hover:bg-red-400/[.12] ip-focus-gold disabled:opacity-35"><Square size={14} /> Clear Program</button></> : <p className="py-12 text-center text-sm text-white/50">Program is clear</p>}</div>
            </div>
          </section>
        </div>

        <aside className="rounded-2xl border border-white/[.08] bg-[#0b0f16] p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3"><div><div className="flex items-center gap-2 text-[#e5b95e]"><Sparkles size={15} /><span className="text-[10px] font-black uppercase tracking-[.14em]">Service context</span></div><h2 className="mt-2 text-base font-black">Recent AI & manual detections</h2></div><span className="text-xs font-bold text-white/45">{detections.length}</span></div>
          <div className="mt-4 space-y-2 ip-scrollbar-thin max-h-[34rem] overflow-y-auto">
            {detections.length ? detections.map((item) => (
              <button key={item.id} type="button" onClick={() => inspectDetection(item)} className="ip-ai-arrive w-full rounded-xl border border-white/[.06] bg-white/[.02] p-3 text-left transition hover:bg-white/[.045] hover:border-white/[.12]">
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate text-sm font-black text-white/80">{item.reference}</div><div className="mt-1 text-[11px] text-white/50">{methodLabel(item.detectionMethod)} · {item.bibleVersion}</div></div><span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[.1em] ${stateTone(item.state)}`}>{item.state}</span></div>
                <p className="mt-2 line-clamp-3 text-xs leading-5 text-white/60">{item.passageText ?? "Passage text unavailable"}</p>
                <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-[.1em] text-white/50"><span>{Number.isFinite(item.confidence) ? `${Math.round(item.confidence)}% confidence` : "confidence n/a"}</span><span>{new Date(item.detectedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>
              </button>
            )) : <div className="rounded-xl border border-dashed border-white/[.08] p-6 text-center"><CheckCircle2 size={20} className="mx-auto text-white/35" /><p className="mt-3 text-xs leading-5 text-white/50">No service Scripture detections yet. You can still find and browse the local Bible above.</p></div>}
          </div>
        </aside>
      </section>
    </div>
  );
}
