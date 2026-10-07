"use client";

export type MediaSourceOption = {
  id: string;
  name: string;
  sourceType: string;
  mediaKind: string | null;
};

type Props = {
  value: Record<string, unknown>;
  mediaSources: MediaSourceOption[];
  disabled?: boolean;
  onChange: (value: Record<string, unknown>) => void;
};

export function MediaCueEditor({ value, mediaSources, disabled = false, onChange }: Props) {
  const title = typeof value.title === "string" ? value.title : "";
  const sourceId = typeof value.sourceId === "string" ? value.sourceId : "";
  const selected = mediaSources.find((source) => source.id === sourceId);
  const mediaKind = typeof value.mediaKind === "string" ? value.mediaKind : (selected?.mediaKind ?? "video");
  const operatorNotes = typeof value.operatorNotes === "string" ? value.operatorNotes : "";

  function chooseSource(nextId: string) {
    const next = mediaSources.find((source) => source.id === nextId);
    onChange({ ...value, sourceId: nextId, mediaKind: next?.mediaKind ?? mediaKind });
  }

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-2 block text-xs font-bold uppercase tracking-[.12em] text-white/40">Cue title</span>
        <input value={title} onChange={(event) => onChange({ ...value, title: event.target.value })} disabled={disabled} maxLength={160} className="min-h-12 w-full rounded-xl border border-white/[.09] bg-black/20 px-4 text-sm text-white outline-none focus:border-[#d7a94a]/45 disabled:opacity-50" />
      </label>
      <label className="block">
        <span className="mb-2 block text-xs font-bold uppercase tracking-[.12em] text-white/40">Approved media source</span>
        <select value={sourceId} onChange={(event) => chooseSource(event.target.value)} disabled={disabled} className="min-h-12 w-full rounded-xl border border-white/[.09] bg-[#0a0d12] px-4 text-sm text-white outline-none focus:border-[#d7a94a]/45 disabled:opacity-50">
          <option value="">Select approved source</option>
          {mediaSources.map((source) => <option key={source.id} value={source.id}>{source.name}{source.mediaKind ? ` · ${source.mediaKind}` : ""}</option>)}
        </select>
      </label>
      <label className="block sm:max-w-xs">
        <span className="mb-2 block text-xs font-bold uppercase tracking-[.12em] text-white/40">Media kind</span>
        <select value={mediaKind} onChange={(event) => onChange({ ...value, mediaKind: event.target.value })} disabled={disabled} className="min-h-12 w-full rounded-xl border border-white/[.09] bg-[#0a0d12] px-4 text-sm text-white outline-none focus:border-[#d7a94a]/45 disabled:opacity-50">
          <option value="image">Image</option><option value="video">Video</option><option value="audio">Audio</option>
        </select>
      </label>
      <label className="block">
        <span className="mb-2 block text-xs font-bold uppercase tracking-[.12em] text-white/40">Operator notes</span>
        <textarea value={operatorNotes} onChange={(event) => onChange({ ...value, operatorNotes: event.target.value })} disabled={disabled} maxLength={1000} rows={4} className="w-full resize-y rounded-xl border border-white/[.09] bg-black/20 px-4 py-3 text-sm leading-6 text-white outline-none focus:border-[#d7a94a]/45 disabled:opacity-50" />
      </label>
    </div>
  );
}
