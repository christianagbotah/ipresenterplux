import type { PoolClient } from "pg";
import { z } from "zod";
import { LIVE_OPERATOR_ROLES, PLANNER_VIEW_ROLES, THEME_ADMIN_ROLES } from "./role-policy.js";

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i, "Expected a six-digit hex color");
const gradientToken = z.enum(["midnight", "violet_pink", "navy_teal", "ivory_rose"]);
const fontFamily = z.enum(["Inter", "Arial", "Verdana", "Trebuchet MS", "Georgia", "Times New Roman", "Noto Sans", "Noto Serif"]);

export const presentationAppearanceSchema = z.object({
  version: z.literal(1),
  background: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("solid"), value: hexColor }).strict(),
    z.object({ kind: z.literal("gradient"), value: gradientToken }).strict(),
    z.object({ kind: z.literal("image"), value: z.string().uuid() }).strict()
  ]),
  primaryTextColor: hexColor,
  secondaryTextColor: hexColor,
  fontFamily,
  titleSizeScale: z.number().min(0.5).max(2.5),
  bodySizeScale: z.number().min(0.5).max(2.25),
  footerSizeScale: z.number().min(0.5).max(1.75),
  horizontalAlignment: z.enum(["left", "center", "right"]),
  verticalAlignment: z.enum(["top", "center", "bottom"]),
  shadow: z.boolean(),
  backingOpacity: z.number().min(0).max(1),
  safeAreaPercent: z.number().min(0).max(15),
  animation: z.enum(["instant", "fade", "slide", "zoom"]),
  lowerThird: z.object({
    mode: z.enum(["off", "auto", "always"]),
    position: z.enum(["bottom_left", "bottom_center", "bottom_right"])
  }).strict(),
  logo: z.object({
    mediaId: z.string().uuid().nullable(),
    position: z.enum(["top_left", "top_right", "bottom_left", "bottom_right"]),
    sizePercent: z.number().min(1).max(30)
  }).strict()
}).strict();

export type PresentationAppearance = z.infer<typeof presentationAppearanceSchema>;

export const DEFAULT_PRESENTATION_APPEARANCE: PresentationAppearance = {
  version: 1,
  background: { kind: "gradient", value: "midnight" },
  primaryTextColor: "#ffffff",
  secondaryTextColor: "#e5b95e",
  fontFamily: "Inter",
  titleSizeScale: 1,
  bodySizeScale: 1,
  footerSizeScale: 1,
  horizontalAlignment: "center",
  verticalAlignment: "center",
  shadow: true,
  backingOpacity: 0.18,
  safeAreaPercent: 6,
  animation: "fade",
  lowerThird: { mode: "auto", position: "bottom_left" },
  logo: { mediaId: null, position: "top_right", sizePercent: 8 }
};

function themeAppearance(overrides: Partial<PresentationAppearance>): PresentationAppearance {
  return presentationAppearanceSchema.parse({
    ...DEFAULT_PRESENTATION_APPEARANCE,
    ...overrides,
    background: overrides.background ?? DEFAULT_PRESENTATION_APPEARANCE.background,
    lowerThird: overrides.lowerThird ?? DEFAULT_PRESENTATION_APPEARANCE.lowerThird,
    logo: overrides.logo ?? DEFAULT_PRESENTATION_APPEARANCE.logo
  });
}

export const BUILTIN_PRESENTATION_THEMES: ReadonlyArray<{ name: string; templateKey: string; appearance: PresentationAppearance }> = [
  { name: "Sunday Modern", templateKey: "sunday_modern", appearance: themeAppearance({}) },
  { name: "Lower Third Scripture", templateKey: "lower_third_scripture", appearance: themeAppearance({ verticalAlignment: "bottom", bodySizeScale: 0.9, backingOpacity: 0.62, lowerThird: { mode: "always", position: "bottom_left" } }) },
  { name: "Sermon Scripture", templateKey: "sermon_scripture", appearance: themeAppearance({ bodySizeScale: 1.18, safeAreaPercent: 8, animation: "fade" }) },
  { name: "Worship Lyrics", templateKey: "worship_lyrics", appearance: themeAppearance({ bodySizeScale: 1.3, secondaryTextColor: "#dbeafe", animation: "slide" }) },
  { name: "Announcement", templateKey: "announcement", appearance: themeAppearance({ horizontalAlignment: "left", titleSizeScale: 1.25, bodySizeScale: 0.9, safeAreaPercent: 9 }) },
  { name: "Youth Service", templateKey: "youth_service", appearance: themeAppearance({ background: { kind: "gradient", value: "violet_pink" }, secondaryTextColor: "#fde047", animation: "zoom" }) },
  { name: "Conference", templateKey: "conference", appearance: themeAppearance({ background: { kind: "gradient", value: "navy_teal" }, horizontalAlignment: "left", secondaryTextColor: "#67e8f9", safeAreaPercent: 7 }) },
  { name: "Funeral", templateKey: "funeral", appearance: themeAppearance({ background: { kind: "solid", value: "#111827" }, secondaryTextColor: "#d1d5db", animation: "fade", shadow: false }) },
  { name: "Wedding", templateKey: "wedding", appearance: themeAppearance({ background: { kind: "gradient", value: "ivory_rose" }, primaryTextColor: "#3f2d2d", secondaryTextColor: "#9f1239", fontFamily: "Georgia", shadow: false }) }
] as const;

type QueryClient = Pick<PoolClient, "query">;

export function parsePresentationAppearance(value: unknown): PresentationAppearance {
  return presentationAppearanceSchema.parse(value);
}

export function resolvePresentationAppearance(value: unknown): PresentationAppearance {
  const parsed = presentationAppearanceSchema.safeParse(value);
  return parsed.success ? parsed.data : presentationAppearanceSchema.parse(DEFAULT_PRESENTATION_APPEARANCE);
}

export async function ensureBuiltinPresentationThemes(client: QueryClient, organizationId: string, createdBy: string | null) {
  for (const theme of BUILTIN_PRESENTATION_THEMES) {
    await client.query(
      `insert into presentation_themes
        (organization_id,name,template_key,appearance,is_builtin,created_by)
       values ($1::uuid,$2,$3,$4::jsonb,true,$5::uuid)
       on conflict (organization_id,name) do nothing`,
      [organizationId, theme.name, theme.templateKey, JSON.stringify(theme.appearance), createdBy]
    );
  }
}

export async function resolveServicePresentationTheme(client: QueryClient, organizationId: string, serviceId: string) {
  const found = await client.query<{
    service_id: string;
    theme_id: string | null;
    theme_name: string | null;
    template_key: string | null;
    appearance: unknown;
    is_builtin: boolean | null;
  }>(
    `select s.id::text as service_id,
            t.id::text as theme_id,t.name as theme_name,t.template_key,t.appearance,t.is_builtin
       from services s
       left join presentation_themes t
         on t.id=s.active_theme_id and t.organization_id=s.organization_id
      where s.id=$1::uuid and s.organization_id=$2::uuid
      limit 1`,
    [serviceId, organizationId]
  );
  const row = found.rows[0];
  if (!row || !row.theme_id) {
    return { serviceFound: Boolean(row), theme: null, appearance: presentationAppearanceSchema.parse(DEFAULT_PRESENTATION_APPEARANCE) };
  }
  return {
    serviceFound: true,
    theme: { id: row.theme_id, name: row.theme_name!, templateKey: row.template_key!, isBuiltin: Boolean(row.is_builtin) },
    appearance: resolvePresentationAppearance(row.appearance)
  };
}


export const presentationThemeCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  templateKey: z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9_-]*$/),
  appearance: presentationAppearanceSchema
}).strict();

export const presentationThemeUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  templateKey: z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9_-]*$/).optional(),
  appearance: presentationAppearanceSchema.optional()
}).strict().refine((value) => Object.keys(value).length > 0, { message: "At least one theme field is required" });

export class PresentationThemeError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "PresentationThemeError";
    this.status = status;
    this.code = code;
  }
}

type PresentationThemeRow = {
  id: string;
  organization_id: string;
  name: string;
  template_key: string;
  appearance: unknown;
  is_builtin: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

function themeDto(row: PresentationThemeRow) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    templateKey: row.template_key,
    appearance: resolvePresentationAppearance(row.appearance),
    isBuiltin: row.is_builtin,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function requireThemeRole(client: QueryClient, userId: string, organizationId: string, roles: readonly string[], code: string, message: string) {
  const allowed = await client.query<{ allowed: boolean }>(
    `select exists(
       select 1 from user_organization_roles
       where user_id=$1::uuid and organization_id=$2::uuid and role_id=any($3::text[])
     ) as allowed`,
    [userId, organizationId, [...roles]]
  );
  if (!allowed.rows[0]?.allowed) throw new PresentationThemeError(403, code, message);
}

async function themeRowById(client: QueryClient, themeId: string) {
  const found = await client.query<PresentationThemeRow>(
    `select id::text,organization_id::text,name,template_key,appearance,is_builtin,created_by::text,created_at::text,updated_at::text
       from presentation_themes where id=$1::uuid limit 1`,
    [themeId]
  );
  return found.rows[0] ?? null;
}

async function writeThemeAudit(client: QueryClient, organizationId: string, actorUserId: string, action: string, entityId: string, details: Record<string, unknown>, entityType = "presentation_theme") {
  await client.query(
    `insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
     values ($1::uuid,'operator',$2,$3,$4,$5,$6::jsonb)`,
    [organizationId, actorUserId, action, entityType, entityId, JSON.stringify(details)]
  );
}

export async function listPresentationThemes(client: QueryClient, actorUserId: string, organizationId: string) {
  await requireThemeRole(client, actorUserId, organizationId, PLANNER_VIEW_ROLES, "theme_view_forbidden", "You are not allowed to view presentation themes for this organization");
  const result = await client.query<PresentationThemeRow>(
    `select id::text,organization_id::text,name,template_key,appearance,is_builtin,created_by::text,created_at::text,updated_at::text
       from presentation_themes
      where organization_id=$1::uuid
      order by is_builtin desc,name,id`,
    [organizationId]
  );
  return result.rows.map(themeDto);
}

export async function getPresentationTheme(client: QueryClient, actorUserId: string, themeId: string) {
  const row = await themeRowById(client, themeId);
  if (!row) throw new PresentationThemeError(404, "theme_not_found", "Presentation theme not found");
  await requireThemeRole(client, actorUserId, row.organization_id, PLANNER_VIEW_ROLES, "theme_view_forbidden", "You are not allowed to view this presentation theme");
  return themeDto(row);
}

export async function createPresentationTheme(client: QueryClient, actorUserId: string, organizationId: string, input: z.input<typeof presentationThemeCreateSchema>) {
  await requireThemeRole(client, actorUserId, organizationId, THEME_ADMIN_ROLES, "theme_edit_forbidden", "Only owners, administrators and media operators can create presentation themes");
  const data = presentationThemeCreateSchema.parse(input);
  let result;
  try {
    result = await client.query<PresentationThemeRow>(
      `insert into presentation_themes(organization_id,name,template_key,appearance,is_builtin,created_by)
       values ($1::uuid,$2,$3,$4::jsonb,false,$5::uuid)
       returning id::text,organization_id::text,name,template_key,appearance,is_builtin,created_by::text,created_at::text,updated_at::text`,
      [organizationId, data.name, data.templateKey, JSON.stringify(data.appearance), actorUserId]
    );
  } catch (error: unknown) {
    if (typeof error === "object" && error && "code" in error && error.code === "23505") {
      throw new PresentationThemeError(409, "theme_name_conflict", "A presentation theme with this name already exists");
    }
    throw error;
  }
  const row = result.rows[0];
  await writeThemeAudit(client, organizationId, actorUserId, "presentation.theme.created", row.id, { name: row.name, templateKey: row.template_key });
  return themeDto(row);
}

export async function updatePresentationTheme(client: QueryClient, actorUserId: string, themeId: string, input: z.input<typeof presentationThemeUpdateSchema>) {
  const current = await themeRowById(client, themeId);
  if (!current) throw new PresentationThemeError(404, "theme_not_found", "Presentation theme not found");
  await requireThemeRole(client, actorUserId, current.organization_id, THEME_ADMIN_ROLES, "theme_edit_forbidden", "Only owners, administrators and media operators can edit presentation themes");
  if (current.is_builtin) throw new PresentationThemeError(409, "builtin_theme_immutable", "Built-in presentation themes cannot be edited");
  const data = presentationThemeUpdateSchema.parse(input);
  let result;
  try {
    result = await client.query<PresentationThemeRow>(
      `update presentation_themes
          set name=coalesce($2,name),
              template_key=coalesce($3,template_key),
              appearance=coalesce($4::jsonb,appearance),
              updated_at=clock_timestamp()
        where id=$1::uuid and organization_id=$5::uuid
        returning id::text,organization_id::text,name,template_key,appearance,is_builtin,created_by::text,created_at::text,updated_at::text`,
      [themeId, data.name ?? null, data.templateKey ?? null, data.appearance ? JSON.stringify(data.appearance) : null, current.organization_id]
    );
  } catch (error: unknown) {
    if (typeof error === "object" && error && "code" in error && error.code === "23505") {
      throw new PresentationThemeError(409, "theme_name_conflict", "A presentation theme with this name already exists");
    }
    throw error;
  }
  const row = result.rows[0];
  await writeThemeAudit(client, current.organization_id, actorUserId, "presentation.theme.updated", themeId, { fields: Object.keys(data), name: row.name, templateKey: row.template_key });
  return themeDto(row);
}

export async function deletePresentationTheme(client: QueryClient, actorUserId: string, themeId: string) {
  const current = await themeRowById(client, themeId);
  if (!current) throw new PresentationThemeError(404, "theme_not_found", "Presentation theme not found");
  await requireThemeRole(client, actorUserId, current.organization_id, THEME_ADMIN_ROLES, "theme_edit_forbidden", "Only owners, administrators and media operators can delete presentation themes");
  if (current.is_builtin) throw new PresentationThemeError(409, "builtin_theme_immutable", "Built-in presentation themes cannot be deleted");
  await client.query(`delete from presentation_themes where id=$1::uuid and organization_id=$2::uuid`, [themeId, current.organization_id]);
  await writeThemeAudit(client, current.organization_id, actorUserId, "presentation.theme.deleted", themeId, { name: current.name, templateKey: current.template_key });
  return { id: themeId, organizationId: current.organization_id, deleted: true };
}

export async function assignServicePresentationTheme(client: QueryClient, actorUserId: string, serviceId: string, themeId: string | null) {
  const service = await client.query<{ organization_id: string; active_theme_id: string | null }>(
    `select organization_id::text,active_theme_id::text from services where id=$1::uuid for update`,
    [serviceId]
  );
  const row = service.rows[0];
  if (!row) throw new PresentationThemeError(404, "service_not_found", "Service not found");
  await requireThemeRole(client, actorUserId, row.organization_id, LIVE_OPERATOR_ROLES, "theme_assignment_forbidden", "You are not allowed to assign the service presentation theme");
  if (themeId) {
    const theme = await client.query<{ id: string }>(
      `select id::text from presentation_themes where id=$1::uuid and organization_id=$2::uuid limit 1`,
      [themeId, row.organization_id]
    );
    if (!theme.rows[0]) throw new PresentationThemeError(404, "theme_not_found", "Presentation theme not found for this organization");
  }
  await client.query(`update services set active_theme_id=$2::uuid,updated_at=clock_timestamp() where id=$1::uuid`, [serviceId, themeId]);
  await writeThemeAudit(client, row.organization_id, actorUserId, "presentation.theme.assigned", serviceId, { fromThemeId: row.active_theme_id, toThemeId: themeId }, "service");
  return { serviceId, organizationId: row.organization_id, themeId };
}
