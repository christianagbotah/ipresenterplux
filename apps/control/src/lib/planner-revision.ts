import type { PlannerRevisionSource } from "./planner-contracts";
import { computePlannerRevision as computePlannerRevisionRuntime } from "./planner-revision-runtime.js";

export function computePlannerRevision(source: PlannerRevisionSource): string {
  return computePlannerRevisionRuntime(source);
}
