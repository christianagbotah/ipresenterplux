// Shared presentational class constants for the Service Planner cue editors.
// Consolidates the design language (gold focus ring, readable label contrast,
// consistent placeholder weight, thin scrollbars) so every editor field looks
// and behaves identically. Presentational only — no logic, no capability gating.

export const plannerFieldLabel =
  "mb-2 block text-[11px] font-bold uppercase tracking-[.12em] text-white/50";

export const plannerInput =
  "min-h-12 w-full rounded-xl border border-white/[.09] bg-black/20 px-4 text-sm text-white outline-none transition placeholder:text-white/40 ip-focus-gold disabled:opacity-50";

export const plannerSelect =
  "min-h-12 w-full rounded-xl border border-white/[.09] bg-[#0a0d12] px-4 text-sm text-white outline-none transition ip-focus-gold disabled:opacity-50";

export const plannerTextarea =
  "w-full resize-y rounded-xl border border-white/[.09] bg-black/20 px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-white/40 ip-focus-gold ip-scrollbar-thin disabled:opacity-50";
