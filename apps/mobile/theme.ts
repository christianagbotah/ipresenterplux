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
  background: "#04070c",
  surface: "#090e15",
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
  gold: "#e3b75c",
  goldSoft: "#f0ca80",
  goldBrand: "#e5b85c",
  goldMuted: "#c9a85f",
  goldTint: "#e3b75c10",
  goldTintStrong: "#e3b75c18",
  goldTintPlayer: "#e3b75c12",
  goldTintActive: "#e3b75c20",

  // Live / connection states — red means on air or disconnected.
  live: "#ff5c5c",
  liveSoft: "#ff8f8f",
  liveTint: "#ff5c5c18",
  liveBorder: "#7f1d1d",
  error: "#fca5a5",

  // Warning states — amber means degraded but recovering.
  warn: "#fbbf24",
  warnTint: "#f4bb5818",
  warnBorder: "#f4bb5840",
  warnBorderStrong: "#713f12"
} as const;

export type Theme = typeof theme;
