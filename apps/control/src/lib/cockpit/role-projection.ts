import type { CockpitViewModel } from "./contracts.ts";

export type CockpitRoleProjectionKind =
  | "producer"
  | "pastor_service_leader"
  | "interpreter"
  | "media_lead"
  | "restricted";

export type CockpitRoleProjection = {
  kind: CockpitRoleProjectionKind;
  label: string;
  showProgram: boolean;
  showPreview: boolean;
  showNext: boolean;
  showAttention: boolean;
  showTranscript: boolean;
  showLanguages: boolean;
  showCameraReadiness: boolean;
  showMediaReadiness: boolean;
  showEngineering: boolean;
  actions: {
    canTake: boolean;
    canClear: boolean;
    canPin: boolean;
    canOpenScripture: boolean;
    canOpenMedia: boolean;
    canOpenCameras: boolean;
    canOpenTranslations: boolean;
    canOpenStreaming: boolean;
  };
};

function has(roles: readonly string[], role: string) {
  return roles.includes(role);
}

function projectionKind(roles: readonly string[]): CockpitRoleProjectionKind {
  if (has(roles, "owner") || has(roles, "admin") || has(roles, "presenter_operator")) return "producer";
  if (has(roles, "pastor")) return "pastor_service_leader";
  if (has(roles, "translator")) return "interpreter";
  if (has(roles, "media_operator")) return "media_lead";
  return "restricted";
}

export function projectCockpitForRole(model: CockpitViewModel, roles: readonly string[]): CockpitRoleProjection {
  const kind = projectionKind(roles);
  const liveControl = model.capabilities.canLiveControl === true;
  const shared = {
    actions: {
      canTake: liveControl,
      canClear: liveControl,
      canPin: model.capabilities.canPlanServices === true || liveControl,
      canOpenScripture: model.capabilities.canViewPlanner === true,
      canOpenMedia: model.capabilities.canMedia === true,
      canOpenCameras: model.capabilities.canCameras === true,
      canOpenTranslations: model.capabilities.canTranslations === true,
      canOpenStreaming: model.capabilities.canStreaming === true
    }
  };

  if (kind === "producer") return {
    kind,
    label: "Producer",
    showProgram: true,
    showPreview: true,
    showNext: true,
    showAttention: true,
    showTranscript: false,
    showLanguages: true,
    showCameraReadiness: true,
    showMediaReadiness: true,
    showEngineering: false,
    ...shared
  };
  if (kind === "pastor_service_leader") return {
    kind,
    label: "Service Leader",
    showProgram: true,
    showPreview: true,
    showNext: true,
    showAttention: true,
    showTranscript: false,
    showLanguages: false,
    showCameraReadiness: false,
    showMediaReadiness: false,
    showEngineering: false,
    ...shared
  };
  if (kind === "interpreter") return {
    kind,
    label: "Interpreter",
    showProgram: true,
    showPreview: false,
    showNext: false,
    showAttention: true,
    showTranscript: true,
    showLanguages: true,
    showCameraReadiness: false,
    showMediaReadiness: false,
    showEngineering: false,
    ...shared,
    actions: { ...shared.actions, canTake: false, canClear: false, canPin: false }
  };
  if (kind === "media_lead") return {
    kind,
    label: "Media Lead",
    showProgram: true,
    showPreview: true,
    showNext: true,
    showAttention: true,
    showTranscript: false,
    showLanguages: false,
    showCameraReadiness: true,
    showMediaReadiness: true,
    showEngineering: false,
    ...shared
  };
  return {
    kind,
    label: "Service View",
    showProgram: true,
    showPreview: false,
    showNext: true,
    showAttention: true,
    showTranscript: false,
    showLanguages: false,
    showCameraReadiness: false,
    showMediaReadiness: false,
    showEngineering: false,
    ...shared,
    actions: { ...shared.actions, canTake: false, canClear: false, canPin: false }
  };
}
