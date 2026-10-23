# Operator Field UAT Interaction Design

## Intent
Repair the physical-laptop Operator workflow exposed by build 1.0.454 so an operator can stage and take content without a synchronized service, manage offline Bible editions, and use Setup & Runtime comfortably on smaller displays.

## Goals
- A single click/tap on a rundown row stages that item in Preview.
- A double click/tap on a rundown row stages it and then takes it to Program.
- Scripture lookup works in local rehearsal when a downloaded local Bible edition is available.
- The desktop exposes a real Bible Versions manager that downloads approved public-domain packages for offline use.
- Synced service scripture continues to use the existing Edge/catalog authority when appropriate.
- Setup & Runtime places Control Plane URL + one-time code on row 1 and Device name + Program output on row 2.
- Setup sidebar and setup main content scroll independently.

## Non-goals
- No automatic Program mutation from search text alone.
- No redistribution of copyrighted Bible translations without explicit rights.
- No change to media playback, recording, pairing security, output authority, or release signing.

## Chosen approach
1. Keep Preview/Program authority in the desktop/Edge flow.
2. Add pointer-driven rundown behavior in the desktop shell, with double-click waiting for any first-click Preview to settle before TAKE.
3. Add a desktop-owned offline Bible library under the existing iPresenterPlux local data root. It downloads a small curated catalog of public-domain eBible VPL ZIP packages, validates ZIP size/content, extracts only the VPL text file, and resolves references locally.
4. Merge downloaded local Bible editions with synchronized Control Plane versions in the desktop selector. Local resolution is preferred for installed editions; otherwise the existing Edge scripture resolver remains the fallback.
5. Replace the Setup screen's outer shared ScrollViewer with independent sidebar and main ScrollViewers.

## Bible package policy
Initial downloadable catalog: World English Bible (WEBP), American Standard Version (ASV), and King James Version (KJV), sourced from eBible VPL packages. Only editions explicitly marked public domain are included. Package downloads must use HTTPS, bounded response size, ZIP-entry validation, atomic file replacement, and no arbitrary archive extraction.

## Interaction rules
- Single click/tap: Preview only.
- Double click/tap: Preview selected item if necessary, then TAKE to Program.
- Keyboard safety remains F6 Preview, F8 TAKE, F7 Clear.
- Search/filtering alone never changes Preview or Program.
- If local Bible lookup fails and no active synced service can resolve the passage, show a direct operator error instead of silently doing nothing.
