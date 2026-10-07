"use client";

import type { MediaSourceOption } from "./MediaCueEditor";

type Props = {
  value: Record<string, unknown>;
  cameraSources: MediaSourceOption[];
  disabled?: boolean;
  onChange: (value: Record<string, unknown>) => void;
};

export function CameraCueEditor({ value, cameraSources, disabled = false, onChange }: Props) {
  const sourceId = typeof value.sourceId === "string" ? value.sourceId : "";
  const label = typeof value.label === "string" ? value.label : "";
  const operatorNote = typeof value.operatorNote === "string" ? value.operatorNote : "";

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-2 block text-xs font-bold uppercase tracking-[.12em] text-white/40">Approved camera source</span>
        <select value={sourceId} onChange={(event) => onChange({ ...value, sourceId: event.target.value })} disabled={disabled} className="min-h-12 w-full rounded-xl border border-white/[.09] bg-[#0a0d12] px-4 text-sm text-white outline-none focus:border-[#d7a94a]/45 disabled:opacity-50">
          <option value="">Select camera</option>
          {cameraSources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="mb-2 block text-xs font-bold uppercase tracking-[.12em] text-white/40">Display label</span>
        <input value={label} onChange={(event) => onChange({ ...value, label: event.target.value })} disabled={disabled} maxLength={160} placeholder="Pulpit Camera" className="min-h-12 w-full rounded-xl border border-white/[.09] bg-black/20 px-4 text-sm text-white outline-none focus:border-[#d7a94a]/45 disabled:opacity-50" />
      </label>
      <label className="block">
        <span className="mb-2 block text-xs font-bold uppercase tracking-[.12em] text-white/40">Operator note</span>
        <textarea value={operatorNote} onChange={(event) => onChange({ ...value, operatorNote: event.target.value })} disabled={disabled} maxLength={1000} rows={4} className="w-full resize-y rounded-xl border border-white/[.09] bg-black/20 px-4 py-3 text-sm leading-6 text-white outline-none focus:border-[#d7a94a]/45 disabled:opacity-50" />
      </label>
    </div>
  );
}
