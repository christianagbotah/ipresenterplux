"use client";

import { plannerFieldLabel, plannerInput, plannerSelect, plannerTextarea } from "../planner-fields";

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
        <span className={plannerFieldLabel}>Cue title</span>
        <input value={title} onChange={(event) => onChange({ ...value, title: event.target.value })} disabled={disabled} maxLength={160} className={plannerInput} />
      </label>
      <label className="block">
        <span className={plannerFieldLabel}>Approved media source</span>
        <select value={sourceId} onChange={(event) => chooseSource(event.target.value)} disabled={disabled} className={plannerSelect}>
          <option value="">Select approved source</option>
          {mediaSources.map((source) => <option key={source.id} value={source.id}>{source.name}{source.mediaKind ? ` · ${source.mediaKind}` : ""}</option>)}
        </select>
      </label>
      <label className="block sm:max-w-xs">
        <span className={plannerFieldLabel}>Media kind</span>
        <select value={mediaKind} onChange={(event) => onChange({ ...value, mediaKind: event.target.value })} disabled={disabled} className={plannerSelect}>
          <option value="image">Image</option><option value="video">Video</option><option value="audio">Audio</option>
        </select>
      </label>
      <label className="block">
        <span className={plannerFieldLabel}>Operator notes</span>
        <textarea value={operatorNotes} onChange={(event) => onChange({ ...value, operatorNotes: event.target.value })} disabled={disabled} maxLength={1000} rows={4} className={plannerTextarea} />
      </label>
    </div>
  );
}
