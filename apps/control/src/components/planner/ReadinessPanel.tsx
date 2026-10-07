"use client";

import { AlertTriangle, CheckCircle2, RotateCcw, ShieldCheck } from "lucide-react";
import type { PlannerReadiness } from "./planner-workspace-types";

type Props = {
  serviceStatus: string;
  readiness: PlannerReadiness;
  canEdit: boolean;
  busy?: boolean;
  conflictFrozen?: boolean;
  edgeAssignmentCount?: number;
  onReady: () => void;
  onReturnToDraft: () => void;
  onFocusCue: (itemId: string) => void;
};

export function ReadinessPanel({
  serviceStatus,
  readiness,
  canEdit,
  busy = false,
  conflictFrozen = false,
  edgeAssignmentCount = 0,
  onReady,
  onReturnToDraft,
  onFocusCue
}: Props) {
  const isReady = serviceStatus === "ready";
  const isDraft = serviceStatus === "draft";
  const mutationDisabled = !canEdit || busy || conflictFrozen;
  const issues = readiness.issues ?? [];

  return (
    <section className="mb-3 overflow-hidden rounded-2xl border border-white/[.07] bg-[#0c1017]">
      <div className="flex flex-col gap-3 border-b border-white/[.07] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className={"flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border " + (isReady ? "border-emerald-400/20 bg-emerald-400/[.08] text-emerald-300" : "border-[#d7a94a]/20 bg-[#d7a94a]/[.08] text-[#f2c765]")}>{isReady ? <CheckCircle2 size={18} /> : <ShieldCheck size={18} />}</span>
          <div className="min-w-0">
            <div className="text-sm font-black text-white/85">Service readiness</div>
            <div className="mt-0.5 text-xs leading-5 text-white/35">
              {isReady
                ? `Ready for service · ${edgeAssignmentCount} Edge assignment${edgeAssignmentCount === 1 ? "" : "s"}`
                : issues.length
                  ? `${issues.length} readiness issue${issues.length === 1 ? "" : "s"} need attention.`
                  : "The server revalidates the complete rundown before Ready is accepted."}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isDraft ? (
            <button
              type="button"
              onClick={onReady}
              disabled={!canEdit || busy || conflictFrozen}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-emerald-400 px-3.5 text-xs font-extrabold text-[#07130d] disabled:cursor-not-allowed disabled:opacity-35"
            >
              <CheckCircle2 size={14} /> Ready for service
            </button>
          ) : null}
          {isReady ? (
            <button
              type="button"
              onClick={onReturnToDraft}
              disabled={!canEdit || busy || conflictFrozen}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/[.09] px-3.5 text-xs font-bold text-white/65 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <RotateCcw size={14} /> Return to draft
            </button>
          ) : null}
          {!isDraft && !isReady ? <span className="rounded-xl border border-white/[.07] px-3 py-2 text-xs font-bold text-white/35">Lifecycle locked: {serviceStatus}</span> : null}
        </div>
      </div>

      {issues.length ? (
        <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">
          {issues.map((issue, index) => {
            const content = (
              <>
                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-300" />
                <span className="min-w-0">
                  <span className="block text-[10px] font-black uppercase tracking-[.12em] text-amber-200/55">{issue.code.replaceAll("_", " ")}</span>
                  <span className="mt-1 block text-xs leading-5 text-white/62">{issue.label}</span>
                  {issue.itemId ? <span className="mt-1 block text-[11px] font-bold text-[#f2c765]">Open affected cue →</span> : null}
                </span>
              </>
            );
            return issue.itemId ? (
              <button
                key={`${issue.code}-${issue.itemId}-${index}`}
                type="button"
                onClick={() => onFocusCue(issue.itemId!)}
                className="flex min-w-0 items-start gap-2 rounded-xl border border-amber-300/15 bg-amber-300/[.045] p-3 text-left transition hover:bg-amber-300/[.075] focus:outline-none focus:ring-2 focus:ring-[#d7a94a]/35"
              >
                {content}
              </button>
            ) : (
              <div key={`${issue.code}-${index}`} className="flex min-w-0 items-start gap-2 rounded-xl border border-amber-300/15 bg-amber-300/[.045] p-3">
                {content}
              </div>
            );
          })}
        </div>
      ) : null}

      {!canEdit && (isDraft || isReady) ? <div className="border-t border-white/[.06] px-4 py-2.5 text-xs text-white/30">You can review readiness, but your current role cannot change the service lifecycle.</div> : null}
      {conflictFrozen ? <div className="border-t border-amber-300/15 bg-amber-300/[.04] px-4 py-2.5 text-xs text-amber-100/65">Readiness actions are paused until the latest planner revision is reloaded.</div> : null}
      <span className="sr-only">Mutation controls disabled: {String(mutationDisabled)}</span>
    </section>
  );
}
