"use server";

import { z } from "zod";
import { auth, signOut } from "@auth";
import { query } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/security";

const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(200, "Password is too long.")
  .regex(/[a-z]/, "Include a lowercase letter.")
  .regex(/[A-Z]/, "Include an uppercase letter.")
  .regex(/[0-9]/, "Include a number.");

export async function changePassword(
  _prevState: string | undefined,
  formData: FormData
) {
  const session = await auth();
  if (!session?.user?.id) return "Your session has expired. Sign in again.";

  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (newPassword !== confirmPassword) return "The new passwords do not match.";

  const parsed = passwordSchema.safeParse(newPassword);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "Choose a stronger password.";

  const users = await query<{ password_hash: string | null }>(
    "select password_hash from users where id=$1 and status='active' limit 1",
    [session.user.id]
  );
  const user = users.rows[0];
  if (!user || !(await verifyPassword(currentPassword, user.password_hash))) {
    return "Current password is incorrect.";
  }

  if (await verifyPassword(newPassword, user.password_hash)) {
    return "Choose a new password that is different from the current password.";
  }

  const newHash = await hashPassword(newPassword);
  await query(
    "update users set password_hash=$2,force_password_change=false,updated_at=now() where id=$1",
    [session.user.id, newHash]
  );

  const memberships = await query<{ organization_id: string }>(
    "select organization_id::text from user_organization_roles where user_id=$1 order by created_at limit 1",
    [session.user.id]
  );
  if (memberships.rows[0]) {
    await query(
      `insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
       values ($1,'operator',$2,'user.password.changed','user',$2,'{}'::jsonb)`,
      [memberships.rows[0].organization_id, session.user.id]
    );
  }

  await signOut({ redirectTo: "/login?passwordChanged=1" });
}
