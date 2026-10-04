import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import pg from "pg";

process.loadEnvFile?.(".env.local");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not configured");
}

const email = "owner@ipresenterplux.local";
const displayName = "iPresenterPlux Owner";
const organizationId = "00000000-0000-4000-8000-000000000001";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

await client.connect();

try {
  const existing = await client.query(
    "select id from users where lower(email)=lower($1) limit 1",
    [email]
  );

  let userId = existing.rows[0]?.id;
  let temporaryPassword = null;

  if (!userId) {
    temporaryPassword = crypto.randomBytes(18).toString("base64url");
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);

    const inserted = await client.query(
      `insert into users(email,display_name,password_hash,status,force_password_change)
       values ($1,$2,$3,'active',true)
       returning id`,
      [email, displayName, passwordHash]
    );

    userId = inserted.rows[0].id;
  }

  await client.query(
    `insert into user_organization_roles(user_id,organization_id,role_id)
     values ($1,$2,'owner')
     on conflict do nothing`,
    [userId, organizationId]
  );

  if (temporaryPassword) {
    const secretsDir = path.resolve("../..", ".secrets");
    await fs.mkdir(secretsDir, { recursive: true, mode: 0o700 });
    const secretPath = path.join(secretsDir, "bootstrap-owner.txt");
    await fs.writeFile(
      secretPath,
      "Email: " + email + "\nTemporary password: " + temporaryPassword + "\nChange required: yes\n",
      { mode: 0o600 }
    );
    await fs.chmod(secretPath, 0o600);
    console.log(JSON.stringify({ ok: true, created: true, email, secretPath }));
  } else {
    console.log(JSON.stringify({ ok: true, created: false, email }));
  }
} finally {
  await client.end();
}
