"use client";

import { plannerFieldLabel, plannerInput } from "../planner-fields";

type Props = {
  value: Record<string, unknown>;
  disabled?: boolean;
  onChange: (value: Record<string, unknown>) => void;
};

export function LowerThirdCueEditor({ value, disabled = false, onChange }: Props) {
  const primaryText = typeof value.primaryText === "string" ? value.primaryText : "";
  const secondaryText = typeof value.secondaryText === "string" ? value.secondaryText : "";
  const durationSeconds = typeof value.durationSeconds === "number" ? value.durationSeconds : 12;

  return (
    <div className="space-y-4">
      <label className="block">
        <span className={plannerFieldLabel}>Primary text</span>
        <input value={primaryText} onChange={(event) => onChange({ ...value, primaryText: event.target.value })} disabled={disabled} maxLength={160} placeholder="Rev. Ama Mensah" className={plannerInput} />
      </label>
      <label className="block">
        <span className={plannerFieldLabel}>Secondary text</span>
        <input value={secondaryText} onChange={(event) => onChange({ ...value, secondaryText: event.target.value })} disabled={disabled} maxLength={500} placeholder="Lead Pastor" className={plannerInput} />
      </label>
      <label className="block sm:max-w-xs">
        <span className={plannerFieldLabel}>Display duration (seconds)</span>
        <input type="number" min={1} max={3600} value={durationSeconds} onChange={(event) => onChange({ ...value, durationSeconds: Number(event.target.value) || 1 })} disabled={disabled} className={plannerInput} />
      </label>
    </div>
  );
}
