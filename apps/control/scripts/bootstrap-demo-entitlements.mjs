#!/usr/bin/env node
import process from "node:process";
import pg from "pg";
import { ensureDemoFullEntitlement } from "../src/lib/licensing/demo-bootstrap.ts";

process.loadEnvFile?.(".env.local");
if (process.env.IPRESENTERPLUX_ENABLE_DEMO_ACCOUNTS !== "true") {
  throw new Error("Demo entitlement bootstrap is disabled because demo accounts are not enabled");
}
if (!process.argv.includes("--apply")) {
  throw new Error("Refusing to modify demo licensing state without --apply");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query("begin");
  const result = await ensureDemoFullEntitlement(client);
  await client.query("commit");
  console.log(JSON.stringify({ ok: true, ...result }));
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
