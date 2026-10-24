# Operator Compact Layout Design

## Intent
Make the Windows Operator workspace dense, clean, and production-first so Schedule, Preview, Program, and Resource Deck fit comfortably on one screen without descriptive text wasting vertical space.

## Required behavior
- Keep single-click = Preview and double-click = Program for Library and Schedule rows.
- Replace the multi-line Live Production header with one compact row only.
- Give Service Schedule substantially more horizontal space; Preview and Program cards must closely fit their 16:9 stages instead of stretching across large empty cards.
- Remove redundant Preview/Program explanatory subtitles and shortcut hint from the header.
- Keep Resource Deck title, remove the two descriptive lines beneath it, and keep category tabs fixed/non-scrollable.
- Keep Add Selected as a fixed action outside any scroll surface.
- Remove the Selected Content/details display from the Operator workspace.
- Remove the persistent bottom update bar. Surface updates under a compact About menu aligned with the top tabs.
- Do not change Program authority, AI/Khaya behavior, pairing, or Control Plane contracts.

## Approach
Modify the existing Avalonia layout in place. Use a wider star-weighted schedule column and compact stage columns, simplify the resource deck to a single full-width library surface, and refactor DesktopUpdateHost from a bottom DockPanel bar into a top-right About menu overlay. Preserve existing click handlers and schedule actions.
