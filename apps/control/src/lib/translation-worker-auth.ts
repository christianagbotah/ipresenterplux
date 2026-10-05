import { createHash, timingSafeEqual } from "node:crypto";

function bearerToken(request: Request) {
  const value = request.headers.get("authorization")?.trim();
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice(7).trim();
  return token.length >= 32 && token.length <= 256 ? token : null;
}

export function authenticateTranslationWorker(request: Request) {
  const token = bearerToken(request);
  const expectedHex = process.env.TRANSLATION_WORKER_TOKEN_HASH?.trim().toLowerCase();
  if (!token || !expectedHex || !/^[0-9a-f]{64}$/.test(expectedHex)) return false;

  const actual = createHash("sha256").update(token).digest();
  const expected = Buffer.from(expectedHex, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
