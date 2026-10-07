"use client";

import { useState, type DragEvent } from "react";
import { ArrowDown, ArrowUp, FileText, GripVertical, Plus } from "lucide-react";
import type { PlannerCueType } from "./CueEditor";
import { plannerCueTypes } from "./CueEditor";
import type { PlannerWorkspaceItem } from "./planner-workspace-types";

type Props = {
  items: PlannerWorkspaceItem[];
  selectedId: string | null;
  canEdit: boolean;
  busy?: boolean;
  onSelect: (itemId: string) => void;
  onAdd: (itemType: PlannerCueType) => void;
  onReorder: (itemIds: string[]) => void;
};

const labels: Record<PlannerCueType, string> = {
  scripture: "Scripture",
  song: "Song",
  slide: "Slide",
  announcement: "Announcement",
  lower_third: "Lower third",
  media: "Media",
  camera: "Camera",
  custom: "Custom"
};

export function RundownList({ items, selectedId, canEdit, busy = false, onSelect, onAdd, onReorder }: Props) {
  const [newType, setNewType] = useState<PlannerCueType>("scripture");
  const [draggedId, setDraggedId] = useState<string | null>(null);

  function moveItem(itemId: string, delta: -1 | 1) {
    if (!canEdit || busy) return;
    const ordered = items.map((item) => item.id);
    const from = ordered.indexOf(itemId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ordered.length) return;
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved);
    onReorder(ordered);
  }

  function startDrag(event: DragEvent<HTMLDivElement>, itemId: string) {
    if (!canEdit || busy) {
      event.preventDefault();
      return;
    }
    setDraggedId(itemId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", itemId);
  }

  function dropOn(event: DragEvent<HTMLDivElement>, targetId: string) {
    if (!canEdit || busy) return;
    event.preventDefault();
    const sourceId = draggedId || event.dataTransfer.getData("text/plain");
    setDraggedId(null);
    if (!sourceId || sourceId === targetId) return;

    const ordered = items.map((item) => item.id);
    const from = ordered.indexOf(sourceId);
    if (from < 0) return;
    ordered.splice(from, 1);
    const targetIndex = ordered.indexOf(targetId);
    if (targetIndex < 0) return;
    ordered.splice(targetIndex, 0, sourceId);
    onReorder(ordered);
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="border-b border-white/[.07] p-3 sm:p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-black text-white/85">Rundown</div>
            <div className="mt-1 text-xs text-white/30">{items.length} cue{items.length === 1 ? "" : "s"}</div>
          </div>
          {canEdit ? (
            <div className="flex min-w-0 items-center gap-2">
              <select value={newType} onChange={(event) => setNewType(event.target.value as PlannerCueType)} disabled={busy} className="min-h-10 min-w-0 rounded-lg border border-white/[.08] bg-[#0a0d12] px-2.5 text-xs text-white outline-none focus:border-[#d7a94a]/45 disabled:opacity-40">
                {plannerCueTypes.map((type) => <option key={type} value={type}>{labels[type]}</option>)}
              </select>
              <button type="button" onClick={() => onAdd(newType)} disabled={busy} className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg bg-[#d7a94a] px-3 text-xs font-extrabold text-[#161109] disabled:opacity-40"><Plus size={14} /> Add</button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5 sm:p-3 ip-scrollbar">
        {items.length ? items.map((item, index) => {
          const selected = item.id === selectedId;
          const draggable = canEdit && !busy;
          return (
            <div
              key={item.id}
              draggable={draggable}
              onDragStart={(event) => startDrag(event, item.id)}
              onDragEnd={() => setDraggedId(null)}
              onDragOver={(event) => {
                if (draggable) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }
              }}
              onDrop={(event) => dropOn(event, item.id)}
              className={
                "group flex w-full min-w-0 items-stretch gap-1 rounded-xl border p-1.5 transition " +
                (selected
                  ? "border-[#d7a94a]/35 bg-[#d7a94a]/10"
                  : draggedId === item.id
                    ? "border-white/[.12] bg-white/[.05] opacity-55"
                    : "border-white/[.06] bg-white/[.02] hover:bg-white/[.04]")
              }
            >
              <button
                type="button"
                onClick={() => onSelect(item.id)}
                className="flex min-w-0 flex-1 items-start gap-3 rounded-lg p-1.5 text-left focus:outline-none focus:ring-2 focus:ring-[#d7a94a]/30"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[.07] bg-black/20 text-xs font-black text-white/45">{index + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.12em] text-white/30"><FileText size={11} />{labels[item.itemType as PlannerCueType] ?? item.itemType}</span>
                  <span className="mt-1.5 block truncate text-sm font-bold text-white/80">{item.title || "Untitled cue"}</span>
                  <span className="mt-1 block truncate text-[11px] text-white/25">{item.state}</span>
                </span>
              </button>

              {canEdit ? (
                <div className="flex shrink-0 flex-col items-center justify-center gap-0.5 pr-0.5">
                  <span title="Drag to reorder" aria-hidden="true" className="flex h-7 w-7 cursor-grab items-center justify-center rounded-md text-white/20 group-hover:text-white/35"><GripVertical size={14} /></span>
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => moveItem(item.id, -1)}
                      disabled={busy || index === 0}
                      aria-label={`Move up ${item.title || "cue"}`}
                      title="Move up"
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-white/[.06] text-white/35 transition hover:bg-white/[.05] hover:text-white/70 disabled:cursor-not-allowed disabled:opacity-20"
                    >
                      <ArrowUp size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveItem(item.id, 1)}
                      disabled={busy || index === items.length - 1}
                      aria-label={`Move down ${item.title || "cue"}`}
                      title="Move down"
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-white/[.06] text-white/35 transition hover:bg-white/[.05] hover:text-white/70 disabled:cursor-not-allowed disabled:opacity-20"
                    >
                      <ArrowDown size={12} />
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        }) : (
          <div className="rounded-2xl border border-dashed border-white/[.08] px-4 py-10 text-center">
            <FileText size={24} className="mx-auto text-white/15" />
            <div className="mt-3 text-sm font-bold text-white/55">No cues yet</div>
            <div className="mt-1 text-xs leading-5 text-white/30">{canEdit ? "Choose a cue type above to begin the order of service." : "This service does not contain any rundown cues."}</div>
          </div>
        )}
      </div>
    </div>
  );
}
