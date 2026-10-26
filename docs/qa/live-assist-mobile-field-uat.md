# Live Assist mobile field UAT

This is a **physical-device release gate** for Competitive UX Phase 4. CI proves code contracts; it does not prove one-handed ergonomics, mobile browser behavior, rotation, or real reconnect behavior.

## Required devices

Run the same scenarios on:

- one supported Android phone in Chrome/PWA mode;
- one supported iPhone in Safari and, where installed, home-screen/PWA mode.

Record device model, OS version, browser/PWA mode, network type, tester, date, and service ID. Do not record credentials or congregation-private content.

## Required role scenarios

### Producer / presentation operator

1. Open Live Assist at a narrow portrait width.
2. Confirm PROGRAM / PREVIEW / NEXT remain readable without horizontal scrolling.
3. Use `What do you need next?` to find Scripture and verify typing/searching does not change Program.
4. Prepare a Scripture Preview, then use the existing TAKE control once; verify one Program change only.
5. Clear Program once; verify one clear only.
6. Open Media & Sources, request a Visual Source Preview, and confirm no source-card Program/TAKE bypass exists.
7. Arm Auto Scripture Live through the governed Scripture screen, return to Live Assist, confirm `AUTO SCRIPTURE LIVE ARMED` remains obvious, then use one-action Disarm.

### Pastor / service leader

1. Confirm Program/Preview/Next context is visible as projected.
2. Confirm TAKE and Clear controls are absent, not merely disabled by CSS.
3. Confirm Scripture/Service destinations are present only when role/capability permits them.
4. Verify requests/searches do not grant Program authority.

### Interpreter / media lead

1. Confirm only role-relevant destinations/actions appear.
2. Confirm unrelated engineering counters are absent.
3. Confirm all important buttons/links are comfortable one-handed touch targets.

## Rotation and narrow-width checks

On each phone:

- rotate portrait -> landscape -> portrait during an active service;
- verify PROGRAM / PREVIEW / NEXT and armed Auto Scripture Live state remain discoverable;
- verify bottom navigation remains reachable and does not cover TAKE/Clear or the Find sheet;
- verify long Scripture/media titles truncate or wrap without horizontal page overflow.

## Reconnect / stale-state checks

1. With Program and Preview visible, disable Wi-Fi/mobile data for at least 10 seconds.
2. Confirm Live Assist keeps the last confirmed Program/Preview/Next on screen.
3. Confirm explicit stale/offline/reconnecting guidance appears and states that the last confirmed live state is being shown.
4. While offline, do not expect a consequential action to be accepted as confirmed.
5. Restore connectivity.
6. Confirm the surface reconnects and refreshes current server truth.
7. **Critical:** confirm the app does not replay the last TAKE, Clear, Disarm, Preview request, or other consequential action automatically after reconnect.

## Pass criteria

Phase 4 physical UAT passes only when both Android and iOS runs show:

- no unauthorized Program control for pastor/interpreter/restricted roles;
- no duplicate/replayed consequential mutation after reconnect;
- persistent readable Program/Preview/Next state across narrow widths and rotation;
- Auto Scripture Live armed state remains obvious and one-action Disarm works for authorized operators;
- Visual Sources remains Preview-only outside the existing Program authority;
- one-handed navigation and all important touch targets are usable;
- no blanking of current live state during temporary network loss;
- no blocking overflow or navigation obstruction.

Any authority escalation, duplicate mutation, hidden Program state, or stale state presented as confirmed current state is a release blocker.
