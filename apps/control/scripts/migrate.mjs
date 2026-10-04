import fs from "node:fs/promises";
import process from "node:process";
import pg from "pg";

process.loadEnvFile?.(".env.local");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not configured");
}

const sql = await fs.readFile(new URL("../db/001_foundation.sql", import.meta.url), "utf8");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
  await client.query(sql);
  const { rows } = await client.query(
    "select current_database() as database, count(*)::int as organizations from organizations"
  );
  console.log(JSON.stringify({ ok: true, ...rows[0] }));
} finally {
  await client.end();
}
