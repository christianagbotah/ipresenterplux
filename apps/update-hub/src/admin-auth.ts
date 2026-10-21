import { timingSafeEqual } from 'node:crypto';

export function verifyAdminBearer(authorization: string | undefined, expectedToken: string | undefined): boolean {
  const expected = expectedToken?.trim();
  if (!expected || !authorization?.startsWith('Bearer ')) return false;
  const supplied = authorization.slice('Bearer '.length);
  const suppliedBytes = Buffer.from(supplied, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  if (suppliedBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(suppliedBytes, expectedBytes);
}

export function requireAdminToken(env: Record<string, string | undefined> = process.env): string {
  const token = env.UPDATE_HUB_ADMIN_TOKEN?.trim();
  if (!token || token.length < 24) throw new Error('UPDATE_HUB_ADMIN_TOKEN must contain at least 24 characters.');
  return token;
}

export function adminActor(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  const normalized = candidate?.trim();
  if (!normalized) return 'update-hub-admin';
  return normalized.slice(0, 120).replace(/[^A-Za-z0-9@._:-]/g, '_');
}
