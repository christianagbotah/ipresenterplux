const TEST_DATABASE_SEGMENTS = new Set(["ci", "test", "testing", "selftest"]);
const OVERRIDE_PHRASE = "I_UNDERSTAND_THIS_CAN_WRITE_DATA";

function databaseName(databaseUrl) {
  if (!databaseUrl?.trim()) throw new Error("DATABASE_URL must be configured for writable database self-test");
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL is invalid for writable database self-test");
  }
  if (!/^postgres(ql)?:$/u.test(parsed.protocol)) {
    throw new Error("DATABASE_URL is invalid for writable database self-test");
  }
  const name = decodeURIComponent(parsed.pathname.replace(/^\//u, "")).trim();
  if (!name) throw new Error("DATABASE_URL is invalid for writable database self-test");
  return name;
}

export function assertWritableSelfTestDatabase(databaseUrl, env = process.env) {
  const name = databaseName(databaseUrl);
  if (env.IPRESENTERPLUX_ALLOW_DATABASE_SELFTEST === OVERRIDE_PHRASE) return name;

  const segments = name.toLowerCase().split(/[-_]+/u).filter(Boolean);
  if (!segments.some((segment) => TEST_DATABASE_SEGMENTS.has(segment))) {
    throw new Error(`database_selftest_refused_non_test_database:${name}`);
  }
  return name;
}

export const WRITABLE_SELFTEST_OVERRIDE_PHRASE = OVERRIDE_PHRASE;
