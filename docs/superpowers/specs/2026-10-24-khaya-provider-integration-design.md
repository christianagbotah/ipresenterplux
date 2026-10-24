# Khaya Provider Integration Design

## Intent
Use the user's active Khaya subscription key for iPresenterPlux African-language translation and speech without exposing the credential, while preserving the existing Google and custom GhanaNLP adapters.

## Chosen approach
Add a distinct `khaya` provider to both Python workers using the existing `httpx` architecture. The provider reads the subscription key only from a mode-600 server file and authenticates with `Ocp-Apim-Subscription-Key` against `https://translation-api.ghananlp.org`.

Alternatives considered: replacing the existing `ghananlp` TTS adapter (rejected because it has a different bearer-auth contract and may still be useful), or adding the Khaya SDK dependency (rejected because the workers already implement bounded HTTP calls and adding another retry layer could spend metered calls twice).

## Translation contract
- Endpoint: `POST /v1/translate`.
- Body: `{ "in": text, "lang": "en-tw|en-ee|en-gaa" }`.
- English target from English source is an identity result with no metered API call.
- French is not routed to Khaya because Khaya's translation catalogue is English/African-language pivot; French remains a Google-provider requirement.
- Fail closed on ambiguous/unsupported languages, non-2xx responses, malformed JSON, or empty translations.

## TTS contract
- Endpoint: `POST /tts/v1/tts`.
- Body: `{ "text": text, "language": "eng|fra|twi|ewe|gaa" }`, optionally `speaker_id`.
- Accept only valid bounded WAV audio.
- Khaya generic speakers are `female`, `male_low`, and `male_high`; no automatic voice cloning is introduced.

## Security and deployment
- Key file: `/home/lightworld/webapps/ipresenterplux/.secrets/ghananlp-token.txt`, mode 600, owner `lightworld`.
- Translation reads `/home/lightworld/webapps/ipresenterplux/.secrets/translation-provider.env`; TTS uses the existing `tts-provider.env`.
- Provider readiness must not call Khaya every polling cycle or consume quota.
- Provider enablement is reversible: code/config lands first; live service is enabled only after tests and safe service-level verification.
