import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ENVELOPE_VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;

type ProviderTokenPayload = {
  accessToken: string;
  refreshToken: string;
};

function decodeKey(raw = process.env.IPRESENTERPLUX_PROVIDER_SECRET_KEY) {
  if (!raw?.trim()) throw new Error("provider_secret_key_missing");
  const value = raw.trim();
  const key = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64url");
  if (key.length !== KEY_BYTES) throw new Error("provider_secret_key_invalid_length");
  return key;
}

export function encryptProviderTokens(payload: ProviderTokenPayload) {
  const accessToken = payload.accessToken.trim();
  const refreshToken = payload.refreshToken.trim();
  if (!accessToken || accessToken.length > 8192) throw new Error("provider_access_token_invalid");
  if (!refreshToken || refreshToken.length > 8192) throw new Error("provider_refresh_token_invalid");

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", decodeKey(), iv);
  const plaintext = Buffer.from(JSON.stringify({ accessToken, refreshToken }), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENVELOPE_VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptProviderTokens(envelope: string): ProviderTokenPayload {
  const [version, ivPart, tagPart, cipherPart, extra] = String(envelope ?? "").split(".");
  if (extra || version !== ENVELOPE_VERSION || !ivPart || !tagPart || !cipherPart) throw new Error("provider_secret_envelope_invalid");
  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  const ciphertext = Buffer.from(cipherPart, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== 16 || ciphertext.length < 1) throw new Error("provider_secret_envelope_invalid");

  const decipher = createDecipheriv("aes-256-gcm", decodeKey(), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(plaintext) as Partial<ProviderTokenPayload>;
  if (typeof parsed.accessToken !== "string" || !parsed.accessToken.trim()) throw new Error("provider_secret_payload_invalid");
  if (typeof parsed.refreshToken !== "string" || !parsed.refreshToken.trim()) throw new Error("provider_secret_payload_invalid");
  return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
}

export function providerSecretKeyConfigured() {
  try {
    decodeKey();
    return true;
  } catch {
    return false;
  }
}
