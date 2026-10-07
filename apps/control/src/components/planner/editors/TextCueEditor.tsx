"use client";

type TextCueType = "slide" | "announcement" | "custom";

type Props = {
  itemType: TextCueType;
  value: Record<string, unknown>;
  disabled?: boolean;
  onChange: (value: Record<string, unknown>) => void;
};

export function TextCueEditor({ itemType, value, disabled = false, onChange }: Props) {
  const title = typeof value.title === "string" ? value.title : "";
  const body = typeof value.body === "string" ? value.body : "";
  const footer = typeof value.footer === "string" ? value.footer : "";
  const dateNote = typeof value.dateNote === "string" ? value.dateNote : "";
  const style = typeof value.style === "string" ? value.style : (itemType === "announcement" ? "announcement" : "default");

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-2 block text-xs font-bold uppercase tracking-[.12em] text-white/40">Title</span>
        <input value={title} onChange={(event) => onChange({ ...value, title: event.target.value })} disabled={disabled} maxLength={160} className="min-h-12 w-full rounded-xl border border-white/[.09] bg-black/20 px-4 text-sm text-white outline-none focus:border-[#d7a94a]/45 disabled:opacity-50" />
      </label>
      <label className="block">
        <span className="mb-2 block text-xs font-bold uppercase tracking-[.12em] text-white/40">Presentation text</span>
        <textarea value={body} onChange={(event) => onChange({ ...value, body: event.target.value })} disabled={disabled} maxLength={12000} rows={10} className="w-full resize-y rounded-xl border border-white/[.09] bg-black/20 px-4 py-3 text-sm leading-6 text-white outline-none focus:border-[#d7a94a]/45 disabled:opacity-50" />
        <span className="mt-1.5 block text-right text-[11px] text-white/25">{body.length.toLocaleString()} / 12,000</span>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-2 block text-xs font-bold uppercase tracking-[.12em] text-white/40">Footer</span>
          <input value={footer} onChange={(event) => onChange({ ...value, footer: event.target.value })} disabled={disabled} maxLength={500} className="min-h-12 w-full rounded-xl border border-white/[.09] bg-black/20 px-4 text-sm text-white outline-none focus:border-[#d7a94a]/45 disabled:opacity-50" />
        </label>
        {itemType === "announcement" ? (
          <label className="block">
            <span className="mb-2 block text-xs font-bold uppercase tracking-[.12em] text-white/40">Date note</span>
            <input value={dateNote} onChange={(event) => onChange({ ...value, dateNote: event.target.value })} disabled={disabled} maxLength={160} className="min-h-12 w-full rounded-xl border border-white/[.09] bg-black/20 px-4 text-sm text-white outline-none focus:border-[#d7a94a]/45 disabled:opacity-50" />
          </label>
        ) : (
          <label className="block">
            <span className="mb-2 block text-xs font-bold uppercase tracking-[.12em] text-white/40">Style</span>
            <select value={style} onChange={(event) => onChange({ ...value, style: event.target.value })} disabled={disabled} className="min-h-12 w-full rounded-xl border border-white/[.09] bg-[#0a0d12] px-4 text-sm text-white outline-none focus:border-[#d7a94a]/45 disabled:opacity-50">
              <option value="default">Default</option>
              <option value="sermon">Sermon</option>
              <option value="scripture">Scripture</option>
              <option value="announcement">Announcement</option>
            </select>
          </label>
        )}
      </div>
    </div>
  );
}
