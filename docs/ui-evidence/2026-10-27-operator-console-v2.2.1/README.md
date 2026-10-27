# Operator Console v2.2.1 — Physical Render Evidence (2026-10-27)

Real renders of the **unmodified** desktop shell (`MainWindow` and friends,
taken from commit `99d6571`) captured on the Avalonia headless platform with
real Skia rendering (`UseHeadlessDrawing = false`) at 2x scaling, downscaled
here to the exact operator-facing resolutions.

Capture method highlights (full harness lives outside the repository):

- the window boots through the app's genuine startup path — settings load,
  schedule load, and an Ed25519-signed test entitlement verified by the real
  `EntitlementVerifier` (public key injected via
  `IPRESENTERPLUX_ENTITLEMENT_PUBLIC_KEYS_JSON`), so the Operator tab opens
  through the real gate;
- every workspace geometry below was **restored from a seeded
  `settings.json`** through the app's own `ApplySavedWorkspaceLayout`
  persistence path, and each run re-persisted the identical star ratios on
  close (the values printed by the harness matched the seeds exactly);
- the service schedule rows come from the app's own
  `operator-schedule.json` store format; the resource list shows the app's
  designed offline rehearsal catalog ("LOCAL REHEARSAL" status is truthful —
  no Edge runtime is running in the render host);
- the only substituted behavior is the entitlement vault backend
  (Windows Credential Manager / macOS Keychain do not exist on the Linux
  render host); it has no effect on layout or rendering.

## Evidence index

| File | Resolution | Workspace state |
| --- | --- | --- |
| `prod-1920-1920x1080.png` | 1920x1080 | Studio default (Production preset, schedule sidebar) |
| `prod-1440-1440x900.png` | 1440x900 | Studio default on the mid-size laptop panel |
| `prod-1366-1366x768.png` | 1366x768 | Studio default on the smallest supported panel |
| `library-1920-1920x1080.png` | 1920x1080 | Resource Deck at default sidebar width — category strip overflows into ‹ › navigation with the edge fade; 5 of 6 categories visible |
| `wide-resource-1920-1920x1080.png` | 1920x1080 | Resource pane widened (media browsing) — all categories fit |
| `narrow-library-1366-1366x768.png` | 1366x768 | Resource Deck at the 220px sidebar floor — 2 full categories + faded partial + arrows, search row absorbs the squeeze |
| `narrow-resource-1920-1920x1080.png` | 1920x1080 | Schedule sidebar dragged narrow |
| `scripture-1920-1920x1080.png` | 1920x1080 | Scripture preset — Bible browser sidebar, deck biased to TITLES & SCRIPTURE |
| `streaming-1920-1920x1080.png` | 1920x1080 | Streaming preset — stage-dominant monitoring shape |
| `pp-split-40-60-1920-1920x1080.png` | 1920x1080 | Preview/Program seam dragged toward Preview (~40/60) |
| `sidebar-collapsed-1366-1366x768.png` | 1366x768 | Library sidebar collapsed — rail-only workspace |
| `deck-collapsed-1920-1920x1080.png` | 1920x1080 | Playout deck collapsed — stage fills the body |
| `media-1366-1366x768.png` | 1366x768 | Media preset on the small panel — wide browser + tight stage |

## Review notes

- Linux headless renders use fontconfig fallbacks for the Windows/macOS
  system fonts; per-OS glyph metrics differ slightly on the booth machines.
  Structure, density, splitter behavior, overflow states and 16:9 stage
  contracts are what these renders evidence.
- These files are review evidence only. If you would rather not carry them
  in the tree, delete this directory before merge — nothing references it
  from code or CI.
