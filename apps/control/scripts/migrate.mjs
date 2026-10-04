import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

process.loadEnvFile?.(".env.local");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not configured");
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const migrationsDir = path.resolve("db");

try {
  await client.connect();
  await client.query(`
    create table if not exists schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const files = (await fs.readdir(migrationsDir))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();

  const appliedRows = await client.query(
    "select filename from schema_migrations"
  );
  const applied = new Set(appliedRows.rows.map((row) => row.filename));
  const executed = [];

  for (const filename of files) {
    if (applied.has(filename)) continue;

    const sql = await fs.readFile(path.join(migrationsDir, filename), "utf8");
    await client.query(sql);
    await client.query(
      "insert into schema_migrations(filename) values ($1) on conflict do nothing",
      [filename]
    );
    executed.push(filename);
  }

  const { rows } = await client.query(
    "select current_database() as database, count(*)::int as organizations from organizations"
  );

  console.log(JSON.stringify({
    ok: true,
    ...rows[0],
    applied: executed
  }));
} finally {
  await client.end();
}
