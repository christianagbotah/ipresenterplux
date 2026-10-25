import type { ReactNode } from "react";

/**
 * iPresenterPlux Console — shared surface primitives.
 *
 * Compact production panels: tight radius, hairline borders, consistent
 * padding. Use these instead of re-inlining bg-[#0b0f16] rounded-2xl chains.
 */

export function Panel({
  children,
  className = "",
  as: Tag = "section"
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "aside" | "article";
}) {
  return (
    <Tag className={"rounded-xl border border-white/[.07] bg-panel p-4 " + className}>{children}</Tag>
  );
}

/** Workspace section header: micro-label + optional value chip. */
export function PanelHeader({
  title,
  hint,
  actions
}: {
  title: string;
  hint?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-3 flex min-h-8 items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="truncate text-[11px] font-black uppercase tracking-[.12em] text-gold">{title}</h2>
        {hint ? <span className="truncate text-[11px] text-white/40">{hint}</span> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Compact metric tile — one value, one label, optional tone. */
export function StatTile({
  label,
  value,
  hint,
  tone = "default"
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "good" | "warn" | "danger" | "live";
}) {
  const valueTone =
    tone === "good"
      ? "text-emerald-300"
      : tone === "warn"
        ? "text-amber-300"
        : tone === "danger"
          ? "text-red-300"
          : tone === "live"
            ? "text-[#ff8f8f]"
            : "text-white";
  return (
    <div className="rounded-xl border border-white/[.07] bg-panel px-4 py-3">
      <div className="text-[10px] font-black uppercase tracking-[.14em] text-white/40">{label}</div>
      <div className={"mt-1 truncate text-lg font-extrabold tabular-nums " + valueTone}>{value}</div>
      {hint ? <div className="mt-0.5 truncate text-[11px] text-white/40">{hint}</div> : null}
    </div>
  );
}

/** Shared empty state — dashed surface, icon, one line of guidance. */
export function EmptyState({
  icon,
  title,
  children
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/[.09] bg-white/[.015] px-6 py-8 text-center">
      {icon ? <div className="text-white/25" aria-hidden="true">{icon}</div> : null}
      <div className="text-sm font-bold text-white/70">{title}</div>
      {children ? <div className="max-w-md text-xs leading-5 text-white/40">{children}</div> : null}
    </div>
  );
}
