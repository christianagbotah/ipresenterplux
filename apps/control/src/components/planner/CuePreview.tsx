"use client";

import { Eye, Loader2 } from "lucide-react";
import type { PlannerPresentation } from "./planner-workspace-types";

type Props = {
  presentation: PlannerPresentation | null;
  loading?: boolean;
  error?: string | null;
};

export function CuePreview({ presentation, loading = false, error = null }: Props) {
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-white/[.07] p-3 sm:p-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-black text-white/85"><Eye size={15} className="text-[#d7a94a]" />Safe Preview</div>
          <div className="mt-1 text-xs text-white/30">Authoring preview only · does not change Program</div>
        </div>
        {loading ? <Loader2 size={16} className="animate-spin text-[#d7a94a]" /> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4 ip-scrollbar">
        {error ? <div className="rounded-xl border border-red-400/20 bg-red-400/[.07] px-4 py-3 text-sm leading-5 text-red-100">{error}</div> : null}
        {presentation ? (
          <div className="overflow-hidden rounded-2xl border border-white/[.08] bg-black/35 shadow-inner">
            <div className="aspect-video min-h-[220px] p-5 sm:p-7">
              <div className="text-[10px] font-bold uppercase tracking-[.16em] text-[#d7a94a]/70">{presentation.itemType.replaceAll("_", " ")}</div>
              <div className="mt-3 text-lg font-black tracking-tight text-white/90 sm:text-xl">{presentation.title}</div>
              <div className="mt-6 whitespace-pre-wrap text-base leading-7 text-white/78">{presentation.body || "No presentation text for this source cue."}</div>
              {presentation.footer ? <div className="mt-8 border-t border-white/[.08] pt-3 text-sm text-white/45">{presentation.footer}</div> : null}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/[.08] px-5 py-14 text-center">
            <Eye size={26} className="mx-auto text-white/15" />
            <div className="mt-3 text-sm font-bold text-white/55">Nothing previewed yet</div>
            <div className="mx-auto mt-1 max-w-sm text-xs leading-5 text-white/30">Use Preview from the editor to validate and render the unsaved cue safely without sending anything live.</div>
          </div>
        )}
      </div>
    </div>
  );
}
