import { query } from "@/lib/db";

export const LIVE_OPERATOR_ROLES = [
  "owner",
  "admin",
  "pastor",
  "presenter_operator",
  "media_operator"
] as const;

export const DEVICE_ADMIN_ROLES = ["owner", "admin"] as const;
export const VOICE_ADMIN_ROLES = ["owner", "admin"] as const;

export const INGEST_ROLES = [
  "owner",
  "admin",
  "presenter_operator",
  "media_operator"
] as const;

export const STREAM_OPERATOR_ROLES = [
  "owner",
  "admin",
  "media_operator"
] as const;

export const TRANSLATION_OPERATOR_ROLES = [
  "owner",
  "admin",
  "translator"
] as const;

export async function userHasAnyRole(
  userId: string,
  organizationId: string,
  allowedRoles: readonly string[]
) {
  const result = await query<{ allowed: boolean }>(
    `select exists(
       select 1
       from user_organization_roles
       where user_id=$1
         and organization_id=$2
         and role_id = any($3::text[])
     ) as allowed`,
    [userId, organizationId, [...allowedRoles]]
  );

  return Boolean(result.rows[0]?.allowed);
}
