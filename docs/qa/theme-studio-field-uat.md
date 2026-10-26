# Theme Studio — Physical Projector UAT Gate

Phase 5 is not release-ready until this checklist is executed on a **Windows Edge** connected to a real projector/display and the JSON report passes `pnpm theme-studio:field-uat <report.json>`.

## Hardware record
Record Edge version/commit, Windows version, GPU/output adapter, projector/display model, cable/adapter, and tested resolution. Minimum release run: 1920×1080 landscape. Repeat at the church's normal production resolution if different.

## Required cases
Use the generated report template (`pnpm theme-studio:field-uat:init <report.json>`) and complete every category:

- `scripture_long` — Preview and Program a long multi-verse Scripture; all visible text remains readable and inside safe zones.
- `lyrics_long` — Preview/Program long song lines and rapid verse changes; no clipping or unreadable scaling.
- `announcement` — title/body/footer hierarchy remains legible at distance.
- `lower_third` — lower-third geometry stays within title-safe area and does not obscure critical content.
- `image_background` — a church-owned local image background renders or fails to the documented safe fallback; no remote URL execution.
- `logo_safe_zone` — logo placement/size remains inside safe zones without covering primary text.
- `theme_switch_no_take` — change the service Theme while Preview/Program are populated; Theme assignment must not TAKE, clear, or replace Program content.
- `invalid_theme_fallback` — inject/replay malformed or future-version Theme metadata in a test environment; Edge must retain readable default styling and keep rendering.
- `offline_continuity` — after the required Theme/content has been fetched, disconnect Internet/control-plane access and confirm local Program/Preview remain readable through the Edge loopback renderer and restart recovery path.

For every case mark `status`, `readable`, and `programMutationObserved`. **Any** unsafe Program mutation, unreadable output, failed/pending case, missing required category, or incomplete hardware record blocks Phase 5 release.

## Additional operator checks
Confirm Theme Studio itself stays out of the Essential live Cockpit, all important touch controls are at least 44px, operational copy remains at least 12px, built-ins cannot be overwritten, and custom Theme edits remain local until Save. Verify a Theme switch does not create `program.show`, `program.clear`, or a Scripture state transition audit event.

## Commands
```bash
cd apps/control
pnpm theme-studio:field-uat:init ../../../theme-studio-field-uat.json
# Fill the generated file during physical testing.
pnpm theme-studio:field-uat ../../../theme-studio-field-uat.json
```
