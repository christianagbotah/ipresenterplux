import type { ReactNode } from "react";

/**
 * iPresenterPlux Console — shared status badge.
 *
 * One tone system for the whole control plane so chips mean the same thing on
 * every workspace. Tones map to the design tokens in globals.css:
 * gold = Preview / brand, live = Program on-air, good/warn/danger = states.
 */
export type BadgeTone = "gold" | "live" | "good" | "warn" | "danger" | "muted" | "info";

const toneClasses: Record<BadgeTone, string> = {
  gold: "border-[#d7a94a]/25 bg-[#d7a94a]/10 text-[#efc86f]",
  live: "border-[#ff5d5d]/35 bg-[#ff5d5d]/12 text-[#ff8f8f]",
  good: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
  warn: "border-amber-400/25 bg-amber-400/10 text-amber-300",
  danger: "border-red-400/30 bg-red-400/10 text-red-300",
  muted: "border-white/10 bg-white/[.04] text-white/55",
  info: "border-sky-400/25 bg-sky-400/10 text-sky-300"
};

export function Badge({
  children,
  tone = "muted",
  className = "",
  title
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={
        "inline-flex max-w-full items-center truncate rounded-md border px-2 py-0.5 text-[11px] font-bold leading-5 tracking-wide " +
        toneClasses[tone] +
        (className ? ` ${className}` : "")
      }
    >
      {children}
    </span>
  );
}

/** Maps a state string to a badge tone — replaces per-page ad-hoc mappers. */
export function stateTone(state: string | null | undefined): BadgeTone {
  switch ((state ?? "").toLowerCase()) {
    case "live":
    case "on_air":
    case "broadcasting":
    case "streaming":
      return "live";
    case "ready":
    case "connected":
    case "active":
    case "published":
    case "succeeded":
    case "healthy":
    case "completed":
      return "good";
    case "pending":
    case "preparing":
    case "queued":
    case "downloading":
    case "starting":
    case "reconnecting":
    case "degraded":
    case "draft":
      return "warn";
    case "failed":
    case "error":
    case "unhealthy":
    case "disconnected":
    case "revoked":
    case "ended":
    case "suspended":
      return "danger";
    case "preview":
    case "armed":
      return "gold";
    default:
      return "muted";
  }
}
