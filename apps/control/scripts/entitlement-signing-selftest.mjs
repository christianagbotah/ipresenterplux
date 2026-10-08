import assert from "node:assert/strict";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function importTs(relative) {
  const source = await readFile(new URL(relative, import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return { source, module: await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`) };
}

const entitlementLoaded = await importTs("../src/lib/licensing/entitlement.ts");
const policyLoaded = await importTs("../src/lib/licensing/entitlement-policy.ts");
const { signEntitlement, verifyEntitlementEnvelope } = entitlementLoaded.module;
const { hasEntitlementFeature, getEntitlementLimit, offlineGraceUntilFor } = policyLoaded.module;

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString()
  };
}

const key1 = keyPair();
const key2 = keyPair();
process.env.IPRESENTERPLUX_ENTITLEMENT_PRIVATE_KEY_PEM = key1.privatePem;
process.env.IPRESENTERPLUX_ENTITLEMENT_SIGNING_KEY_ID = "test-k1";

const onlineValidUntil = "2026-10-09T08:00:00.000Z";
const payload = {
  schemaVersion: 1,
  product: "ipresenterplux",
  audience: "edge-desktop",
  entitlementId: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  subscriptionId: "33333333-3333-4333-8333-333333333333",
  planCode: "church-pro",
  activationId: "44444444-4444-4444-8444-444444444444",
  installationId: "installation-test-0001",
  issuedAt: "2026-10-08T08:00:00.000Z",
  onlineValidUntil,
  offlineGraceUntil: offlineGraceUntilFor(onlineValidUntil),
  features: {
    "core.presentation": true,
    "streaming.web": true,
    "streaming.social": false
  },
  limits: { deviceSeats: 3, translationChannels: 5 },
  signingKeyId: "test-k1"
};
assert.equal(
  new Date(payload.offlineGraceUntil).getTime() - new Date(payload.onlineValidUntil).getTime(),
  7 * 24 * 60 * 60 * 1000,
  "offline grace must be exactly seven days beyond online validity"
);

const envelope = signEntitlement(payload);
assert.match(envelope, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
assert.deepEqual(verifyEntitlementEnvelope(envelope, { "test-k1": key1.publicPem }), payload);
assert.equal(hasEntitlementFeature(payload, "streaming.web"), true);
assert.equal(hasEntitlementFeature(payload, "streaming.social"), false);
assert.equal(hasEntitlementFeature(payload, "translations.audio"), false);
assert.equal(getEntitlementLimit(payload, "deviceSeats"), 3);
assert.equal(getEntitlementLimit(payload, "missing"), null);

const [payloadSegment, signatureSegment] = envelope.split(".");
const tamperedPayload = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8"));
tamperedPayload.planCode = "enterprise";
const tamperedSegment = Buffer.from(JSON.stringify(tamperedPayload), "utf8").toString("base64url");
assert.throws(
  () => verifyEntitlementEnvelope(`${tamperedSegment}.${signatureSegment}`, { "test-k1": key1.publicPem }),
  /invalid entitlement signature/iu
);
const alteredSignature = Buffer.from(Buffer.from(signatureSegment, "base64url"));
alteredSignature[0] ^= 1;
assert.throws(
  () => verifyEntitlementEnvelope(`${payloadSegment}.${alteredSignature.toString("base64url")}`, { "test-k1": key1.publicPem }),
  /invalid entitlement signature/iu
);

function manuallySignedEnvelope(customPayload, privatePem) {
  const raw = Buffer.from(JSON.stringify(customPayload), "utf8");
  const signature = cryptoSign(null, raw, privatePem);
  return `${raw.toString("base64url")}.${signature.toString("base64url")}`;
}
for (const [field, value] of [["product", "other-product"], ["audience", "browser"]]) {
  const wrong = { ...payload, [field]: value };
  assert.throws(
    () => verifyEntitlementEnvelope(manuallySignedEnvelope(wrong, key1.privatePem), { "test-k1": key1.publicPem }),
    new RegExp(`invalid entitlement ${field}`, "iu")
  );
}

const unknown = { ...payload, signingKeyId: "unknown-k9" };
assert.throws(
  () => verifyEntitlementEnvelope(manuallySignedEnvelope(unknown, key1.privatePem), { "test-k1": key1.publicPem }),
  /unknown entitlement signing key/iu
);

process.env.IPRESENTERPLUX_ENTITLEMENT_PRIVATE_KEY_PEM = key2.privatePem;
process.env.IPRESENTERPLUX_ENTITLEMENT_SIGNING_KEY_ID = "test-k2";
const rotatedPayload = { ...payload, entitlementId: "55555555-5555-4555-8555-555555555555", signingKeyId: "test-k2" };
const rotatedEnvelope = signEntitlement(rotatedPayload);
assert.deepEqual(
  verifyEntitlementEnvelope(rotatedEnvelope, { "test-k1": key1.publicPem, "test-k2": key2.publicPem }),
  rotatedPayload
);

assert.doesNotMatch(entitlementLoaded.source, /console\.(?:log|info|debug)/u, "entitlement material must not be logged");
assert.doesNotMatch(entitlementLoaded.source, /PRIVATE KEY-----[A-Za-z0-9+/=\s]+/u, "private signing material must never be embedded");
console.log(JSON.stringify({ ok: true, algorithm: "Ed25519", rotatedKeys: 2, offlineGraceDays: 7, productScoped: true }));
