import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

export type EntitlementPayload = {
  schemaVersion: number;
  product: string;
  audience: string;
  entitlementId: string;
  organizationId: string;
  subscriptionId: string;
  planCode: string;
  activationId: string;
  installationId: string;
  issuedAt: string;
  onlineValidUntil: string;
  offlineGraceUntil: string;
  features: Record<string, boolean>;
  limits: Record<string, number>;
  signingKeyId: string;
};

export type EntitlementPublicKeys = Readonly<Record<string, string | Buffer>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PRODUCT = "ipresenterplux";
const AUDIENCE = "edge-desktop";

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}

function parseIso(name: string, value: unknown) {
  if (typeof value !== "string") throw new Error(`Invalid entitlement ${name}`);
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
    throw new Error(`Invalid entitlement ${name}`);
  }
  return time;
}

function assertRecord(value: unknown, name: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid entitlement ${name}`);
  }
}

function validatePayload(value: unknown): EntitlementPayload {
  assertRecord(value, "payload");
  const payload = value as Record<string, unknown>;
  if (payload.schemaVersion !== 1) throw new Error("Invalid entitlement schema version");
  if (payload.product !== PRODUCT) throw new Error("Invalid entitlement product");
  if (payload.audience !== AUDIENCE) throw new Error("Invalid entitlement audience");
  for (const name of ["entitlementId", "organizationId", "subscriptionId", "activationId"] as const) {
    const current = payload[name];
    if (typeof current !== "string" || !UUID.test(current)) throw new Error(`Invalid entitlement ${name}`);
  }
  for (const name of ["planCode", "installationId", "signingKeyId"] as const) {
    const current = payload[name];
    if (typeof current !== "string" || current.length < 1 || current.length > 200) {
      throw new Error(`Invalid entitlement ${name}`);
    }
  }
  const issuedAt = parseIso("issuedAt", payload.issuedAt);
  const onlineValidUntil = parseIso("onlineValidUntil", payload.onlineValidUntil);
  const offlineGraceUntil = parseIso("offlineGraceUntil", payload.offlineGraceUntil);
  if (onlineValidUntil < issuedAt) throw new Error("Invalid entitlement online validity");
  if (offlineGraceUntil < onlineValidUntil) throw new Error("Invalid entitlement offline grace");

  assertRecord(payload.features, "features");
  for (const feature of Object.values(payload.features as Record<string, unknown>)) {
    if (typeof feature !== "boolean") throw new Error("Invalid entitlement features");
  }
  assertRecord(payload.limits, "limits");
  for (const limit of Object.values(payload.limits as Record<string, unknown>)) {
    if (typeof limit !== "number" || !Number.isFinite(limit)) throw new Error("Invalid entitlement limits");
  }
  return payload as unknown as EntitlementPayload;
}

export function signEntitlement(payload: EntitlementPayload) {
  const signingKeyId = process.env.IPRESENTERPLUX_ENTITLEMENT_SIGNING_KEY_ID;
  const privateKeyPem = process.env.IPRESENTERPLUX_ENTITLEMENT_PRIVATE_KEY_PEM;
  if (!signingKeyId || !privateKeyPem) throw new Error("Entitlement signing is not configured");
  if (payload.signingKeyId !== signingKeyId) throw new Error("Entitlement signing key mismatch");
  const validated = validatePayload(payload);
  const raw = Buffer.from(stableJson(validated), "utf8");
  const signature = sign(null, raw, createPrivateKey(privateKeyPem));
  return `${raw.toString("base64url")}.${signature.toString("base64url")}`;
}

export function verifyEntitlementEnvelope(envelope: string, publicKeys: EntitlementPublicKeys) {
  const parts = envelope.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("Invalid entitlement envelope");

  let raw: Buffer;
  let signature: Buffer;
  let untrusted: unknown;
  try {
    raw = Buffer.from(parts[0], "base64url");
    signature = Buffer.from(parts[1], "base64url");
    untrusted = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new Error("Invalid entitlement envelope");
  }

  const signingKeyId = untrusted && typeof untrusted === "object"
    ? (untrusted as { signingKeyId?: unknown }).signingKeyId
    : undefined;
  if (typeof signingKeyId !== "string" || !publicKeys[signingKeyId]) {
    throw new Error("Unknown entitlement signing key");
  }

  let verified = false;
  try {
    verified = verify(null, raw, createPublicKey(publicKeys[signingKeyId]), signature);
  } catch {
    verified = false;
  }
  if (!verified) throw new Error("Invalid entitlement signature");
  return validatePayload(untrusted);
}
