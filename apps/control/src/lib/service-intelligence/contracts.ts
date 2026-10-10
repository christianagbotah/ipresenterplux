export type ServicePreparationNoteType = "sermon_notes" | "service_notes" | "operator_notes";

export type ServicePreparationNote = {
  id: string;
  organizationId: string;
  serviceId: string;
  noteType: ServicePreparationNoteType;
  title: string;
  content: string;
  sourceLabel: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ServiceMemoryStatus = "pending" | "ready" | "failed";

export type ServiceMemoryRecord = {
  serviceId: string;
  organizationId: string;
  status: ServiceMemoryStatus;
  sourceFingerprint: string | null;
  summary: string;
  keyScriptures: unknown[];
  speakers: unknown[];
  songsMedia: unknown[];
  incidents: unknown[];
  languagesOutputs: Record<string, unknown>;
  generatorVersion: string;
  generatedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ServiceMemoryChapter = {
  id: string;
  organizationId: string;
  serviceId: string;
  ordinal: number;
  title: string;
  summary: string;
  startedAt: string | null;
  endedAt: string | null;
  sourceKind: "transcript" | "scripture" | "rundown" | "mixed";
  confidence: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ServicePreparationSuggestion = {
  id: string;
  kind: "scripture_reference" | "history_reuse" | "history_context" | "library_reuse" | "readiness_attention";
  title: string;
  reason: string;
  evidence: string;
  confidence: number;
  sourceServiceId: string | null;
  sourceObservedAt: string | null;
  plannerCandidate: null | { itemType: string; input: unknown };
  navigationTarget: string | null;
};

export type ServicePreparationContext = {
  organizationId: string;
  service: {
    id: string;
    title: string;
    serviceType: string;
    status: string;
    campusId: string | null;
    activeBibleVersion: string;
    scheduledStart: string | null;
  };
  notes: ServicePreparationNote[];
  readiness: {
    outputs: { enabled: number; healthy: number; degraded: number };
    languages: { enabled: number; listeners: number };
    edge: { count: number; name: string | null; freshness: "current" | "stale" | "unavailable"; lastSeenAt: string | null };
  };
  suggestions: ServicePreparationSuggestion[];
};
