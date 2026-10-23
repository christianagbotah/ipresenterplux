# Operator Layout Field-UAT Repair Design

## Intent
Use the laptop-class Operator viewport more efficiently based on physical field feedback: eliminate Scripture Lookup control collisions, keep Preview and Program visually close, give the left and right operator panes more usable width, and move the transition safety hint beneath the action buttons instead of between Clear Program and Open Program.

## Chosen approach
Keep the existing three-column Avalonia Operator architecture and make a focused layout repair rather than redesigning the workspace. Increase side-rail usability slightly, reduce outer/inter-column/vertical gutters, allow larger 16:9 stages on wider displays, force Bible version and Find & Preview into separate grid rows, and split the transition bar into an action row plus a dedicated hint row.

## Constraints
- Preserve 16:9 Preview and Program rendering.
- Preserve F6 Preview, F8 Take, F7 Clear and all Edge-authoritative behavior.
- Do not change media, pairing, subscription, recording, or output semantics.
- Keep the outer Operator viewport fixed; side panes own vertical overflow.
- Remain usable at the existing 1040x640 restored window target and common 1366x768 laptops.
