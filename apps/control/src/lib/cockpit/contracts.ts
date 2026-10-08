import type { CurrentServiceCapabilities } from "../current-service.ts";

export type CockpitFreshness = "current" | "stale" | "unavailable";
export type CockpitStageSource = "presentation_item" | "scripture_detection";

export type CockpitStageState = {
  id: string;
  source: CockpitStageSource;
  contentType: string;
  title: string;
  state: "preview" | "live";
  observedAt: string | null;
  detail: string | null;
};

export type CockpitProgramState = CockpitStageState;
export type CockpitPreviewState = CockpitStageState;

export type CockpitNowContext = {
  speakerId: string | null;
  speakerSource: string | null;
  transcriptText: string | null;
  sourceLanguage: string | null;
  asrConfidence: number | null;
  observedAt: string | null;
  currentContent: CockpitProgramState | null;
};

export type CockpitNextItem = {
  id: string;
  source: "planned" | "recommendation" | "pinned";
  targetType: string;
  targetId: string;
  title: string;
  state: string;
  sortOrder: number | null;
  confidence: number | null;
  reason: string | null;
  observedAt: string | null;
  freshUntil: string | null;
  actions: Array<"preview" | "open" | "pin" | "dismiss" | "use_instead">;
};

export type CockpitAttentionItem = {
  id: string;
  severity: "info" | "warning" | "critical";
  affectedCapability: string;
  impact: string;
  containment: string;
  recommendedAction: string;
  detailHref: string | null;
  observedAt: string | null;
  freshUntil: string | null;
  recoveryIntent: string | null;
};

export type CockpitSystemFreshness = {
  freshness: CockpitFreshness;
  lastSeenAt: string | null;
};

export type CockpitViewModel = {
  organization: { id: string; name: string };
  service: null | {
    id: string;
    title: string;
    status: string;
    campusId: string | null;
    campusName: string | null;
    activeBibleVersion: string;
    aiEnabled: boolean;
    autoPreviewThreshold: number;
  };
  capabilities: CurrentServiceCapabilities;
  program: CockpitProgramState | null;
  preview: CockpitPreviewState | null;
  now: CockpitNowContext;
  next: CockpitNextItem[];
  attention: CockpitAttentionItem[];
  systems: {
    edge: CockpitSystemFreshness & { id: string | null; name: string | null; status: string | null };
    camera: CockpitSystemFreshness & { count: number; activeName: string | null };
    audio: CockpitSystemFreshness & { count: number; activeName: string | null };
    outputs: { total: number; enabled: number; healthy: number; degraded: number };
    languages: { enabled: number; listeners: number };
    audience: { listeners: number; serviceLive: boolean };
  };
  authority: {
    programMutation: "existing_domain_paths_only";
    edgeOwnsPhysicalTruth: true;
  };
};
