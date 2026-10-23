# Operator Field UAT Interaction Design

## Intent
Turn the physical-laptop Operator surface from a runtime shell into a practical church presentation console while preserving Edge as the authority for Preview, Program and media output.

## Goals
- Stop heartbeat-driven visual flicker by avoiding collection/layout rebinding when presentation/catalog identity has not changed.
- A single click/tap on Library or Schedule content stages that item in Preview; a double click/tap stages it and then takes it to Program.
- Separate the desktop workflow into Library/Search, Selected Content details, Preview/Program and a Service Schedule.
- Persist the local rehearsal schedule and allow Add, Remove, Move Up and Move Down without silently mutating the cloud planner.
- Scripture lookup works in local rehearsal when a downloaded local Bible edition is available.
- The desktop exposes a Bible Versions manager for approved public-domain offline editions.
- Selecting/seeking Scripture exposes a whole-chapter browser with Book, Chapter, From verse and To verse controls plus Preview Verse Range.
- Make AI Scripture discoverable from Operator with Manual, Auto Preview and guarded Auto Live semantics; policy mutation remains in the authenticated Control Plane for this field candidate.
- Setup & Runtime places Control Plane URL + one-time code on row 1 and Device name + Program output on row 2.
- Setup sidebar and setup main content scroll independently.

## Non-goals
- Search text alone never mutates Program.
- Do not redistribute copyrighted Bible translations without explicit rights.
- The local field schedule does not overwrite the cloud service planner.
- This pass does not weaken media download safety, pairing security, recording scope, release signing or the explicit TAKE safety model.
- Organization-wide Songs/Slides/Media remain cloud-owned data; desktop-wide organization library synchronization is a follow-on transport task rather than exposing browser-session credentials to the shell.

## Chosen approach
1. Keep Preview/Program authority in the existing desktop-to-Edge IPC path.
2. Gate periodic UI refreshes by Preview/Program/service/media-preparation identity so a one-second heartbeat cannot continuously rebuild ListBox/ComboBox collections.
3. Treat the left surface as Library/Search and the right top surface as a persisted local Service Schedule; the center Selected Content surface explains exactly what will be staged and exposes Scripture browsing when possible.
4. Use the same Preview/TAKE methods for pointer gestures, keyboard shortcuts and schedule operations.
5. Add a desktop-owned offline Bible library under the existing iPresenterPlux local data root. Download a curated catalog of public-domain eBible VPL ZIP packages, validate bounded ZIP/VPL content, extract only the VPL text file and resolve references locally.
6. Merge downloaded Bible editions with synchronized Control Plane versions. Local resolution is preferred for installed editions; the existing Edge scripture resolver remains the synced-service fallback.
7. Persist only the local field schedule as bounded JSON with atomic replacement. Cloud planning remains an explicit web/planner action.
8. Surface the existing Control Plane Scripture automation workspace from desktop rather than duplicating live-service authorization/arming logic in this pass.

## Bible package policy
Initial downloadable catalog: World English Bible (WEBP/WEB), American Standard Version (ASV), and King James Version (KJV), sourced from eBible VPL packages. Only editions explicitly marked public domain are included. Downloads require HTTPS, bounded response size, ZIP-entry validation, atomic file replacement and no arbitrary archive extraction.

## Interaction rules
- Single click/tap: Preview only.
- Double click/tap: Preview selected item if necessary, then TAKE to Program.
- F6 Preview, F8 TAKE and F7 Clear remain available.
- Search/filtering alone never changes Preview or Program.
- Selected Scripture with a downloaded local edition opens its entire chapter in the details browser; a verse/range is explicitly previewed.
- Manual AI mode leaves detections for operator action; Auto Preview may stage eligible detections; Auto Live remains separately armed and guarded by organization permission, live service and active Edge checks.
- If local Bible lookup fails and no active synced service can resolve the passage, show a direct operator error instead of silently doing nothing.
