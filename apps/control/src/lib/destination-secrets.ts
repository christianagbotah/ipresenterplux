import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ENVELOPE_VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;

type DestinationSecretPayload = {
  streamKey: string;
};

function decodeKey(raw = process.env.IPRESENTERPLUX_DESTINATION_SECRET_KEY) {
  if (!raw?.trim()) throw new Error("destination_secret_key_missing");
  const value = raw.trim();
  let key: Buffer;
  if (/^[0-9a-f]{64}$/i.test(value)) key = Buffer.from(value, "hex");
  else key = Buffer.from(value, "base64url");
  if (key.length !== KEY_BYTES) throw new Error("destination_secret_key_invalid_length");
  return key;
}

export function encryptDestinationSecret(payload: DestinationSecretPayload) {
  const streamKey = payload.streamKey.trim();
  if (!streamKey || streamKey.length > 4096) throw new Error("destination_stream_key_invalid");

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", decodeKey(), iv);
  const plaintext = Buffer.from(JSON.stringify({ streamKey }), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENVELOPE_VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptDestinationSecret(envelope: string): DestinationSecretPayload {
  const [version, ivPart, tagPart, cipherPart, extra] = envelope.split(".");
  if (extra || version !== ENVELOPE_VERSION || !ivPart || !tagPart || !cipherPart) {
    throw new Error("destination_secret_envelope_invalid");
  }

  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  const ciphertext = Buffer.from(cipherPart, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== 16 || ciphertext.length < 1) {
    throw new Error("destination_secret_envelope_invalid");
  }

  const decipher = createDecipheriv("aes-256-gcm", decodeKey(), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(plaintext) as Partial<DestinationSecretPayload>;
  if (typeof parsed.streamKey !== "string" || !parsed.streamKey.trim()) {
    throw new Error("destination_secret_payload_invalid");
  }
  return { streamKey: parsed.streamKey };
}

export function destinationSecretKeyConfigured() {
  try {
    decodeKey();
    return true;
  } catch {
    return false;
  }
}
