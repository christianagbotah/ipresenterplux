export const ENTITLEMENT_PRODUCT = "ipresenterplux";
export const ENTITLEMENT_AUDIENCE = "edge-desktop";
export const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

type EntitlementLike = {
  features?: Record<string, unknown>;
  limits?: Record<string, unknown>;
};

export function offlineGraceUntilFor(onlineValidUntil: string | Date) {
  const timestamp = new Date(onlineValidUntil).getTime();
  if (!Number.isFinite(timestamp)) throw new Error("Invalid entitlement online validity");
  return new Date(timestamp + OFFLINE_GRACE_MS).toISOString();
}

export function hasEntitlementFeature(payload: EntitlementLike, featureId: string) {
  return payload.features?.[featureId] === true;
}

export function getEntitlementLimit(payload: EntitlementLike, limitId: string) {
  const value = payload.limits?.[limitId];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
