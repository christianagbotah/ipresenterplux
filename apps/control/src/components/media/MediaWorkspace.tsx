"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CirclePlus, Film, ListPlus, Music2, Search, SquarePlay, Type, Video } from "lucide-react";

type PreviewEligibility = "eligible" | "native_only" | "unsupported" | "missing_source";

type LibraryItem = {
  id: string;
  organizationId: string;
  itemType: "song" | "slide" | "media";
  title: string;
  plannerInput: Record<string, unknown>;
  mediaSourceId: string | null;
  source: { id: string; name: string | null; type: string | null; status: string | null } | null;
  previewEligibility: PreviewEligibility;
  previewReason: string | null;
  createdAt: string;
  updatedAt: string;
};

type CurrentService = {
  id: string;
  title: string;
  status: string;
  revision: string;
  editable: boolean;
};

type MediaSource = {
  id: string;
  name: string;
  type: string;
  status: string;
  mediaKind: string | null;
};

type Props = {
  organizationId: string;
  organizationName: string;
  initialItems: LibraryItem[];
  currentService: CurrentService | null;
  mediaSources: MediaSource[];
  canEdit: boolean;
};

const inputClass = "min-h-11 w-full rounded-xl border border-white/[.08] bg-white/[.035] px-3 text-sm text-white outline-none transition placeholder:text-white/40 focus:border-[#d7a94a]/55 focus:bg-white/[.05]";

function eligibilityLabel(state: PreviewEligibility) {
  if (state === "eligible") return "Preview eligible";
  if (state === "native_only") return "Native only";
  if (state === "missing_source") return "Source missing";
  return "Unsupported";
}

function eligibilityClass(state: PreviewEligibility) {
  if (state === "eligible") return "border-emerald-400/20 bg-emerald-400/8 text-emerald-200";
  if (state === "native_only") return "border-amber-300/20 bg-amber-300/8 text-amber-100";
  return "border-red-300/20 bg-red-300/8 text-red-100";
}

function itemIcon(type: LibraryItem["itemType"]) {
  if (type === "song") return Music2;
  if (type === "slide") return Type;
  return Film;
}

function itemSummary(item: LibraryItem) {
  if (item.itemType === "song") {
    const sections = Array.isArray(item.plannerInput.sections) ? item.plannerInput.sections.length : 0;
    const author = typeof item.plannerInput.author === "string" ? item.plannerInput.author : "";
    return `${sections} section${sections === 1 ? "" : "s"}${author ? ` · ${author}` : ""}`;
  }
  if (item.itemType === "slide") {
    const body = typeof item.plannerInput.body === "string" ? item.plannerInput.body : "";
    return body || "Text slide";
  }
  return item.source?.name ? `${item.source.name} · ${String(item.plannerInput.mediaKind ?? "media")}` : "Media source";
}

export function MediaWorkspace({
  organizationId,
  organizationName,
  initialItems,
  currentService,
  mediaSources,
  canEdit
}: Props) {
  const [items, setItems] = useState(initialItems);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"song" | "slide" | "media">("song");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [body, setBody] = useState("");
  const [sectionLabel, setSectionLabel] = useState("Verse 1");
  const [sourceId, setSourceId] = useState(mediaSources[0]?.id ?? "");
  const [mediaKind, setMediaKind] = useState<"image" | "video" | "audio">(
    mediaSources[0]?.mediaKind === "image" || mediaSources[0]?.mediaKind === "audio" ? mediaSources[0].mediaKind : "video"
  );
  const [revision, setRevision] = useState(currentService?.revision ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const visibleItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => `${item.title} ${itemSummary(item)}`.toLowerCase().includes(needle));
  }, [items, query]);

  const eligibleCount = items.filter((item) => item.previewEligibility === "eligible").length;
  const nativeCount = items.filter((item) => item.previewEligibility === "native_only").length;

  function resetForm() {
    setTitle("");
    setAuthor("");
    setBody("");
    setSectionLabel("Verse 1");
  }

  async function createItem() {
    if (!canEdit || !title.trim()) return;
    if ((kind === "song" || kind === "slide") && !body.trim()) return;
    if (kind === "media" && !sourceId) return;
    setBusy("create");
    setMessage(null);
    try {
      const input = kind === "song"
        ? { title: title.trim(), author: author.trim() || undefined, sections: [{ label: sectionLabel.trim() || "Verse 1", text: body }] }
        : kind === "slide"
          ? { title: title.trim(), body, style: "default" }
          : { title: title.trim(), sourceId, mediaKind };
      const response = await fetch("/api/v1/media/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, itemType: kind, input })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not create library item");
      setItems((current) => [payload.item as LibraryItem, ...current]);
      resetForm();
      setMessage(`${payload.item.title} added to the reusable library.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create library item");
    } finally {
      setBusy(null);
    }
  }

  async function addToService(item: LibraryItem) {
    if (!currentService || !revision || item.previewEligibility !== "eligible") return;
    setBusy(item.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/media/items/${item.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId: currentService.id, expectedRevision: revision })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not add item to service");
      setRevision(payload.revision);
      setMessage(`${item.title} added to ${currentService.title}. It is queued for Preview in Operator.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add item to service");
    } finally {
      setBusy(null);
    }
  }

  function chooseSource(nextId: string) {
    setSourceId(nextId);
    const source = mediaSources.find((candidate) => candidate.id === nextId);
    if (source?.mediaKind === "image" || source?.mediaKind === "video" || source?.mediaKind === "audio") {
      setMediaKind(source.mediaKind);
    }
  }

  return (
    <main className="min-h-screen bg-[#080b10] text-white">
      <header className="sticky top-0 z-40 border-b border-white/[.07] bg-[#090c12]/92 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.18em] text-[#d7a94a]"><Music2 size={14} />Songs & Media</div>
            <h1 className="mt-1 text-xl font-black tracking-tight sm:text-2xl">{organizationName}</h1>
            <p className="mt-1 text-xs text-white/50">Reusable worship content · Planner-safe rundown insertion · truthful Edge availability</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/media/import" className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-[#d7a94a]/25 bg-[#d7a94a]/[.07] px-4 text-sm font-bold text-[#efc86f] transition hover:bg-[#d7a94a]/[.12] ip-focus-gold">Import existing content</Link>
            <Link href="/planner" className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-white/[.09] px-4 text-sm font-semibold text-white/65 transition hover:bg-white/[.05] hover:text-white ip-focus-gold">Service Planner</Link>
            <Link href="/operator" className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#d7a94a] px-4 text-sm font-black text-[#17120a] transition hover:brightness-110 ip-focus-gold"><SquarePlay size={16} />Open Operator</Link>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1600px] gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[360px_minmax(0,1fr)] lg:px-8 lg:py-7">
        <aside className="space-y-4">
          <section className="rounded-3xl border border-white/[.07] bg-[#0c1017]/85 p-5">
            <div className="text-[11px] font-bold uppercase tracking-[.16em] text-white/50">Current service</div>
            {currentService ? (
              <div className="mt-3">
                <div className="text-lg font-black">{currentService.title}</div>
                <div className="mt-1 text-xs font-bold uppercase tracking-[.14em] text-emerald-300/75">{currentService.status} · {currentService.editable ? "rundown editable" : "rundown locked"}</div>
                <p className="mt-3 text-xs leading-5 text-white/55">{currentService.editable ? "Library items are added as queued Planner cues. Preview and Program remain explicit operator actions." : "This service is already live, so its Planner rundown is locked. Reusable content stays available and can be used in the next ready service."}</p>
              </div>
            ) : (
              <div className="mt-3 rounded-2xl border border-amber-300/15 bg-amber-300/[.05] p-4">
                <div className="text-sm font-bold text-amber-100">No ready/live service</div>
                <p className="mt-1 text-xs leading-5 text-white/55">The Reusable library remains available. Open Service Planner when you are ready to build a rundown.</p>
                <Link href="/planner" className="mt-3 inline-flex cursor-pointer text-xs font-bold text-[#d7a94a] hover:underline">Open Planner →</Link>
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-white/[.07] bg-[#0c1017]/85 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[.16em] text-[#d7a94a]">Create reusable item</div>
                <div className="mt-1 text-sm text-white/55">Songs, text slides and approved media sources.</div>
              </div>
              <CirclePlus size={20} className="text-[#d7a94a]/70" />
            </div>
            <div className="mt-4 space-y-3">
              <select className={`${inputClass} cursor-pointer`} value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} disabled={!canEdit}>
                <option value="song">Song</option>
                <option value="slide">Text slide</option>
                <option value="media">Media source</option>
              </select>
              <input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={kind === "song" ? "Song title" : kind === "slide" ? "Slide title" : "Media cue title"} disabled={!canEdit} />
              {kind === "song" && <input className={inputClass} value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="Author / composer (optional)" disabled={!canEdit} />}
              {kind === "song" && <input className={inputClass} value={sectionLabel} onChange={(event) => setSectionLabel(event.target.value)} placeholder="Section label, e.g. Verse 1" disabled={!canEdit} />}
              {(kind === "song" || kind === "slide") && <textarea className={`${inputClass} min-h-32 resize-y py-3`} value={body} onChange={(event) => setBody(event.target.value)} placeholder={kind === "song" ? "Section lyrics" : "Slide text"} disabled={!canEdit} />}
              {kind === "media" && (
                <>
                  <select className={`${inputClass} cursor-pointer`} value={sourceId} onChange={(event) => chooseSource(event.target.value)} disabled={!canEdit || mediaSources.length === 0}>
                    {mediaSources.length === 0 && <option value="">No media sources available</option>}
                    {mediaSources.map((source) => <option key={source.id} value={source.id}>{source.name} · {source.status}</option>)}
                  </select>
                  <select className={`${inputClass} cursor-pointer`} value={mediaKind} onChange={(event) => setMediaKind(event.target.value as typeof mediaKind)} disabled={!canEdit}>
                    <option value="image">Image</option>
                    <option value="video">Video</option>
                    <option value="audio">Audio</option>
                  </select>
                </>
              )}
              <button type="button" onClick={createItem} disabled={!canEdit || busy === "create"} className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#d7a94a] px-4 text-sm font-black text-[#17120a] transition hover:brightness-110 ip-focus-gold disabled:cursor-not-allowed disabled:opacity-40"><CirclePlus size={16} />{busy === "create" ? "Saving…" : "Save to library"}</button>
              {!canEdit && <p className="text-xs leading-5 text-white/50">Your role can view this library but cannot modify service content.</p>}
            </div>
          </section>
        </aside>

        <section className="min-w-0 rounded-3xl border border-white/[.07] bg-[#0c1017]/80 p-4 sm:p-5 lg:p-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[.16em] text-[#d7a94a]">Reusable library</div>
              <h2 className="mt-1 text-xl font-black tracking-tight">Service-ready content</h2>
              <p className="mt-1 text-sm text-white/55">{items.length} items · {eligibleCount} Preview eligible · {nativeCount} Native only</p>
            </div>
            <label className="relative block w-full xl:max-w-sm">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
              <input className={`${inputClass} pl-10`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, author, lyrics…" />
            </label>
          </div>

          {message && <div className="mt-4 rounded-xl border border-[#d7a94a]/15 bg-[#d7a94a]/[.06] px-4 py-3 text-sm text-[#f2dca9]">{message}</div>}

          <div className="mt-5 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {visibleItems.map((item) => {
              const Icon = itemIcon(item.itemType);
              const canAdd = Boolean(canEdit && currentService?.editable && revision && item.previewEligibility === "eligible");
              return (
                <article key={item.id} className="ip-ai-arrive flex min-h-56 flex-col rounded-2xl border border-white/[.07] bg-white/[.025] p-4 transition hover:border-white/[.12] hover:bg-white/[.035]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[.07] bg-black/20 text-[#d7a94a]"><Icon size={18} /></div>
                    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[.1em] ${eligibilityClass(item.previewEligibility)}`}>{eligibilityLabel(item.previewEligibility)}</span>
                  </div>
                  <div className="mt-4 text-base font-black leading-tight">{item.title}</div>
                  <p className="mt-2 line-clamp-3 text-xs leading-5 text-white/55">{itemSummary(item)}</p>
                  {item.previewReason && <p className="mt-2 text-[11px] leading-4 text-amber-100/55">{item.previewReason}</p>}
                  <div className="mt-auto pt-4">
                    <button type="button" onClick={() => addToService(item)} disabled={!canAdd || busy === item.id} className="inline-flex min-h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/[.09] bg-white/[.035] px-3 text-xs font-bold text-white/70 transition hover:bg-white/[.07] hover:text-white ip-focus-gold disabled:cursor-not-allowed disabled:opacity-35"><ListPlus size={15} />{busy === item.id ? "Adding…" : "Add to service"}</button>
                  </div>
                </article>
              );
            })}
          </div>

          {visibleItems.length === 0 && (
            <div className="mt-5 rounded-2xl border border-dashed border-white/[.09] px-6 py-14 text-center">
              <Video size={28} className="mx-auto text-white/30" />
              <div className="mt-3 text-sm font-bold">No matching library items</div>
              <p className="mt-1 text-xs text-white/50">Create a reusable song, slide or approved media cue from the panel on the left.</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
