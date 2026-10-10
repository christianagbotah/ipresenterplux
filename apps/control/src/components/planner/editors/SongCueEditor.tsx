"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { plannerFieldLabel, plannerInput, plannerTextarea } from "../planner-fields";

type SongSection = { label: string; text: string };

type Props = {
  value: Record<string, unknown>;
  disabled?: boolean;
  onChange: (value: Record<string, unknown>) => void;
};

function sectionsFrom(value: Record<string, unknown>): SongSection[] {
  if (!Array.isArray(value.sections)) return [{ label: "Verse 1", text: "" }];
  const sections = value.sections
    .filter((section): section is Record<string, unknown> => Boolean(section) && typeof section === "object" && !Array.isArray(section))
    .map((section) => ({
      label: typeof section.label === "string" ? section.label : "Section",
      text: typeof section.text === "string" ? section.text : ""
    }));
  return sections.length ? sections : [{ label: "Verse 1", text: "" }];
}

const iconBtn = "rounded-lg border border-white/[.08] p-2.5 text-white/55 transition hover:bg-white/[.05] hover:text-white ip-focus-gold disabled:opacity-25";
const iconBtnDanger = "rounded-lg border border-red-400/20 p-2.5 text-red-200/70 transition hover:bg-red-400/[.08] hover:text-red-100 ip-focus-gold disabled:opacity-25";

export function SongCueEditor({ value, disabled = false, onChange }: Props) {
  const title = typeof value.title === "string" ? value.title : "";
  const author = typeof value.author === "string" ? value.author : "";
  const sections = sectionsFrom(value);

  function replaceSections(next: SongSection[]) {
    onChange({ ...value, sections: next, defaultSection: 0 });
  }

  function updateSection(index: number, patch: Partial<SongSection>) {
    replaceSections(sections.map((section, sectionIndex) => sectionIndex === index ? { ...section, ...patch } : section));
  }

  function moveSection(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= sections.length) return;
    const next = [...sections];
    [next[index], next[target]] = [next[target], next[index]];
    replaceSections(next);
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={plannerFieldLabel}>Song title</span>
          <input value={title} onChange={(event) => onChange({ ...value, title: event.target.value })} disabled={disabled} maxLength={160} className={plannerInput} />
        </label>
        <label className="block">
          <span className={plannerFieldLabel}>Author / attribution</span>
          <input value={author} onChange={(event) => onChange({ ...value, author: event.target.value })} disabled={disabled} maxLength={500} className={plannerInput} />
        </label>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-white/85">Song sections</div>
          <div className="mt-1 text-xs text-white/50">Up to 64 ordered sections. Each section is kept structured for later live stepping.</div>
        </div>
        <button
          type="button"
          disabled={disabled || sections.length >= 64}
          onClick={() => replaceSections([...sections, { label: `Section ${sections.length + 1}`, text: "" }])}
          className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border border-[#d7a94a]/25 bg-[#d7a94a]/10 px-3 text-xs font-bold text-[#f2c765] transition hover:bg-[#d7a94a]/[.16] ip-focus-gold disabled:opacity-35"
        >
          <Plus size={14} /> Add section
        </button>
      </div>

      <div className="space-y-3">
        {sections.map((section, index) => (
          <div key={`${index}-${section.label}`} className="ip-ai-arrive rounded-2xl border border-white/[.07] bg-black/15 p-3 sm:p-4">
            <div className="mb-3 flex items-center gap-2">
              <input
                value={section.label}
                onChange={(event) => updateSection(index, { label: event.target.value })}
                disabled={disabled}
                maxLength={80}
                aria-label={`Section ${index + 1} label`}
                className="min-h-10 min-w-0 flex-1 rounded-lg border border-white/[.08] bg-black/20 px-3 text-sm font-semibold text-white outline-none transition placeholder:text-white/40 ip-focus-gold disabled:opacity-50"
              />
              <button type="button" aria-label="Move up" title="Move up" disabled={disabled || index === 0} onClick={() => moveSection(index, -1)} className={iconBtn}><ArrowUp size={14} /></button>
              <button type="button" aria-label="Move down" title="Move down" disabled={disabled || index === sections.length - 1} onClick={() => moveSection(index, 1)} className={iconBtn}><ArrowDown size={14} /></button>
              <button type="button" aria-label="Remove section" title="Remove" disabled={disabled || sections.length === 1} onClick={() => replaceSections(sections.filter((_, sectionIndex) => sectionIndex !== index))} className={iconBtnDanger}><Trash2 size={14} /></button>
            </div>
            <textarea
              value={section.text}
              onChange={(event) => updateSection(index, { text: event.target.value })}
              disabled={disabled}
              maxLength={4000}
              rows={5}
              placeholder="Section lyrics or text"
              className={`${plannerTextarea} min-h-32`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
