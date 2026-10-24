# Khaya Developer UAT Enablement Design

## Intent
Use the active Khaya Developer subscription for bounded development/UAT of iPresenterPlux multilingual translation and text-to-speech before production plan selection.

## Decisions
- Keep the Khaya subscription key server-only in `.secrets/ghananlp-token.txt` with mode 0600.
- Enable Khaya Translation and Khaya TTS on the VPS for development testing.
- Validate with a tiny real call budget: one English→Twi translation and one Twi TTS synthesis first; only expand to Ewe/Ga after success.
- Provider failures degrade interpreted voice/text only and must not affect local presentation, ASR, Preview or Program.
- Do not add Khaya credentials to Control browser code, audience clients, Windows/macOS Edge, mobile clients, GitHub, or release artifacts.
- Keep PR #109 draft and stable channel untouched.

## Desktop impact
Khaya runs behind Control/worker APIs. The current Edge tree is unchanged from Windows beta 1.0.496, so no desktop rebuild is required unless contract verification finds a native dependency on provider-specific behavior.

## Rollback
Set `IPRESENTERPLUX_TTS_PROVIDER=disabled` and/or `IPRESENTERPLUX_TRANSLATION_PROVIDER=disabled`, restart the affected worker, and retain the prior server files and beta package.