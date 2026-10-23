# Bible Catalog + Voice Scripture Design

## Intent
Make Scripture a first-class desktop operator resource: churches can discover/install legally distributable offline Bible editions, and the production microphone can detect spoken Scripture references or quoted verse text and stage matches safely into Preview.

## Decisions
- Desktop Bible manager shows a searchable catalog, not only installed/downloadable rows.
- One-click download is enabled only for editions whose full-text redistribution/source is explicitly permitted. Restricted editions remain discoverable with `License/provider required`; no copyrighted full text is bundled or scraped.
- Keep the existing VPL offline store/resolver and extend its package catalog; installed editions remain usable without Internet.
- Voice Scripture reuses the existing WASAPI/CoreAudio -> ASR -> durable transcript -> control-plane reference/quote/context detector. Do not create a competing local detector.
- The default live policy is Auto Preview; taking content to Program remains explicit. Existing guarded Auto Live remains opt-in/admin controlled.
- Remote ASR uses the existing Edge device credential through a Control Plane ASR gateway. The private ASR worker token never ships to desktop clients.
- Desktop surfaces Mic / ASR / Voice Scripture state so an operator can see whether listening is actually working.

## Safety and resilience
- Presentation/output must continue if ASR fails.
- No raw ASR provider secret in the desktop shell.
- No automatic Program mutation from the new desktop default.
- Audio requests are bounded and authenticated; worker URL is server-side only.
- Current local manual Bible lookup remains available in rehearsal even without an active cloud service.
