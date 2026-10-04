import crypto from "node:crypto";
import bcrypt from "bcryptjs";

export function hashIdentifier(value: string) {
  return crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

export function hashToken(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, passwordHash: string | null) {
  if (!passwordHash) return false;
  return bcrypt.compare(password, passwordHash);
}
