import { createHash } from "node:crypto";

export function computePlannerRevision(source) {
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
