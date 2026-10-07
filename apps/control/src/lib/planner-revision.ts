import { createHash } from "node:crypto";
import type { PlannerRevisionSource } from "./planner-contracts";

export function computePlannerRevision(source: PlannerRevisionSource): string {
  const canonical = [
    source.serviceId,
    source.serviceUpdatedAt,
    ...source.items.flatMap((item) => [
      item.id,
      item.itemType,
      String(item.sortOrder),
      item.state,
      item.updatedAt
    ])
  ].join("\u001f");

  return createHash("sha256").update(canonical).digest("hex").slice(0, 24);
}
