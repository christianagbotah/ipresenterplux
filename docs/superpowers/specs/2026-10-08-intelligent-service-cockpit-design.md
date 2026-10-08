# iPresenterPlux Intelligent Service Cockpit Design

Date: 2026-10-08
Status: Approved
Owner: Lightworld Technologies Ltd
Parent: `2026-10-07-product-readiness-program-design.md`

## Purpose

iPresenterPlux must not become another EasyWorship, ProPresenter, vMix or OBS clone with a newer skin. The product must establish a simpler, AI-native operating model for church production while retaining enough depth that experienced operators do not lose professional control.

The core experience goal is: **make a first-time volunteer confident, make an experienced operator faster, and make a technical production lead feel that advanced power is available without living inside complexity.**

This design introduces the Intelligent Service Cockpit: one primary live-production surface organized around what is happening now, what is likely to happen next, and what requires human attention. Existing Scripture, Media, Cameras, AI Director, Translation, Streaming, Audience and Archive capabilities remain separate domain engines behind this cockpit; they are not removed or duplicated.

## Product principles

1. **AI removes work; it does not add another panel.** AI prepares, ranks, summarizes, routes, warns and recommends before it asks the operator to act.
2. **Program remains deliberate.** AI may prepare Preview and recommendations, but it never changes Program without an explicitly approved future automation mode.
3. **One-screen confidence beats information density.** Healthy subsystems recede visually. Attention states surface only when the operator can or should act.
4. **Progressive depth, not feature deletion.** Basic operators see the minimum live controls. Experienced operators can expand routing, telemetry, automation detail and diagnostics without entering a different product.
5. **Service context is the operating system.** The active service, its rundown, people, devices, outputs, languages and audience state drive the UI.
6. **Physical truth comes from Edge.** The Control Plane never pretends the browser owns cameras, audio devices or local outputs that are physically controlled by the paired church computer.
7. **Fast recovery is part of UX.** Failures are translated into plain-language impact and recovery actions instead of raw infrastructure status.
8. **The product remembers.** A completed service becomes structured, searchable production memory rather than a dead recording file.

## Success criteria

The redesign succeeds when:

- a new volunteer can understand the live screen without learning the internal module architecture;
- a trained operator can move from detection/recommendation to Preview to Program with fewer clicks and less eye travel than the current Control Room;
- a ProPresenter/OBS/vMix-style power user can still reach precise controls without cluttering the default live surface;
- the operator does not need to monitor healthy ASR, translation, TTS, streaming, camera and Edge telemetry continuously;
- AI recommendations clearly show confidence, evidence and intended action;
- every recommendation is reversible before Program;
- live failures state user impact first, then the safest recovery action;
- mobile views are role-specific rather than compressed desktop dashboards;
- all existing tenant, RBAC, entitlement, Preview/Program and Edge-truth boundaries remain intact.

## Non-goals

This program does not:

- recreate a scene-node editor like OBS;
- recreate a dense switcher matrix like vMix;
- recreate a slide-bin-first presentation workflow as the default experience;
- remove the existing detailed domain workspaces;
- give AI unrestricted Program authority;
- move camera/audio capture into the browser;
- replace the Service Planner, Archive or licensing systems;
- attempt the full future church-management suite.

## Primary operating model

The product uses five phases:

**Prepare -> Assist -> Preview -> Program -> Remember**

### Prepare

Before service, the system assembles useful context from the planned service, reusable media, previous services, Bible references, sermon notes when available, configured outputs, languages, paired Edge devices and operator preferences.

The result is not an automatically fixed show. It is a prepared starting point: likely songs/media, known Scripture references, output readiness, audience links, language readiness and unresolved setup issues.

### Assist

During service, AI continuously interprets current context and generates ranked recommendations. Examples:

- `Romans 8:28 detected · 97% · Preview`
- `Closing prayer context detected · prepare closing slide`
- `Pastor moved to lectern · Camera 2 recommended`
- `French listeners connected · translated audio is available`
- `YouTube destination degraded · local Program unaffected`

Recommendations are suggestions or safe preparation actions. They do not directly take content to Program.

### Preview

Preview is the universal safety boundary for presentable content. Scripture, songs, slides, media and future graphics that can reach Program must expose a real Preview state before the operator can TAKE them live.

### Program

Program is the deliberate live output state. TAKE, Clear and emergency recovery remain unambiguous, large and keyboard-accessible. Any future automation mode that can alter Program must be separately designed, permissioned and visibly armed.

### Remember

After service, the platform stores structured production history: rundown, Scriptures, transcript chapters, speakers, songs, output incidents, translations, artifacts and useful AI-generated metadata. This feeds Archive, search and future preparation suggestions.

## Information architecture

The sidebar remains available for domain workspaces, but the default mental model changes from "choose a module" to "run the service."

The top-level product surfaces become:

- **Cockpit** — default service operating surface.
- **Plan** — Service Planner and preparation.
- **Library** — Songs & Media and reusable assets.
- **Live Systems** — Cameras, Translation, Streaming and Audience, presented as advanced/expanded operational tools.
- **Intelligence** — AI Director, recommendation history and automation configuration.
- **Archive** — completed service memory.
- **Settings** — organization/device/account configuration.

Existing routes may remain for compatibility, but navigation grouping and labels should reflect the operating model rather than exposing every subsystem as an equal first-class mental burden.

## Switching moat and interoperability

iPresenterPlux should make migration from established church-production tools feel low-risk without copying their interface. The product wins switchers by preserving useful assets and familiar output expectations while removing the operational burden they have learned to tolerate.

The first migration bridge should prioritize common, portable inputs: Scripture references, song lyrics/text, images, videos, presentation files where technically supportable, service/rundown data that can be exported safely, streaming destinations and standard media URLs/files. Product-specific proprietary formats should be supported only where legally and technically practical; the architecture must not depend on reverse-engineering competitors.

Experienced operators may opt into familiar keyboard accelerators when they do not conflict with iPresenterPlux safety rules. Familiar shortcuts are a transition aid, not the primary UX. Preview -> Program authority remains unchanged.

Interoperability is also a migration tool. Churches should be able to introduce iPresenterPlux alongside existing production software using supported output/control bridges where appropriate, prove value during real services, then retire older workflows gradually rather than performing a risky all-at-once conversion.

Adoption success should therefore be measured not only by feature parity, but by **time-to-first-successful-service**, reduction in operator actions, reduction in training time, and how much existing church content can be reused without manual recreation.

## Cockpit layout

The Cockpit replaces the current card-heavy Control Room as the default live-production view. It is built around three persistent zones and one collapsible attention layer.

### 1. Program + Preview stage

Program and Preview are the visual center of gravity, not secondary cards buried among telemetry.

- Program is visually dominant and always communicates what the audience is receiving.
- Preview is adjacent and clearly distinct from Program.
- TAKE is positioned between or immediately beneath Preview and Program so the action maps spatially to the state transition.
- Clear Program and emergency-safe actions are nearby but visually separated to prevent accidental activation.
- The surface shows the content type and origin: Scripture, song, media, graphic, camera/program video or future supported output type.
- Operator shortcuts remain available but never bypass state validation or authorization.

### 2. Now rail

A compact rail shows current live context:

- active service and service state;
- current speaker when known;
- latest transcript context;
- current Scripture/content;
- active camera/source summary;
- active audience language/output state;
- elapsed service/live duration when useful.

This rail is contextual, not a telemetry dump. Healthy low-level counters stay hidden unless expanded.

### 3. Next rail

The Next rail replaces the idea that the operator must constantly browse multiple modules. It contains a ranked queue of likely next actions from three sources:

- planned rundown items;
- AI recommendations;
- manually pinned operator items.

Each item has a compact reason and confidence when AI-generated. Actions are explicit, for example `Preview`, `Open`, `Pin`, `Dismiss`, or `Use instead`. Nothing in this rail directly changes Program.

### 4. Attention layer

The Cockpit has no permanent wall of green status cards. Healthy systems are represented by a compact ambient health indicator. The attention layer expands only when there is an actionable warning or the operator requests diagnostics.

An attention item answers in this order:

1. What is affected?
2. Is Program/audience currently impacted?
3. What is the recommended action?
4. What technical detail is available if an advanced operator expands it?

Example: `YouTube stream interrupted. Local Program and audience Wi-Fi are still live. Retry YouTube` is preferred over `RTMP destination error`.

## Focus Mode

Focus Mode is a dedicated live-service presentation state optimized for pressure and speed. It is available from the Cockpit and may become an operator preference for automatic entry when a service goes live.

Focus Mode contains only:

- large Program;
- Preview;
- Next queue;
- TAKE;
- Clear Program;
- a minimal Now context strip;
- one health/attention indicator;
- a command/search trigger.

Secondary navigation, configuration, historical lists, detailed worker metrics and setup controls recede until Focus Mode is exited or an alert requires action.

Focus Mode must support desktop keyboard operation and touch-friendly large targets. It must not depend on hover-only controls.

## Predictive Next

Predictive Next is the signature AI assistance layer for the Cockpit. It does not attempt to run the service autonomously. It ranks and prepares likely next actions so the human operates ahead of the room rather than reacting late.

Recommendation inputs may include:

- current and recent transcript;
- explicit Scripture references and quote/context matches;
- current service rundown and nearby planned items;
- current speaker identity/context when available;
- recent songs/media used in the service;
- service phase and elapsed time;
- camera/source availability;
- audience language demand;
- output/stream health;
- organization/operator preferences;
- prior service patterns only when they are relevant and tenant-scoped.

Every recommendation includes:

- action type;
- target entity or content;
- confidence;
- concise evidence/reason;
- expiration or freshness where relevant;
- whether it is suggestion-only or has already been safely prepared in Preview.

Recommendations become stale when their source context is stale. Stale suggestions must visually decay or disappear rather than linger as if still relevant.

## AI command layer

The Cockpit includes a universal command entry point available by keyboard, click/tap and eventually voice where appropriate. It is not a chat page competing with the live UI. It is a fast command/search layer over existing authorized product capabilities.

Examples:

- `Show John 3:16 NIV`
- `Prepare the closing slide`
- `Find Amazing Grace`
- `Preview Camera 2`
- `Open French interpretation`
- `Start YouTube`
- `Mute this recommendation type`
- `What is wrong with streaming?`

The command system must:

- resolve intent to explicit product actions;
- show the interpreted action before consequential mutations when ambiguity exists;
- respect RBAC, tenant scope and subscription entitlements;
- use the same underlying domain services/APIs as normal UI controls;
- never create a bypass around Preview/Program or device security;
- provide a deterministic fallback when natural-language interpretation is unavailable.

The command layer may execute low-risk navigation/search/read actions immediately. Live mutations follow the same confirmation/safety rules as their normal UI equivalents.

## AI Director relationship

AI Director remains the detailed intelligence workspace. The Cockpit consumes a small, ranked projection of its recommendations rather than duplicating the full AI Director UI.

AI Director owns:

- recommendation history;
- confidence/evidence inspection;
- source/worker health relevant to recommendations;
- organization/service AI settings;
- future automation-policy configuration.

The Cockpit owns:

- the top few contextually relevant recommendations;
- operator actions on those recommendations;
- attention-worthy AI failures that affect live operation.

## Recovery and resilience UX

Recovery is designed as an operator workflow, not an infrastructure dashboard.

For each failure class, the product maps technical state to:

- user-visible impact;
- containment status;
- recommended recovery;
- escalation/detail.

Examples:

- Edge offline: explain which local capabilities are unavailable and whether current Program is frozen/continuing.
- ASR degraded: explain that manual Scripture/Media operation still works.
- translation worker offline: explain which language channels are affected while original audio remains available.
- social stream failed: make clear whether local Program, recording and other destinations remain healthy.
- entitlement renewal unavailable: explain offline-grace state without blocking stop/read/history/settings operations.

Recovery actions must be idempotent where possible and must never make an already-contained failure worse.

## Progressive depth

The Cockpit uses three depth levels without separate products:

### Essential

Default for volunteers and basic operators. Shows live service state, Program/Preview, Next, TAKE/Clear and plain-language attention.

### Advanced

Expands camera/source selection, output destinations, languages, rundown detail, recommendation evidence and selected live-system controls.

### Engineering

Exposes deeper Edge/provider/worker telemetry, latency, counters, routing detail and diagnostics. Engineering detail is intentionally absent from the default operator surface.

Role permissions still govern actions independently of visual depth. A user cannot gain capability by selecting an advanced view.

## Mobile and role-specific views

Mobile is not a responsive copy of the full desktop cockpit. It presents task-specific surfaces based on role and current service state.

Examples:

- Pastor/service leader: current/next rundown, Scripture context, simple request/pin actions.
- Producer: Program/Preview status, Next queue, attention/recovery and approved live controls.
- Interpreter: assigned language, transcript/source audio status, translation channel health.
- Media lead: queued assets, camera/media readiness and requests.
- General audience: live video, Scripture, captions and selected-language audio only.

The mobile experience must preserve tenant/RBAC/entitlement rules and must not expose engineering diagnostics to roles that do not need them.

## Architecture and boundaries

This program is an experience layer over existing domain services, not a replacement architecture.

### Cockpit service model

Introduce one server-side Cockpit view model that composes current service context from existing sources:

- current service and role/entitlement capabilities;
- current Program and Preview state;
- current/next Planner items;
- top AI recommendations;
- latest transcript/speaker context;
- active camera/source summary;
- output/language/audience summary;
- actionable health incidents.

The Cockpit view model must not own independent copies of domain state. It reads or projects authoritative state from existing Planner, Scripture, Media, Camera, AI Director, Translation, Streaming, Audience and Edge tables/services.

### Recommendation contract

AI recommendations should be represented through a stable service-scoped contract rather than inferred ad hoc in React components. A recommendation requires at least:

- unique ID;
- organization ID;
- service ID;
- recommendation type;
- target type/target ID or structured payload;
- confidence;
- reason/evidence summary;
- source observed time;
- freshness/expiry;
- state such as `suggested`, `prepared`, `accepted`, `dismissed`, `expired`;
- optional Preview/result linkage;
- created/updated timestamps.

Recommendations must be organization- and service-scoped and auditable when operator actions mutate them.

### Attention contract

Health/attention incidents should use a normalized UI contract even when the underlying systems remain separate. The contract should include:

- severity;
- affected capability;
- user impact;
- containment statement;
- recommended action;
- deep-link/detail target;
- observed time/freshness.

The first implementation may compute this contract from existing telemetry without introducing a new durable incident table unless persistence is needed for recovery/audit.

### Command contract

Natural-language commands resolve into typed product intents, for example `scripture.preview`, `media.search`, `stream.start`, `navigation.open`, `camera.recommendation.open`. Intent execution delegates to existing domain services and authorization checks. The command layer does not directly write arbitrary domain tables.

## Safety and authority rules

- Program mutation always uses the existing authorized Program path.
- Predictive Next may auto-prepare Preview only when existing service settings permit it.
- Recommendation confidence never overrides RBAC or entitlement.
- AI-generated content is visibly marked when provenance matters.
- Ambiguous commands must not guess consequential live actions.
- `Clear Program`, `Stop stream`, `End service` and similar consequential actions keep their existing explicit controls/confirmation behavior.
- A degraded AI system must leave manual operation fully available.
- Focus Mode is a presentation state, not a privilege escalation or separate backend authority.

## Visual design system direction

The Cockpit must move away from a dashboard made of equally weighted cards.

Use:

- large live surfaces;
- strong spatial relationship between Preview, TAKE and Program;
- restrained dark surfaces with warm iPresenterPlux accent rather than excessive gold decoration;
- typography large enough for fast scanning at production distance;
- whitespace and grouping instead of persistent borders around every data point;
- ambient status that stays quiet when healthy;
- motion only for meaningful state transitions, recommendation arrival and live-output changes;
- clear pointer, hover, focus and touch states for every interactive control.

Avoid:

- grids of small KPI cards during live operation;
- tiny technical labels as the primary status language;
- persistent green badges for healthy systems;
- modal overload;
- hidden hover-only actions;
- dense toolbars full of rarely used controls;
- copying scene/source lists merely because competing products use them.

## Transition from current product

The rollout must preserve the already-green workstreams and avoid a big-bang rewrite.

### Phase 1: Unified Cockpit shell

- Replace the default Control Room information hierarchy with Program/Preview/Now/Next/Attention.
- Reuse current service context, Scripture state, Planner items, streaming/language summaries and existing controls.
- Keep existing domain routes available.
- Add Focus Mode using the same Cockpit state model.

### Phase 2: Predictive Next

- Add a service-scoped recommendation contract.
- Project Scripture AI recommendations first because the evidence/confidence pipeline already exists.
- Add Planner/media recommendations next.
- Add camera recommendations only from real Edge truth.
- Add recommendation freshness, pin/dismiss/accept behavior and audit.

### Phase 3: AI command layer

- Start with deterministic search/navigation and Scripture/media preparation commands.
- Add streaming/language/camera intents only after each intent can reuse a typed, authorization-safe domain operation.
- Add natural-language interpretation over those typed intents, never arbitrary tool execution.

### Phase 4: Smart attention and recovery

- Normalize existing Edge/ASR/translation/TTS/stream/provider health into operator-impact incidents.
- Add plain-language recovery actions and engineering drill-down.

### Phase 5: Role/mobile projections

- Expose Cockpit projections tailored to producer, pastor/service leader, interpreter and media roles.
- Preserve the public Audience experience as its own minimal surface.

## Testing strategy

### Contract tests

- Cockpit view model preserves authoritative service/Preview/Program state.
- recommendation ordering and freshness are deterministic for equal inputs;
- stale recommendations expire rather than remain actionable;
- command resolution maps only to registered typed intents;
- attention incidents always include impact + recommended action;
- role/entitlement gating remains independent of UI depth.

### Safety regressions

- no AI recommendation can mutate Program directly;
- auto-preview respects existing service AI settings and thresholds;
- Focus Mode cannot bypass RBAC;
- expired/degraded AI still permits manual Preview/Program workflows where the user is authorized;
- camera recommendations never claim unavailable browser-owned capture;
- tenant isolation applies to recommendation/history data;
- command layer cannot bypass activation/entitlement gates.

### UX acceptance

- every primary live action is keyboard reachable;
- touch targets meet mobile/tablet operator needs;
- no visible live control is dead;
- healthy system detail is not required to operate a normal service;
- every red/amber attention state explains impact and next action;
- Program and Preview are visually distinguishable at a glance;
- new users can identify what is live and what will happen next without opening another page.

### Production build and route acceptance

The program must preserve all existing CI gates from navigation, Scripture, Audience/Streaming, licensing and Studio Workspaces. New Cockpit/Focus/AI-command routes or components must be covered by production build and route-manifest validation where applicable.

## Field-UAT scenarios

The first Cockpit field UAT must cover:

1. Start a prepared service with healthy Edge/outputs and enter Focus Mode.
2. Preacher cites a Scripture; AI recommends it; operator previews and takes it live.
3. Operator ignores/dismisses a wrong recommendation without disturbing Program.
4. Operator searches and previews a song/media item without leaving the live mental model.
5. A social stream fails while local Program remains healthy; Cockpit explains containment and offers recovery.
6. Translation/TTS becomes degraded; original-language audience path continues and the operator sees affected languages only.
7. Camera telemetry becomes stale; recommendation disappears or degrades rather than suggesting unavailable hardware.
8. Operator uses the command layer for a safe search/preparation action and receives an explicit interpretation.
9. Unauthorized user opens the Cockpit and sees only permitted controls despite selecting advanced depth.
10. Service ends and the completed session appears in Archive with structured memory intact.

## Acceptance criteria

This program is complete when:

- Control Room and Operator are unified into one coherent Cockpit mental model;
- Focus Mode can run a live service without requiring the operator to navigate to domain modules for normal actions;
- Program, Preview, Next and Attention are immediately understandable;
- Predictive Next produces ranked, evidence-backed, freshness-aware recommendations;
- recommendations can be previewed/pinned/dismissed but cannot directly mutate Program;
- the AI command layer resolves only to typed, authorized product intents;
- healthy subsystem telemetry recedes while actionable failures surface with plain-language impact/recovery;
- experienced operators can expand advanced/engineering detail without cluttering the default view;
- mobile projections are role-specific rather than compressed desktop pages;
- existing domain workspaces remain accessible for deep work;
- all existing security, entitlement, tenant and Preview/Program safety regressions remain green;
- field UAT demonstrates that a first-time volunteer can identify live state, next action and recovery guidance with minimal instruction.

## Future extensions intentionally deferred

These ideas fit the direction but are outside this first Cockpit implementation program:

- autonomous Program switching;
- generative scene/layout design;
- automatic sermon clip publishing;
- full voice-controlled live operation;
- multi-room/multi-campus simultaneous production control;
- predictive camera movement using computer vision;
- automatic lower-thirds/person recognition;
- full church-management workflow integration.

They should be added only if they preserve the central rule: **iPresenterPlux should make advanced production feel simpler, not make simple production feel technical.**
