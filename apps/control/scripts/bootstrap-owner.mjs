import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import process from "node:process";
import bcrypt from "bcryptjs";
import pg from "pg";

process.loadEnvFile?.(".env.local");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not configured");
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const secretDir = path.resolve("../..", ".secrets");
const credentialFile = path.join(secretDir, "bootstrap-owner.txt");

try {
  await client.connect();

  const existing = await client.query(
    "select id,email from users order by created_at limit 1"
  );

  if (existing.rowCount) {
    console.log(JSON.stringify({ ok: true, created: false, owner: existing.rows[0].email }));
    process.exit(0);
  }

  const org = await client.query(
    "select id from organizations order by created_at limit 1"
  );

  if (!org.rowCount) {
    throw new Error("No organization exists for bootstrap owner");
  }

  const email = "owner@ipresenterplux.local";
  const displayName = "iPresenterPlux Owner";
  const password = crypto.randomBytes(18).toString("base64url");
  const passwordHash = await bcrypt.hash(password, 12);

  await client.query("begin");

  const user = await client.query(
    `insert into users(email,display_name,password_hash,status,force_password_change)
     values ($1,$2,$3,'active',true)
     returning id`,
    [email, displayName, passwordHash]
  );

  await client.query(
    `insert into user_organization_roles(user_id,organization_id,role_id)
     values ($1,$2,'owner')`,
    [user.rows[0].id, org.rows[0].id]
  );

  await client.query(
    `insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
     values ($1,'system',$2,'auth.bootstrap.owner_created','user',$2,$3::jsonb)`,
    [org.rows[0].id, user.rows[0].id, JSON.stringify({ email })]
  );

  await client.query("commit");

  fs.mkdirSync(secretDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    credentialFile,
    "Email: " + email + "\nTemporary password: " + password + "\nChange this password before public deployment.\n",
    { mode: 0o600 }
  );

  console.log(JSON.stringify({ ok: true, created: true, owner: email, credentialFile }));
} catch (error) {
  try {
    await client.query("rollback");
  } catch {}
  throw error;
} finally {
  await client.end();
}
