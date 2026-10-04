import crypto from "node:crypto";

function key() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET must be configured before issuing recoverable Edge credentials");
  }
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptEdgeCredentialForRecovery(credential: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(credential, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptEdgeCredentialRecovery(envelope: string) {
  const [version, ivRaw, tagRaw, ciphertextRaw] = envelope.split(".");
  if (version !== "v1" || !ivRaw || !tagRaw || !ciphertextRaw) {
    throw new Error("Invalid Edge credential recovery envelope");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, "base64url")),
    decipher.final()
  ]).toString("utf8");
}
