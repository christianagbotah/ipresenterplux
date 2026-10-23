# Operator Persistent Stage Hierarchy Design

## Intent
Preview and Program are the live operator's primary decision surface. They must remain large, readable, side-by-side and continuously visible while library, Bible-browser, schedule and runtime content grows around them.

## Root cause
The center Grid currently gives Preview/Program the only flexible star row while the Details & Bible browser sits in an Auto row containing a large child. Avalonia therefore satisfies the details height first and compresses the stage row, sometimes to near-zero height.

## Chosen approach
Keep the existing three-column operator model, but make the center vertically proportional: a protected 3* live-stage row and a secondary 2* details row. Give the live row a 180px floor and 330px ceiling; allow each 16:9 stage to grow to 560x315. Put Details & Bible browser in its own scrolling row instead of an Auto/max-height child.

## Constraints
- Preview and Program remain equal 16:9 surfaces.
- Preview/Program cannot disappear when Bible verses or selected-item details grow.
- TAKE/Clear/Open Program remain immediately beneath the live monitors.
- Left library and right schedule/runtime keep independent scrolling.
- Details/Bible browser keeps its own internal vertical scroll.
- No change to cue authority, single-click Preview, double-click Program, media, Scripture, pairing, licensing, recording or streaming semantics.
- Restored 1040x640 remains usable; widescreen laptops should exploit extra center width.
