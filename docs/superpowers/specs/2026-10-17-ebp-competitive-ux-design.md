# iPresenterPlux Competitive UX Architecture — Express Bible Presenter Benchmark

Date: 2026-10-17
Status: Draft for written-spec review
Owner: Lightworld Technologies Ltd
Extends: `2026-10-08-intelligent-service-cockpit-design.md`
Related: `2026-10-10-native-edge-visual-capture-design.md`

## Purpose

iPresenterPlux must beat current church-presentation tools by becoming easier to operate under live-service pressure while offering a deeper production platform underneath. This design uses Express Bible Presenter (EBP) as a current competitive benchmark without copying its source code, visual design, proprietary assets, or interaction implementation.

The product promise is:

> **A first-time church volunteer should be able to run a service confidently within ten minutes, while a professional production engineer can keep discovering serious capability underneath.**

The competitive strategy is not “more controls than EBP.” It is **less visible interface, more intelligence, safer live operation, stronger native media foundations, and richer church-specific automation.**

## Competitive evidence baseline

The benchmark was inspected from the public `Expressconsult-cmd/express-bible-presenter` repository and its declared official domain `expressbiblepresenter.com.ng` on 2026-10-17. The repository showed active commits through 2026-10-16.

Observed EBP strengths include:

- Bible chapter navigation and instant word search;
- browser speech recognition for spoken Scripture commands;
- song lyric search, saved songs, pasted lyrics and PDF/Word/TXT lyric import;
- media support including images, video, PDF and PPTX;
- projector/OBS-oriented output modes;
- configurable text, backgrounds, logos, lower thirds, transitions and hotkeys;
- mobile remote control with QR/PIN linking, Bible, songs, media, announcements, timer, freeze and blank controls;
- light/dark interface options and substantial operator customization.

Observed competitive openings include:

- the desktop production surface exposes many controls, ribbons, selectors and design options at once;
- its current voice workflow depends on browser `SpeechRecognition` / `webkitSpeechRecognition`, with explicit Chrome/Edge and secure-context limitations;
- its reviewed architecture is strongly browser-centric for control and remote operation;
- styling power is presented largely as production-time controls rather than a reusable design-system workflow;
- the remote experience is simpler than the main desktop experience, demonstrating that reduced interaction density materially improves usability.

These observations are evidence for product positioning only. iPresenterPlux must not reproduce EBP code, proprietary UI composition, text, graphics, or implementation details.

## Product positioning

iPresenterPlux is a **church service operating system with an intelligent production cockpit**, not merely a Bible presenter and not a general-purpose broadcast switcher.

It combines:

- presentation;
- Scripture intelligence;
- songs and media;
- native visual sources;
- audience delivery;
- interpretation and translation;
- recording and streaming;
- service planning;
- AI recommendations;
- service memory and archive.

The default operator should not experience these as ten unrelated applications. The active service is the organizing context.

## Non-negotiable product principles

1. **Preview remains private; Program remains deliberate.** AI and operators may prepare Preview. Only authorized Program actions change what the congregation receives.
2. **Power is progressively disclosed.** Capability may be deep; the default live surface must stay shallow.
3. **One obvious next action beats ten equivalent controls.** Context decides which actions are prominent.
4. **AI prepares work instead of creating more dashboards.** Recommendations appear where the operator already works.
5. **Physical source truth comes from Edge.** Browser UI never pretends to own sanctuary cameras, displays or windows.
6. **Operational truth beats requested state.** Preview/Program badges reflect confirmed Edge state, not merely commands sent.
7. **Offline Sunday operation is a product requirement.** Losing cloud/control-plane connectivity must not unnecessarily destroy local presentation or Program continuity.
8. **Role and visual depth are separate.** Essential/Advanced/Engineering changes presentation density, never authorization.
9. **The product remembers the service.** Scripture, songs, speakers, media, sources, translations, incidents and output history become reusable context.
10. **No competitor cloning.** We may preserve familiar concepts and import portable user content, but the interaction model must remain distinctly iPresenterPlux.

## Success criteria

The competitive redesign succeeds when:

- a new operator can identify Program, Preview, Next and the primary search/command entry without instruction;
- a Scripture reference can be found and safely placed in Preview in one direct interaction sequence;
- a returning operator can run most ordinary Sunday actions without opening advanced settings;
- a professional operator can reach detailed source, output and diagnostic controls without leaving the product;
- mobile live control is task-first rather than a compressed desktop layout;
- rich styling is primarily prepared as reusable Themes rather than rebuilt during live operation;
- AI recommendation flow reduces search and navigation without bypassing live safety;
- camera/display/window state is confirmed by Edge and shown accurately;
- accessibility floors remain at least 12px for operational text and 44px for important touch targets;
- first-successful-service time and operator actions are measurably lower than the legacy/module-first workflow.

## Experience model

The operating model remains:

**Prepare -> Assist -> Preview -> Program -> Remember**

This competitive design sharpens each phase:

- **Prepare** creates themes, service plans, source preferences, media, translations and likely content before the room is live.
- **Assist** uses the Universal Command surface and Predictive Next to find or prepare content with minimal navigation.
- **Preview** is the universal private verification surface for presentable content.
- **Program** is a deliberate authority boundary with clear TAKE/Clear/emergency-safe actions.
- **Remember** stores structured service history for reuse and future recommendations.

## Progressive depth contract

### Essential

Default for volunteers and ordinary Sunday operators.

Visible by default:

- active service;
- Program;
- Preview;
- Next;
- universal search/command;
- Scripture, Songs and Media quick entry;
- TAKE;
- Clear/Black as separately protected actions;
- plain-language attention state.

Hidden by default:

- codec details;
- raw device handles;
- transport paths;
- low-level worker metrics;
- detailed styling controls;
- provider-specific streaming diagnostics.

### Advanced

Adds:

- Visual Sources;
- lower thirds and announcements;
- audience and language controls;
- recording/streaming destinations;
- rundown detail;
- Theme selection and selected safe overrides;
- AI evidence and recommendation controls.

### Engineering

Adds:

- source modes and device detail;
- NDI/SRT/RTMP and related routing detail;
- encoder/output health;
- worker/provider diagnostics;
- detailed latency/counters;
- troubleshooting and recovery tooling.

The selected depth is a display preference, not a permission grant.

## Information architecture

The product navigation should reflect service work rather than implementation modules.

### Primary surfaces

- **Cockpit** — default live-service surface.
- **Plan** — service preparation and rundown.
- **Library** — Scripture assets, Songs, Media and reusable content.
- **Live Systems** — Visual Sources, Audience, Translation and Streaming.
- **Intelligence** — AI Director, recommendation history and future automation policy.
- **Archive** — completed-service memory.
- **Settings** — organization, users, devices, subscriptions and technical configuration.

Existing route compatibility may remain, but navigation labels should converge on this model.

## Cockpit competitive layout

The desktop Cockpit remains **Now | Stage | Next**, with Program and Preview continuously visible.

### Header

The header contains only service-level information and global actions:

- active service name/state;
- compact health/attention state;
- Universal Command trigger;
- Focus Mode;
- user/depth control.

Do not place dense design controls or device configuration in the header.

### Now rail

Shows current context only:

- what is live;
- current Scripture/song/media/source;
- speaker/context when known;
- live language/audience summary when relevant;
- only active impact or warnings.

Healthy systems recede.

### Stage

The central stage contains:

- Preview;
- TAKE PREVIEW LIVE;
- Program;
- Clear/Black emergency-safe controls;
- explicit content/source labels;
- visible confirmation of what the congregation is receiving.

Preview and Program may show Scripture, song, media, graphic, camera, display or window content through the same mental model.

### Next rail

Contains a small ranked queue from:

- service rundown;
- AI recommendation;
- operator pin;
- recent search/command result;
- source suggestion.

Every Next card answers:

- what is suggested;
- why;
- confidence when AI-derived;
- whether it is only suggested or already prepared;
- one primary action such as `Preview`.

Nothing in Next directly bypasses Preview to mutate Program.

## Universal Command and Search

The Universal Command surface is the fastest way to reach content or authorized actions. It must not feel like opening a chatbot.

Persistent prompt language may be:

**What do you need next?**

It accepts deterministic and natural inputs such as:

- `John 3:16`;
- `Romans 8`;
- `Jesus wept`;
- `Way Maker`;
- `offering video`;
- `pulpit camera`;
- `welcome our visitors`;
- `prepare Psalm 23 NLT`;
- `open French interpretation`;
- `what is wrong with YouTube?`.

Results are grouped consistently:

**Scripture · Songs · Media · Service · Visual Sources · Actions**

### Command safety

- navigation/search/read actions may happen immediately;
- ambiguous commands show the interpretation before mutation;
- live-capable actions use existing authorized domain commands;
- source selection prepares Preview only;
- no natural-language phrase is allowed to silently bypass Preview/Program authority;
- commands that are unavailable offline degrade to deterministic local search/actions where possible.

### Keyboard and touch

- desktop shortcut: `Ctrl/Cmd+K` opens the command surface;
- `/` may focus search where it does not conflict with an input field;
- Arrow keys navigate results;
- Enter performs the safe primary action, normally Preview for presentable content;
- live TAKE remains a separate explicit shortcut/action;
- touch layout uses at least 44px primary targets.

## Scripture experience — Find -> Prepare -> Preview

Scripture is a signature workflow and must be faster than navigating book/chapter trees for ordinary use while still supporting traditional browsing.

### Entry methods

- exact reference;
- abbreviation (`Rom 8:28`);
- phrase search;
- word search;
- whole chapter;
- recent references;
- favourites;
- service-plan references;
- voice detection;
- AI quote/context matching;
- manual Bible browser.

### Fast reference flow

1. Operator types or speaks a reference.
2. The system resolves canonical book/chapter/verse and configured translation.
3. A result appears with verse text and translation.
4. Primary action is `Preview`.
5. Preview updates privately.
6. Operator verifies and uses TAKE separately.

### Voice-assisted flow

When sermon speech produces a high-confidence Scripture reference:

- a compact Next recommendation appears;
- it includes reference, translation, confidence and evidence/source freshness;
- AI may preload the Scripture data;
- the operator chooses Preview;
- Program remains unchanged until TAKE.

Low-confidence detections never create a misleading “confirmed” state. They may appear as suggestions or require a second disambiguating choice.

### Scripture workspace

The detailed workspace supports:

- reference/phrase search;
- book/chapter browsing;
- translation switching;
- side-by-side translation comparison;
- whole chapter rendering;
- previous/next verse and context range;
- recent/history/favourites;
- theme preview;
- long-verse fit preview;
- primary/secondary translation output where configured.

The detailed workspace is not required for routine live lookup.

### Audience independence

Projector translation and audience-device translation are separate concerns. Audience members may choose supported languages without forcing the projector to change.

## Songs and Media

EBP demonstrates that lyric and media breadth is table stakes. iPresenterPlux should match common import/use cases while simplifying live operation.

### Songs

Support:

- saved songs library;
- paste lyrics;
- TXT/DOCX/PDF import where legally and technically supportable;
- configurable stanza/line grouping;
- verse/chorus/bridge semantic structure where detected or manually assigned;
- theme assignment;
- service-plan insertion;
- search from Universal Command;
- Preview before Program.

Online lyric discovery must respect copyright/licensing and should not become an uncontrolled scraping dependency.

### Media

Support common portable assets:

- images;
- video;
- PDF;
- PPTX where supported;
- reusable graphics;
- service-plan assets.

The live operator sees simple actions: `Preview`, `Play/Pause` where relevant, `Next/Previous` for paged media, and `Clear`. Import/transcoding/detail belongs outside the live surface.

## Visual Sources

The current `/cameras` route evolves into the **Visual Sources** workspace while route compatibility may remain.

### Categories

- **Cameras**
- **Screens**
- **Windows**

### Source card

Each source card displays:

- operator-friendly name;
- kind;
- reporting Edge device;
- availability/capture status;
- useful mode summary such as resolution/fps when confirmed;
- last report freshness;
- confirmed Preview badge;
- confirmed Program badge;
- camera preference/label where applicable.

### Safe actions

Authorized source-card actions are limited to:

- `Preview`;
- `Rescan`;
- `Clear Preview`;
- label/preference where appropriate.

There is **no Go Live / TAKE action on a source card**.

The only route to live visual Program is:

**Visual Sources -> Preview -> Studio TAKE -> Program**

Requested state and confirmed Edge state must remain visually distinct.

## Theme Studio

A major competitive improvement is moving design complexity out of live operation.

### Principle

Rich styling remains possible, but Sunday operators select a prepared **Theme** rather than manipulating dozens of independent controls while live.

### Initial theme types

- Sunday Modern;
- Sermon Scripture;
- Lower Third Scripture;
- Worship Lyrics;
- Announcement;
- Youth Service;
- Conference;
- Funeral;
- Wedding.

Organizations can duplicate and customize themes.

### Theme capabilities

Theme Studio may control:

- font family and weight;
- size and responsive fitting;
- text/reference colors;
- alignment and safe zones;
- background color/gradient/image/video;
- logo position/size;
- opacity;
- text shadow/backing treatment;
- transitions;
- lower-third geometry;
- primary/secondary translation typography;
- output-specific variants where required.

### Live overrides

Advanced users may apply a limited safe subset of temporary live overrides. Temporary changes must be visibly temporary and must not silently mutate the saved theme.

### Automatic fit

Scripture/lyric presentation should automatically handle overflow according to theme rules before forcing manual font adjustments. Where content cannot fit safely, the system should split or warn rather than silently crop.

## Mobile Live Assist

Mobile is a purpose-built live controller, not a scaled desktop Cockpit.

### Primary destinations

- **Live Assist**
- **Scripture**
- **Service**
- **Media & Sources**
- **Audience**

Tabs are role-filtered. A user sees only surfaces relevant to their role and subscription.

### Persistent live strip

Where the role can operate live presentation, the top of the mobile interface shows:

- Program summary;
- Preview summary;
- Next summary;
- connection/attention state.

### Mobile live actions

Large primary actions include:

- Preview selected Scripture/song/media/source;
- Previous/Next where contextually valid;
- TAKE for roles with live authority;
- Clear/Black with protective treatment;
- quick announcement;
- source/media transport when authorized.

The app should preserve EBP remote’s strongest lesson—large, task-specific touch controls—while retaining iPresenterPlux Preview/Program safety.

### Mobile voice

A mobile operator may speak a Scripture reference or command. The result is resolved through the same command/Scripture pipeline and normally lands in Preview or Next. Voice is not a direct Program bypass.

## AI differentiation

AI is the durable competitive moat only when it saves operator work.

### Predictive Next

Uses service context, transcript, Scripture detection, rundown, recent content, source availability and audience/language context to rank likely next actions.

Examples:

- `Romans 8:28 detected · 94% · Preview`;
- `Offering item next in plan · Preview offering graphic`;
- `Pastor moved to lectern · Pulpit Camera available · Preview`;
- `French listeners connected · French interpretation available`.

### AI confidence contract

Every AI recommendation shows enough evidence for the operator to understand why it exists. Confidence and freshness affect ranking. Stale recommendations expire rather than lingering.

### AI failure behavior

If AI/ASR is unavailable:

- manual Scripture search still works;
- local Bible data still works where available;
- media/source Preview still works;
- Program continues;
- the operator sees plain-language impact, not an infrastructure panic wall.

## Translation and audience moat

Audience experience is a first-class differentiator beyond traditional presenter tools.

The audience client should support, subject to configured capabilities:

- live Scripture/content;
- captions/transcript;
- live video where available;
- listener-selected language;
- interpreted/translated audio channels;
- service links/QR onboarding;
- no production controls.

Future same-voice/accent translation must remain a separate, permissioned capability with explicit quality/fallback states; it must not block original-language Program when unavailable.

## Interoperability and switching

Winning competitor users requires low-risk adoption.

Prioritize portable imports and bridges:

- song lyrics/text;
- images/video;
- PDF/PPTX where supportable;
- Scripture references;
- service/rundown data;
- reusable media folders;
- standard stream destinations;
- standard output/control bridges where appropriate.

Do not make migration depend on reverse-engineering proprietary competitor formats.

Support coexistence during adoption so a church can prove iPresenterPlux alongside its current workflow before switching completely.

## Accessibility and ergonomic floor

All new/touched operator surfaces must enforce:

- 12px minimum operational text, with 14px preferred for explanatory/action copy;
- 44px minimum important touch targets;
- keyboard-visible focus;
- text labels alongside status color;
- no hover-only primary actions;
- clear disabled states;
- stable layout under common laptop resolutions;
- bounded independent scrolling where cockpit rails require it;
- 16:9 Preview/Program geometry without forced distortion;
- responsive mobile layouts designed intentionally rather than merely wrapped.

## Reliability and recovery language

Operator-facing failures are written in this order:

1. what is affected;
2. whether Program/audience is currently affected;
3. safest action;
4. optional technical detail.

Examples:

- `Pulpit Camera disconnected. Program is holding the last frame briefly, then will fall back to black. Choose another source in Preview.`
- `Speech detection unavailable. Manual Scripture search still works.`
- `YouTube stream interrupted. Local Program and recording are still running.`

## Telemetry and privacy

UI and control-plane telemetry must remain allowlisted. Sensitive native source data such as raw device keys, native handles, arbitrary full window titles, paths, credentials, tokens and frame bytes must not be exposed to operator APIs or audit details.

Window source display should prefer safe process identity and operator labels rather than arbitrary private document titles.

## Competitive capability target

| Capability | EBP benchmark | iPresenterPlux target |
| --- | --- | --- |
| Bible lookup | Strong | Faster universal lookup + detailed workspace |
| Voice Scripture | Browser-based | Edge/AI-assisted, confidence-aware, safer Preview flow |
| Songs | Strong | Match portable workflows + service context + Themes |
| Media/PDF/PPTX | Strong | Match common inputs + native routing/Preview semantics |
| Desktop simplicity | Dense capability surface | Essential-first live cockpit |
| Mobile remote | Strong/simple | Match simplicity + Program/Preview/Next safety model |
| Styling | Rich live controls | Rich reusable Theme Studio + limited live overrides |
| Cameras/screens/windows | Not central in reviewed browser implementation | Native Edge capture and confirmed routing truth |
| Program authority | Send-live oriented concepts | Explicit Preview -> TAKE -> Program boundary |
| Audience language | Not central in reviewed benchmark | First-class multilingual audience experience |
| AI service awareness | Limited compared with target | Predictive Next + service/context intelligence |
| Offline continuity | Browser/PWA-dependent workflow | Edge-first local Program continuity |
| Service memory | Limited benchmark evidence | Structured Archive feeding future preparation |

The goal is not to claim superiority before implementation or field evidence. This table defines the target experience and acceptance direction.

## Measurement

Track product success using operational metrics rather than feature count:

- median time from login to ready-to-run service;
- time to find and Preview a Scripture reference;
- number of actions required from detected Scripture to Preview;
- number of live errors caused by wrong content/source selection;
- frequency of emergency Clear/Black and recovery success;
- training time for first-time volunteers;
- percentage of routine services completed without opening Engineering depth;
- percentage of AI recommendations accepted/dismissed/expired;
- average time from actionable failure to recovery;
- content reuse rate from prior services/imports;
- mobile-control task completion success.

## Delivery order

This design intentionally sequences usability before adding more visible features.

1. **Finish Visual Sources** — Cameras/Screens/Windows, confirmed state, safe Preview controls.
2. **Universal Command foundation** — deterministic search/categories first, natural-language interpretation layered afterward.
3. **Scripture Find -> Prepare -> Preview** — fast reference/phrase/voice flow integrated with Cockpit Next.
4. **Mobile Live Assist** — role-specific, large-target Program/Preview/Next controller.
5. **Theme Studio** — move presentation richness out of the live cockpit into reusable themes.
6. **Songs/Media parity hardening** — imports, service planning and Preview semantics.
7. **AI and audience moat expansion** — stronger Predictive Next, interpretation, multilingual audience experience and recovery intelligence.

Each stage must ship behind the existing RBAC, tenant, entitlement, audit and Preview/Program boundaries.

## Explicit non-goals for this competitive program

- copying EBP’s UI, code, CSS, product text or visual assets;
- recreating a ribbon-heavy production UI;
- making every advanced setting visible by default;
- replacing OBS/vMix by imitating their switcher interfaces;
- browser-based sanctuary capture as the production architecture;
- automatic AI Program switching in this phase;
- reverse-engineering proprietary competitor file formats;
- marking Windows camera/screen capture `available` before physical hardware UAT;
- sacrificing offline local presentation for cloud convenience.

## Acceptance scenarios

### Scenario 1 — first-time Scripture operator

A volunteer opens Cockpit, types `John 3:16`, sees the verse result, presses Preview, verifies it, then TAKE. No module navigation or styling setup is required.

### Scenario 2 — preacher mentions Scripture

ASR detects `Romans 8:28` with high confidence. Next shows the recommendation. Operator presses Preview. Program is unchanged until TAKE.

### Scenario 3 — visual source

Operator opens Visual Sources, selects `Pulpit Camera`, presses Preview, returns/sees it in Preview, and uses Studio TAKE. The source card itself never exposes Go Live.

### Scenario 4 — source failure

Program camera disconnects. Existing Edge failure policy holds the last frame for up to two seconds, then safe black. Cockpit states impact and recommends another source; it does not auto-switch Program.

### Scenario 5 — simple Sunday mobile

Authorized mobile operator sees Program/Preview/Next, searches a Scripture, previews it, and takes it live with large touch controls. Engineering telemetry is absent.

### Scenario 6 — professional setup

An Engineering-depth user configures output/source detail and diagnoses transport health without forcing those controls onto the volunteer’s Essential view.

### Scenario 7 — styling

Designer builds `Sunday Modern` in Theme Studio before service. During service the operator selects the theme; they are not required to manipulate font, opacity, shadow, logo and background controls independently.

### Scenario 8 — AI outage

ASR/AI becomes unavailable. Program continues, manual Scripture/Media/Visual Source operation remains usable, and the Cockpit states exactly what automation was lost.

## Design decisions locked by this spec

- iPresenterPlux competes on reduced operational complexity, not maximum visible feature density.
- Universal Command is the primary fast-entry surface across content and safe actions.
- Scripture’s default live flow is Find -> Prepare -> Preview -> separate TAKE.
- `/cameras` evolves conceptually into Visual Sources with Cameras/Screens/Windows.
- source cards cannot mutate Program directly.
- reusable Themes replace production-time styling complexity as the default model.
- mobile is role/task-specific and preserves Program/Preview/Next semantics.
- Edge/native capabilities and offline continuity are core differentiators.
- audience translation/interpretation is a strategic moat rather than an add-on page.
- AI never silently bypasses Program authority in this phase.

## References

- Existing Cockpit architecture: `docs/superpowers/specs/2026-10-08-intelligent-service-cockpit-design.md`
- Native visual capture architecture: `docs/superpowers/specs/2026-10-10-native-edge-visual-capture-design.md`
- Public competitor reference reviewed 2026-10-17: `https://github.com/Expressconsult-cmd/express-bible-presenter`
- Competitor-declared official domain: `https://expressbiblepresenter.com.ng`
