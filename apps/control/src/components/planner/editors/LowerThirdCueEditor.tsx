"use client";

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
        <span className="mb-2 block text-xs font-bold uppercase tracking-[.12em] text-white/40">Primary text</span>
        <input value={primaryText} onChange={(event) => onChange({ ...value, primaryText: event.target.value })} disabled={disabled} maxLength={160} placeholder="Rev. Ama Mensah" className="min-h-12 w-full rounded-xl border border-white/[.09] bg-black/20 px-4 text-sm text-white outline-none focus:border-[#d7a94a]/45 disabled:opacity-50" />
      </label>
      <label className="block">
        <span className="mb-2 block text-xs font-bold uppercase tracking-[.12em] text-white/40">Secondary text</span>
        <input value={secondaryText} onChange={(event) => onChange({ ...value, secondaryText: event.target.value })} disabled={disabled} maxLength={500} placeholder="Lead Pastor" className="min-h-12 w-full rounded-xl border border-white/[.09] bg-black/20 px-4 text-sm text-white outline-none focus:border-[#d7a94a]/45 disabled:opacity-50" />
      </label>
      <label className="block sm:max-w-xs">
        <span className="mb-2 block text-xs font-bold uppercase tracking-[.12em] text-white/40">Display duration (seconds)</span>
        <input type="number" min={1} max={3600} value={durationSeconds} onChange={(event) => onChange({ ...value, durationSeconds: Number(event.target.value) || 1 })} disabled={disabled} className="min-h-12 w-full rounded-xl border border-white/[.09] bg-black/20 px-4 text-sm text-white outline-none focus:border-[#d7a94a]/45 disabled:opacity-50" />
      </label>
    </div>
  );
}
