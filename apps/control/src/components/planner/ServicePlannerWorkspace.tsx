"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Copy, Eye, Loader2, RefreshCcw, Save, Trash2 } from "lucide-react";
import { CueEditor, plannerCueTypes, type PlannerCueType } from "./CueEditor";
import { CuePreview } from "./CuePreview";
import { ReadinessPanel } from "./ReadinessPanel";
import { RundownList } from "./RundownList";
import type { BibleVersionOption } from "./editors/ScriptureCueEditor";
import type { MediaSourceOption } from "./editors/MediaCueEditor";
import type {
  PlannerDetailPayload,
  PlannerPresentation,
  PlannerReadiness,
  PlannerReadinessIssue,
  PlannerWorkspaceItem,
  PlannerWorkspaceService
} from "./planner-workspace-types";

type Props = {
  initialDetail: PlannerDetailPayload;
  bibleVersions: BibleVersionOption[];
  mediaSources: MediaSourceOption[];
};

type ApiPayload = {
  ok?: boolean;
  error?: string;
  code?: string;
  issues?: PlannerReadinessIssue[];
  item?: PlannerWorkspaceItem;
  items?: PlannerWorkspaceItem[];
  revision?: string;
  service?: PlannerWorkspaceService;
  readiness?: PlannerReadiness;
  edgeAssignment?: { count: number };
};

type PreviewPayload = {
  ok?: boolean;
  error?: string;
  presentation?: PlannerPresentation;
};

class PlannerRequestError extends Error {
  status: number;
  code?: string;
  issues: PlannerReadinessIssue[];

  constructor(message: string, status: number, code?: string, issues: PlannerReadinessIssue[] = []) {
    super(message);
    this.name = "PlannerRequestError";
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function inputFromItem(item: PlannerWorkspaceItem) {
  const content = objectValue(item.content);
  if (item.itemType === "scripture") return { reference: content.reference ?? item.title, version: content.version ?? "", footer: content.footer ?? "" };
  if (item.itemType === "song") return { title: content.title ?? item.title, author: content.author ?? "", sections: content.sections ?? [{ label: "Verse 1", text: "" }], defaultSection: content.defaultSection ?? 0 };
  if (item.itemType === "slide" || item.itemType === "custom") return { title: content.title ?? item.title, body: content.body ?? "", footer: content.footer ?? "", style: content.style ?? "default" };
  if (item.itemType === "announcement") return { title: content.title ?? item.title, body: content.body ?? "", footer: content.footer ?? "", dateNote: content.dateNote ?? "", style: content.style ?? "announcement" };
  if (item.itemType === "lower_third") return { primaryText: content.primaryText ?? item.title, secondaryText: content.secondaryText ?? "", durationSeconds: content.durationSeconds ?? 12 };
  if (item.itemType === "media") return { title: content.title ?? item.title, sourceId: content.sourceId ?? "", mediaKind: content.mediaKind ?? "video", operatorNotes: content.operatorNotes ?? "" };
  if (item.itemType === "camera") return { sourceId: content.sourceId ?? "", label: content.label ?? item.title, operatorNote: content.operatorNote ?? "" };
  return { title: item.title, body: content.body ?? "", footer: content.footer ?? "", style: content.style ?? "default" };
}

function newInput(itemType: PlannerCueType, detail: PlannerDetailPayload, bibleVersions: BibleVersionOption[], mediaSources: MediaSourceOption[]) {
  if (itemType === "scripture") return { reference: "", version: detail.service.activeBibleVersion || bibleVersions[0]?.id || "", footer: "" };
  if (itemType === "song") return { title: "", author: "", sections: [{ label: "Verse 1", text: "" }], defaultSection: 0 };
  if (itemType === "slide") return { title: "", body: "", footer: "", style: "default" };
  if (itemType === "announcement") return { title: "", body: "", footer: "", dateNote: "", style: "announcement" };
  if (itemType === "lower_third") return { primaryText: "", secondaryText: "", durationSeconds: 12 };
  if (itemType === "media") {
    const first = mediaSources.find((source) => source.sourceType !== "camera");
    return { title: "", sourceId: first?.id ?? "", mediaKind: first?.mediaKind ?? "video", operatorNotes: "" };
  }
  if (itemType === "camera") {
    const first = mediaSources.find((source) => source.sourceType === "camera");
    return { sourceId: first?.id ?? "", label: first?.name ?? "", operatorNote: "" };
  }
  return { title: "", body: "", footer: "", style: "default" };
}

function sortItems(items: PlannerWorkspaceItem[]) {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

function itemsInOrder(items: PlannerWorkspaceItem[], itemIds: string[]) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered: PlannerWorkspaceItem[] = [];
  itemIds.forEach((id, index) => {
    const item = byId.get(id);
    if (item) ordered.push({ ...item, sortOrder: (index + 1) * 1000 });
  });
  return ordered;
}

export function ServicePlannerWorkspace({ initialDetail, bibleVersions, mediaSources }: Props) {
  const [service, setService] = useState(initialDetail.service);
  const [items, setItems] = useState(() => sortItems(initialDetail.items));
  const [revision, setRevision] = useState(initialDetail.revision);
  const [readiness, setReadiness] = useState<PlannerReadiness>(initialDetail.readiness);
  const [edgeAssignment, setEdgeAssignment] = useState(initialDetail.edgeAssignment);
  const [selectedId, setSelectedId] = useState<string | null>(initialDetail.items[0]?.id ?? null);
  const [itemType, setItemType] = useState<PlannerCueType>((initialDetail.items[0]?.itemType as PlannerCueType) ?? "scripture");
  const [draft, setDraft] = useState<Record<string, unknown>>(() => initialDetail.items[0] ? inputFromItem(initialDetail.items[0]) : newInput("scripture", initialDetail, bibleVersions, mediaSources));
  const [creating, setCreating] = useState(initialDetail.items.length === 0 && initialDetail.canEdit);
  const [preview, setPreview] = useState<PlannerPresentation | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflictFrozen, setConflictFrozen] = useState(false);
  const [activePane, setActivePane] = useState<"Rundown" | "Editor" | "Preview">("Rundown");

  const selectedItem = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId]);
  const cameraSources = useMemo(() => mediaSources.filter((source) => source.sourceType === "camera"), [mediaSources]);
  const assetSources = useMemo(() => mediaSources.filter((source) => source.sourceType !== "camera"), [mediaSources]);
  const canEditForStatus = initialDetail.canEdit && (service.status === "draft" || service.status === "ready");
  const canMutate = canEditForStatus && !conflictFrozen;

  function selectItem(itemId: string) {
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item) return;
    setSelectedId(item.id);
    setItemType(item.itemType as PlannerCueType);
    setDraft(inputFromItem(item));
    setCreating(false);
    setPreviewError(null);
    setActivePane("Editor");
  }

  function beginCreate(type: PlannerCueType) {
    if (!canMutate) return;
    setSelectedId(null);
    setItemType(type);
    setDraft(newInput(type, { ...initialDetail, service }, bibleVersions, mediaSources));
    setCreating(true);
    setPreview(null);
    setPreviewError(null);
    setError(null);
    setActivePane("Editor");
  }

  function changeItemType(type: PlannerCueType) {
    if (!canMutate) return;
    setItemType(type);
    setDraft(newInput(type, { ...initialDetail, service }, bibleVersions, mediaSources));
    setPreview(null);
    setPreviewError(null);
  }

  async function requestMutation(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) {
    const response = await fetch(url, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        "If-Match": `"${revision}"`
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const payload = await response.json().catch(() => null) as ApiPayload | null;
    if (!response.ok || !payload?.ok) {
      throw new PlannerRequestError(
        payload?.error || `Planner request failed (${response.status})`,
        response.status,
        payload?.code,
        payload?.issues ?? []
      );
    }
    return payload;
  }

  function acceptServerState(payload: ApiPayload) {
    if (payload.revision) setRevision(payload.revision);
    if (payload.service) setService(payload.service);
    if (payload.items) setItems(sortItems(payload.items));
    if (payload.readiness) setReadiness(payload.readiness);
    if (payload.edgeAssignment) setEdgeAssignment(payload.edgeAssignment);
  }

  function handleMutationFailure(caught: unknown, fallback: string) {
    if (caught instanceof PlannerRequestError) {
      if (caught.code === "planner_revision_conflict") {
        setConflictFrozen(true);
        setError("This service plan changed in another session. Reload latest before making more changes.");
        return;
      }
      if (caught.code === "readiness_failed") {
        setReadiness({ status: "blocked", issues: caught.issues });
        setError(null);
        return;
      }
      setError(caught.message || fallback);
      return;
    }
    setError(caught instanceof Error ? caught.message : fallback);
  }

  async function previewCue() {
    setBusy("preview");
    setPreviewError(null);
    try {
      const response = await fetch(`/api/v1/planner/services/${service.id}/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemType, input: draft })
      });
      const payload = await response.json().catch(() => null) as PreviewPayload | null;
      if (!response.ok || !payload?.ok || !payload.presentation) {
        setPreview(null);
        setPreviewError(payload?.error || "Preview could not be generated.");
        return;
      }
      setPreview(payload.presentation);
      setActivePane("Preview");
    } catch {
      setPreview(null);
      setPreviewError("Preview service could not be reached.");
    } finally {
      setBusy(null);
    }
  }

  async function saveCue() {
    if (!canMutate) return;
    setBusy("save");
    setError(null);
    try {
      const url = creating
        ? `/api/v1/planner/services/${service.id}/items`
        : `/api/v1/planner/services/${service.id}/items/${selectedItem?.id}`;
      const payload = await requestMutation(url, creating ? "POST" : "PATCH", { itemType, input: draft });
      acceptServerState(payload);
      setReadiness({ status: "not_validated", issues: [] });
      if (payload.item) {
        setItems((current) => sortItems(creating ? [...current, payload.item!] : current.map((item) => item.id === payload.item!.id ? payload.item! : item)));
        setSelectedId(payload.item.id);
        setItemType(payload.item.itemType as PlannerCueType);
        setDraft(inputFromItem(payload.item));
        setCreating(false);
      }
    } catch (caught) {
      handleMutationFailure(caught, "Cue could not be saved.");
    } finally {
      setBusy(null);
    }
  }

  async function duplicateCue() {
    if (!canMutate || !selectedItem) return;
    setBusy("duplicate");
    setError(null);
    try {
      const payload = await requestMutation(`/api/v1/planner/services/${service.id}/items/${selectedItem.id}/duplicate`, "POST");
      acceptServerState(payload);
      setReadiness({ status: "not_validated", issues: [] });
      if (payload.item) {
        setSelectedId(payload.item.id);
        setItemType(payload.item.itemType as PlannerCueType);
        setDraft(inputFromItem(payload.item));
      }
    } catch (caught) {
      handleMutationFailure(caught, "Cue could not be duplicated.");
    } finally {
      setBusy(null);
    }
  }

  async function deleteCue() {
    if (!canMutate || !selectedItem) return;
    if (!window.confirm(`Delete “${selectedItem.title}” from this rundown?`)) return;
    setBusy("delete");
    setError(null);
    try {
      const payload = await requestMutation(`/api/v1/planner/services/${service.id}/items/${selectedItem.id}`, "DELETE");
      acceptServerState(payload);
      setReadiness({ status: "not_validated", issues: [] });
      const nextItems = sortItems(payload.items ?? items.filter((item) => item.id !== selectedItem.id));
      setItems(nextItems);
      const next = nextItems[0] ?? null;
      setSelectedId(next?.id ?? null);
      if (next) {
        setItemType(next.itemType as PlannerCueType);
        setDraft(inputFromItem(next));
        setCreating(false);
      } else {
        setItemType("scripture");
        setDraft(newInput("scripture", { ...initialDetail, service: payload.service ?? service }, bibleVersions, mediaSources));
        setCreating(canMutate);
      }
      setPreview(null);
    } catch (caught) {
      handleMutationFailure(caught, "Cue could not be deleted.");
    } finally {
      setBusy(null);
    }
  }

  async function reorderCues(itemIds: string[]) {
    if (!canMutate || busy || itemIds.length !== items.length) return;
    const previousItems = items;
    const optimisticItems = itemsInOrder(items, itemIds);
    if (optimisticItems.length !== items.length) return;

    setItems(optimisticItems);
    setBusy("reorder");
    setError(null);
    try {
      const payload = await requestMutation(`/api/v1/planner/services/${service.id}/reorder`, "POST", { itemIds });
      acceptServerState(payload);
      setReadiness({ status: "not_validated", issues: [] });
      if (!payload.items) setItems(optimisticItems);
    } catch (caught) {
      setItems(previousItems);
      handleMutationFailure(caught, "Rundown order could not be saved.");
    } finally {
      setBusy(null);
    }
  }

  async function markReady() {
    if (!canMutate) return;
    setBusy("ready");
    setError(null);
    try {
      const payload = await requestMutation(`/api/v1/planner/services/${service.id}/ready`, "POST");
      acceptServerState(payload);
      setReadiness({ status: "ready", issues: [] });
    } catch (caught) {
      handleMutationFailure(caught, "Service could not be marked ready.");
    } finally {
      setBusy(null);
    }
  }

  async function returnToDraft() {
    if (!canMutate) return;
    setBusy("draft");
    setError(null);
    try {
      const payload = await requestMutation(`/api/v1/planner/services/${service.id}/draft`, "POST");
      acceptServerState(payload);
      setReadiness({ status: "not_validated", issues: [] });
    } catch (caught) {
      handleMutationFailure(caught, "Service could not be returned to draft.");
    } finally {
      setBusy(null);
    }
  }

  function focusReadinessCue(itemId: string) {
    selectItem(itemId);
  }

  function reloadLatest() {
    window.location.reload();
  }

  return (
    <div className="min-w-0">
      {conflictFrozen ? (
        <div className="mb-3 flex flex-col gap-3 rounded-2xl border border-amber-300/20 bg-amber-300/[.06] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-300" />
            <div>
              <div className="text-sm font-black text-amber-100">Stale planner revision</div>
              <div className="mt-1 text-xs leading-5 text-amber-100/60">Another session changed this service plan. Mutations are frozen so we never overwrite newer work.</div>
            </div>
          </div>
          <button type="button" onClick={reloadLatest} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-amber-200/20 bg-amber-200/[.07] px-3.5 text-xs font-extrabold text-amber-100 transition hover:bg-amber-200/[.12]"><RefreshCcw size={14} /> Reload latest</button>
        </div>
      ) : null}

      <ReadinessPanel
        serviceStatus={service.status}
        readiness={readiness}
        canEdit={canEditForStatus}
        busy={Boolean(busy)}
        conflictFrozen={conflictFrozen}
        edgeAssignmentCount={edgeAssignment.count}
        onReady={markReady}
        onReturnToDraft={returnToDraft}
        onFocusCue={focusReadinessCue}
      />

      <div className="mb-3 grid grid-cols-3 gap-2 lg:hidden">
        {(["Rundown", "Editor", "Preview"] as const).map((pane) => (
          <button key={pane} type="button" onClick={() => setActivePane(pane)} className={"min-h-11 rounded-xl border px-3 text-sm font-bold transition " + (activePane === pane ? "border-[#d7a94a]/35 bg-[#d7a94a]/10 text-[#f2c765]" : "border-white/[.07] bg-white/[.025] text-white/45")}>{pane}</button>
        ))}
      </div>

      <div className="grid min-w-0 gap-3 lg:min-h-[650px] lg:grid-cols-[minmax(230px,0.8fr)_minmax(360px,1.35fr)_minmax(300px,1fr)]">
        <section className={(activePane === "Rundown" ? "block" : "hidden") + " min-h-[480px] overflow-hidden rounded-2xl border border-white/[.07] bg-[#0c1017] lg:block lg:min-h-0"}>
          <RundownList items={items} selectedId={selectedId} canEdit={canMutate} busy={Boolean(busy)} onSelect={selectItem} onAdd={beginCreate} onReorder={reorderCues} />
        </section>

        <section className={(activePane === "Editor" ? "block" : "hidden") + " min-h-[480px] overflow-hidden rounded-2xl border border-white/[.07] bg-[#0c1017] lg:block lg:min-h-0"}>
          <div className="flex flex-col gap-3 border-b border-white/[.07] p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
            <div className="min-w-0">
              <div className="text-sm font-black text-white/85">{creating ? "New cue" : selectedItem?.title || "Cue editor"}</div>
              <div className="mt-1 text-xs text-white/30">{conflictFrozen ? "Reload the latest plan before making more changes." : canEditForStatus ? "Changes stay in Draft until saved." : "Read-only service plan."}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={previewCue} disabled={Boolean(busy)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/[.09] px-3 text-xs font-bold text-white/65 disabled:opacity-35">{busy === "preview" ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}Preview</button>
              <button type="button" onClick={saveCue} disabled={!canMutate || Boolean(busy)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#d7a94a] px-3.5 text-xs font-extrabold text-[#161109] disabled:cursor-not-allowed disabled:opacity-35">{busy === "save" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}{creating ? "Add cue" : "Save"}</button>
              {selectedItem && !creating ? <button type="button" onClick={duplicateCue} disabled={!canMutate || Boolean(busy)} title="Duplicate cue" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/[.09] px-3 text-xs font-bold text-white/55 disabled:cursor-not-allowed disabled:opacity-35"><Copy size={14} />Duplicate</button> : null}
              {selectedItem && !creating ? <button type="button" onClick={deleteCue} disabled={!canMutate || Boolean(busy)} title="Delete cue" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-red-400/20 px-3 text-xs font-bold text-red-200/70 disabled:cursor-not-allowed disabled:opacity-35"><Trash2 size={14} />Delete</button> : null}
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto p-3 sm:p-4 lg:max-h-[760px] ip-scrollbar">
            {error ? <div className="mb-4 rounded-xl border border-red-400/20 bg-red-400/[.07] px-4 py-3 text-sm leading-5 text-red-100">{error}</div> : null}
            <label className="mb-5 block sm:max-w-xs">
              <span className="mb-2 block text-xs font-bold uppercase tracking-[.12em] text-white/40">Cue type</span>
              <select value={itemType} onChange={(event) => changeItemType(event.target.value as PlannerCueType)} disabled={!canMutate || Boolean(busy)} className="min-h-11 w-full rounded-xl border border-white/[.09] bg-[#0a0d12] px-3 text-sm text-white outline-none focus:border-[#d7a94a]/45 disabled:opacity-50">
                {plannerCueTypes.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}
              </select>
            </label>
            <CueEditor itemType={itemType} value={draft} bibleVersions={bibleVersions} mediaSources={assetSources} cameraSources={cameraSources} disabled={!canMutate || Boolean(busy)} onChange={setDraft} />
          </div>
        </section>

        <section className={(activePane === "Preview" ? "block" : "hidden") + " min-h-[480px] overflow-hidden rounded-2xl border border-white/[.07] bg-[#0c1017] lg:block lg:min-h-0"}>
          <CuePreview presentation={preview} loading={busy === "preview"} error={previewError} />
        </section>
      </div>
    </div>
  );
}
