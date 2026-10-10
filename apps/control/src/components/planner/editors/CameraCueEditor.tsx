"use client";

import { plannerFieldLabel, plannerInput, plannerSelect, plannerTextarea } from "../planner-fields";
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
        <span className={plannerFieldLabel}>Approved camera source</span>
        <select value={sourceId} onChange={(event) => onChange({ ...value, sourceId: event.target.value })} disabled={disabled} className={plannerSelect}>
          <option value="">Select camera</option>
          {cameraSources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
        </select>
      </label>
      <label className="block">
        <span className={plannerFieldLabel}>Display label</span>
        <input value={label} onChange={(event) => onChange({ ...value, label: event.target.value })} disabled={disabled} maxLength={160} placeholder="Pulpit Camera" className={plannerInput} />
      </label>
      <label className="block">
        <span className={plannerFieldLabel}>Operator note</span>
        <textarea value={operatorNote} onChange={(event) => onChange({ ...value, operatorNote: event.target.value })} disabled={disabled} maxLength={1000} rows={4} className={plannerTextarea} />
      </label>
    </div>
  );
}
