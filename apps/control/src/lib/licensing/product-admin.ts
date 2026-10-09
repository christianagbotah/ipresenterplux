function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function configuredProductAdmins(allowlist?: string | null) {
  const raw = allowlist ?? process.env.IPRESENTERPLUX_PRODUCT_ADMIN_EMAILS ?? "";
  return new Set(
    raw
      .split(/[;,\n]/u)
      .map(normalizeEmail)
      .filter(Boolean)
  );
}

export function isProductAdminEmail(email: string | null | undefined, allowlist?: string | null) {
  if (!email) return false;
  return configuredProductAdmins(allowlist).has(normalizeEmail(email));
}

export function requireProductAdminEmail(email: string | null | undefined, allowlist?: string | null) {
  if (!isProductAdminEmail(email, allowlist)) {
    throw new Error("Lightworld product administrator authorization is required");
  }
}
