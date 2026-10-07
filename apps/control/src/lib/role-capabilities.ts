import {
  DEVICE_ADMIN_ROLES,
  LIVE_OPERATOR_ROLES,
  PLANNER_MUTATION_ROLES,
  PLANNER_VIEW_ROLES,
  STREAM_OPERATOR_ROLES,
  TRANSLATION_OPERATOR_ROLES
} from "./role-policy.js";

function intersects(roles: readonly string[], allowed: readonly string[]) {
  return roles.some((role) => allowed.includes(role));
}

export function roleCapabilities(roles: readonly string[]) {
  return {
    canLiveControl: intersects(roles, LIVE_OPERATOR_ROLES),
    canStreaming: intersects(roles, STREAM_OPERATOR_ROLES),
    canTranslations: intersects(roles, TRANSLATION_OPERATOR_ROLES),
    canSettings: intersects(roles, DEVICE_ADMIN_ROLES),
    canViewPlanner: intersects(roles, PLANNER_VIEW_ROLES),
    canPlanServices: intersects(roles, PLANNER_MUTATION_ROLES)
  };
}
