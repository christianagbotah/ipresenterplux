import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const PRODUCT_KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PRODUCT_KEY_PREFIX = "IPLX";
const PRODUCT_KEY_SECRET_LENGTH = 20;
const PRODUCT_KEY_SALT_BYTES = 16;
const PRODUCT_KEY_HASH_BYTES = 32;
const NORMALIZED_PATTERN = /^IPLX[A-HJ-NP-Z2-9]{20}$/u;
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

type RandomSource = (size: number) => Buffer;

export function normalizeProductKey(input: string) {
  const normalized = input.toUpperCase().replace(/[\s-]+/gu, "");
  if (!NORMALIZED_PATTERN.test(normalized)) {
    throw new Error("Invalid product key format");
  }
  return normalized;
}

export function deriveProductKeyHash(normalized: string, salt: Buffer): Promise<Buffer> {
  if (!NORMALIZED_PATTERN.test(normalized) || salt.length !== PRODUCT_KEY_SALT_BYTES) {
    return Promise.reject(new Error("Invalid product key material"));
  }

  return new Promise((resolve, reject) => {
    scrypt(normalized, salt, PRODUCT_KEY_HASH_BYTES, SCRYPT_OPTIONS, (error, derived) => {
      if (error) return reject(error);
      resolve(Buffer.from(derived));
    });
  });
}

export async function verifyProductKey(input: string, salt: Buffer, expectedHash: Buffer) {
  if (salt.length !== PRODUCT_KEY_SALT_BYTES || expectedHash.length !== PRODUCT_KEY_HASH_BYTES) return false;

  let normalized: string;
  try {
    normalized = normalizeProductKey(input);
  } catch {
    return false;
  }

  const actualHash = await deriveProductKeyHash(normalized, salt);
  return timingSafeEqual(actualHash, expectedHash);
}

export async function generateProductKey(randomSource: RandomSource = randomBytes) {
  const secretBytes = randomSource(PRODUCT_KEY_SECRET_LENGTH);
  const salt = randomSource(PRODUCT_KEY_SALT_BYTES);
  if (secretBytes.length !== PRODUCT_KEY_SECRET_LENGTH || salt.length !== PRODUCT_KEY_SALT_BYTES) {
    throw new Error("Random source returned invalid product key material");
  }

  let secret = "";
  for (const byte of secretBytes) secret += PRODUCT_KEY_ALPHABET[byte & 31];
  const normalized = `${PRODUCT_KEY_PREFIX}${secret}`;
  const groups = [normalized.slice(0, 4)];
  for (let offset = 4; offset < normalized.length; offset += 4) groups.push(normalized.slice(offset, offset + 4));

  return {
    displayKey: groups.join("-"),
    normalized,
    prefix: normalized.slice(0, 12),
    salt,
    hash: await deriveProductKeyHash(normalized, salt)
  };
}
