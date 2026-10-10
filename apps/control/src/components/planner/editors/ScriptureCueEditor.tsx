"use client";

import { plannerFieldLabel, plannerInput, plannerSelect } from "../planner-fields";

export type BibleVersionOption = { id: string; name: string; abbreviation: string };

type Props = {
  value: Record<string, unknown>;
  bibleVersions: BibleVersionOption[];
  disabled?: boolean;
  onChange: (value: Record<string, unknown>) => void;
};

export function ScriptureCueEditor({ value, bibleVersions, disabled = false, onChange }: Props) {
  const reference = typeof value.reference === "string" ? value.reference : "";
  const bibleVersion = typeof value.version === "string" ? value.version : "";
  const footer = typeof value.footer === "string" ? value.footer : "";

  return (
    <div className="space-y-4">
      <label className="block">
        <span className={plannerFieldLabel}>Scripture reference</span>
        <input
          value={reference}
          onChange={(event) => onChange({ ...value, reference: event.target.value })}
          disabled={disabled}
          placeholder="John 3:16-17"
          maxLength={120}
          className={plannerInput}
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={plannerFieldLabel}>Bible version</span>
          <select
            value={bibleVersion}
            onChange={(event) => onChange({ ...value, version: event.target.value })}
            disabled={disabled}
            className={plannerSelect}
          >
            {bibleVersions.map((version) => (
              <option key={version.id} value={version.id}>{version.abbreviation} · {version.name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={plannerFieldLabel}>Footer override</span>
          <input
            value={footer}
            onChange={(event) => onChange({ ...value, footer: event.target.value })}
            disabled={disabled}
            placeholder="Uses Bible abbreviation when blank"
            maxLength={500}
            className={plannerInput}
          />
        </label>
      </div>
    </div>
  );
}
