/**
 * iPresenterPlux Console — shared control classes.
 *
 * The existing workspaces inline long Tailwind chains for buttons and inputs
 * with drifting values (four gold-button ink colors, five hover treatments,
 * several input backgrounds). These constants define the one true recipe.
 * New code and migrated surfaces use them; untouched surfaces keep rendering
 * exactly as before.
 */

export const buttonPrimary =
  "ip-focus-gold inline-flex items-center justify-center gap-2 rounded-xl bg-gold px-4 font-extrabold text-gold-ink transition hover:bg-[#e6ba5e] disabled:cursor-not-allowed disabled:opacity-50";

export const buttonSecondary =
  "ip-focus-gold inline-flex items-center justify-center gap-2 rounded-xl border border-white/[.08] bg-white/[.03] font-bold text-white/70 transition hover:bg-white/[.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-45";

export const buttonDanger =
  "ip-focus-gold inline-flex items-center justify-center gap-2 rounded-xl border border-red-400/30 bg-red-400/10 font-bold text-red-300 transition hover:bg-red-400/15 disabled:cursor-not-allowed disabled:opacity-45";

export const inputField =
  "ip-focus-gold w-full rounded-xl border border-white/[.08] bg-white/[.035] px-3 text-sm text-white placeholder:text-white/30 transition focus:border-gold/50";

export const selectField =
  "ip-focus-gold w-full rounded-xl border border-white/[.08] bg-[#0a0d12] px-3 text-sm text-white transition focus:border-gold/50";

/** Sticky workspace header used by every console surface. */
export const workspaceHeader =
  "sticky top-0 z-30 flex min-h-16 items-center justify-between gap-3 border-b border-white/[.07] bg-console-2/92 px-4 backdrop-blur-xl lg:px-6";

/** Standard content container inside a workspace shell. */
export const workspaceContainer = "mx-auto w-full max-w-[1600px] px-4 py-6 lg:px-6";
