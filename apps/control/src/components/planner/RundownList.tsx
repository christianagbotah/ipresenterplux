"use client";

import { useState } from "react";
import { FileText, Plus } from "lucide-react";
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

export function RundownList({ items, selectedId, canEdit, busy = false, onSelect, onAdd }: Props) {
  const [newType, setNewType] = useState<PlannerCueType>("scripture");

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
              <select value={newType} onChange={(event) => setNewType(event.target.value as PlannerCueType)} disabled={busy} className="min-h-10 min-w-0 rounded-lg border border-white/[.08] bg-[#0a0d12] px-2.5 text-xs text-white outline-none focus:border-[#d7a94a]/45">
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
          return (
            <button
              type="button"
              key={item.id}
              onClick={() => onSelect(item.id)}
              className={
                "flex w-full min-w-0 items-start gap-3 rounded-xl border p-3 text-left transition " +
                (selected
                  ? "border-[#d7a94a]/35 bg-[#d7a94a]/10"
                  : "border-white/[.06] bg-white/[.02] hover:bg-white/[.04]")
              }
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[.07] bg-black/20 text-xs font-black text-white/45">{index + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.12em] text-white/30"><FileText size={11} />{labels[item.itemType as PlannerCueType] ?? item.itemType}</span>
                <span className="mt-1.5 block truncate text-sm font-bold text-white/80">{item.title || "Untitled cue"}</span>
                <span className="mt-1 block truncate text-[11px] text-white/25">{item.state}</span>
              </span>
            </button>
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
