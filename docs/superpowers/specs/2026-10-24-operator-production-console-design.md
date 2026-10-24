# Operator Production Console Design

**Intent:** Move iPresenterPlux Operator from a dashboard/card layout to a dense professional live-production workspace inspired by the interaction strengths of EasyWorship, OBS, and vMix while keeping iPresenterPlux visual identity and safety rules.

## Goals
- Schedule, Preview, Program, and Resource Deck must be runtime-resizable.
- Preview and Program canvases must fill their panes instead of sitting inside oversized cards with dead space.
- Default geometry should resemble a production console: narrow schedule rail, large Preview/Program, substantial lower resource dock.
- Pane boundaries must be obvious but visually quiet; drag targets should use thin splitters, not large gaps.
- Resource tabs/actions stay fixed while resource results consume remaining space.
- Single-click Preview and double-click Program behavior remains unchanged.
- F6 Preview, F8 Take, F7 Clear and physical Program authority remain unchanged.

## Approach
Use Avalonia's built-in `GridSplitter` rather than introducing a third-party docking framework in this pass. The upper workspace becomes five columns: Schedule, splitter, Preview, splitter, Program. The whole production/resource workspace becomes three rows: production, horizontal splitter, resources. Preview/Program panes become flat tool panes that stretch to available bounds, and the 16:9 stage Viewbox scales with the pane.

This creates the EasyWorship-style adjustable production layout immediately with low runtime risk. Full drag-to-rearrange/detachable docking can be layered later if field UAT proves it is worth the added complexity.

## Defaults
- Upper production height: about 58% of workspace; Resource Deck about 42%.
- Schedule: about 22% of upper width.
- Preview and Program share the remainder roughly equally.
- Splitter hit targets: 5 px with subtle divider color and resize cursors supplied by Avalonia.
- Flat pane chrome: small uppercase pane title, no rounded oversized outer cards, 6–8 px internal padding.

## Non-goals
- Do not imitate EasyWorship/OBS/vMix branding, icons, or proprietary assets.
- Do not change cloud APIs, local operator command contracts, AI authority, or output safety.
- Do not add third-party docking dependencies in this pass.

## Acceptance
- Every major Operator pane can be resized by dragging a visible divider.
- Preview/Program content grows and shrinks with its pane while preserving 16:9.
- No fixed `MaxWidth = 400` production-card cap or `MaxWidth = 320` stage cap remains.
- Resource Deck height is adjustable.
- Schedule/Preview/Program remain simultaneously visible at normal laptop/desktop widths.
- Existing direct click/double-click and keyboard production controls remain intact.