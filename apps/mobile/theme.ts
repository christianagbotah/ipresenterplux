/**
 * iPresenterPlux audience app design tokens.
 *
 * Single source of truth for color on the mobile audience surface. Values are
 * shared with the desktop operator shell (OperatorTheme.cs) and the web control
 * plane (apps/control/src/app/globals.css) so all three frontends speak one
 * visual language: dark console surfaces, gold = Preview/NEXT, red = LIVE.
 */
export const theme = {
  // Surfaces
  background: "#07090d",
  surface: "#0b0f16",
  video: "#000000",
  border: "#29303c",
  borderSoft: "#1d2530",
  borderLang: "#252d38",
  borderNotice: "#302610",
  borderGoldDeck: "#5f4a25",

  // Text
  ink: "#ffffff",
  body: "#b6bfcc",
  muted: "#87909f",
  mutedAlt: "#8d96a5",
  faint: "#667080",
  onGold: "#191307",
  onGoldButton: "#111111",

  // Accents — gold is the brand + "in Preview / next up" cue color.
  gold: "#d7a94a",
  goldSoft: "#efc76e",
  goldBrand: "#e5b85c",
  goldMuted: "#c9a85f",
  goldTint: "#d7a94a10",
  goldTintStrong: "#d7a94a18",
  goldTintPlayer: "#d7a94a12",
  goldTintActive: "#d7a94a20",

  // Live / connection states — red means on air or disconnected.
  live: "#ff5d5d",
  liveSoft: "#ff8f8f",
  liveTint: "#ff5d5d18",
  liveBorder: "#7f1d1d",
  error: "#fca5a5",

  // Warning states — amber means degraded but recovering.
  warn: "#fbbf24",
  warnTint: "#f4bb5818",
  warnBorder: "#f4bb5840",
  warnBorderStrong: "#713f12"
} as const;

export type Theme = typeof theme;
