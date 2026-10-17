# iPresenterPlux Competitive UX Design — Express Bible Presenter Benchmark

Date: 2026-10-17
Status: Draft for written-spec review
Owner: Lightworld Technologies Ltd
Extends:
- `2026-10-08-intelligent-service-cockpit-design.md`
- `2026-10-10-cockpit-ergonomics-design.md`
- `2026-10-07-navigation-scripture-usability-design.md`
- `2026-10-10-native-edge-visual-capture-design.md`

## Purpose

iPresenterPlux must be easier to operate than church-presentation tools that expose many controls at once while still growing into a substantially richer production, interpretation, audience and broadcast platform.

This design uses Express Bible Presenter (EBP) as a current competitive benchmark. The objective is not to reproduce its interface, code or proprietary implementation. The objective is to understand the workflows churches already value, retain the useful expectations behind those workflows, and then give iPresenterPlux a simpler operating model with deeper native and AI capabilities.

The product thesis is:

> **Less interface. More intelligence. More capability. Faster operation.**

The practical success target is:

> **A first-time church volunteer should be able to run a normal Sunday service after ten minutes of guided orientation, while an experienced broadcast engineer should continue discovering useful depth without switching to a different product.**

## Competitive research basis

Research performed on 2026-10-17 used the publicly accessible EBP repository and official public host information:

- repository: `https://github.com/Expressconsult-cmd/express-bible-presenter`
- official host declared by the project: `https://expressbiblepresenter.com.ng`
- reviewed current public implementation areas: main studio HTML/CSS/JS, mobile remote, authentication/admin structure and recent repository activity.

The review is a point-in-time benchmark. EBP can change after this date, so iPresenterPlux should compete against enduring user needs rather than chasing individual controls.

No EBP source code, proprietary artwork or proprietary UI implementation is to be copied into iPresenterPlux. Competitive research informs product requirements only.

## What EBP validates about church workflows

The reviewed public implementation demonstrates that churches value a single tool that can cover more than plain Bible lookup. Its current surface includes or references:

- Bible book/chapter/verse navigation;
- direct Scripture reference entry and verse-text search;
- voice-assisted Scripture operation;
- saved songs and lyric slide generation;
- song import from text/document sources;
- image/video/PDF/PPTX media presentation;
- announcements, name tags/lower thirds and timers;
- background, text, logo and layout styling;
- remote mobile control through pairing;
- freeze/blank and previous/next live controls;
- OBS/browser-source-style output;
- operator hotkeys;
- light/dark interface options.

These are not all differentiators by themselves. They establish a minimum expectation for a modern church presentation product.

## Competitive opportunity

The main opportunity is not simply to offer more features. It is to remove the cognitive tax of using them.

The reviewed EBP desktop studio exposes a broad collection of navigation, design, media and production controls in the primary operating surface. That makes capability visible, but it also requires the operator to continually distinguish configuration controls from live-service actions.

iPresenterPlux will take the opposite approach:

1. Live operation shows only current context, the next likely action and the Preview/Program transition.
2. Configuration depth appears progressively and contextually.
3. AI prepares work but does not silently change Program.
4. Native Edge owns physical capture/output truth rather than pretending the browser owns sanctuary hardware.
5. Mobile is designed as a role-specific live assistant, not a compressed desktop.
6. Rich visual styling is prepared as reusable themes rather than exposed as dozens of live controls.
7. The platform connects presentation, native visual sources, audience delivery, interpretation, recording and streaming around one active service.

## Positioning

iPresenterPlux is not positioned as "a Bible presenter with more features."

It is a **church service operating system with an intelligent production cockpit**.

Presentation is one core capability inside a service-aware operating model that also understands:

- the service rundown;
- what is currently on Program;
- what is prepared in Preview;
- what the preacher is saying;
- what Scripture is likely needed next;
- what cameras/displays/windows are physically available;
- what audience languages are in use;
- what recording/streaming outputs are healthy;
- what happened earlier in this service;
- what should be remembered after the service.

## Non-negotiable UX rules

1. **Program is deliberate.** AI may search, rank, prepare and Preview. It must not silently TAKE to Program under the default product mode.
2. **Preview is private.** A Preview action must never be visually or semantically confused with going live.
3. **Physical truth comes from Edge.** Cameras, displays, windows and local output state use Edge-confirmed truth.
4. **Healthy systems recede.** Green telemetry walls are not the default interface.
5. **Advanced controls are not deleted; they are progressively disclosed.**
6. **No live-service workflow depends on an Internet round-trip when a safe local path can exist.**
7. **No critical action is hover-only.** Keyboard and touch remain first-class.
8. **Operational text has a 12px absolute floor; important touch targets are at least 44px.**
9. **The same terms mean the same thing everywhere.** Preview, Program, TAKE, Clear, Black, Queue and Next must not be renamed casually per module.
10. **One action should have one obvious home.** Duplication is allowed only for deliberate convenience, never because ownership is unclear.

## Progressive depth model

The product exposes three depth levels over the same underlying capability graph. These are presentation modes, not different editions or separate products.

### Essential

Designed for volunteers and normal Sunday operation. It emphasizes:

- Program;
- Preview;
- TAKE;
- Clear/Black;
- Next;
- Scripture;
- Songs;
- Media;
- service queue/rundown;
- one universal find/command trigger;
- actionable attention only.

Essential mode must be sufficient to run a normal service without entering Settings or Engineering.

### Advanced

Designed for presentation/media leads. It adds:

- Visual Sources;
- lower thirds/name tags;
- announcements and timers;
- Theme selection and per-service overrides;
- audience controls;
- interpretation/language controls;
- recording;
- streaming destinations;
- richer service planning;
- deeper recommendation controls.

### Engineering

Designed for technical production staff. It adds:

- source formats and capture diagnostics;
- Edge devices and local output routing;
- NDI/SRT/RTMP/WebRTC details where relevant;
- encoder/network health;
- provider diagnostics;
- detailed logs/telemetry suitable for recovery;
- advanced device and destination configuration.

Engineering depth never becomes the default merely because it exists.

## Primary live layout

The existing Intelligent Cockpit remains the foundation. The competitive refinement is a stricter hierarchy:

### 1. Program + Preview stage

Program and Preview are always visually obvious during live operation.

- Program is the largest live truth surface.
- Preview is adjacent and clearly private.
- TAKE sits spatially between Preview and Program.
- Clear/Black is nearby but separated enough to avoid accidental activation.
- The content origin is always visible: Scripture, song, media, visual source, graphic or another supported type.
- Pending command state is visually different from Edge-confirmed state.

### 2. Now + Next rail

The rail answers two questions:

- **Now:** What is actually happening?
- **Next:** What is most likely useful next?

The Now rail contains only live context that helps the operator make the next decision.

The Next rail ranks:

- upcoming rundown items;
- AI recommendations;
- manually pinned content;
- recent/relevant Scripture;
- recently used songs/media;
- safe recovery actions when a live subsystem degrades.

No Next item changes Program directly. It may open, prepare, Preview, pin or dismiss.

### 3. Command/find surface

One universal field is available from the Cockpit and by keyboard shortcut.

Working label:

**What do you need next?**

The field accepts deterministic queries first and natural language second.

Examples:

- `John 3:16`
- `Rom 8`
- `Jesus wept`
- `Way Maker`
- `offering video`
- `pulpit camera`
- `announcement welcome our visitors`
- `preview Psalm 23 NLT`
- `open French interpretation`

Results are grouped automatically:

- Scripture;
- Songs;
- Media;
- Service/Rundown;
- Visual Sources;
- People/Lower Thirds;
- Actions.

The deterministic parser handles direct references, exact names, known aliases and explicit commands even when AI services are unavailable.

Natural-language interpretation may propose an action when useful, but consequential actions remain governed by existing RBAC and Preview/Program rules.

## Scripture experience

Scripture should become the fastest and most intelligent path in the product.

The core operating flow is:

**Hear / Type -> Recognize -> Suggest -> Preview -> TAKE**

### Direct search

A single Scripture entry field supports:

- exact references;
- abbreviations;
- chapter-only references;
- verse ranges;
- phrase/text search;
- recent references;
- favourites;
- service-history references.

Direct reference parsing must not require Internet access during a service.

### Sermon-aware detection

When speech analysis identifies a likely Scripture reference, the system creates a compact Next recommendation such as:

`Romans 8:28 · 94% confidence · Preview`

The operator can:

- Preview;
- inspect context;
- choose another translation;
- dismiss;
- pin for later.

The default path never auto-TAKEs the recommendation.

### Context controls

Once a passage is selected, the operator can move quickly through:

- previous/next verse;
- previous/next passage;
- whole chapter;
- configurable context before/after;
- alternate translation;
- parallel translation.

Long passages use automatic layout fitting within Theme constraints rather than exposing font-size micromanagement in the live surface.

### Translation model

Projector translation and audience-device language do not have to be identical.

A church may project its preferred Bible version while audience users independently receive translated text/captions/audio in their selected language where licensed/configured.

### Scripture preferences

Tenant-scoped preferences may remember:

- default Bible version;
- secondary/parallel version;
- preferred Scripture theme;
- reference-format preference;
- preacher-specific defaults where explicitly configured;
- whether AI Scripture recommendations should auto-open in Preview or remain recommendation-only.

Any auto-Preview option still does not grant Program authority.

## Songs and media

The competitor benchmark confirms that songs and rich media belong in the normal church workflow, but iPresenterPlux should avoid creating a separate dense mini-application for each one.

### Songs

Songs support:

- reusable song library;
- fast title/lyric search;
- text paste/import;
- supported document import;
- verse/chorus/bridge structure when known;
- automatic slide generation;
- configurable line grouping;
- per-song Theme assignment;
- recent/favourite songs;
- Service Planner insertion;
- Preview before Program;
- mobile next/previous slide operation.

The system should infer sensible slide breaks but keep manual correction available.

### Media

Media supports the current product direction for reusable assets and portable import, including technically supportable images, video, PDF and presentation documents.

The default operator interaction is:

**Find -> Preview -> TAKE**

Playback/page controls appear only when the selected media type needs them.

The operator should not see PDF controls while operating a video, or video transport controls while presenting an image.

## Theme Studio

Rich styling is a competitive requirement, but live-service styling clutter is not.

Theme Studio owns reusable visual design. It is separate from the default live operation surface.

A Theme can define:

- typography family, weight and scale;
- text/reference colors;
- alignment and safe zones;
- background color/image/video behavior;
- gradient and shadow treatment;
- logo placement/size;
- lower-third geometry;
- Scripture-specific layout;
- song-specific layout;
- announcement layout;
- transition behavior;
- projector/stream/audience variants where required.

Built-in starting themes should include examples such as:

- Sunday Modern;
- Sermon Scripture;
- Lower Third Scripture;
- Worship Lyrics;
- Announcement;
- Youth Service;
- Conference;
- Funeral;
- Wedding.

The exact shipped names may change during content design, but the product requirement is fixed: common visual decisions are prepared once and reused.

During a service, the operator primarily chooses a Theme or a small safe override. Advanced editors may open Theme Studio when needed, but styling controls do not permanently occupy the Cockpit.

## Visual Sources workspace

The current `/cameras` route evolves into the operator-facing **Visual Sources** workspace while preserving route compatibility where useful.

The first categories are:

- Cameras;
- Screens;
- Windows.

The workspace reflects Edge-owned physical truth rather than browser capture state.

Each source card shows only useful operational information:

- operator-visible source name;
- source kind;
- reporting Edge device;
- coarse freshness/availability;
- Edge-confirmed capture state;
- last report time;
- relevant dimensions/frame rate when available;
- confirmed Preview badge;
- confirmed Program badge;
- camera-specific preference/label where applicable.

Primary source actions are limited to:

- **Preview**;
- **Rescan Sources**;
- **Clear Preview**;
- camera label/preference controls where authorized.

There is deliberately no source-card `Go Live` or `TAKE` action.

The live path remains:

**Visual Sources -> Preview -> Cockpit -> TAKE PREVIEW LIVE**

This keeps physical source discovery simple without creating a second Program authority surface.

Requested state must be visually distinct from confirmed state. If the operator requests Preview, the UI may show `Preparing…`; it does not show the Preview badge until Edge telemetry confirms the route.

## Mobile / Live Assist

The mobile experience takes the useful lesson from EBP's remote simplicity but follows iPresenterPlux authority and role boundaries.

The default mobile product is **Live Assist**, not a miniature engineering dashboard.

The proposed primary destinations are:

- Live Assist;
- Scripture;
- Service;
- Media & Sources;
- Audience.

Navigation is role-filtered. A pastor, presentation operator, interpreter and engineer do not need identical tabs.

A compact live strip remains visible where practical:

**PROGRAM | PREVIEW | NEXT**

### Mobile Scripture flow

A live operator can:

1. type or speak a reference;
2. see the resolved passage;
3. Preview it;
4. inspect the Preview confirmation;
5. TAKE it live only when their role has live authority.

A pastor/service leader without live authority can request or pin content without gaining Program control.

### Mobile source flow

Authorized operators can inspect Visual Sources and request Preview. Engineering diagnostics stay hidden unless the role and depth mode require them.

### Mobile resilience

The remote experience must:

- reconnect gracefully;
- communicate connection loss in plain language;
- distinguish stale data from confirmed current state;
- avoid duplicating an issued consequential command during reconnect;
- keep large touch targets and readable status labels;
- never infer Program state from a command request alone.

## AI differentiation

AI is a workflow compressor, not a competing chat panel.

### Predictive Next

Predictive Next ranks the likely next useful actions using service context, transcript, detected Scripture, rundown proximity, prior operator choices, source availability and audience needs.

Recommendations must explain enough to be trusted:

- what is suggested;
- why;
- confidence where meaningful;
- freshness/expiry where meaningful;
- what action will happen if accepted.

### AI Scripture Assistant

The Scripture assistant combines:

- explicit spoken references;
- quote/context matching;
- nearby sermon context;
- active service plan;
- recent Scripture history.

A high-confidence detection may auto-prepare Preview only if the organization explicitly enables that behavior. It still cannot auto-TAKE in the default authority model.

### AI service commands

The universal command field can resolve natural language onto existing product capabilities, for example:

- `preview Psalm 23 in NLT`;
- `find the welcome video`;
- `preview pulpit camera`;
- `prepare Pastor Mensah lower third`;
- `what is wrong with YouTube?`.

It must use the same domain services and RBAC checks as the visible UI. AI is not an authorization bypass.

### AI recovery assistance

When a subsystem degrades, the system explains operator impact first.

Example:

`Pulpit camera stopped. Program is holding the last frame for up to 2 seconds, then will go black. Preview another source.`

This is preferred over exposing only a driver/HRESULT-style error.

## Audience and interpretation moat

This is a strategic area where iPresenterPlux should exceed Bible-presentation competitors rather than merely match them.

Audience participants can connect through the supported local/internet audience experience and receive:

- live video where configured;
- current Scripture/content;
- captions;
- selected-language translated text;
- selected-language audio interpretation where available.

Language choice is per audience user/session rather than forcing one projector language for the whole church.

The longer-term differentiator remains natural translated voice that preserves the preacher's delivery characteristics where technically, ethically and legally appropriate. That future capability must retain clear labeling and consent controls; it is not required for the first competitive UX release.

## Offline and local-service resilience

The competitive experience must remain useful during Internet loss.

Local-critical capabilities include, where the deployed Edge/product edition supports them:

- local Bible lookup;
- service queue/rundown access needed for the current service;
- local Preview/Program presentation;
- native visual-source routing;
- local recording;
- manual Scripture/song/media operation;
- locally available themes/assets;
- safe control from the local operator environment.

Cloud-dependent AI, external streaming destinations and Internet audience delivery may degrade independently without stopping local Program.

The UI must state the distinction clearly instead of showing a generic "offline" failure over the entire product.

## Role model

The competitive UX is role-sensitive by default.

Examples:

### Volunteer presentation operator

Sees Essential mode with Scripture, Songs, Media, Queue, Preview, Program, TAKE, Clear/Black and actionable attention.

### Media lead

Adds Visual Sources, themes, lower thirds, recording, streaming and richer planning.

### Pastor/service leader

Sees current/next service context, Scripture, requests/pins and audience context without automatically receiving Program authority.

### Interpreter

Sees relevant language channels, transcript/translation state and interpretation controls without unrelated media engineering.

### Broadcast engineer

Can enter Engineering depth for source, encoder, network and destination diagnostics.

The product should remember the user's preferred depth when safe, but role/entitlement boundaries always win over preference.

## Competitive capability map

The product should deliberately classify competitor capabilities into three buckets.

### Match because users expect it

- fast Bible reference lookup;
- verse-text search;
- song library and slide generation;
- image/video/PDF/presentation media support where technically supported;
- announcements and lower thirds;
- timers;
- reusable styling/themes;
- keyboard shortcuts;
- mobile remote/live assistance;
- blank/freeze/clear-style safety actions;
- projector/stream-friendly output.

### Beat through usability

- one universal find/command surface instead of requiring the operator to choose a subsystem first;
- a persistent, unambiguous Preview/Program stage;
- progressive depth rather than permanent styling/engineering controls;
- role-specific mobile rather than one remote surface for every user;
- contextual controls that appear only for the active content type;
- Edge-confirmed physical source state rather than optimistic browser/request state;
- clearer recovery copy focused on audience impact and safe next actions;
- theme reuse instead of live design micromanagement.

### Beat through platform depth

- native Windows/macOS Edge capture/output architecture;
- AI sermon-aware Scripture preparation;
- Predictive Next across Scripture, media, rundown and source context;
- integrated audience-language experience;
- interpretation and translated audio roadmap;
- one service model connecting presentation, sources, audience, recording and streaming;
- offline local Program continuity;
- searchable post-service operational memory.

## Visual design direction

The product keeps the current professional dark broadcast-cockpit direction with restrained gold emphasis.

The design system must prioritize state over decoration:

- Program gets the strongest live-state treatment;
- Preview is visually strong but clearly non-live;
- dangerous/irreversible actions use distinct placement and wording, not color alone;
- status labels always accompany status colors;
- primary live actions are large and stable in position;
- configuration chrome is quieter than live content;
- cards are used only when they improve grouping, not as the default shape for every fact;
- responsive layouts preserve hierarchy instead of stacking every desktop panel vertically without prioritization.

The UI should feel like a calm live-production cockpit rather than a dashboard full of KPI tiles or a desktop settings application.

## Keyboard model

Keyboard operation is a first-class competitive advantage for experienced operators.

The product should provide stable defaults for common live actions and allow safe customization without bypassing authority checks.

Required concepts include:

- focus/open universal command;
- Preview selected item;
- TAKE Preview to Program;
- Clear/Black Program;
- next/previous item within current context;
- dismiss/pin recommendation;
- escape/close transient surfaces.

Custom shortcuts may be offered where conflicts can be detected. A shortcut invokes the same guarded command path as its visible control.

## Adoption and migration

Churches switching from other tools should not have to recreate their entire media life before testing iPresenterPlux.

The migration path prioritizes portable content:

- song lyrics/text;
- images and video;
- supported PDF/presentation documents;
- common Scripture references/service notes;
- reusable lower-third/person lists where safely importable;
- service/rundown data in documented portable formats;
- streaming destination configuration through supported secure setup.

Product-specific proprietary formats are supported only where legally and technically appropriate. The product must not depend on reverse-engineering competitors.

Interoperability adapters may let a church introduce iPresenterPlux alongside existing tools during migration, but iPresenterPlux must remain fully functional without those tools.

## Measurable success criteria

The competitive redesign succeeds when field UAT demonstrates all of the following:

1. A first-time volunteer can complete the guided orientation and successfully run a basic simulated service within 10 minutes.
2. From Cockpit, a direct Scripture reference can be resolved and placed into Preview without navigating to a separate module.
3. A detected spoken Scripture recommendation can be Previewed with one obvious action and cannot silently reach Program.
4. An operator can find a song, media item or visual source from the same universal find/command entry point.
5. The default Essential live surface does not expose engineering telemetry or dense styling controls.
6. Preview and Program remain visible and semantically distinct throughout live operation.
7. A camera/display/window request shows pending state until Edge confirms Preview/Program truth.
8. Mobile live operation uses role-specific controls and does not expose unauthorized Program actions.
9. Internet loss does not stop local Scripture/manual presentation and other supported local-critical service functions.
10. A degraded subsystem reports audience/service impact and a recovery action before raw technical detail.
11. Rich visual customization can be prepared as a reusable Theme without permanently occupying the live Cockpit.
12. The production build, RBAC, tenant isolation, audit and Preview/Program regression gates remain green.

## UX performance targets

These are product targets for design/testing, not promises that bypass real network or hardware limits:

- direct deterministic Scripture lookup should feel immediate on the local/control data path;
- the universal command surface should open without a network dependency;
- common Essential actions should require no more than one primary decision after the desired item is found;
- a normal Sunday operator should not need Settings during live service after pre-service readiness passes;
- live-state controls should remain visible without requiring page archaeology or repeated scrolling;
- critical attention should be distinguishable within one glance from non-actionable status.

## Implementation sequence

This architecture should be delivered in focused increments rather than as one large UI rewrite.

### Phase 1 — Visual Sources completion

Finish the current Visual Sources control-plane/UI work:

- stable Edge identity and sanitized telemetry;
- durable Rescan / Preview / Clear Preview commands;
- Cameras / Screens / Windows categories;
- Edge-confirmed Preview/Program badges;
- pending versus confirmed state;
- camera preferences retained where applicable;
- no source-card live action.

This phase builds on the native Windows visual capture work already merged.

### Phase 2 — Universal find/command surface

Add the shared command/search entry point and deterministic resolver for:

- Scripture references;
- verse text;
- songs;
- media;
- service/rundown items;
- visual sources;
- explicit low-risk navigation/preparation actions.

Natural-language intent resolution is layered on after deterministic coverage is reliable.

### Phase 3 — Scripture fast path

Refine Scripture around:

- Hear / Type -> Recognize -> Suggest -> Preview -> TAKE;
- recent/favourite/service-context references;
- context navigation;
- translation switching;
- automatic Theme-based fitting;
- Predictive Next integration.

### Phase 4 — Live Assist mobile

Build the role-specific mobile navigation and persistent Program/Preview/Next strip, using existing authorization and durable command infrastructure.

### Phase 5 — Theme Studio

Move rich styling into reusable Theme definitions with safe live overrides and content-type variants.

### Phase 6 — Audience and intelligence deepening

Continue audience-language, interpretation, service memory and AI automation after the simpler core workflow is proven in field UAT.

## Testing strategy

### Contract and safety tests

Protect:

- Preview/Program authority;
- no visual-source Go Live command;
- RBAC on all live mutations;
- tenant/service/source ownership;
- Edge-confirmed route state;
- telemetry privacy/sanitization;
- deterministic command parsing;
- offline-safe local paths;
- role/depth capability projection.

### UX structural tests

Protect:

- Program/Preview hierarchy;
- typography and touch-target floors;
- keyboard focus consistency;
- no hover-only critical action;
- Essential mode absence of engineering/styling clutter;
- source tabs and contextual controls;
- mobile role projection;
- clear pending versus confirmed route state.

### Field UAT

Run simulated and real-service scenarios with at least:

- a first-time volunteer;
- a regular presentation operator;
- a media lead;
- a technical/broadcast operator.

Measure:

- time to first successful Preview;
- time to first successful TAKE;
- number of wrong-surface navigation attempts;
- number of accidental live-action attempts;
- ability to recover from source/network/AI degradation;
- time to locate Scripture, song, media and source;
- subjective confidence after the service.

## Non-goals for this design

This design does not:

- clone EBP, EasyWorship, ProPresenter, OBS or vMix;
- replace the native Edge architecture with browser capture;
- introduce unrestricted AI Program authority;
- expose a node-based scene compositor in Essential mode;
- require every advanced feature to ship before the simpler Cockpit is useful;
- make Theme Studio a full general-purpose graphic design application;
- promise that every proprietary competitor file format can be imported;
- mark Windows visual capture as production-available before physical hardware UAT passes;
- fold future church finance/member-management features into the live production cockpit.

## Acceptance criteria

This design is accepted when:

- the existing Intelligent Cockpit remains the core live architecture;
- EBP-class baseline workflows are accounted for without copying EBP implementation;
- the universal find/command surface is the primary cross-domain discovery mechanism;
- Essential/Advanced/Engineering depth is explicit;
- Scripture has a faster sermon-aware Preview path;
- Visual Sources preserves Preview -> Program authority and Edge truth;
- Theme Studio removes rich styling clutter from default live operation;
- mobile becomes role-specific Live Assist;
- audience/interpretation and native Edge remain strategic differentiation;
- offline local operation remains a first-class product constraint;
- the implementation is split into the six phases above so progress can ship incrementally and safely.

